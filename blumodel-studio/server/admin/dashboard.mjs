// Admin > Overview: one server-computed snapshot of the business (GET /api/admin/dashboard).
//
// Money rules (the same as Admin > Billing):
//   - Real money (provider 'stripe') and demo money (provider 'demo') are reported apart, never
//     added together.
//   - Amounts are per currency, never summed across currencies. New charges are CAD; rows from
//     before 2026-10-15 (and subscriptions started then) are USD and are reported as legacy USD.
// Everything is a handful of aggregate queries over indexed columns, so it stays fast on SQLite.

const DAY = 86_400_000;

/** `{ cad: n, usd: n }` style map from rows of `{ currency, cents }`. */
const byCurrency = (rows, key = 'cents') => Object.fromEntries(rows.filter((r) => r.currency).map((r) => [String(r.currency).toLowerCase(), r[key]]));
const dayString = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {{ db: any, now: () => number, billing: any, allowance: any, config: any }} deps
 *   billing: a billing service (createBillingService); allowance: createAllowance(...)
 */
export function createDashboard({ db, now, billing, allowance, config }) {
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;

  function money(provider, t) {
    const d30 = t - 30 * DAY;
    const unlocks = (since) => {
      const rows = db.prepare('SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM kitchen_unlocks WHERE provider = ? AND created_at >= ? GROUP BY currency').all(provider, since);
      return { count: rows.reduce((s, r) => s + r.n, 0), byCurrency: byCurrency(rows) };
    };
    const refunds = (since) => {
      const rows = db
        .prepare("SELECT currency, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM orders WHERE provider = ? AND status = 'refunded' AND COALESCE(refunded_at, updated_at) >= ? GROUP BY currency")
        .all(provider, since);
      return { count: rows.reduce((s, r) => s + r.n, 0), byCurrency: byCurrency(rows) };
    };
    const collected = (since) => {
      const pay = db.prepare('SELECT currency, COALESCE(SUM(amount_cents), 0) AS cents FROM billing_payments WHERE provider = ? AND created_at >= ? GROUP BY currency').all(provider, since);
      const ord = db.prepare("SELECT currency, COALESCE(SUM(amount_cents), 0) AS cents FROM orders WHERE provider = ? AND paid_at IS NOT NULL AND paid_at >= ? GROUP BY currency").all(provider, since);
      const out = {};
      for (const r of [...pay, ...ord]) out[String(r.currency).toLowerCase()] = (out[String(r.currency).toLowerCase()] ?? 0) + r.cents;
      return out;
    };
    return {
      unlocks30d: unlocks(d30),
      unlocksAll: unlocks(0),
      refunds30d: refunds(d30),
      refundsAll: refunds(0),
      collected30d: collected(d30),
    };
  }

  function subscriptions(stats) {
    const of = (s) => ({ unlimited: s.active.unlimited ?? 0, contractor: s.active.contractor ?? 0, pastDue: s.pastDue, cancelling: s.cancelling, mrrByCurrency: s.mrrByCurrency });
    return { stripe: of(stats.stripe), demo: of(stats.demo) };
  }

  /** Complimentary plans in force now (an end date that has passed doesn't count). */
  function compActive(t) {
    const out = { unlimited: 0, contractor: 0 };
    const rows = db.prepare("SELECT plan, current_period_end FROM subscriptions WHERE provider = 'comp' AND status = 'active'").all();
    for (const r of rows) if (!r.current_period_end || r.current_period_end > t) out[r.plan] = (out[r.plan] ?? 0) + 1;
    return out;
  }

  /** The custom-model allowance this period, across every account on the Contractor plan. */
  function models() {
    const ids = db
      .prepare("SELECT user_id FROM subscriptions WHERE plan = 'contractor' AND status IN ('active', 'past_due')")
      .all()
      .map((r) => r.user_id);
    const out = { contractors: 0, included: 0, granted: 0, used: 0, left: 0 };
    for (const id of ids) {
      const a = allowance.of(id);
      if (!a.active) continue;
      out.contractors++;
      out.included += a.included;
      out.granted += a.granted;
      out.used += a.used;
      out.left += a.left;
    }
    return out;
  }

  function studioQueue(t) {
    const rows = db.prepare("SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('paid', 'in_progress', 'revision_requested') GROUP BY status").all();
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return {
      open: rows.reduce((s, r) => s + r.n, 0),
      toStart: by.paid ?? 0,
      inProgress: by.in_progress ?? 0,
      revision: by.revision_requested ?? 0,
      overdue: count("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid', 'in_progress', 'revision_requested') AND due_at IS NOT NULL AND due_at < ?", t),
    };
  }

  function recentSignups() {
    return db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.created_at, s.plan, s.status, s.provider,
                EXISTS (SELECT 1 FROM account_status d WHERE d.user_id = u.id) AS disabled
           FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
          ORDER BY u.created_at DESC LIMIT 10`,
      )
      .all()
      .map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        createdAt: r.created_at,
        plan: r.plan && (r.status === 'active' || r.status === 'past_due') ? r.plan : 'free',
        disabled: !!r.disabled,
      }));
  }

  function recentPayments() {
    const pays = db
      .prepare(
        `SELECT p.created_at AS at, p.kind, p.plan, p.project_name, p.amount_cents, p.currency, p.provider, p.user_id, u.email
           FROM billing_payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 10`,
      )
      .all()
      .map((r) => ({
        at: r.at,
        kind: r.kind,
        label: r.kind === 'kitchen_unlock' ? 'Kitchen unlock' : `${r.plan === 'contractor' ? 'Contractor' : 'Unlimited'} ${r.kind === 'renewal' ? 'renewal' : 'plan'}`,
        userId: r.user_id ?? null,
        email: r.email ?? null,
        amountCents: r.amount_cents,
        currency: String(r.currency).toLowerCase(),
        provider: r.provider,
      }));
    const ords = db
      .prepare(
        `SELECT o.paid_at AS at, o.status, o.amount_cents, o.currency, o.provider, o.user_id, u.email
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
          WHERE o.paid_at IS NOT NULL AND o.provider IN ('stripe', 'demo') ORDER BY o.paid_at DESC LIMIT 10`,
      )
      .all()
      .map((r) => ({
        at: r.at,
        kind: 'order',
        label: r.status === 'refunded' ? 'Custom model (refunded)' : 'Custom model',
        userId: r.user_id ?? null,
        email: r.email ?? null,
        amountCents: r.amount_cents,
        currency: String(r.currency).toLowerCase(),
        provider: r.provider,
      }));
    return [...pays, ...ords].sort((a, b) => b.at - a.at).slice(0, 10);
  }

  return {
    snapshot() {
      const t = now();
      const stats = billing.adminStats();
      const d7 = t - 7 * DAY;
      const d30 = t - 30 * DAY;
      return {
        generatedAt: t,
        payments: config.paymentsProvider,
        stripeMode: config.stripeMode ?? null,
        signups: {
          d7: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', d7),
          d30: count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', d30),
          total: count('SELECT COUNT(*) AS n FROM users'),
          disabled: count('SELECT COUNT(*) AS n FROM account_status'),
        },
        subscriptions: { ...subscriptions(stats), comp: compActive(t) },
        money: { stripe: money('stripe', t), demo: money('demo', t) },
        models: models(),
        studioQueue: studioQueue(t),
        leads: {
          d7: count('SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?', d7),
          d30: count('SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?', d30),
          unread: count("SELECT COUNT(*) AS n FROM leads WHERE status = 'new' AND read_at IS NULL"),
        },
        retail: {
          d7: count('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE day >= ?', dayString(d7)),
          d30: count('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE day >= ?', dayString(d30)),
        },
        kitchens: count('SELECT COUNT(*) AS n FROM projects'),
        recentSignups: recentSignups(),
        recentPayments: recentPayments(),
      };
    },
  };
}
