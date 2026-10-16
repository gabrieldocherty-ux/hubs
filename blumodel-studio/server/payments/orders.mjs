// The custom-model order service (PRODUCT_SPEC §7, BUILD_PLAN §7 C-T4, §13.3): request
// validation, the status machine, the one idempotent markOrderPaid(), delivery into a
// product, refunds, expiry and the revenue report. Routes live in server/routes/orders.mjs.
//
// Since 2026-10-15 custom models are not sold: they come with the Contractor plan (INCLUDED_MODELS
// a month, server/payments/allowance.mjs). A new request is an order with tier and provider 'plan',
// amount 0, that goes straight to the studio's queue ('paid' is the queue's "ready to start"):
//
//   submit (allowance checked) ─▶ paid ─start─▶ in_progress ─deliver (all items)─▶ delivered ─accept─▶ completed
//                                  │                ▲                                  │
//        cancel before it starts ─▶ cancelled       └──────── revision (≤ 2) ◀─────────┘
//        (the models go back to that period's allowance)
//
// Orders placed before then were paid for and keep their stored prices, currency and refund path:
//
//   draft ─checkout─▶ pending_payment ─paid─▶ paid ─start─▶ in_progress … (as above)
//     │                  │ decline / 24 h
//     └─cancel─▶ cancelled ▼ payment_failed / expired
//   paid / in_progress / revision_requested / delivered ─refund─▶ refunded
//
// Every transition is a conditional UPDATE (… WHERE status IN (…)) and writes an
// order_events row only when it changed something, so replays are harmless.

import fs from 'node:fs';
import { HttpError } from '../http/respond.mjs';
import { randomId, FILE_ID_RE, PRODUCT_ID_RE, BUILTIN_ID_RE } from '../lib/ids.mjs';
import { KIND_SET, KIND_CATEGORY, VARIANTS } from '../catalog/kinds.mjs';
import { includedQuote, legacyQuote, addBusinessDays, PACK, LEGACY_TIERS, MAX_ITEMS, REVISIONS, MODEL_TERMS, CURRENCY } from './tiers.mjs';
import { normalizeUpc } from './upc.mjs';
import { createAllowance } from './allowance.mjs';

const PRODUCTS_PER_PACK = PACK.productsPerPack;

const LEGACY_IDS = LEGACY_TIERS.map((t) => t.id);

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
/** The tier and provider of a request included in the Contractor plan (nothing paid). */
export const PLAN = 'plan';
export const EXPIRY_MS = 24 * 3_600_000;
export const MAX_REFERENCES = 8;
export const MAX_NOTES = 4_000;
export const MAX_BRAND = 60;
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
  const allowance = createAllowance({ db, now, billing, config });

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

  /** A request included in the Contractor plan: nothing was or will be paid for it. */
  const isPlan = (row) => row.tier === PLAN || row.provider === PLAN;
  /** A Model-pack order (tier 'pack', 14-15 October 2026, never live); older ones used the retired tiers. */
  const isPack = (row) => row.tier === PACK.id;

  /**
   * The order's quote, from what is STORED on it, never re-priced: a pack order keeps the lines
   * and turnaround tiers.mjs gave it when it was created (in `extras.quote`), and an order from
   * before packs is rebuilt from its items' stored amounts. Either way `amountCents` is
   * `orders.amount_cents`, the one amount checkout charges and a payment must match.
   */
  const quoteOf = (row, items = itemsOf(row.id)) => {
    const extras = parse(row.extras, {});
    const rush = extras.rush === true;
    const saved = isObj(extras.quote) && Array.isArray(extras.quote.lines) ? extras.quote : null;
    if (isPlan(row)) {
      const q = includedQuote(Math.max(1, Math.min(MAX_ITEMS, items.length || 1)), row.currency);
      return { ...q, products: items.length, amountCents: row.amount_cents, dueBusinessDays: Number(saved?.dueBusinessDays) || q.dueBusinessDays, items: items.map(() => ({ amountCents: 0 })) };
    }
    if (isPack(row) && saved) {
      return {
        pricing: 'pack',
        amountCents: row.amount_cents,
        currency: row.currency,
        dueBusinessDays: Number(saved.dueBusinessDays) || PACK.businessDays,
        rush,
        products: items.length,
        packs: Number(saved.packs) || 1,
        items: items.map((it) => ({ pack: Math.floor(it.idx / PRODUCTS_PER_PACK) + 1, amountCents: it.amountCents })),
        lines: saved.lines.map((l) => ({ label: String(l.label), amountCents: Number(l.amountCents), ...(l.pack ? { pack: Number(l.pack) } : {}) })),
      };
    }
    // In the order's own currency (every order from before 2026-10-15 is USD).
    return legacyQuote({ items: items.map((it) => ({ tier: it.tier, extraFinishes: it.extraFinishes, amountCents: it.amountCents, name: it.brief?.name })), rush, amountCents: row.amount_cents, currency: row.currency });
  };

  const titleOf = (row, items) => {
    if (items.length > 1) return `${row.line || items[0]?.brief?.name || 'Custom models'} · ${items.length} products`;
    return items[0]?.brief?.name || 'Custom model';
  };

  /**
   * What checkout sends the payment provider: the stored quote's lines when they add up to the
   * order's amount (they always should), otherwise one line for the whole amount, so a provider
   * can never be asked for anything but `orders.amount_cents`.
   */
  function checkoutLines(row, items = itemsOf(row.id)) {
    const q = quoteOf(row, items);
    const lines = q.lines.filter((l) => Number.isInteger(l.amountCents) && l.amountCents > 0);
    const sum = lines.reduce((s, l) => s + l.amountCents, 0);
    const what = isPack(row) ? `custom 3D models (${items.length} product${items.length === 1 ? '' : 's'})` : 'custom 3D model';
    if (sum !== row.amount_cents || !lines.length) return [{ label: `BluModel Studio - ${what}: ${titleOf(row, items)}`, amountCents: row.amount_cents }];
    return lines.map((l) => ({ label: `BluModel Studio - ${l.label}`, amountCents: l.amountCents }));
  }

  /** The order as the client sees it (BUILD_PLAN §3.8 `Order`, plus items and a few derived fields). */
  function toWire(row, items = itemsOf(row.id)) {
    const extras = parse(row.extras, {});
    const q = quoteOf(row, items);
    const brand = row.brand_id ? brands.get(row.brand_id) : null;
    const pack = isPack(row);
    const plan = isPlan(row);
    return {
      id: row.id,
      userId: row.user_id ?? null,
      target: row.target,
      brandId: row.brand_id ?? null,
      brandName: brand?.name ?? null,
      status: row.status,
      tier: row.tier,
      /**
       * 'plan' (included in the Contractor plan, nothing paid), or for an order placed before
       * 2026-10-15 'pack' / 'tiers' (paid, at its stored price and currency).
       */
      pricing: q.pricing,
      packs: pack ? q.packs : 0,
      finishesPerModel: plan ? MODEL_TERMS.finishesPerModel : pack ? PACK.finishesPerModel : null,
      /** The allowance period a plan request counted against (null for a paid order). */
      planPeriod: plan && row.plan_period_start ? { start: row.plan_period_start, end: row.plan_period_end } : null,
      /** Whether the buyer can still withdraw it (a plan request the studio hasn't started). */
      cancellable: plan ? row.status === 'paid' : UNPAID.includes(row.status),
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
      items: pack ? items.map((it) => ({ ...it, pack: Math.floor(it.idx / PRODUCTS_PER_PACK) + 1 })) : items,
      quote: { pricing: q.pricing, amountCents: q.amountCents, currency: q.currency, dueBusinessDays: q.dueBusinessDays, packs: q.packs, products: q.products, rush: q.rush, lines: q.lines },
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
      if (isPlan(o)) return { ok: false, changed: false, reason: 'not_payable' }; // included in the plan: nothing to pay
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
    if (input.brand != null && input.brand !== '') {
      const brand = typeof input.brand === 'string' ? input.brand.trim() : null;
      if (brand === null || brand.length > MAX_BRAND) err('brand', `Keep the brand to ${MAX_BRAND} characters or fewer.`);
      else if (brand) b.brand = brand;
    }
    if (input.upc != null && input.upc !== '') {
      const u = normalizeUpc(input.upc);
      if (!u.ok) err('upc', u.message);
      else {
        b.upc = u.code;
        b.upcFormat = u.format;
      }
    }
    // The size is optional since Model packs: give all of it, some of it or none. Without it the
    // studio uses the delivered model's measured size.
    for (const [k, lo, hi, label] of [
      ['widthIn', 1, 240, 'Width'],
      ['depthIn', 1, 120, 'Depth'],
      ['heightIn', 0.25, 144, 'Height'],
    ]) {
      if (input[k] == null || input[k] === '') continue;
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

    /** Why an uploaded file can't be used as this caller's reference photo, or null if it can. */
    const notOwnPhoto = (id) => {
      const f = files.get(id);
      // Only the caller's own uploads, of kind `reference`, and only photos.
      if (!f || f.ownerUserId !== user.id || f.kind !== 'reference') return 'can’t be used here. Upload it again.';
      if (!IMAGE_EXTS.has(f.ext)) return 'must be a PNG, JPEG or WebP image.';
      return null;
    };
    const refs = input.referenceFileIds ?? [];
    if (!Array.isArray(refs) || refs.length > MAX_REFERENCES || !refs.every((id) => typeof id === 'string' && FILE_ID_RE.test(id))) {
      err('referenceFileIds', `Add up to ${MAX_REFERENCES} reference photos.`);
    } else {
      b.referenceFileIds = [...new Set(refs)];
      for (const id of b.referenceFileIds) {
        const why = notOwnPhoto(id);
        if (why) {
          err('referenceFileIds', why.startsWith('must') ? 'Reference photos must be PNG, JPEG or WebP images.' : 'One of the reference photos can’t be used here. Upload it again.');
          break;
        }
      }
    }
    if (input.barcodeFileId != null && input.barcodeFileId !== '') {
      const id = input.barcodeFileId;
      const why = typeof id === 'string' && FILE_ID_RE.test(id) ? notOwnPhoto(id) : 'can’t be used here. Upload it again.';
      if (why) err('barcodeFileId', `The barcode photo ${why}`);
      else b.barcodeFileId = id;
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
    // The studio needs one way to identify the product: a photo, its UPC, a photo of its barcode,
    // or the catalog product it started from.
    const failed = (f) => errors.some((e) => e.field === `${at}.${f}`);
    if (b.referenceFileIds && !b.referenceFileIds.length && !b.refProductId && !b.upc && !b.barcodeFileId && !failed('upc') && !failed('barcodeFileId') && !failed('refProductId')) {
      err('referenceFileIds', 'Add at least one reference photo or the product’s UPC, so the studio can identify it.');
    }
    return b;
  }

  /**
   * Validates a request body: `{ target, brandId?, line?, items: [{ brief }] }`, or the
   * single-item form `{ target, brief }`. Nothing in it is priced: a `tier`, `extraFinishes`,
   * `rush` or amount sent by a page from before 2026-10-15 is ignored. Throws a 400 with field
   * errors or a 404 for a brand the caller isn't in. Whether the caller may submit at all (the
   * Contractor plan and its allowance) is checked by create(), in the same transaction as the insert.
   */
  function readRequest(body, user) {
    const errors = [];
    const target = body.target ?? 'contractor';
    if (!TARGETS.includes(target)) throw invalid([{ field: 'target', message: 'Choose who the model is for.' }]);
    let brandId = null;
    if (target === 'brand') {
      brandId = typeof body.brandId === 'string' ? body.brandId : '';
      if (!brandId || !auth.isBrandMember(user.id, brandId)) throw new HttpError(404, 'Not found.');
    }
    let line = '';
    if (body.line != null && body.line !== '') {
      if (typeof body.line !== 'string' || body.line.trim().length > 60) errors.push({ field: 'line', message: 'Keep the line name to 60 characters or fewer.' });
      else line = body.line.trim();
    }
    const rawItems = Array.isArray(body.items) ? body.items : body.brief !== undefined ? [{ brief: body.brief }] : null;
    if (!rawItems || !rawItems.length) throw invalid([{ field: 'items', message: 'Add a product to model.' }]);
    if (rawItems.length > MAX_ITEMS) throw invalid([{ field: 'items', message: `One request can hold up to ${MAX_ITEMS} products. Send the rest as another request.` }]);
    const items = rawItems.map((it, i) => {
      const at = `items[${i}]`;
      if (!isObj(it)) {
        errors.push({ field: at, message: 'Describe the product to model.' });
        return null;
      }
      return { brief: readBrief(it.brief, `${at}.brief`, errors, user) };
    });
    if (errors.length) throw invalid(errors);
    return { target, brandId, line, items };
  }

  /** "November 3, 2026": when an allowance period ends (UTC, as the server counts it). */
  const resetDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const models = (n) => `${n} model${n === 1 ? '' : 's'}`;

  /**
   * Submits a validated request against the Contractor plan's allowance: one model per product.
   * In ONE transaction it checks the plan, counts what this period has used and inserts the order,
   * so two requests sent at once can't both take the last model. The order goes straight to the
   * studio's queue (status 'paid', amount 0, provider 'plan') and remembers its period. Throws a 403
   * without the Contractor plan and a 409 when the request is bigger than what is left. Returns the
   * row. (`id` is for seeds only.)
   */
  function create(user, req, { id = randomId('o_') } = {}) {
    const n = req.items.length;
    return tx(() => {
      const a = allowance.of(user.id);
      if (!a.active) {
        throw new HttpError(403, 'Custom 3D models come with the Contractor plan: 3 a month, made by our studio.', { needs: 'contractor', allowance: a });
      }
      if (n > a.left) {
        const when = resetDay(a.resetsAt);
        const msg = a.left
          ? `You have ${models(a.left)} left this month and this request has ${n} products. Remove ${n - a.left}, or send the rest after your allowance resets on ${when}.`
          : `You’ve used this month’s ${models(a.total)}. Your allowance resets on ${when}.`;
        throw new HttpError(409, msg, { needs: 'allowance', allowance: a });
      }
      const q = includedQuote(n, CURRENCY);
      const t = now();
      db.prepare(
        `INSERT INTO orders (id, user_id, target, brand_id, status, tier, extras, amount_cents, currency, provider, brief, line, ref_product_id,
                             pending_since, created_at, updated_at, paid_at, due_at, plan_period_start, plan_period_end)
         VALUES (?, ?, ?, ?, 'paid', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        user.id,
        req.target,
        req.brandId,
        PLAN,
        JSON.stringify({ included: true, quote: { dueBusinessDays: q.dueBusinessDays, lines: q.lines } }),
        CURRENCY,
        PLAN,
        JSON.stringify(req.items[0].brief),
        req.line,
        req.items[0].brief.refProductId ?? null,
        t,
        t,
        t,
        t,
        addBusinessDays(t, q.dueBusinessDays),
        a.periodStart,
        a.periodEnd,
      );
      const ins = db.prepare('INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, ?, ?, ?, 0, 0)');
      req.items.forEach((it, i) => ins.run(id, i, JSON.stringify(it.brief), PLAN));
      addEvent(id, {
        type: 'created',
        to: 'paid',
        by: user.id,
        note: `Included in the Contractor plan: ${models(n)} from this month’s allowance (${a.left - n} of ${a.total} left).`,
        data: { items: n, included: true, periodStart: a.periodStart, periodEnd: a.periodEnd },
      });
      return rowOf(id);
    });
  }

  /**
   * Withdraws a plan request before the studio starts it (by its buyer, the studio or an admin):
   * it becomes 'cancelled' and its models go back to the period's allowance. Returns true when it
   * changed; false when it isn't a plan request or work has started.
   */
  function cancelPlanRequest(orderId, { by = null, note = '' } = {}) {
    const o = rowOf(orderId);
    if (!o || !isPlan(o)) return false;
    return transition(orderId, ['paid'], 'cancelled', {
      by,
      type: 'cancelled',
      note: note || 'Cancelled before work started; the models went back to this month’s allowance.',
      data: { included: true },
    });
  }

  /**
   * FOR SEEDS AND TESTS ONLY (no route calls it): an order as one placed and priced before
   * 2026-10-15, at a retired tier's stored price in US dollars, left as a draft to be paid through
   * the old checkout. Shows paid history (receipts, refunds, revenue) on a demo database.
   */
  function createPriorOrder(user, req, { id = randomId('o_'), tier = 'standard', amountCents = 27_900, currency = 'usd', provider = 'demo' } = {}) {
    if (!LEGACY_IDS.includes(tier)) throw new Error(`createPriorOrder: "${tier}" is not a retired tier.`);
    const t = now();
    tx(() => {
      db.prepare(
        `INSERT INTO orders (id, user_id, target, brand_id, status, tier, extras, amount_cents, currency, provider, brief, line, ref_product_id,
                             pending_since, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, '{"rush":false,"extraFinishes":0}', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.id, req.target, req.brandId, tier, amountCents * req.items.length, currency, provider, JSON.stringify(req.items[0].brief), req.line, req.items[0].brief.refProductId ?? null, t, t, t);
      const ins = db.prepare('INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, ?, ?, ?, 0, ?)');
      req.items.forEach((it, i) => ins.run(id, i, JSON.stringify(it.brief), tier, amountCents));
      addEvent(id, { type: 'created', to: 'draft', by: user.id, data: { items: req.items.length, amountCents: amountCents * req.items.length } });
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
        if (!isNum(want) || want <= 0) continue; // a size the request didn't give
        const off = Math.abs(got - want) / want;
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
    // The studio's size, else the request's, else the model's own measured size (a request
    // may come without a size since Model packs).
    const bb = model.meta?.bboxIn ?? null;
    const pick = (k, bbKey) => (isNum(d[k]) && d[k] > 0 ? d[k] : isNum(brief[k]) ? brief[k] : bb && isNum(bb[bbKey]) && bb[bbKey] > 0 ? round2(bb[bbKey]) : null);
    const dims = {
      widthIn: pick('widthIn', 'w'),
      depthIn: pick('depthIn', 'd'),
      heightIn: pick('heightIn', 'h'),
      elevationIn: isNum(d.elevationIn) ? d.elevationIn : brief.elevationIn ?? 0,
    };
    const missing = ['widthIn', 'depthIn', 'heightIn'].filter((k) => dims[k] == null);
    if (missing.length) throw invalid(missing.map((k) => ({ field: `dims.${k}`, message: 'The request has no size and the model has none to measure: enter the width, depth and height.' })));
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
      // The brand and UPC the buyer gave: structured fields (they link the model to the retail
      // catalog's store listings by UPC) and, as before, in the description.
      const ident = [brief.brand ? `Brand: ${brief.brand}` : null, brief.upc ? `UPC ${brief.upc}` : null].filter(Boolean);
      const spec = {
        kind: brief.kind,
        ...(brief.variant ? { variant: brief.variant } : {}),
        category: brief.category ?? KIND_CATEGORY[brief.kind],
        name,
        blurb: `Custom 3D model made by the BluModel 3D studio.${ident.length ? ` ${ident.join(' · ')}.` : ''}`,
        sku: '',
        ...dims,
        price,
        finishes,
        imageFileIds: [img.id],
        modelFileId: glb.id,
        ...(o.line ? { line: o.line } : {}),
        ...(brief.brand ? { brand: String(brief.brand).slice(0, 60) } : {}),
        ...(brief.upc ? { upc: brief.upc } : {}),
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
      // Model packs first; the retired tiers stay listed so older orders still add up.
      byTier: [PACK.id, ...LEGACY_IDS].map((id) => {
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
    isPack,
    quoteOf,
    checkoutLines,
    toWire,
    addEvent,
    transition,
    markOrderPaid,
    markRefunded,
    sweepExpired,
    readRequest,
    create,
    cancelPlanRequest,
    createPriorOrder,
    allowance,
    isPlan,
    deliver,
    glbReport,
    revenue,
  };
}
