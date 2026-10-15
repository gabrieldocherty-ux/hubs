// Package C (orders): custom 3D models (PRODUCT_SPEC §7, BUILD_PLAN §7, §13.3).
//
// Since 2026-10-15 they are not sold: the Contractor plan includes 3 a month, made by our studio
// (server/payments/allowance.mjs). A request is submitted against that allowance and goes straight
// to the studio. Orders paid for before then keep their stored prices, checkout and refunds.
//
//   buyer     /api/orders/tiers (the included models' terms) · /api/orders/allowance ·
//             /api/orders (submit, list) · /api/orders/:id (?sync=1 after Stripe) · checkout (an
//             older unpaid order only) · cancel · revision · accept
//   demo      /api/payments/demo/:id/complete   (refused unless the DEMO provider is allowed)
//   studio    /api/studio/orders · start · note · deliver · cancel (a plan request not yet started)
//   admin     /api/admin/orders/:id/refund · /api/admin/revenue ·
//             /api/admin/model-allowance · /api/admin/model-grants (extra models, audit-logged)
//
// The Stripe webhook route is the foundation's (server/routes/webhooks.mjs): it verifies and
// dedupes, then dispatches here through services.webhooks ('order' and 'charge.refunded').
// Nothing new is priced: a request's amount is 0 and client-sent amounts, tiers and rush are
// ignored. A paid order's amount is the one stored on it when it was made.

import { HttpError } from '../http/respond.mjs';
import { paymentsUnavailable, selectProvider } from '../payments/index.mjs';
import { includedQuote, tiersWire, MAX_ITEMS } from '../payments/tiers.mjs';
import { createOrderService, ORDER_STATUSES, UNPAID, ACTIVE, REFUNDABLE } from '../payments/orders.mjs';
import { MAX_GRANT, MAX_GRANT_NOTE } from '../payments/allowance.mjs';
import { audit } from '../lib/audit.mjs';
import { idOf } from '../payments/stripe.mjs';

const SESSION_RE = /^cs_[A-Za-z0-9_]{1,200}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
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
    // Reference photos and barcode photos: private to the buyer and the studio (files.canRead).
    const refIds = [...new Set(items.flatMap((it) => [...(it.brief?.referenceFileIds ?? []), ...(it.brief?.barcodeFileId ? [it.brief.barcodeFileId] : [])]))];
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
    // A plan request: the staff see where the contractor stands this period (and admins can grant more).
    const buyerAllowance = staff && o.user_id && orders.isPlan(o) ? { ...orders.allowance.of(o.user_id), grants: orders.allowance.currentGrants(o.user_id) } : null;
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
      ...(staff ? { buyer, buyerAllowance } : {}),
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

  /** An account by id or email (admin tools), or a 400/404. */
  const findUser = (userId, email) => {
    let u = null;
    if (typeof userId === 'string' && USER_ID_RE.test(userId)) u = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
    else if (typeof email === 'string' && EMAIL_RE.test(email.trim())) u = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email.trim().toLowerCase().slice(0, 254));
    else throw new HttpError(400, 'Enter the account’s email address.', { errors: [{ field: 'email', message: 'Enter the account’s email address.' }] });
    if (!u) throw new HttpError(404, 'No account has that email address.', { code: 'no_such_user' });
    return { id: u.id, email: u.email, name: u.name };
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
      // Kept for a page loaded before 2026-10-15: a request isn't priced any more, so the "quote" is
      // the included one (amount 0, the turnaround). Rush is gone and ignored.
      method: 'POST',
      path: '/api/orders/quote',
      auth: 'none',
      rateLimit: { name: 'order-quote', max: 600, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const b = rc.body;
        const n = Array.isArray(b.items) ? b.items.length : b.products === undefined ? 1 : b.products;
        if (!Number.isInteger(n) || n < 1 || n > MAX_ITEMS) throw new HttpError(400, `Quote 1 to ${MAX_ITEMS} products.`, { errors: [{ field: 'products', message: `Quote 1 to ${MAX_ITEMS} products.` }] });
        const { items: _shares, ...q } = includedQuote(n);
        return { quote: q };
      },
    },

    // ── the buyer ───────────────────────────────────────────────────────────
    {
      // Submits a request against the Contractor plan's allowance (no payment, so it works whatever
      // the server's payments are). 403 without the plan, 409 past the allowance (both carry it).
      method: 'POST',
      path: '/api/orders',
      rateLimit: { name: 'order-create', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const req = orders.readRequest(rc.body, rc.user);
        const row = orders.create(rc.user, req);
        const w = orders.toWire(row);
        rc.send(201, { order: w, quote: w.quote, allowance: orders.allowance.of(rc.user.id) });
      },
    },
    {
      method: 'GET',
      path: '/api/orders',
      handler: (rc) => {
        orders.sweepExpired();
        const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id').all(rc.user.id);
        return { orders: rows.map((o) => orders.toWire(o)), allowance: orders.allowance.of(rc.user.id), payments: config.paymentsProvider, demo: config.paymentsProvider === 'demo' };
      },
    },
    {
      // Where the caller stands: `{ active, included, granted, used, total, left, periodStart,
      // periodEnd, resetsAt, supportEmail }` (active is false without the Contractor plan).
      method: 'GET',
      path: '/api/orders/allowance',
      handler: (rc) => ({ allowance: orders.allowance.of(rc.user.id), terms: tiersWire().models }),
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
        if (orders.isPlan(o)) throw new HttpError(409, 'This request is included in your Contractor plan: there is nothing to pay.', { status: o.status });
        if (!UNPAID.includes(o.status)) {
          const why = o.status === 'expired' ? 'This order expired. Start a new request.' : o.status === 'cancelled' ? 'This order was cancelled.' : 'This order is already paid.';
          throw new HttpError(409, why, { status: o.status });
        }
        const providerId = config.paymentsProvider;
        if (providerId === 'demo') requireDemo();
        const attempt = o.checkout_attempts + 1;
        const provider = selectProvider(ctx, providerId);
        // The stored price (orders.amount_cents) as the stored quote's lines: an order made before
        // packs is charged what it was quoted, and a pack order what it was quoted at creation.
        const { url, ref } = await provider.createCheckout({ id: o.id, amountCents: o.amount_cents, currency: o.currency, items: orders.checkoutLines(o) }, { attempt, email: rc.user.email });
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
        if (orders.isPlan(o)) {
          // A plan request can be withdrawn until the studio starts it; its models go back to the allowance.
          if (o.status === 'cancelled') throw new HttpError(409, 'This request is already cancelled.', { status: o.status });
          if (!orders.cancelPlanRequest(o.id, { by: rc.user.id, note: 'Withdrawn before work started; the models went back to this month’s allowance.' })) {
            throw new HttpError(409, 'The studio has started on this request, so it can’t be withdrawn. Add a note for the studio instead.', { status: o.status });
          }
          return detail(orders.rowOf(o.id), rc.user);
        }
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
      // The studio cancels a plan request it won't make (before starting it): the models go back
      // to the contractor's allowance for that period. A paid order is refunded instead.
      method: 'POST',
      path: '/api/studio/orders/:id/cancel',
      auth: 'studio',
      handler: (rc) => {
        const o = visibleOrder(rc, rc.params.id);
        const text = note(rc.body.note);
        if (!orders.isPlan(o)) throw new HttpError(409, 'Only a request included in the Contractor plan can be cancelled here; a paid order is refunded.', { status: o.status });
        if (!orders.cancelPlanRequest(o.id, { by: rc.user.id, note: text ? `Cancelled by the studio: ${text} The models went back to this month’s allowance.` : '' })) {
          throw new HttpError(409, o.status === 'cancelled' ? 'This request is already cancelled.' : 'Work has started on this request, so it can’t be cancelled.', { status: o.status });
        }
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
        if (orders.isPlan(o)) throw new HttpError(409, 'Nothing was paid for this request: it is included in the Contractor plan. Cancel it before work starts instead.', { status: o.status });
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

    // ── the Contractor plan's included models (admin) ───────────────────────
    {
      // `?email=` or `?userId=`: where a contractor stands this period, and the grants that apply.
      method: 'GET',
      path: '/api/admin/model-allowance',
      auth: 'admin',
      handler: (rc) => {
        const u = findUser(rc.query.get('userId'), rc.query.get('email'));
        return { user: u, allowance: orders.allowance.of(u.id), grants: orders.allowance.currentGrants(u.id) };
      },
    },
    {
      // Gives a contractor extra models for their CURRENT period only (they don't roll over).
      // `{ userId | email, models: 1..50, note }`. Audit-logged.
      method: 'POST',
      path: '/api/admin/model-grants',
      auth: 'admin',
      rateLimit: { name: 'admin-model-grant', max: 120, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const b = rc.body;
        const u = findUser(b.userId, b.email);
        const models = b.models;
        if (!Number.isInteger(models) || models < 1 || models > MAX_GRANT) {
          throw new HttpError(400, `Grant 1 to ${MAX_GRANT} models.`, { errors: [{ field: 'models', message: `Grant 1 to ${MAX_GRANT} models.` }] });
        }
        const text = typeof b.note === 'string' ? b.note.trim() : '';
        if (text.length > MAX_GRANT_NOTE) throw new HttpError(400, `Keep the note to ${MAX_GRANT_NOTE} characters or fewer.`, { errors: [{ field: 'note', message: `Keep the note to ${MAX_GRANT_NOTE} characters or fewer.` }] });
        const out = ctx.tx(() => {
          const before = orders.allowance.of(u.id);
          if (!before.active) throw new HttpError(409, 'That account isn’t on the Contractor plan, so extra models would do nothing.', { code: 'not_contractor' });
          const grant = orders.allowance.grant(u.id, { models, note: text, adminId: rc.user.id });
          audit(db, { admin: rc.user, action: 'model_grant', targetUserId: u.id, targetEmail: u.email, detail: { models, note: text, grantId: grant.id, periodStart: grant.periodStart, periodEnd: grant.periodEnd }, at: ctx.now() });
          return grant;
        });
        rc.send(201, { grant: out, allowance: orders.allowance.of(u.id), grants: orders.allowance.currentGrants(u.id) });
      },
    },
  ];
}
