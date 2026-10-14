// The custom-model order service (PRODUCT_SPEC §7, BUILD_PLAN §7 C-T4, §13.3): request
// validation, the status machine, the one idempotent markOrderPaid(), delivery into a
// product, refunds, expiry and the revenue report. Routes live in server/routes/orders.mjs.
//
//   draft ─checkout─▶ pending_payment ─paid─▶ paid ─start─▶ in_progress ─deliver (all items)─▶ delivered ─accept─▶ completed
//     │                  │ decline / 24 h                                 ▲                       │
//     └─cancel─▶ cancelled ▼ payment_failed / expired                     └── revision (≤ 2) ◀─────┘
//   paid / in_progress / revision_requested / delivered ─refund─▶ refunded
//
// Every transition is a conditional UPDATE (… WHERE status IN (…)) and writes an
// order_events row only when it changed something, so replays are harmless.

import fs from 'node:fs';
import { HttpError } from '../http/respond.mjs';
import { randomId, FILE_ID_RE, PRODUCT_ID_RE, BUILTIN_ID_RE } from '../lib/ids.mjs';
import { KIND_SET, KIND_CATEGORY, VARIANTS } from '../catalog/kinds.mjs';
import { quote, tierById, addBusinessDays, MAX_ITEMS, MAX_EXTRA_FINISHES, REVISIONS, CURRENCY } from './tiers.mjs';

export const ORDER_STATUSES = Object.freeze([
  'draft',
  'pending_payment',
  'payment_failed',
  'paid',
  'in_progress',
  'delivered',
  'revision_requested',
  'completed',
  'cancelled',
  'refunded',
  'expired',
]);
export const TARGETS = Object.freeze(['customer', 'brand', 'contractor']);
/** Not yet paid; these expire 24 h after the last checkout started (or creation). */
export const UNPAID = Object.freeze(['draft', 'pending_payment', 'payment_failed']);
/**
 * States a payment may land in. A real payment must never be dropped, so a payment that
 * arrives after the order expired or was cancelled (an old Stripe tab) is still honoured.
 */
export const PAYABLE = Object.freeze([...UNPAID, 'expired', 'cancelled']);
export const REFUNDABLE = Object.freeze(['paid', 'in_progress', 'revision_requested', 'delivered']);
/** What the studio queue shows by default. */
export const ACTIVE = Object.freeze(['paid', 'in_progress', 'revision_requested']);
export const EXPIRY_MS = 24 * 3_600_000;
export const MAX_REFERENCES = 8;
export const MAX_NOTES = 4_000;
const DAY = 86_400_000;

const IMAGE_EXTS = new Set(['png', 'jpg', 'webp']);
const TYPE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (n) => Math.round(n * 100) / 100;
const parse = (s, fallback = null) => {
  if (s == null) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

/** A 400 carrying field errors, like the product editor's. */
const invalid = (errors, message = 'Some details of the request need fixing.') => new HttpError(400, message, { errors });

/**
 * @param {{ db: any, now: () => number, services: any, config: any, log?: any, tx: (fn: Function) => any }} deps
 */
export function createOrderService({ db, now, services, config, log = console, tx }) {
  const { files, products, brands, auth, billing } = services;

  // ── reading ─────────────────────────────────────────────────────────────
  const rowOf = (id) => (typeof id === 'string' && /^o_[a-z0-9]{24}$/.test(id) ? db.prepare('SELECT * FROM orders WHERE id = ?').get(id) ?? null : null);
  const itemsOf = (id) =>
    db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY idx')
      .all(id)
      .map((r) => ({
        idx: r.idx,
        brief: parse(r.brief, {}),
        tier: r.tier,
        extraFinishes: r.extra_finishes,
        amountCents: r.amount_cents,
        deliverableProductId: r.deliverable_product_id ?? null,
        deliveredAt: r.delivered_at ?? null,
      }));
  const eventsOf = (id) =>
    db
      .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id')
      .all(id)
      .map((r) => ({
        id: r.id,
        orderId: r.order_id,
        type: r.type,
        fromStatus: r.from_status ?? null,
        toStatus: r.to_status ?? null,
        byUserId: r.by_user_id ?? null,
        note: r.note,
        data: parse(r.data, null),
        createdAt: r.created_at,
      }));

  /** The request's quote, recomputed from its stored items (prices come only from tiers.mjs). */
  const quoteOf = (row, items = itemsOf(row.id)) => {
    const extras = parse(row.extras, {});
    return quote({ items: items.map((it) => ({ tier: it.tier, extraFinishes: it.extraFinishes, name: it.brief?.name })), rush: extras.rush === true });
  };

  const titleOf = (row, items) => {
    if (items.length > 1) return `${row.line || items[0]?.brief?.name || 'Custom models'} · ${items.length} products`;
    return items[0]?.brief?.name || 'Custom model';
  };

  /** The order as the client sees it (BUILD_PLAN §3.8 `Order`, plus items and a few derived fields). */
  function toWire(row, items = itemsOf(row.id)) {
    const extras = parse(row.extras, {});
    const q = quoteOf(row, items);
    const brand = row.brand_id ? brands.get(row.brand_id) : null;
    return {
      id: row.id,
      userId: row.user_id ?? null,
      target: row.target,
      brandId: row.brand_id ?? null,
      brandName: brand?.name ?? null,
      status: row.status,
      tier: row.tier,
      extras: { extraFinishes: Number(extras.extraFinishes) || 0, rush: extras.rush === true },
      amountCents: row.amount_cents,
      currency: row.currency,
      provider: row.provider,
      brief: parse(row.brief, {}),
      refProductId: row.ref_product_id ?? null,
      deliverableProductId: row.deliverable_product_id ?? null,
      assignedTo: row.assigned_to ?? null,
      revisionsUsed: row.revisions_used,
      revisionsAllowed: REVISIONS,
      line: row.line || null,
      title: titleOf(row, items),
      items,
      quote: { amountCents: q.amountCents, currency: q.currency, dueBusinessDays: q.dueBusinessDays, lines: q.lines },
      expiresAt: UNPAID.includes(row.status) ? row.pending_since + EXPIRY_MS : null,
      dueAt: row.due_at ?? null,
      paidAt: row.paid_at ?? null,
      deliveredAt: row.delivered_at ?? null,
      completedAt: row.completed_at ?? null,
      refundedAt: row.refunded_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── writing ─────────────────────────────────────────────────────────────
  function addEvent(orderId, { type, from = null, to = null, by = null, note = '', data = null }) {
    db.prepare('INSERT INTO order_events (order_id, type, from_status, to_status, by_user_id, note, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      orderId,
      type,
      from,
      to,
      by,
      String(note ?? '').slice(0, 4000),
      data == null ? null : JSON.stringify(data),
      now(),
    );
  }

  /**
   * Moves the order from one of `from` to `to` with a conditional UPDATE, plus extra column
   * assignments. Writes an event only when a row changed. Returns true when it changed.
   * @param {Record<string, any>} [set]  column → value, or `{ sql, args }` for an expression
   *   (SET expressions see the row as it was before this UPDATE)
   */
  function transition(orderId, from, to, { by = null, type = to, note = '', data = null, set = {} } = {}) {
    return tx(() => {
      const before = rowOf(orderId);
      if (!before || !from.includes(before.status)) return false;
      const cols = ['status = ?', 'updated_at = ?'];
      const args = [to, now()];
      for (const [k, v] of Object.entries(set)) {
        if (v && typeof v === 'object' && 'sql' in v) {
          cols.push(`${k} = ${v.sql}`);
          args.push(...(v.args ?? []));
        } else {
          cols.push(`${k} = ?`);
          args.push(v);
        }
      }
      const res = db.prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`).run(...args, orderId, ...from);
      if (!res.changes) return false;
      addEvent(orderId, { type, from: before.status, to, by, note, data });
      return true;
    });
  }

  /**
   * THE place an order becomes paid, for both providers (PRODUCT_SPEC §7.4). Idempotent: a
   * second call (webhook replay, the success-page sync, a double click) changes nothing.
   * The amount and currency must match the server's own quote, or nothing is fulfilled.
   * @returns {{ ok: boolean, changed: boolean, reason?: string }}
   */
  function markOrderPaid(orderId, { ref = null, amountCents, currency, paymentIntent = null, by = null, source = 'unknown' } = {}) {
    return tx(() => {
      const o = rowOf(orderId);
      if (!o) return { ok: false, changed: false, reason: 'unknown_order' };
      const cur = String(currency ?? '').toLowerCase();
      if (amountCents !== o.amount_cents || cur !== o.currency) {
        log.warn?.(`order ${orderId}: payment of ${amountCents} ${cur} does not match ${o.amount_cents} ${o.currency}; not fulfilled`);
        addEvent(orderId, {
          type: 'payment_mismatch',
          note: 'A payment arrived for a different amount than this order’s price, so the order was not fulfilled. Staff will look into it.',
          data: { source, ref, amountCents: amountCents ?? null, currency: cur || null },
        });
        return { ok: false, changed: false, reason: 'amount_mismatch' };
      }
      if (!PAYABLE.includes(o.status)) return { ok: true, changed: false };
      const t = now();
      const q = quoteOf(o);
      const late = o.status === 'expired' || o.status === 'cancelled';
      const changed = transition(orderId, PAYABLE, 'paid', {
        by,
        type: 'paid',
        note: late ? `The payment arrived after the order was ${o.status === 'expired' ? 'expired' : 'cancelled'}; it has been honoured.` : '',
        data: { source, ref },
        set: {
          paid_at: t,
          due_at: addBusinessDays(t, q.dueBusinessDays),
          provider_ref: { sql: 'COALESCE(?, provider_ref)', args: [ref] },
          payment_intent: { sql: 'COALESCE(?, payment_intent)', args: [paymentIntent] },
        },
      });
      return { ok: true, changed };
    });
  }

  /** Expires unpaid orders whose checkout window (24 h) has passed. Returns how many. */
  function sweepExpired() {
    const cutoff = now() - EXPIRY_MS;
    const stale = db.prepare(`SELECT id FROM orders WHERE status IN ('draft','pending_payment','payment_failed') AND pending_since < ?`).all(cutoff);
    let n = 0;
    for (const { id } of stale) {
      if (transition(id, UNPAID, 'expired', { type: 'expired', note: 'Not paid within 24 hours.' })) n++;
    }
    return n;
  }

  /** Refunded: archive what was delivered (kitchens keep their snapshots). Idempotent. */
  function markRefunded(orderId, { ref = null, by = null, note = '', source = 'admin' } = {}) {
    return tx(() => {
      const changed = transition(orderId, [...REFUNDABLE, 'completed'], 'refunded', {
        by,
        type: 'refunded',
        note,
        data: { source, ref },
        set: { refunded_at: now(), refund_ref: ref },
      });
      if (!changed) return false;
      for (const it of itemsOf(orderId)) {
        const p = it.deliverableProductId ? products.get(it.deliverableProductId) : null;
        if (p && p.status !== 'archived') products.archive(p.id);
      }
      return true;
    });
  }

  // ── request validation ──────────────────────────────────────────────────
  function readBrief(input, at, errors, user) {
    const err = (f, m) => errors.push({ field: `${at}.${f}`, message: m });
    if (!isObj(input)) {
      errors.push({ field: at, message: 'Describe the product to model.' });
      return null;
    }
    const b = {};
    if (typeof input.productTypeId !== 'string' || !TYPE_ID_RE.test(input.productTypeId)) err('productTypeId', 'Choose a product type.');
    else b.productTypeId = input.productTypeId;
    if (!KIND_SET.has(input.kind)) err('kind', 'Choose a product type.');
    else {
      b.kind = input.kind;
      b.category = KIND_CATEGORY[input.kind];
      if (input.variant != null && input.variant !== '') {
        if (!VARIANTS[input.kind]?.includes(input.variant)) err('variant', 'That variant doesn’t match the product type.');
        else b.variant = input.variant;
      }
    }
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) err('name', 'Name the product.');
    else if (name.length > 80) err('name', 'Keep the name to 80 characters or fewer.');
    else b.name = name;
    for (const [k, lo, hi, label] of [
      ['widthIn', 1, 240, 'Width'],
      ['depthIn', 1, 120, 'Depth'],
      ['heightIn', 0.25, 144, 'Height'],
    ]) {
      if (!isNum(input[k]) || input[k] < lo || input[k] > hi) err(k, `${label} must be between ${lo} and ${hi} inches.`);
      else b[k] = round2(input[k]);
    }
    if (input.elevationIn != null) {
      if (!isNum(input.elevationIn) || input.elevationIn < 0 || input.elevationIn > 120) err('elevationIn', 'Height off the floor must be between 0 and 120 inches.');
      else b.elevationIn = round2(input.elevationIn);
    }
    const notes = input.notes == null ? '' : typeof input.notes === 'string' ? input.notes.trim() : null;
    if (notes === null) err('notes', 'Notes must be text.');
    else if (notes.length > MAX_NOTES) err('notes', `Keep notes to ${MAX_NOTES.toLocaleString('en-US')} characters or fewer.`);
    else b.notes = notes;

    const refs = input.referenceFileIds ?? [];
    if (!Array.isArray(refs) || refs.length > MAX_REFERENCES || !refs.every((id) => typeof id === 'string' && FILE_ID_RE.test(id))) {
      err('referenceFileIds', `Add up to ${MAX_REFERENCES} reference photos.`);
    } else {
      b.referenceFileIds = [...new Set(refs)];
      for (const id of b.referenceFileIds) {
        const f = files.get(id);
        // Only the caller's own uploads, of kind `reference`, and only photos.
        if (!f || f.ownerUserId !== user.id || f.kind !== 'reference') {
          err('referenceFileIds', 'One of the reference photos can’t be used here. Upload it again.');
          break;
        }
        if (!IMAGE_EXTS.has(f.ext)) {
          err('referenceFileIds', 'Reference photos must be PNG, JPEG or WebP images.');
          break;
        }
      }
    }
    if (input.refProductId != null && input.refProductId !== '') {
      const id = input.refProductId;
      if (typeof id !== 'string') err('refProductId', 'That reference product isn’t valid.');
      else if (PRODUCT_ID_RE.test(id)) {
        const p = products.get(id);
        if (!p || !products.inCatalog(p, user)) err('refProductId', 'That reference product isn’t available.');
        else b.refProductId = id;
      } else if (BUILTIN_ID_RE.test(id)) b.refProductId = id;
      else err('refProductId', 'That reference product isn’t valid.');
    }
    if (b.referenceFileIds && !b.referenceFileIds.length && !b.refProductId && !errors.some((e) => e.field.startsWith(`${at}.reference`))) {
      err('referenceFileIds', 'Add at least one reference photo (or start from a catalog product).');
    }
    return b;
  }

  /**
   * Validates a request body: `{ target, brandId?, line?, rush?, items: [{ brief, tier, extraFinishes }] }`,
   * or the single-item form `{ target, brief, tier, extraFinishes, rush }`. Any amount the client
   * sends is ignored. Throws a 400 with field errors, a 404 for a brand the caller isn't in,
   * or a 403 for a contractor request without the Contractor plan.
   */
  function readRequest(body, user) {
    const errors = [];
    const target = body.target ?? 'customer';
    if (!TARGETS.includes(target)) throw invalid([{ field: 'target', message: 'Choose who the model is for.' }]);
    let brandId = null;
    if (target === 'brand') {
      brandId = typeof body.brandId === 'string' ? body.brandId : '';
      if (!brandId || !auth.isBrandMember(user.id, brandId)) throw new HttpError(404, 'Not found.');
    }
    if (target === 'contractor' && billing.planOf(user.id).id !== 'contractor') {
      throw new HttpError(403, 'Modelling for My catalog is part of the Contractor plan.', { needs: 'contractor' });
    }
    let line = '';
    if (body.line != null && body.line !== '') {
      if (typeof body.line !== 'string' || body.line.trim().length > 60) errors.push({ field: 'line', message: 'Keep the line name to 60 characters or fewer.' });
      else line = body.line.trim();
    }
    if (body.rush != null && typeof body.rush !== 'boolean') errors.push({ field: 'rush', message: 'Rush is on or off.' });
    const rawItems = Array.isArray(body.items) ? body.items : body.brief !== undefined ? [{ brief: body.brief, tier: body.tier, extraFinishes: body.extraFinishes }] : null;
    if (!rawItems || !rawItems.length) throw invalid([{ field: 'items', message: 'Add a product to model.' }]);
    if (rawItems.length > MAX_ITEMS) throw invalid([{ field: 'items', message: `One request can hold up to ${MAX_ITEMS} products.` }]);
    const items = rawItems.map((it, i) => {
      const at = `items[${i}]`;
      if (!isObj(it)) {
        errors.push({ field: at, message: 'Describe the product to model.' });
        return null;
      }
      const brief = readBrief(it.brief, `${at}.brief`, errors, user);
      if (!tierById(it.tier)) errors.push({ field: `${at}.tier`, message: 'Choose a model tier.' });
      const ef = it.extraFinishes ?? 0;
      if (!Number.isInteger(ef) || ef < 0 || ef > MAX_EXTRA_FINISHES) errors.push({ field: `${at}.extraFinishes`, message: `Extra finishes: a whole number from 0 to ${MAX_EXTRA_FINISHES}.` });
      return { brief, tier: it.tier, extraFinishes: Number.isInteger(ef) ? ef : 0 };
    });
    if (errors.length) throw invalid(errors);
    return { target, brandId, line, rush: body.rush === true, items };
  }

  /** Creates a draft order from a validated request. Returns the row. (`id` is for seeds only.) */
  function create(user, req, { id = randomId('o_') } = {}) {
    const q = quote({ items: req.items.map((it) => ({ tier: it.tier, extraFinishes: it.extraFinishes, name: it.brief.name })), rush: req.rush });
    const t = now();
    tx(() => {
      db.prepare(
        `INSERT INTO orders (id, user_id, target, brand_id, status, tier, extras, amount_cents, currency, provider, brief, line, ref_product_id,
                             pending_since, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        user.id,
        req.target,
        req.brandId,
        req.items[0].tier,
        JSON.stringify({ rush: req.rush, extraFinishes: req.items.reduce((s, it) => s + it.extraFinishes, 0) }),
        q.amountCents,
        CURRENCY,
        config.paymentsProvider,
        JSON.stringify(req.items[0].brief),
        req.line,
        req.items[0].brief.refProductId ?? null,
        t,
        t,
        t,
      );
      const ins = db.prepare('INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, ?, ?, ?, ?, ?)');
      req.items.forEach((it, i) => ins.run(id, i, JSON.stringify(it.brief), it.tier, it.extraFinishes, q.items[i].amountCents));
      addEvent(id, { type: 'created', to: 'draft', by: user.id, data: { items: req.items.length, amountCents: q.amountCents } });
    });
    return rowOf(id);
  }

  // ── delivery ────────────────────────────────────────────────────────────
  /** A copy of `file` owned by the order's buyer (or brand), so the deliverable is theirs to keep and edit. */
  function copyFile(file, { ownerUserId, brandId = null }) {
    const buf = fs.readFileSync(files.blobPath(file.sha256, file.ext));
    return files.saveBuffer(buf, { kind: file.kind, visibility: 'private', ownerUserId, brandId, originalName: file.originalName });
  }

  /** The GLB report the studio sees: size, triangles, slots, warnings and >5% axis mismatches. */
  function glbReport(file, dims) {
    const meta = file.meta ?? {};
    const warnings = [...(meta.warnings ?? [])];
    const bb = meta.bboxIn ?? null;
    const axes = [];
    if (bb && dims) {
      for (const [axis, got, want] of [
        ['width', bb.w, dims.widthIn],
        ['height', bb.h, dims.heightIn],
        ['depth', bb.d, dims.depthIn],
      ]) {
        const off = want > 0 ? Math.abs(got - want) / want : 0;
        axes.push({ axis, modelIn: round2(got), declaredIn: want, offPct: Math.round(off * 1000) / 10 });
        if (off > 0.05) warnings.push(`The model’s ${axis} is ${round2(got)}″ but the brief says ${want}″ (${Math.round(off * 100)}% off). It is scaled to fit in kitchens.`);
      }
    }
    return { sizeBytes: file.sizeBytes, triangles: meta.triangles ?? null, slots: meta.slots ?? [], materials: meta.materials ?? [], bboxIn: bb, axes, warnings };
  }

  /**
   * Delivers one item: validates the studio's GLB + thumbnail, copies them to the buyer (or
   * brand), and creates (or, on a revision round, updates) the product:
   *   customer   → source 'custom', private, owned by the buyer, published live
   *   contractor → source 'contractor', private, owned by the buyer, live in My catalog
   *   brand      → source 'brand', a draft in that brand (normal moderation applies)
   * The order becomes `delivered` once every item has a deliverable.
   */
  function deliver(orderId, studioUser, body) {
    const o = rowOf(orderId);
    if (!o) throw new HttpError(404, 'That order does not exist.');
    if (o.status !== 'in_progress') throw new HttpError(409, o.status === 'paid' || o.status === 'revision_requested' ? 'Start the order before delivering.' : 'This order isn’t in progress.');
    const items = itemsOf(orderId);
    const idx = body.item ?? 0;
    const item = Number.isInteger(idx) ? items.find((it) => it.idx === idx) : null;
    if (!item) throw invalid([{ field: 'item', message: 'Choose which product you are delivering.' }]);
    const model = files.assertUsable(String(body.modelFileId ?? ''), { userId: studioUser.id, kinds: ['model'] });
    if (model.ext !== 'glb') throw invalid([{ field: 'modelFileId', message: 'Deliver a .glb model.' }]);
    const thumb = files.assertUsable(String(body.thumbFileId ?? ''), { userId: studioUser.id, kinds: ['image'] });

    const brief = item.brief;
    const d = isObj(body.dims) ? body.dims : {};
    const dims = {
      widthIn: isNum(d.widthIn) ? d.widthIn : brief.widthIn,
      depthIn: isNum(d.depthIn) ? d.depthIn : brief.depthIn,
      heightIn: isNum(d.heightIn) ? d.heightIn : brief.heightIn,
      elevationIn: isNum(d.elevationIn) ? d.elevationIn : brief.elevationIn ?? 0,
    };
    let price = 0;
    if (body.price != null) {
      if (!isNum(body.price) || body.price < 0 || body.price > 1_000_000) throw invalid([{ field: 'price', message: 'Price must be between $0 and $1,000,000.' }]);
      price = round2(body.price);
    } else if (brief.refProductId && PRODUCT_ID_RE.test(brief.refProductId)) {
      price = products.get(brief.refProductId)?.spec?.price ?? 0;
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : brief.name;
    const finishes = body.finishes ?? [{ id: 'as-modelled', name: 'As modelled', hex: '#d6d0c6', material: 'paint' }];
    const report = glbReport(model, dims);

    const buyerId = o.user_id;
    if (!buyerId) throw new HttpError(409, 'The buyer’s account no longer exists.');
    const owner = o.target === 'brand' ? { ownerUserId: buyerId, brandId: o.brand_id } : { ownerUserId: buyerId };
    if (o.target === 'brand' && (!o.brand_id || !brands.get(o.brand_id))) throw new HttpError(409, 'The brand this order was for no longer exists.');

    const result = tx(() => {
      const glb = copyFile(model, owner);
      const img = copyFile(thumb, owner);
      const spec = {
        kind: brief.kind,
        ...(brief.variant ? { variant: brief.variant } : {}),
        category: brief.category ?? KIND_CATEGORY[brief.kind],
        name,
        blurb: 'Custom 3D model made by the BluModel 3D studio.',
        sku: '',
        ...dims,
        price,
        finishes,
        imageFileIds: [img.id],
        modelFileId: glb.id,
        ...(o.line ? { line: o.line } : {}),
      };
      let product;
      const existing = item.deliverableProductId ? products.get(item.deliverableProductId) : null;
      if (existing && existing.status !== 'archived') {
        product = products.update(existing.id, spec, { force: true });
        if (o.target !== 'brand') product = products.publish(product.id);
      } else if (o.target === 'brand') {
        product = products.create({ source: 'brand', brandId: o.brand_id, visibility: 'public', spec, status: 'draft' });
      } else {
        product = products.create({ source: o.target === 'contractor' ? 'contractor' : 'custom', ownerUserId: buyerId, visibility: 'private', spec, status: 'draft' });
        product = products.publish(product.id);
      }
      const t = now();
      db.prepare('UPDATE order_items SET deliverable_product_id = ?, delivered_at = ? WHERE order_id = ? AND idx = ?').run(product.id, t, orderId, item.idx);
      const all = itemsOf(orderId);
      const done = all.every((it) => it.deliverableProductId);
      const data = { item: item.idx, productId: product.id, warnings: report.warnings };
      if (done) {
        transition(orderId, ['in_progress'], 'delivered', {
          by: studioUser.id,
          type: 'delivered',
          data,
          // The first delivery counts for turnaround; a revision round keeps it.
          set: { delivered_at: { sql: 'COALESCE(delivered_at, ?)', args: [t] }, deliverable_product_id: all[0].deliverableProductId },
        });
      } else {
        addEvent(orderId, { type: 'item_delivered', by: studioUser.id, note: `Delivered ${all.filter((it) => it.deliverableProductId).length} of ${all.length}.`, data });
        db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(t, orderId);
      }
      return { product, done };
    });
    return { ...result, report };
  }

  // ── revenue ─────────────────────────────────────────────────────────────
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

  /** Orders-only revenue for one provider over the last `days` (cents; G owns subscriptions). */
  function revenue({ days, provider }) {
    const end = now();
    const since = end - days * DAY;
    const paid = db.prepare('SELECT id, amount_cents, paid_at, delivered_at FROM orders WHERE provider = ? AND paid_at IS NOT NULL AND paid_at >= ?').all(provider, since);
    const refunded = db.prepare('SELECT id, amount_cents, refunded_at FROM orders WHERE provider = ? AND refunded_at IS NOT NULL AND refunded_at >= ?').all(provider, since);
    const tiers = db
      .prepare(
        `SELECT i.tier AS tier, COUNT(*) AS items, SUM(i.amount_cents) AS gross FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.provider = ? AND o.paid_at IS NOT NULL AND o.paid_at >= ? GROUP BY i.tier`,
      )
      .all(provider, since);
    const gross = paid.reduce((s, r) => s + r.amount_cents, 0);
    const refunds = refunded.reduce((s, r) => s + r.amount_cents, 0);
    const byDayMap = new Map();
    for (let t = since; t <= end + DAY; t += DAY) {
      const k = dayOf(t);
      if (k > dayOf(end)) break;
      byDayMap.set(k, { day: k, gross: 0, refunds: 0, count: 0 });
    }
    for (const r of paid) {
      const b = byDayMap.get(dayOf(r.paid_at));
      if (b) {
        b.gross += r.amount_cents;
        b.count++;
      }
    }
    for (const r of refunded) {
      const b = byDayMap.get(dayOf(r.refunded_at));
      if (b) b.refunds += r.amount_cents;
    }
    const turn = paid.filter((r) => r.delivered_at).map((r) => (r.delivered_at - r.paid_at) / DAY);
    return {
      gross,
      refunds,
      net: gross - refunds,
      count: paid.length,
      refundCount: refunded.length,
      byTier: ['simple', 'standard', 'complex'].map((id) => {
        const r = tiers.find((x) => x.tier === id);
        return { tier: id, items: r?.items ?? 0, gross: r?.gross ?? 0 };
      }),
      byDay: [...byDayMap.values()],
      avgTurnaroundDays: turn.length ? Math.round((turn.reduce((s, x) => s + x, 0) / turn.length) * 10) / 10 : null,
    };
  }

  return {
    rowOf,
    itemsOf,
    eventsOf,
    quoteOf,
    toWire,
    addEvent,
    transition,
    markOrderPaid,
    markRefunded,
    sweepExpired,
    readRequest,
    create,
    deliver,
    glbReport,
    revenue,
  };
}
