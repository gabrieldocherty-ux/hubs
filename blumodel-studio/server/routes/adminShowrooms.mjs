// Admin > Companies and the Overview's showroom numbers (docs/SHOWROOM_PIVOT.md §8). The tenant
// CRUD, licenses, the monthly plan, hostnames, members and credits are the foundation's
// (tenantsAdmin.mjs, tenantsBilling.mjs, tenantsLeads.mjs); this module only adds what the admin
// panel needs on top, all read-only:
//
//   GET /api/admin/showrooms/overview      { companies, monthly, licenses, credits, salesLeads, queue, generatedAt }
//   GET /api/admin/showrooms/queue         { groups: [{ tenant: { id, slug, name } | null, open, overdue, orders }] }
//                                          the studio modelling queue (open orders) grouped by company
//   GET /api/admin/tenants/:id/usage       { renders, products, leads, queue: { open, overdue, orders } }
//
// Every tenant in GET /api/admin/tenants also gains `usage: { rendersUsed, renderCents, products,
// includedProducts, queueOpen }` (an admin extra), so the company list can show it.
//
// Sales-site and admin-only (the router answers 401/403 before a handler; 'admin' routes never exist
// on a showroom). Nothing here writes, so nothing here is audited; every write the Companies tab
// makes goes through the foundation's audited routes.
//
// Which orders belong to a company: orders.tenant_id when that column exists (the workspace
// package may add it), else the orders of the company's accounts: its team (tenant_members) and the
// accounts made on its showroom (users.tenant_id).

import { HttpError } from '../http/respond.mjs';
import { SHOWROOM_LICENSE } from '../lib/plans.mjs';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const READ = { name: 'admin-showrooms-read', max: 1200, windowMs: HOUR, by: 'user' };
export const OPEN_ORDER_STATUSES = Object.freeze(['paid', 'in_progress', 'revision_requested']);
const OPEN_SQL = `('${OPEN_ORDER_STATUSES.join("','")}')`;
const BRIEF_MAX = 160;

/** ms at the start of the UTC year that `at` falls in. */
export const yearStart = (at) => Date.UTC(new Date(at).getUTCFullYear(), 0, 1);

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services } = ctx;
  const { tenants } = services;

  const hasColumn = (table, col) => {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    } catch {
      return false;
    }
  };
  // Checked per call (cheap): another package's migration may add it while this module is loaded.
  const ordersHaveTenant = () => hasColumn('orders', 'tenant_id');

  const mustGet = (id) => {
    const t = tenants.get(id);
    if (!t) throw new HttpError(404, 'That showroom does not exist.');
    return t;
  };

  // ── renders and products ────────────────────────────────────────────────
  /** Charged render reservations (refunded and released ones are not "used"). */
  function renders(tenantId, since = 0) {
    const r = db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cents), 0) AS cents FROM tenant_credit_holds WHERE tenant_id = ? AND purpose = 'render' AND status = 'charged' AND created_at >= ?")
      .get(tenantId, since);
    return { count: Number(r.n), cents: Number(r.cents) };
  }

  function products(tenantId) {
    const r = db
      .prepare("SELECT SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS live, SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS hidden, COUNT(*) AS n FROM products WHERE tenant_id = ?")
      .get(tenantId);
    return { live: Number(r.live ?? 0), hidden: Number(r.hidden ?? 0), total: Number(r.n ?? 0), included: SHOWROOM_LICENSE.includedProducts };
  }

  // ── the studio queue ────────────────────────────────────────────────────
  const orderWire = (o) => ({
    id: o.id,
    status: o.status,
    tier: o.tier,
    brief: String(o.brief ?? '').slice(0, BRIEF_MAX),
    line: o.line ?? '',
    email: o.email ?? null,
    assignedTo: o.assigned_email ?? null,
    dueAt: o.due_at ?? null,
    paidAt: o.paid_at ?? null,
    createdAt: o.created_at,
    overdue: !!o.due_at && o.due_at < ctx.now(),
  });

  const ORDER_COLS = `o.id, o.status, o.tier, o.brief, o.line, o.due_at, o.paid_at, o.created_at, o.user_id,
    u.email AS email, a.email AS assigned_email, u.tenant_id AS user_tenant`;

  function queueFor(tenantId) {
    const byTenant = ordersHaveTenant();
    const ofAccounts = '(o.user_id IN (SELECT user_id FROM tenant_members WHERE tenant_id = ?) OR u.tenant_id = ?)';
    const belongs = byTenant ? `(o.tenant_id = ? OR (o.tenant_id IS NULL AND ${ofAccounts}))` : ofAccounts;
    const rows = db
      .prepare(
        `SELECT ${ORDER_COLS} FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
           LEFT JOIN users a ON a.id = o.assigned_to
          WHERE o.status IN ${OPEN_SQL} AND ${belongs}
          ORDER BY COALESCE(o.due_at, o.paid_at, o.created_at), o.id
          LIMIT 200`,
      )
      .all(...(byTenant ? [tenantId, tenantId, tenantId] : [tenantId, tenantId]));
    const orders = rows.map(orderWire);
    return { open: orders.length, overdue: orders.filter((o) => o.overdue).length, orders };
  }

  /** Every open order, each under the company it belongs to (null: a sales-site customer's own). */
  function queueGroups() {
    const byTenant = ordersHaveTenant();
    const rows = db
      .prepare(
        `SELECT ${ORDER_COLS}${byTenant ? ', o.tenant_id AS order_tenant' : ''},
                (SELECT m.tenant_id FROM tenant_members m WHERE m.user_id = o.user_id ORDER BY m.created_at LIMIT 1) AS member_tenant
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
           LEFT JOIN users a ON a.id = o.assigned_to
          WHERE o.status IN ${OPEN_SQL}
          ORDER BY COALESCE(o.due_at, o.paid_at, o.created_at), o.id
          LIMIT 500`,
      )
      .all();
    const groups = new Map();
    for (const r of rows) {
      const tid = r.order_tenant ?? r.user_tenant ?? r.member_tenant ?? null;
      if (!groups.has(tid)) {
        const t = tid ? tenants.get(tid) : null;
        groups.set(tid, { tenant: t ? { id: t.id, slug: t.slug, name: t.name } : null, open: 0, overdue: 0, orders: [] });
      }
      const g = groups.get(tid);
      const o = orderWire(r);
      g.orders.push(o);
      g.open++;
      if (o.overdue) g.overdue++;
    }
    // Companies first (most overdue, then most open), sales-site customers last.
    return [...groups.values()].sort((a, b) => (a.tenant ? 0 : 1) - (b.tenant ? 0 : 1) || b.overdue - a.overdue || b.open - a.open || String(a.tenant?.name).localeCompare(String(b.tenant?.name)));
  }

  // ── the overview ────────────────────────────────────────────────────────
  function overview() {
    const t = ctx.now();
    tenants.refreshAll();
    const companies = { setup: 0, live: 0, lapsed: 0, suspended: 0, total: 0, demo: 0 };
    for (const r of db.prepare('SELECT status, is_demo, COUNT(*) AS n FROM tenants GROUP BY status, is_demo').all()) {
      if (r.is_demo) {
        companies.demo += Number(r.n);
        continue; // the demo showroom is ours: not a company
      }
      companies[r.status] = (companies[r.status] ?? 0) + Number(r.n);
      companies.total += Number(r.n);
    }

    // Monthly plans. MRR counts real Stripe plans still running (active or in a failed payment's
    // grace), demo ones apart; complimentary plans bring in nothing. The demo showroom is left out.
    const monthly = { stripe: { count: 0, byCurrency: {} }, demo: { count: 0, byCurrency: {} }, comp: 0, pastDue: 0, cancelling: 0 };
    const subs = db
      .prepare(
        `SELECT s.provider, s.status, s.amount_cents, s.currency, s.cancel_at_period_end FROM tenant_subscriptions s JOIN tenants tn ON tn.id = s.tenant_id
          WHERE tn.is_demo = 0 AND s.status IN ('active','past_due')`,
      )
      .all();
    for (const s of subs) {
      if (s.provider === 'comp') {
        monthly.comp++;
        continue;
      }
      const bucket = s.provider === 'stripe' ? monthly.stripe : monthly.demo;
      bucket.count++;
      bucket.byCurrency[s.currency] = (bucket.byCurrency[s.currency] ?? 0) + Number(s.amount_cents);
      if (s.status === 'past_due') monthly.pastDue++;
      if (s.cancel_at_period_end) monthly.cancelling++;
    }

    // Licenses recorded (booked) this calendar year, not voided; complimentary ones counted apart.
    const y0 = yearStart(t);
    const licenses = { year: new Date(t).getUTCFullYear(), count: 0, byCurrency: {}, comp: 0, current: 0 };
    for (const l of db
      .prepare(
        `SELECT l.amount_cents, l.currency, l.paid_how FROM tenant_licenses l JOIN tenants tn ON tn.id = l.tenant_id
          WHERE tn.is_demo = 0 AND l.voided_at IS NULL AND l.created_at >= ?`,
      )
      .all(y0)) {
      if (l.paid_how === 'comp' || !l.amount_cents) {
        licenses.comp++;
        continue;
      }
      licenses.count++;
      licenses.byCurrency[l.currency] = (licenses.byCurrency[l.currency] ?? 0) + Number(l.amount_cents);
    }
    const today = new Date(t).toISOString().slice(0, 10);
    licenses.current = Number(
      db
        .prepare('SELECT COUNT(DISTINCT l.tenant_id) AS n FROM tenant_licenses l JOIN tenants tn ON tn.id = l.tenant_id WHERE tn.is_demo = 0 AND l.voided_at IS NULL AND l.starts_on <= ? AND l.ends_on >= ?')
        .get(today, today).n,
    );

    // Credits used = charged render reservations (refunds give them back, so they don't count).
    const used = (since) => {
      const r = db
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(h.cents), 0) AS cents FROM tenant_credit_holds h JOIN tenants tn ON tn.id = h.tenant_id WHERE tn.is_demo = 0 AND h.status = 'charged' AND h.created_at >= ?")
        .get(since);
      return { count: Number(r.n), cents: Number(r.cents) };
    };
    const balance = db
      .prepare(`SELECT COALESCE(SUM(l.remaining), 0) AS cents FROM tenant_credit_lots l JOIN tenants tn ON tn.id = l.tenant_id WHERE tn.is_demo = 0 AND l.remaining > 0 AND l.expires_at > ?`)
      .get(t).cents;
    const credits = { used30d: used(t - 30 * DAY), usedYear: used(y0), outstandingCents: Number(balance) };

    const sl = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS fresh, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS d30 FROM sales_leads").get(t - 30 * DAY);
    const salesLeads = { total: Number(sl.n), new: Number(sl.fresh ?? 0), d30: Number(sl.d30 ?? 0) };

    const groups = queueGroups().filter((g) => g.tenant);
    const queue = { companies: groups.length, open: groups.reduce((s, g) => s + g.open, 0), overdue: groups.reduce((s, g) => s + g.overdue, 0) };

    return { companies, monthly, licenses, credits, salesLeads, queue, generatedAt: t };
  }

  // The company list shows usage next to each company.
  tenants.addAdminExtra((tn) => {
    const r = renders(tn.id);
    const p = products(tn.id);
    return { usage: { rendersUsed: r.count, renderCents: r.cents, products: p.live, includedProducts: p.included, queueOpen: queueFor(tn.id).open } };
  });

  return [
    {
      method: 'GET',
      path: '/api/admin/showrooms/overview',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        rc.res.setHeader('Cache-Control', 'no-store');
        return overview();
      },
    },
    {
      method: 'GET',
      path: '/api/admin/showrooms/queue',
      auth: 'admin',
      rateLimit: READ,
      handler: (rc) => {
        rc.res.setHeader('Cache-Control', 'no-store');
        return { groups: queueGroups() };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/tenants/:id/usage',
      auth: 'admin',
      rateLimit: READ,
      params: { id: ID_PARAM },
      handler: (rc) => {
        const tn = mustGet(rc.params.id);
        rc.res.setHeader('Cache-Control', 'no-store');
        const t = ctx.now();
        return {
          renders: { total: renders(tn.id), d30: renders(tn.id, t - 30 * DAY), month: renders(tn.id, Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1)) },
          products: products(tn.id),
          leads: services.leads?.countFor ? services.leads.countFor(tn.id) : null,
          queue: queueFor(tn.id),
        };
      },
    },
  ];
}
