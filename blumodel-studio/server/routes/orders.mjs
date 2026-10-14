// Package C (orders): paid custom 3D models (PRODUCT_SPEC §7, BUILD_PLAN §7, §13.3).
//
//   customer  /api/orders/tiers · /api/orders/quote · /api/orders (create, list) · /api/orders/:id
//             (?sync=1 after Stripe) · checkout · cancel · revision · accept
//   demo      /api/payments/demo/:id/complete   (refused unless the DEMO provider is allowed)
//   studio    /api/studio/orders · start · note · deliver
//   admin     /api/admin/orders/:id/refund · /api/admin/revenue
//
// The Stripe webhook route is the foundation's (server/routes/webhooks.mjs): it verifies and
// dedupes, then dispatches here through services.webhooks ('order' and 'charge.refunded').
// Prices come only from server/payments/tiers.mjs; client-sent amounts are ignored.

import { HttpError } from '../http/respond.mjs';
import { paymentsUnavailable, selectProvider } from '../payments/index.mjs';
import { quote, tiersWire, tierById, MAX_ITEMS } from '../payments/tiers.mjs';
import { createOrderService, ORDER_STATUSES, UNPAID, ACTIVE, REFUNDABLE } from '../payments/orders.mjs';
import { idOf } from '../payments/stripe.mjs';

const SESSION_RE = /^cs_[A-Za-z0-9_]{1,200}$/;
const STAFF = new Set(['studio', 'admin']);

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const orders = createOrderService({ db, now: ctx.now, services, config, log, tx: ctx.tx });

  // ── Stripe webhooks (the route is the foundation's) ──────────────────────
  const recordPayment = (event, orderId) =>
    db
      .prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, type, order_id, received_at, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run('stripe', String(event.id), String(event.type), orderId ?? null, ctx.now(), JSON.stringify(event).slice(0, 64_000));

  services.webhooks.on('order', (event) => {
    if (!String(event.type).startsWith('checkout.session.')) return; // charges are handled by type below
    const s = event.data?.object ?? {};
    const orderId = s.metadata?.order_id ?? s.client_reference_id;
    const o = orders.rowOf(orderId);
    if (!o) return;
    recordPayment(event, o.id);
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (s.payment_status !== 'paid') return; // an async method completes later
        orders.markOrderPaid(o.id, { ref: s.id, amountCents: s.amount_total, currency: s.currency, paymentIntent: idOf(s.payment_intent), source: 'stripe_webhook' });
        return;
      case 'checkout.session.async_payment_failed':
        orders.transition(o.id, ['pending_payment'], 'payment_failed', { type: 'payment_failed', note: 'The payment didn’t go through.', data: { source: 'stripe_webhook', ref: s.id } });
        return;
      case 'checkout.session.expired':
        // Only the session currently on the order; an older attempt expiring changes nothing.
        if (o.provider_ref === s.id) orders.transition(o.id, ['pending_payment'], 'expired', { type: 'expired', note: 'The checkout page expired.', data: { source: 'stripe_webhook', ref: s.id } });
        return;
      default:
    }
  });

  services.webhooks.on('charge.refunded', (event) => {
    const ch = event.data?.object ?? {};
    const pi = idOf(ch.payment_intent);
    if (!pi) return;
    const o = db.prepare("SELECT * FROM orders WHERE payment_intent = ? AND provider = 'stripe'").get(pi);
    if (!o) return; // not an order (e.g. a kitchen unlock)
    recordPayment(event, o.id);
    if (ch.refunded === true) orders.markRefunded(o.id, { ref: idOf(ch.refunds?.data?.[0]) ?? ch.id ?? null, source: 'stripe_webhook', note: 'Refunded in Stripe.' });
    else orders.addEvent(o.id, { type: 'partial_refund', note: 'Part of this payment was refunded in Stripe.', data: { amountRefunded: ch.amount_refunded ?? null } });
  });

  // ── helpers ─────────────────────────────────────────────────────────────
  const isStaff = (user) => !!user && STAFF.has(user.role);

  /** The order if the caller may see it (its buyer, studio or admin); otherwise 404. */
  const visibleOrder = (rc, id) => {
    const o = orders.rowOf(id);
    if (!o || (o.user_id !== rc.user.id && !isStaff(rc.user))) throw new HttpError(404, 'That order does not exist.');
    return o;
  };
  /** Only the buyer may act on their order. */
  const ownOrder = (rc, id) => {
    const o = orders.rowOf(id);
    if (!o || o.user_id !== rc.user.id) throw new HttpError(404, 'That order does not exist.');
    return o;
  };

  /** No payments on this server (launch contract): every order-payment endpoint answers 503. */
  const requirePayments = () => {
    if (config.paymentsProvider === 'none') throw paymentsUnavailable();
  };
  const requireDemo = () => {
    requirePayments();
    if (config.paymentsProvider !== 'demo') throw new HttpError(403, 'Demo payments are only available when Stripe isn’t configured.');
  };

  const label = (byUserId, viewer, buyerId) => {
    if (!byUserId) return 'system';
    if (byUserId === viewer.id) return 'you';
    if (byUserId === buyerId) return 'customer';
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(byUserId);
    return u?.role === 'admin' ? 'admin' : u?.role === 'studio' ? 'studio' : 'customer';
  };

  /** Everything the order page (and the studio drawer) shows. */
  function detail(o, viewer) {
    const items = orders.itemsOf(o.id);
    const wire = orders.toWire(o, items);
    const staff = isStaff(viewer);
    const refIds = [...new Set(items.flatMap((it) => it.brief?.referenceFileIds ?? []))];
    const references = refIds
      .map((id) => services.files.get(id))
      .filter((f) => f && services.files.canRead(viewer, f, null))
      .map((f) => services.files.toWire(f));
    const deliverables = items
      .map((it) => (it.deliverableProductId ? services.products.get(it.deliverableProductId) : null))
      .filter(Boolean)
      .map((row) => services.products.toWire(row, { which: row.liveSpec && row.source !== 'brand' ? 'live' : 'working', viewer }))
      .filter(Boolean);
    const events = orders.eventsOf(o.id).map((e) => ({
      ...e,
      by: label(e.byUserId, viewer, o.user_id),
      byUserId: staff ? e.byUserId : e.byUserId === viewer.id ? e.byUserId : null,
      // Payment plumbing (refs) is for staff only.
      data: staff ? e.data : e.data && typeof e.data === 'object' ? { ...(e.data.item != null ? { item: e.data.item } : {}), ...(e.data.productId ? { productId: e.data.productId } : {}) } : null,
    }));
    let buyer = null;
    if (staff && o.user_id) {
      const u = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(o.user_id);
      buyer = u ? { id: u.id, name: u.name, email: u.email } : null;
    }
    let assignee = null;
    if (o.assigned_to) {
      const a = db.prepare('SELECT name FROM users WHERE id = ?').get(o.assigned_to);
      assignee = staff ? (a?.name ?? null) : 'BluModel 3D studio';
    }
    return {
      order: wire,
      events,
      references,
      deliverables,
      ...(staff ? { buyer } : {}),
      assignee,
      payments: config.paymentsProvider,
      demo: config.paymentsProvider === 'demo',
    };
  }

  const queueWire = (o) => {
    const items = orders.itemsOf(o.id);
    const w = orders.toWire(o, items);
    const u = o.user_id ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(o.user_id) : null;
    const a = o.assigned_to ? db.prepare('SELECT name FROM users WHERE id = ?').get(o.assigned_to) : null;
    return { ...w, buyer: u ? { name: u.name, email: u.email } : null, assignee: a?.name ?? null, delivered: items.filter((it) => it.deliverableProductId).length };
  };

  const days = (v, def = 90) => {
    const n = Number(v ?? def);
    return Number.isInteger(n) && n >= 1 && n <= 730 ? n : def;
  };

  const note = (v, { required = false, field = 'note' } = {}) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (required && !s) throw new HttpError(400, 'Add a note.', { errors: [{ field, message: 'Add a note.' }] });
    if (s.length > 2000) throw new HttpError(400, 'Keep the note to 2,000 characters or fewer.', { errors: [{ field, message: 'Keep the note to 2,000 characters or fewer.' }] });
    return s;
  };

  return [
    // ── public ──────────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/orders/tiers',
      auth: 'none',
      handler: () => ({ ...tiersWire(), payments: config.paymentsProvider, demo: config.paymentsProvider === 'demo' }),
    },
    {
      // A live quote for the request form; the order itself is re-quoted when it is created.
      method: 'POST',
      path: '/api/orders/quote',
      auth: 'none',
      rateLimit: { name: 'order-quote', max: 600, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const b = rc.body;
        const list = Array.isArray(b.items) ? b.items : [b];
        if (!list.length || list.length > MAX_ITEMS) throw new HttpError(400, `Quote 1 to ${MAX_ITEMS} products.`);
        const items = list.map((it, i) => {
          if (!it || !tierById(it.tier)) throw new HttpError(400, 'Choose a model tier.', { errors: [{ field: `items[${i}].tier`, message: 'Choose a model tier.' }] });
          return { tier: it.tier, extraFinishes: Number.isInteger(it.extraFinishes) ? it.extraFinishes : 0, name: typeof it.name === 'string' ? it.name : undefined };
        });
        return { quote: quote({ items, rush: b.rush === true }) };
      },
    },

    // ── the buyer ───────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/orders',
      rateLimit: { name: 'order-create', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        requirePayments();
        const req = orders.readRequest(rc.body, rc.user);
        const row = orders.create(rc.user, req);
        const w = orders.toWire(row);
        rc.send(201, { order: w, quote: w.quote });
      },
    },
    {
      method: 'GET',
      path: '/api/orders',
      handler: (rc) => {
        orders.sweepExpired();
        const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id').all(rc.user.id);
        return { orders: rows.map((o) => orders.toWire(o)), payments: config.paymentsProvider, demo: config.paymentsProvider === 'demo' };
      },
    },
    {
      method: 'GET',
      path: '/api/orders/:id',
      handler: async (rc) => {
        orders.sweepExpired();
        let o = visibleOrder(rc, rc.params.id);
        // Back from Stripe (`?session_id=` on the page): don't wait for the webhook.
        if (rc.query.get('sync') === '1' && o.user_id === rc.user.id && o.provider === 'stripe' && config.paymentsProvider === 'stripe') {
          const asked = rc.query.get('session_id');
          const ref = asked && SESSION_RE.test(asked) ? asked : o.provider_ref;
          if (ref && [...UNPAID, 'expired', 'cancelled'].includes(o.status)) {
            const s = await selectProvider(ctx, 'stripe').retrieve(ref);
            if (s.orderId === o.id && s.paid) {
              ctx.tx(() => orders.markOrderPaid(o.id, { ref, amountCents: s.amountCents, currency: s.currency, paymentIntent: s.paymentIntent, by: rc.user.id, source: 'stripe_sync' }));
              o = orders.rowOf(o.id);
            }
          }
        }
        return detail(o, rc.user);
      },
    },
    {
      method: 'POST',
      path: '/api/orders/:id/checkout',
      rateLimit: { name: 'order-checkout', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        requirePayments();
        orders.sweepExpired();
        const o = ownOrder(rc, rc.params.id);
        if (!UNPAID.includes(o.status)) {
          const why = o.status === 'expired' ? 'This order expired. Start a new request.' : o.status === 'cancelled' ? 'This order was cancelled.' : 'This order is already paid.';
          throw new HttpError(409, why, { status: o.status });
        }
        const providerId = config.paymentsProvider;
        if (providerId === 'demo') requireDemo();
        const attempt = o.checkout_attempts + 1;
        const items = orders.itemsOf(o.id);
        const q = orders.quoteOf(o, items);
        const provider = selectProvider(ctx, providerId);
        const { url, ref } = await provider.createCheckout(
          {
            id: o.id,
            amountCents: o.amount_cents,
            currency: o.currency,
            items: items.map((it, i) => ({
              label: `BluModel Studio - Custom 3D model (${tierById(it.tier).name}): ${it.brief?.name ?? 'product'}`,
              amountCents: q.items[i].amountCents,
            })),
          },
          { attempt, email: rc.user.email },
        );
        const changed = orders.transition(o.id, UNPAID, 'pending_payment', {
          by: rc.user.id,
          type: 'checkout',
          data: { provider: providerId, attempt },
          set: { provider: providerId, provider_ref: ref, checkout_attempts: attempt, pending_since: ctx.now() },
        });
        if (!changed) throw new HttpError(409, 'This order changed while starting checkout. Reload and try again.');
        return { url, provider: providerId };
      },
    },
    {
      method: 'POST',
      path: '/api/orders/:id/cancel',
      handler: (rc) => {
        const o = ownOrder(rc, rc.params.id);
        if (!UNPAID.includes(o.status)) throw new HttpError(409, o.status === 'cancelled' ? 'This order is already cancelled.' : 'Paid orders can’t be cancelled here. Contact BluModel Studio for a refund.', { status: o.status });
        orders.transition(o.id, UNPAID, 'cancelled', { by: rc.user.id, type: 'cancelled' });
        return detail(orders.rowOf(o.id), rc.user);
      },
    },
    {
      method: 'POST',
      path: '/api/orders/:id/revision',
      handler: (rc) => {
        const o = ownOrder(rc, rc.params.id);
        const text = note(rc.body.note, { required: true });
        if (o.status !== 'delivered') throw new HttpError(409, 'You can ask for a revision once the model is delivered.', { status: o.status });
        if (o.revisions_used >= 2) throw new HttpError(409, 'Both revision rounds have been used.', { status: o.status });
        const changed = orders.transition(o.id, ['delivered'], 'revision_requested', {
          by: rc.user.id,
          type: 'revision_requested',
          note: text,
          set: { revisions_used: { sql: 'revisions_used + 1' } },
        });
        if (!changed) throw new HttpError(409, 'This order changed. Reload and try again.');
        return detail(orders.rowOf(o.id), rc.user);
      },
    },
    {
      method: 'POST',
      path: '/api/orders/:id/accept',
      handler: (rc) => {
        const o = ownOrder(rc, rc.params.id);
        if (o.status !== 'delivered') throw new HttpError(409, 'You can accept the model once it is delivered.', { status: o.status });
        orders.transition(o.id, ['delivered'], 'completed', { by: rc.user.id, type: 'completed', set: { completed_at: ctx.now() } });
        return detail(orders.rowOf(o.id), rc.user);
      },
    },

    // ── the DEMO provider ───────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/payments/demo/:id/complete',
      handler: (rc) => {
        requireDemo();
        orders.sweepExpired();
        const o = ownOrder(rc, rc.params.id);
        if (o.provider !== 'demo') throw new HttpError(400, 'That order isn’t a demo order.');
        const outcome = rc.body.outcome;
        if (outcome !== 'success' && outcome !== 'decline') throw new HttpError(400, 'Choose success or decline.');
        if (o.status === 'draft') throw new HttpError(409, 'Start checkout first.', { status: o.status });
        if (o.status === 'expired' || o.status === 'cancelled') throw new HttpError(409, o.status === 'expired' ? 'This order expired. Start a new request.' : 'This order was cancelled.', { status: o.status });
        if (o.status === 'pending_payment' || o.status === 'payment_failed') {
          ctx.tx(() => {
            const id = `demo_${o.id}_${o.checkout_attempts}_${outcome}_${ctx.now()}`;
            db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, type, order_id, received_at, payload) VALUES (?, ?, ?, ?, ?, ?)').run('demo', id, `demo.${outcome}`, o.id, ctx.now(), null);
            if (outcome === 'success') {
              // The DEMO "provider" pays exactly the server's amount; no money moves.
              orders.markOrderPaid(o.id, { ref: `demo_${o.id}`, amountCents: o.amount_cents, currency: o.currency, by: rc.user.id, source: 'demo' });
            } else {
              orders.transition(o.id, ['pending_payment'], 'payment_failed', { by: rc.user.id, type: 'payment_failed', note: 'Declined (simulated). Nothing was charged.', data: { source: 'demo' } });
            }
          });
        }
        // Anything later (already paid…) is a harmless repeat: report the order as it is.
        return detail(orders.rowOf(o.id), rc.user);
      },
    },

    // ── the studio ──────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/studio/orders',
      auth: 'studio',
      handler: (rc) => {
        orders.sweepExpired();
        const s = rc.query.get('status') || 'active';
        let statuses;
        if (s === 'active') statuses = ACTIVE;
        else if (s === 'all') statuses = ORDER_STATUSES.filter((x) => !UNPAID.includes(x) && x !== 'expired' && x !== 'cancelled');
        else if (ORDER_STATUSES.includes(s)) statuses = [s];
        else throw new HttpError(400, 'Unknown status filter.');
        const rows = db
          .prepare(`SELECT * FROM orders WHERE status IN (${statuses.map(() => '?').join(', ')}) ORDER BY due_at IS NULL, due_at, paid_at, created_at`)
          .all(...statuses);
        const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
        return { orders: rows.map(queueWire), counts, filter: s };
      },
    },
    {
      method: 'POST',
      path: '/api/studio/orders/:id/start',
      auth: 'studio',
      handler: (rc) => {
        const o = visibleOrder(rc, rc.params.id);
        if (o.status !== 'paid' && o.status !== 'revision_requested') throw new HttpError(409, o.status === 'in_progress' ? 'This order is already in progress.' : 'Only paid orders (or revision requests) can be started.', { status: o.status });
        orders.transition(o.id, ['paid', 'revision_requested'], 'in_progress', { by: rc.user.id, type: 'started', set: { assigned_to: rc.user.id } });
        return detail(orders.rowOf(o.id), rc.user);
      },
    },
    {
      method: 'POST',
      path: '/api/studio/orders/:id/note',
      auth: 'studio',
      handler: (rc) => {
        const o = visibleOrder(rc, rc.params.id);
        const text = note(rc.body.note, { required: true });
        orders.addEvent(o.id, { type: 'note', by: rc.user.id, note: text });
        db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(ctx.now(), o.id);
        return detail(orders.rowOf(o.id), rc.user);
      },
    },
    {
      method: 'POST',
      path: '/api/studio/orders/:id/deliver',
      auth: 'studio',
      handler: (rc) => {
        const o = visibleOrder(rc, rc.params.id);
        const out = orders.deliver(o.id, rc.user, rc.body);
        const d = detail(orders.rowOf(o.id), rc.user);
        return { ...d, product: services.products.toWire(out.product, { which: 'working', viewer: rc.user }), report: out.report, complete: out.done };
      },
    },
    {
      // The GLB report for an uploaded model before it is delivered (the deliver form's check).
      method: 'GET',
      path: '/api/studio/orders/:id/report',
      auth: 'studio',
      handler: (rc) => {
        const o = visibleOrder(rc, rc.params.id);
        const items = orders.itemsOf(o.id);
        const it = items.find((x) => String(x.idx) === (rc.query.get('item') || '0'));
        if (!it) throw new HttpError(400, 'Choose which product you are delivering.');
        const f = services.files.assertUsable(String(rc.query.get('modelFileId') || ''), { userId: rc.user.id, kinds: ['model'] });
        return { report: orders.glbReport(f, it.brief) };
      },
    },

    // ── admin ───────────────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/orders/:id/refund',
      auth: 'admin',
      handler: async (rc) => {
        const o = visibleOrder(rc, rc.params.id);
        if (!REFUNDABLE.includes(o.status)) throw new HttpError(409, o.status === 'refunded' ? 'This order is already refunded.' : 'Only paid, in-progress or delivered orders can be refunded.', { status: o.status });
        const text = note(rc.body.note);
        // The order's own provider: a DEMO order stays a DEMO refund even after Stripe is set up.
        const r = await selectProvider(ctx, o.provider).refund({ id: o.id, paymentIntent: o.payment_intent });
        if (!r.ok) throw new HttpError(502, 'The payment provider didn’t complete the refund.', { refundStatus: r.status });
        ctx.tx(() => orders.markRefunded(o.id, { ref: r.ref, by: rc.user.id, note: text, source: o.provider }));
        return detail(orders.rowOf(o.id), rc.user);
      },
    },
    {
      method: 'GET',
      path: '/api/admin/revenue',
      auth: 'admin',
      handler: (rc) => {
        const n = days(rc.query.get('days'));
        const demo = orders.revenue({ days: n, provider: 'demo' });
        const stripe = orders.revenue({ days: n, provider: 'stripe' });
        const current = config.paymentsProvider === 'stripe' ? stripe : demo;
        return { provider: config.paymentsProvider, days: n, currency: 'usd', ...current, byProvider: { demo, stripe } };
      },
    },
  ];
}
