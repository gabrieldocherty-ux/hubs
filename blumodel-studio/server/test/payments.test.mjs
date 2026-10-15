// Package C (orders): payment security and the Stripe path for custom-model orders.
// Stripe is only ever a mocked fetch here; no real Stripe call is made anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';
import { verifyStripeSignature } from '../lib/validators.mjs';
import { quote, addBusinessDays } from '../payments/tiers.mjs';

const SECRET = 'whsec_orders_test';
const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_orders', STRIPE_WEBHOOK_SECRET: SECRET, PUBLIC_URL: 'https://blumodel.example' };

const sign = (body, secret = SECRET, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
function signed(event, secret = SECRET, ts) {
  const body = JSON.stringify(event);
  return { body, header: sign(body, secret, ts) };
}

/** A Stripe stand-in: records every call; sessions and refunds succeed. */
function stripeMock() {
  const calls = [];
  const sessions = new Map();
  let n = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body ?? '');
    calls.push({ method: init.method, path: u.pathname, url: String(url), form, headers: init.headers });
    if (u.hostname !== 'api.stripe.com') return json({ error: { message: 'unexpected host' } }, 400);
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') {
      const id = `cs_test_${++n}`;
      const total = [...form.keys()].filter((k) => /^line_items\[\d+\]\[price_data\]\[unit_amount\]$/.test(k)).reduce((s, k) => s + Number(form.get(k)), 0);
      sessions.set(id, { id, object: 'checkout.session', payment_status: 'unpaid', status: 'open', amount_total: total, currency: form.get('line_items[0][price_data][currency]'), client_reference_id: form.get('client_reference_id'), metadata: { kind: form.get('metadata[kind]'), order_id: form.get('metadata[order_id]') }, payment_intent: null });
      return json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    if (u.pathname.startsWith('/v1/checkout/sessions/') && init.method === 'GET') {
      const s = sessions.get(decodeURIComponent(u.pathname.split('/').pop()));
      return s ? json(s) : json({ error: { message: 'No such session' } }, 404);
    }
    if (u.pathname === '/v1/refunds' && init.method === 'POST') return json({ id: 're_test_1', object: 'refund', status: 'succeeded', payment_intent: form.get('payment_intent') });
    return json({ error: { message: 'not mocked' } }, 400);
  };
  /** What Stripe does when the buyer pays on its page. */
  const pay = (id, over = {}) => Object.assign(sessions.get(id), { payment_status: 'paid', status: 'complete', payment_intent: `pi_for_${id}` }, over);
  return { fetch, calls, sessions, pay };
}

async function stripeServer() {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  const hook = (ev, headers = {}) => s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': ev.header, ...headers }, csrf: false });
  return { s, mock, hook };
}

async function order(s, agent, over = {}) {
  const ref = (await agent.putRaw('/api/files?kind=reference&name=p.png', makePng(), 'image/png')).body.file.id;
  const r = await agent.post('/api/orders', {
    target: 'customer',
    brief: { productTypeId: 'sink-farmhouse', kind: 'sink', variant: 'farmhouse', name: 'Old farmhouse sink', widthIn: 33, depthIn: 22, heightIn: 36, notes: '', referenceFileIds: [ref] },
    tier: 'standard',
    extraFinishes: 1,
    amountCents: 1,
    ...over,
  });
  assert.equal(r.status, 201, r.text);
  return r.body.order;
}

const completed = (session, over = {}) => ({ id: `evt_${crypto.randomBytes(6).toString('hex')}`, type: 'checkout.session.completed', data: { object: { ...session, ...over } } });
const orderRow = (s, id) => s.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const paidEvents = (s, id) => s.db.prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND type = 'paid'").get(id).n;

// ── signatures ───────────────────────────────────────────────────────────

test('webhook signatures: valid, two v1 values, tampered, 10 minutes old, v0 only, short signature', () => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }));
  const now = Date.now();
  const ts = Math.floor(now / 1000);
  const good = crypto.createHmac('sha256', SECRET).update(`${ts}.`).update(body).digest('hex');
  const wrong = crypto.createHmac('sha256', 'whsec_other').update(`${ts}.`).update(body).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=${good}`, SECRET, 300, now), true, 'valid');
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=${wrong},v1=${good}`, SECRET, 300, now), true, 'any of several v1 values (secret rotation)');
  const tampered = Buffer.from(body.toString().replace('evt_1', 'evt_2'));
  assert.equal(verifyStripeSignature(tampered, `t=${ts},v1=${good}`, SECRET, 300, now), false, 'tampered body');
  const old = ts - 600;
  const oldSig = crypto.createHmac('sha256', SECRET).update(`${old}.`).update(body).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${old},v1=${oldSig}`, SECRET, 300, now), false, '10 minutes old');
  assert.equal(verifyStripeSignature(body, `t=${ts},v0=${good}`, SECRET, 300, now), false, 'v0 only (downgrade)');
  assert.doesNotThrow(() => verifyStripeSignature(body, `t=${ts},v1=abcd`, SECRET, 300, now));
  assert.equal(verifyStripeSignature(body, `t=${ts},v1=abcd`, SECRET, 300, now), false, 'short signature, no throw');
  assert.equal(verifyStripeSignature(body, undefined, SECRET, 300, now), false, 'no header');
});

// ── config ───────────────────────────────────────────────────────────────

test('with no Stripe keys the provider is demo; with both (test values) checkout goes to Stripe', async () => {
  const demo = await startTestServer({ env: { PAYMENTS: 'auto', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' } });
  try {
    assert.equal((await demo.agent().get('/api/config')).body.payments, 'demo');
    assert.equal((await demo.agent().get('/api/orders/tiers')).body.payments, 'demo');
  } finally {
    await demo.close();
  }
  const { s, mock } = await stripeServer();
  try {
    assert.equal((await s.agent().get('/api/config')).body.payments, 'stripe');
    const ann = await s.user();
    const o = await order(s, ann);
    assert.equal(o.provider, 'stripe');
    const c = await ann.post(`/api/orders/${o.id}/checkout`);
    assert.equal(c.status, 200, c.text);
    assert.match(c.body.url, /^https:\/\/checkout\.stripe\.com\//);
    assert.equal(mock.calls.length, 1);
    assert.ok(mock.calls.every((x) => new URL(x.url).hostname === 'api.stripe.com'));
  } finally {
    await s.close();
  }
});

// ── checkout request ─────────────────────────────────────────────────────

test('Stripe checkout is built on the server’s amount: form fields, idempotency key, session id in the query string', async () => {
  const { s, mock } = await stripeServer();
  try {
    const ann = await s.user();
    const o = await order(s, ann);
    assert.equal(o.amountCents, 12_900, 'one product is one Model pack; the old tier and extra finish in the body change nothing');
    const c = await ann.post(`/api/orders/${o.id}/checkout`, { amountCents: 50 });
    assert.equal(c.status, 200, c.text);
    const call = mock.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v1/checkout/sessions');
    assert.equal(call.headers.Authorization, 'Bearer sk_test_orders');
    assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(call.headers['Idempotency-Key'], `${o.id}-1`);
    const f = call.form;
    assert.equal(f.get('mode'), 'payment');
    assert.equal(f.get('line_items[0][price_data][currency]'), 'cad');
    assert.equal(f.get('line_items[0][price_data][unit_amount]'), '12900', 'the server’s quote; the client’s 50 is ignored');
    assert.equal(f.get('line_items[0][price_data][product_data][name]'), 'BluModel Studio - Model pack: 1 product');
    assert.equal(f.get('line_items[0][quantity]'), '1');
    assert.equal(f.get('line_items[1][price_data][unit_amount]'), null, 'one pack, one line');
    assert.equal(f.get('client_reference_id'), o.id);
    assert.equal(f.get('metadata[order_id]'), o.id);
    assert.equal(f.get('metadata[kind]'), 'order');
    assert.equal(f.get('payment_intent_data[metadata][order_id]'), o.id);
    assert.equal(f.get('customer_email'), ann.user.email);
    assert.equal(f.get('success_url'), `https://blumodel.example/?session_id={CHECKOUT_SESSION_ID}#/orders/${o.id}`);
    assert.ok(call.form.toString().includes('success_url=https%3A%2F%2Fblumodel.example%2F%3Fsession_id%3D%7BCHECKOUT_SESSION_ID%7D%23%2Forders%2F'), 'the placeholder sits in the query string, before the hash');
    assert.equal(f.get('cancel_url'), `https://blumodel.example/#/orders/${o.id}`);
    const row = orderRow(s, o.id);
    assert.equal(row.status, 'pending_payment');
    assert.equal(row.provider_ref, 'cs_test_1');

    // A retry after a decline gets a new attempt (and a new idempotency key).
    s.db.prepare("UPDATE orders SET status = 'payment_failed' WHERE id = ?").run(o.id);
    await ann.post(`/api/orders/${o.id}/checkout`);
    assert.equal(mock.calls[1].headers['Idempotency-Key'], `${o.id}-2`);

    // A multi-product request with rush: one line per pack plus the rush line, one session.
    const pro = await s.user();
    const ref = (await pro.putRaw('/api/files?kind=reference&name=p.png', makePng(), 'image/png')).body.file.id;
    const b = (n) => ({ brief: { productTypeId: 'pendant-globe', kind: 'pendant', variant: 'globe', name: `Globe ${n}`, widthIn: 12, depthIn: 12, heightIn: 12, notes: '', referenceFileIds: [ref] }, tier: 'simple' });
    const multi = (await pro.post('/api/orders', { items: [b(1), b(2)], rush: true })).body.order;
    await pro.post(`/api/orders/${multi.id}/checkout`);
    const mf = mock.calls[2].form;
    assert.equal(mf.get('line_items[0][price_data][product_data][name]'), 'BluModel Studio - Model pack: 2 products');
    assert.equal(mf.get('line_items[0][price_data][unit_amount]'), '12900');
    assert.equal(mf.get('line_items[1][price_data][product_data][name]'), 'BluModel Studio - Rush (+50%, half the turnaround)');
    assert.equal(mf.get('line_items[1][price_data][unit_amount]'), '6450');
    assert.equal(multi.amountCents, 19_350);

    // An order placed before Model packs is charged the price it was quoted, line for line.
    const legacyId = 'o_legacystripeorder0000001';
    const t0 = Date.now();
    s.db
      .prepare(
        `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, pending_since, created_at, updated_at)
         VALUES (?, ?, 'customer', 'draft', 'standard', ?, 31800, 'usd', 'stripe', ?, ?, ?, ?)`,
      )
      .run(legacyId, ann.user.id, JSON.stringify({ rush: false, extraFinishes: 1 }), JSON.stringify({ name: 'Old farmhouse sink' }), t0, t0, t0);
    s.db.prepare("INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, 0, ?, 'standard', 1, 31800)").run(legacyId, JSON.stringify({ name: 'Old farmhouse sink' }));
    const lc = await ann.post(`/api/orders/${legacyId}/checkout`);
    assert.equal(lc.status, 200, lc.text);
    const lf = mock.calls[3].form;
    assert.equal(lf.get('line_items[0][price_data][unit_amount]'), '31800');
    assert.equal(lf.get('line_items[0][price_data][product_data][name]'), 'BluModel Studio - Standard model: Old farmhouse sink, 1 extra finish');
    assert.equal(lf.get('line_items[1][price_data][unit_amount]'), null);
    // Demo completion is refused when Stripe is the provider.
    const demo = await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
    assert.equal(demo.status, 403);
    assert.equal(orderRow(s, o.id).status, 'pending_payment');
  } finally {
    await s.close();
  }
});

// ── webhooks ─────────────────────────────────────────────────────────────

test('webhook: verified, deduplicated (one fulfilment), no X-BluModel needed; every other POST still needs it', async () => {
  const { s, mock, hook } = await stripeServer();
  try {
    const ann = await s.user();
    const o = await order(s, ann);
    await ann.post(`/api/orders/${o.id}/checkout`);
    const session = mock.pay('cs_test_1');
    const ev = signed(completed(session));
    const r1 = await hook(ev);
    assert.equal(r1.status, 200, r1.text);
    assert.deepEqual(r1.body, { received: true });
    const row = orderRow(s, o.id);
    assert.equal(row.status, 'paid');
    assert.equal(row.payment_intent, 'pi_for_cs_test_1');
    assert.equal(row.due_at, addBusinessDays(row.paid_at, quote({ tier: 'standard', extraFinishes: 1 }).dueBusinessDays));
    // The same event again: acknowledged, not fulfilled twice.
    const r2 = await hook(signed(JSON.parse(ev.body)));
    assert.equal(r2.status, 200);
    assert.equal(r2.body.duplicate, true);
    // A different event for the same payment (Stripe's async_payment_succeeded, say): still one.
    await hook(signed({ ...completed(session), type: 'checkout.session.async_payment_succeeded' }));
    assert.equal(paidEvents(s, o.id), 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE provider = 'stripe' AND order_id = ?").get(o.id).n, 2);

    // The CSRF gate still guards every other POST.
    const noHeader = await ann.request('POST', '/api/orders', { body: { tier: 'simple' }, csrf: false });
    assert.equal(noHeader.status, 403);
    assert.equal((await ann.request('POST', `/api/orders/${o.id}/cancel`, { body: {}, csrf: false })).status, 403);
  } finally {
    await s.close();
  }
});

test('webhook: unverified → 400 with no change; an amount mismatch is logged and not fulfilled', async () => {
  const { s, mock, hook } = await stripeServer();
  try {
    const ann = await s.user();
    const o = await order(s, ann);
    await ann.post(`/api/orders/${o.id}/checkout`);
    const session = mock.pay('cs_test_1');
    const before = JSON.stringify(orderRow(s, o.id));
    const evs = [
      signed(completed(session), 'whsec_wrong'),
      signed(completed(session), SECRET, Math.floor(Date.now() / 1000) - 600),
      { body: JSON.stringify(completed(session)), header: 't=1,v0=abc' },
      { body: JSON.stringify(completed(session)), header: '' },
    ];
    for (const ev of evs) {
      const r = await hook(ev);
      assert.equal(r.status, 400, ev.header);
    }
    assert.equal(JSON.stringify(orderRow(s, o.id)), before, 'no DB change');
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n, 0);

    const cheap = await hook(signed(completed(session, { amount_total: 100 })));
    assert.equal(cheap.status, 200, 'verified events are always acknowledged');
    assert.equal(orderRow(s, o.id).status, 'pending_payment', 'not paid');
    const euro = await hook(signed(completed(session, { currency: 'eur' })));
    assert.equal(euro.status, 200);
    assert.equal(orderRow(s, o.id).status, 'pending_payment');
    const mismatches = s.db.prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND type = 'payment_mismatch'").get(o.id).n;
    assert.equal(mismatches, 2);
    // Unpaid (an async method still processing) completes nothing either.
    await hook(signed(completed(session, { payment_status: 'unpaid' })));
    assert.equal(orderRow(s, o.id).status, 'pending_payment');
    // Events for other kinds and unknown orders are ignored without error.
    assert.equal((await hook(signed(completed({ ...session, metadata: { kind: 'order', order_id: 'o_doesnotexist0000000000000' }, client_reference_id: null })))).status, 200);
  } finally {
    await s.close();
  }
});

test('webhook: expired and failed sessions; a payment that lands after expiry is honoured', async () => {
  const { s, mock, hook } = await stripeServer();
  try {
    const ann = await s.user();
    const o = await order(s, ann);
    await ann.post(`/api/orders/${o.id}/checkout`);
    const sess = mock.sessions.get('cs_test_1');
    await hook(signed({ id: 'evt_fail', type: 'checkout.session.async_payment_failed', data: { object: sess } }));
    assert.equal(orderRow(s, o.id).status, 'payment_failed');
    await ann.post(`/api/orders/${o.id}/checkout`); // attempt 2 → cs_test_2
    // The OLD session expiring changes nothing; the current one expiring expires the order.
    await hook(signed({ id: 'evt_exp_old', type: 'checkout.session.expired', data: { object: sess } }));
    assert.equal(orderRow(s, o.id).status, 'pending_payment');
    await hook(signed({ id: 'evt_exp_new', type: 'checkout.session.expired', data: { object: mock.sessions.get('cs_test_2') } }));
    assert.equal(orderRow(s, o.id).status, 'expired');
    // Money arrives anyway (an old tab): it is honoured, never dropped.
    await hook(signed(completed(mock.pay('cs_test_1'))));
    const row = orderRow(s, o.id);
    assert.equal(row.status, 'paid');
    const ev = s.db.prepare("SELECT from_status, note FROM order_events WHERE order_id = ? AND type = 'paid'").get(o.id);
    assert.equal(ev.from_status, 'expired');
    assert.match(ev.note, /honoured/);
  } finally {
    await s.close();
  }
});

test('returning from Stripe (?sync=1) fulfils without waiting for the webhook, idempotently', async () => {
  const { s, mock } = await stripeServer();
  try {
    const ann = await s.user();
    const bob = await s.user();
    const o = await order(s, ann);
    await ann.post(`/api/orders/${o.id}/checkout`);
    const unpaid = await ann.get(`/api/orders/${o.id}?sync=1&session_id=cs_test_1`);
    assert.equal(unpaid.body.order.status, 'pending_payment');
    mock.pay('cs_test_1');
    assert.equal((await bob.get(`/api/orders/${o.id}?sync=1&session_id=cs_test_1`)).status, 404);
    const r = await ann.get(`/api/orders/${o.id}?sync=1&session_id=cs_test_1`);
    assert.equal(r.body.order.status, 'paid');
    await ann.get(`/api/orders/${o.id}?sync=1`);
    assert.equal(paidEvents(s, o.id), 1);
    // A session for another order can't pay this one.
    const o2 = await order(s, ann);
    await ann.post(`/api/orders/${o2.id}/checkout`);
    assert.equal((await ann.get(`/api/orders/${o2.id}?sync=1&session_id=cs_test_1`)).body.order.status, 'pending_payment');
  } finally {
    await s.close();
  }
});

test('Stripe refunds: the admin refund calls /v1/refunds on the payment intent; charge.refunded from the dashboard refunds too', async () => {
  const { s, mock, hook } = await stripeServer();
  try {
    const ann = await s.user();
    const admin = await s.user({ role: 'admin' });
    const o = await order(s, ann);
    await ann.post(`/api/orders/${o.id}/checkout`);
    await hook(signed(completed(mock.pay('cs_test_1'))));
    const r = await admin.post(`/api/admin/orders/${o.id}/refund`, { note: 'Duplicate order.' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.order.status, 'refunded');
    const call = mock.calls.find((c) => c.path === '/v1/refunds');
    assert.equal(call.form.get('payment_intent'), 'pi_for_cs_test_1');
    assert.equal(call.headers['Idempotency-Key'], `refund-${o.id}`);
    assert.equal(orderRow(s, o.id).refund_ref, 're_test_1');
    // Stripe's charge.refunded for the same refund changes nothing more.
    await hook(signed({ id: 'evt_ch_1', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_for_cs_test_1', refunded: true, metadata: { kind: 'order', order_id: o.id } } } }));
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND type = 'refunded'").get(o.id).n, 1);

    // A refund made in the Stripe dashboard arrives only as charge.refunded.
    const o2 = await order(s, ann);
    await ann.post(`/api/orders/${o2.id}/checkout`);
    await hook(signed(completed(mock.pay('cs_test_2'))));
    await hook(signed({ id: 'evt_ch_partial', type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: 'pi_for_cs_test_2', refunded: false, amount_refunded: 500 } } }));
    assert.equal(orderRow(s, o2.id).status, 'paid', 'a partial refund is noted, not a full refund');
    await hook(signed({ id: 'evt_ch_full', type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: 'pi_for_cs_test_2', refunded: true } } }));
    assert.equal(orderRow(s, o2.id).status, 'refunded');
    // A charge that isn't an order's is ignored.
    assert.equal((await hook(signed({ id: 'evt_ch_x', type: 'charge.refunded', data: { object: { id: 'ch_x', payment_intent: 'pi_unknown', refunded: true } } }))).status, 200);
  } finally {
    await s.close();
  }
});
