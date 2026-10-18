// The company workspace's prices and "Request more products" (docs/SHOWROOM_PIVOT.md §5 "Products";
// tables in server/db/migrations/workspace.mjs). Module 'workspace'. Routes say their own hosts
// through auth: 'staff'/'owner' answer only on a showroom, 'studio' only on the sales site.
//
// Workspace (a member of THIS showroom's team):
//   GET  /api/workspace/pricing                  { defaultMarkupPct, rows: { [productId]: PriceRow } }
//   PUT  /api/workspace/pricing                  { defaultMarkupPct } -> the same
//   PUT  /api/workspace/pricing/:productId       PriceRow -> { productId, row }  (one of this showroom's products)
//        PriceRow = { costCents: int|null, costByWidth: { "<width>": int }|null, markupPct: number|null }
//        Costs are private to the team. The price visitors see is the product's own `price` /
//        `priceByWidth`, which the workspace sets from cost and markup (PATCH /api/workspace/products/:id).
//   GET  /api/workspace/requests                 { requests: [ProductRequest], included: { products, modelled, inLicense } }
//   POST /api/workspace/requests                 { items: [RequestItem] (1-40), note? } -> 201 { request }
//   GET  /api/workspace/requests/:id             { request } with events and reference files
//   POST /api/workspace/requests/:id/approve     go ahead at the quote (an owner; any of the team when
//                                                the quote is included in the license) -> { request }
//   POST /api/workspace/requests/:id/decline     owner: { note? } -> { request }
//   POST /api/workspace/requests/:id/cancel      before the studio starts (requested or quoted) -> { request }
//   POST /api/workspace/requests/:id/note        { note } -> { request }
// Studio (our modelling studio; sales site):
//   GET  /api/studio/product-requests            ?status=open|all|<status> -> { requests, groups: [{ tenant, requests }], counts }
//   GET  /api/studio/product-requests/:id        { request } with the company, events and references
//   POST /api/studio/product-requests/:id/quote  { amountCents (0 with includedInLicense), includedInLicense?, note?, turnaroundDays? }
//   POST /api/studio/product-requests/:id/start  approved -> in_progress
//   POST /api/studio/product-requests/:id/deliver { note? } in_progress -> delivered (the products are
//                                                added to the company's catalog by the studio)
//   POST /api/studio/product-requests/:id/decline { note } requested|quoted -> declined
//   POST /api/studio/product-requests/:id/note   { note }
//
// Nothing here takes a payment: a quote is invoiced with the license (SHOWROOM_PIVOT §2).

import { HttpError } from '../http/respond.mjs';
import { randomId } from '../lib/ids.mjs';
import { SHOWROOM_LICENSE } from '../lib/plans.mjs';
import { normalizeUpc } from '../payments/upc.mjs';

const PRODUCT_PARAM = /^p_[A-Za-z0-9_-]{1,60}$/;
const REQUEST_PARAM = /^pr_[A-Za-z0-9]{8,40}$/;
const FILE_ID = /^f_[A-Za-z0-9_-]{1,60}$/;
export const REQUEST_STATUSES = Object.freeze(['requested', 'quoted', 'approved', 'in_progress', 'delivered', 'declined', 'cancelled']);
const OPEN = Object.freeze(['requested', 'quoted', 'approved', 'in_progress']);
export const MAX_REQUEST_ITEMS = 40;
const MAX_REFS = 8;

const bad = (field, message) => new HttpError(400, message, { errors: [{ field, message }] });
const text = (v, max, field, { required = false, label = 'This' } = {}) => {
  if (v === undefined || v === null) {
    if (required) throw bad(field, `${label} is needed.`);
    return '';
  }
  if (typeof v !== 'string') throw bad(field, `${label} should be text.`);
  const s = v.trim();
  if (required && !s) throw bad(field, `${label} is needed.`);
  if (s.length > max) throw bad(field, `Keep it to ${max} characters or fewer.`);
  return s;
};
const markupOf = (v, field) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) throw bad(field, 'Markup is a percentage from 0 to 1000.');
  return Math.round(v * 100) / 100;
};
const centsOf = (v, field) => {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0 || v > 100_000_000) throw bad(field, 'Costs are whole cents from 0 up.');
  return v;
};
const dimOf = (v, field) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 480) throw bad(field, 'Sizes are inches, more than 0 and up to 480.');
  return Math.round(v * 100) / 100;
};

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services } = ctx;
  const { products, files, tenants } = services;

  // ── helpers ─────────────────────────────────────────────────────────────
  const ownProduct = (rc, id) => {
    const row = products.get(id);
    if (!row || row.tenantId !== rc.tenant.id) throw new HttpError(404, 'That product does not exist.');
    return row;
  };

  const priceWire = (r) => ({ costCents: r.cost_cents ?? null, costByWidth: r.cost_by_width ? JSON.parse(r.cost_by_width) : null, markupPct: r.markup_pct ?? null });
  const pricingWire = (tenantId) => {
    const d = db.prepare('SELECT default_markup_pct FROM tenant_pricing WHERE tenant_id = ?').get(tenantId);
    const rows = db.prepare('SELECT * FROM tenant_product_prices WHERE tenant_id = ?').all(tenantId);
    return { defaultMarkupPct: d?.default_markup_pct ?? 0, rows: Object.fromEntries(rows.map((r) => [r.product_id, priceWire(r)])) };
  };

  /** A request item, cleaned; throws a 400 naming the field (items[i].field). */
  const readItem = (rc, raw, i) => {
    const f = (k) => `items[${i}].${k}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad(`items[${i}]`, 'Each product needs at least a name.');
    const name = text(raw.name, 80, f('name'), { required: true, label: 'The product’s name' });
    let upc = '';
    if (typeof raw.upc === 'string' && raw.upc.trim()) {
      const u = normalizeUpc(raw.upc);
      if (!u.ok) throw bad(f('upc'), u.message);
      upc = u.code;
    }
    let url = text(raw.url, 400, f('url'));
    if (url) {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
        url = u.toString();
      } catch {
        throw bad(f('url'), 'Use a web address like https://maker.example/product.');
      }
    }
    const refs = raw.referenceFileIds ?? [];
    if (!Array.isArray(refs) || refs.length > MAX_REFS) throw bad(f('referenceFileIds'), `Up to ${MAX_REFS} photos a product.`);
    const referenceFileIds = [];
    for (const id of refs) {
      const file = typeof id === 'string' && FILE_ID.test(id) ? files.get(id) : null;
      // Only this showroom's own uploads: never another showroom's or the sales site's.
      if (!file || file.tenantId !== rc.tenant.id || !['reference', 'image'].includes(file.kind)) throw bad(f('referenceFileIds'), 'That photo can’t be used here. Upload it again.');
      if (!referenceFileIds.includes(file.id)) referenceFileIds.push(file.id);
    }
    return {
      name,
      brand: text(raw.brand, 60, f('brand')),
      sku: text(raw.sku, 60, f('sku')),
      upc,
      url,
      widthIn: dimOf(raw.widthIn, f('widthIn')),
      depthIn: dimOf(raw.depthIn, f('depthIn')),
      heightIn: dimOf(raw.heightIn, f('heightIn')),
      finishes: text(raw.finishes, 300, f('finishes')),
      notes: text(raw.notes, 1000, f('notes')),
      referenceFileIds,
    };
  };

  const rowOf = (id) => db.prepare('SELECT * FROM tenant_product_requests WHERE id = ?').get(id) ?? null;
  /** This showroom's request, or a 404 (another showroom's looks missing). */
  const ownRequest = (rc, id) => {
    const r = REQUEST_PARAM.test(id) ? rowOf(id) : null;
    if (!r || r.tenant_id !== rc.tenant.id) throw new HttpError(404, 'That request does not exist.');
    return r;
  };
  const anyRequest = (id) => {
    const r = REQUEST_PARAM.test(id) ? rowOf(id) : null;
    if (!r) throw new HttpError(404, 'That request does not exist.');
    return r;
  };

  const addEvent = (requestId, { type, from = null, to = null, by = null, side, note = '' }) =>
    db
      .prepare('INSERT INTO tenant_product_request_events (request_id, type, from_status, to_status, by_user_id, by_side, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(requestId, type, from, to, by, side, note, ctx.now());

  /** Moves a request from one of `from` to `to` (conditional, so a race changes nothing twice). */
  const transition = (r, from, to, { by, side, type = to, note = '', set = {} }) => {
    const cols = ['status = ?', 'updated_at = ?'];
    const args = [to, ctx.now()];
    for (const [k, v] of Object.entries(set)) {
      cols.push(`${k} = ?`);
      args.push(v);
    }
    const res = db.prepare(`UPDATE tenant_product_requests SET ${cols.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`).run(...args, r.id, ...from);
    if (!res.changes) return false;
    addEvent(r.id, { type, from: r.status, to, by, side, note });
    return true;
  };

  const userName = (id) => (id ? (db.prepare('SELECT name, email FROM users WHERE id = ?').get(id) ?? null) : null);

  /** A request as the company (`viewer` on its team) or the studio sees it. */
  const wire = (r, { viewer, studio = false, full = false }) => {
    const items = JSON.parse(r.items);
    const by = userName(r.requested_by);
    const out = {
      id: r.id,
      status: r.status,
      items,
      note: r.note,
      quote:
        r.quoted_at === null || r.quoted_at === undefined
          ? null
          : { amountCents: r.quote_cents ?? 0, currency: r.quote_currency, note: r.quote_note, turnaroundDays: r.quote_days ?? null, includedInLicense: !!r.quote_included, at: r.quoted_at },
      requestedBy: by ? { name: by.name, email: by.email } : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      approvedAt: r.approved_at ?? null,
      deliveredAt: r.delivered_at ?? null,
    };
    if (studio) {
      const t = tenants.get(r.tenant_id);
      out.tenant = t ? { id: t.id, name: t.name, slug: t.slug, status: t.status } : { id: r.tenant_id, name: '', slug: '', status: '' };
      const a = userName(r.assigned_to);
      out.assignee = a?.name ?? null;
    }
    if (full) {
      out.events = db
        .prepare('SELECT * FROM tenant_product_request_events WHERE request_id = ? ORDER BY id')
        .all(r.id)
        .map((e) => {
          let who;
          if (e.by_side === 'studio') who = studio ? (userName(e.by_user_id)?.name ?? 'studio') : 'BluModel studio';
          else if (e.by_side === 'system') who = 'system';
          else who = viewer && e.by_user_id === viewer.id ? 'you' : (userName(e.by_user_id)?.name ?? 'your team');
          return { id: e.id, type: e.type, from: e.from_status, to: e.to_status, note: e.note, by: who, at: e.created_at };
        });
      const ids = [...new Set(items.flatMap((it) => it.referenceFileIds ?? []))];
      out.references = ids
        .map((id) => files.get(id))
        .filter((f) => f && f.tenantId === r.tenant_id)
        .map((f) => files.toWire(f));
    }
    return out;
  };

  const noteOf = (v, { required = false } = {}) => text(v, 2000, 'note', { required, label: 'A note' });

  return [
    // ── prices ──────────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/pricing',
      auth: 'staff',
      handler: (rc) => pricingWire(rc.tenant.id),
    },
    {
      method: 'PUT',
      path: '/api/workspace/pricing',
      auth: 'staff',
      maxBytes: 1_024,
      handler: (rc) => {
        const m = markupOf(rc.body?.defaultMarkupPct, 'defaultMarkupPct');
        if (m === null) throw bad('defaultMarkupPct', 'Markup is a percentage from 0 to 1000.');
        db.prepare(
          `INSERT INTO tenant_pricing (tenant_id, default_markup_pct, updated_at, updated_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id) DO UPDATE SET default_markup_pct = excluded.default_markup_pct, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        ).run(rc.tenant.id, m, ctx.now(), rc.user.id);
        return pricingWire(rc.tenant.id);
      },
    },
    {
      method: 'PUT',
      path: '/api/workspace/pricing/:productId',
      auth: 'staff',
      params: { productId: PRODUCT_PARAM },
      maxBytes: 8_192,
      handler: (rc) => {
        const p = ownProduct(rc, rc.params.productId);
        const b = rc.body ?? {};
        const costCents = centsOf(b.costCents, 'costCents');
        let byWidth = null;
        if (b.costByWidth !== null && b.costByWidth !== undefined) {
          if (typeof b.costByWidth !== 'object' || Array.isArray(b.costByWidth)) throw bad('costByWidth', 'Costs by width are { "24": cents }.');
          const entries = Object.entries(b.costByWidth);
          if (entries.length > 40) throw bad('costByWidth', 'Up to 40 widths.');
          byWidth = {};
          for (const [w, c] of entries) {
            if (!/^\d{1,3}(\.\d{1,2})?$/.test(w)) throw bad('costByWidth', 'Widths are inches, like 24 or 13.5.');
            if (c === null) continue;
            byWidth[w] = centsOf(c, `costByWidth.${w}`);
          }
          if (!Object.keys(byWidth).length) byWidth = null;
        }
        const markupPct = markupOf(b.markupPct, 'markupPct');
        db.prepare(
          `INSERT INTO tenant_product_prices (product_id, tenant_id, cost_cents, cost_by_width, markup_pct, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(product_id) DO UPDATE SET cost_cents = excluded.cost_cents, cost_by_width = excluded.cost_by_width, markup_pct = excluded.markup_pct,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        ).run(p.id, rc.tenant.id, costCents, byWidth ? JSON.stringify(byWidth) : null, markupPct, ctx.now(), rc.user.id);
        return { productId: p.id, row: priceWire(db.prepare('SELECT * FROM tenant_product_prices WHERE product_id = ?').get(p.id)) };
      },
    },

    // ── Request more products (the company) ─────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/requests',
      auth: 'staff',
      handler: (rc) => {
        const rows = db.prepare('SELECT * FROM tenant_product_requests WHERE tenant_id = ? ORDER BY created_at DESC, id').all(rc.tenant.id);
        const modelled = db.prepare("SELECT COUNT(*) AS n FROM products WHERE tenant_id = ? AND status <> 'archived'").get(rc.tenant.id).n;
        const inLicense = db
          .prepare("SELECT COALESCE(SUM(item_count), 0) AS n FROM tenant_product_requests WHERE tenant_id = ? AND quote_included = 1 AND status IN ('approved','in_progress','delivered')")
          .get(rc.tenant.id).n;
        return { requests: rows.map((r) => wire(r, { viewer: rc.user })), included: { products: SHOWROOM_LICENSE.includedProducts, modelled, inLicense } };
      },
    },
    {
      method: 'POST',
      path: '/api/workspace/requests',
      auth: 'staff',
      maxBytes: 96_000,
      rateLimit: { name: 'workspace-request', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const b = rc.body ?? {};
        if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_REQUEST_ITEMS) throw bad('items', `List 1 to ${MAX_REQUEST_ITEMS} products.`);
        const items = b.items.map((it, i) => readItem(rc, it, i));
        const note = noteOf(b.note);
        const id = randomId('pr_');
        const t = ctx.now();
        ctx.tx(() => {
          db.prepare(
            `INSERT INTO tenant_product_requests (id, tenant_id, requested_by, status, items, item_count, note, created_at, updated_at)
             VALUES (?, ?, ?, 'requested', ?, ?, ?, ?, ?)`,
          ).run(id, rc.tenant.id, rc.user.id, JSON.stringify(items), items.length, note, t, t);
          addEvent(id, { type: 'requested', to: 'requested', by: rc.user.id, side: 'company', note });
        });
        rc.send(201, { request: wire(rowOf(id), { viewer: rc.user, full: true }) });
      },
    },
    {
      method: 'GET',
      path: '/api/workspace/requests/:id',
      auth: 'staff',
      handler: (rc) => ({ request: wire(ownRequest(rc, rc.params.id), { viewer: rc.user, full: true }) }),
    },
    {
      method: 'POST',
      path: '/api/workspace/requests/:id/approve',
      auth: 'staff',
      body: 'none',
      handler: (rc) => {
        const r = ownRequest(rc, rc.params.id);
        if (r.status !== 'quoted') throw new HttpError(409, r.status === 'requested' ? 'The studio hasn’t quoted this request yet.' : 'This request has already moved on.', { status: r.status });
        if (!r.quote_included && rc.memberRole !== 'owner') throw new HttpError(403, 'Only an owner of the showroom can accept a quote.', { code: 'owner_only' });
        const ok = transition(r, ['quoted'], 'approved', { by: rc.user.id, side: 'company', set: { approved_at: ctx.now(), approved_by: rc.user.id }, note: r.quote_included ? 'Included in the license.' : '' });
        if (!ok) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/workspace/requests/:id/decline',
      auth: 'owner',
      maxBytes: 4_096,
      handler: (rc) => {
        const r = ownRequest(rc, rc.params.id);
        const note = noteOf(rc.body?.note);
        if (r.status !== 'quoted') throw new HttpError(409, 'Only a quoted request can be declined.', { status: r.status });
        if (!transition(r, ['quoted'], 'declined', { by: rc.user.id, side: 'company', note })) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/workspace/requests/:id/cancel',
      auth: 'staff',
      body: 'none',
      handler: (rc) => {
        const r = ownRequest(rc, rc.params.id);
        if (!['requested', 'quoted'].includes(r.status)) throw new HttpError(409, r.status === 'cancelled' ? 'This request is already cancelled.' : 'The studio has started on this request, so it can’t be cancelled. Add a note instead.', { status: r.status });
        if (!transition(r, ['requested', 'quoted'], 'cancelled', { by: rc.user.id, side: 'company' })) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/workspace/requests/:id/note',
      auth: 'staff',
      maxBytes: 4_096,
      handler: (rc) => {
        const r = ownRequest(rc, rc.params.id);
        const note = noteOf(rc.body?.note, { required: true });
        addEvent(r.id, { type: 'note', by: rc.user.id, side: 'company', note });
        db.prepare('UPDATE tenant_product_requests SET updated_at = ? WHERE id = ?').run(ctx.now(), r.id);
        return { request: wire(rowOf(r.id), { viewer: rc.user, full: true }) };
      },
    },

    // ── the studio's queue ──────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/studio/product-requests',
      auth: 'studio',
      handler: (rc) => {
        const s = rc.query.get('status') || 'open';
        let statuses;
        if (s === 'open') statuses = OPEN;
        else if (s === 'all') statuses = REQUEST_STATUSES;
        else if (REQUEST_STATUSES.includes(s)) statuses = [s];
        else throw new HttpError(400, 'Unknown status filter.');
        const rows = db
          .prepare(`SELECT * FROM tenant_product_requests WHERE status IN (${statuses.map(() => '?').join(', ')}) ORDER BY tenant_id, created_at`)
          .all(...statuses);
        const requests = rows.map((r) => wire(r, { viewer: rc.user, studio: true }));
        const groups = [];
        for (const r of requests) {
          let g = groups.find((x) => x.tenant.id === r.tenant.id);
          if (!g) groups.push((g = { tenant: r.tenant, requests: [], items: 0 }));
          g.requests.push(r);
          g.items += r.items.length;
        }
        groups.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name, 'en'));
        const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM tenant_product_requests GROUP BY status').all().map((r) => [r.status, r.n]));
        return { requests, groups, counts, filter: s };
      },
    },
    {
      method: 'GET',
      path: '/api/studio/product-requests/:id',
      auth: 'studio',
      handler: (rc) => ({ request: wire(anyRequest(rc.params.id), { viewer: rc.user, studio: true, full: true }) }),
    },
    {
      method: 'POST',
      path: '/api/studio/product-requests/:id/quote',
      auth: 'studio',
      maxBytes: 4_096,
      handler: (rc) => {
        const r = anyRequest(rc.params.id);
        const b = rc.body ?? {};
        const included = b.includedInLicense === true;
        const amount = included ? 0 : b.amountCents;
        if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) throw bad('amountCents', 'The quote is a whole number of cents.');
        if (!included && amount === 0) throw bad('amountCents', 'Enter the price, or mark the request as included in the license.');
        let days = null;
        if (b.turnaroundDays !== undefined && b.turnaroundDays !== null) {
          if (!Number.isInteger(b.turnaroundDays) || b.turnaroundDays < 1 || b.turnaroundDays > 120) throw bad('turnaroundDays', 'Turnaround is 1 to 120 business days.');
          days = b.turnaroundDays;
        }
        const note = noteOf(b.note);
        if (!['requested', 'quoted'].includes(r.status)) throw new HttpError(409, 'Only a request that isn’t approved yet can be quoted.', { status: r.status });
        const ok = transition(r, ['requested', 'quoted'], 'quoted', {
          by: rc.user.id,
          side: 'studio',
          type: r.status === 'quoted' ? 'requoted' : 'quoted',
          note: included ? `Included in the license.${note ? ` ${note}` : ''}` : note,
          set: { quote_cents: amount, quote_included: included ? 1 : 0, quote_note: note, quote_days: days, quoted_at: ctx.now(), quoted_by: rc.user.id },
        });
        if (!ok) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, studio: true, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/studio/product-requests/:id/start',
      auth: 'studio',
      body: 'none',
      handler: (rc) => {
        const r = anyRequest(rc.params.id);
        if (r.status !== 'approved') throw new HttpError(409, r.status === 'quoted' ? 'The company hasn’t accepted the quote yet.' : 'Only an approved request can be started.', { status: r.status });
        if (!transition(r, ['approved'], 'in_progress', { by: rc.user.id, side: 'studio', type: 'started', set: { assigned_to: rc.user.id } })) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, studio: true, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/studio/product-requests/:id/deliver',
      auth: 'studio',
      maxBytes: 4_096,
      handler: (rc) => {
        const r = anyRequest(rc.params.id);
        const note = noteOf(rc.body?.note);
        if (r.status !== 'in_progress') throw new HttpError(409, 'Start the request before delivering it.', { status: r.status });
        if (!transition(r, ['in_progress'], 'delivered', { by: rc.user.id, side: 'studio', note, set: { delivered_at: ctx.now() } })) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, studio: true, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/studio/product-requests/:id/decline',
      auth: 'studio',
      maxBytes: 4_096,
      handler: (rc) => {
        const r = anyRequest(rc.params.id);
        const note = noteOf(rc.body?.note, { required: true });
        if (!['requested', 'quoted'].includes(r.status)) throw new HttpError(409, 'Only a request that isn’t approved yet can be declined.', { status: r.status });
        if (!transition(r, ['requested', 'quoted'], 'declined', { by: rc.user.id, side: 'studio', note })) throw new HttpError(409, 'This request changed. Reload and try again.');
        return { request: wire(rowOf(r.id), { viewer: rc.user, studio: true, full: true }) };
      },
    },
    {
      method: 'POST',
      path: '/api/studio/product-requests/:id/note',
      auth: 'studio',
      maxBytes: 4_096,
      handler: (rc) => {
        const r = anyRequest(rc.params.id);
        const note = noteOf(rc.body?.note, { required: true });
        addEvent(r.id, { type: 'note', by: rc.user.id, side: 'studio', note });
        db.prepare('UPDATE tenant_product_requests SET updated_at = ? WHERE id = ?').run(ctx.now(), r.id);
        return { request: wire(rowOf(r.id), { viewer: rc.user, studio: true, full: true }) };
      },
    },
  ];
}
