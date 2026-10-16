// Plan changes and the Contractor plan's included custom models (fixer finding: upgrade, request
// three models, downgrade, and the models were made for a credited-back upgrade).
//   - an upgrade to Contractor is invoiced and paid at once (always_invoice +
//     error_if_incomplete); a declined payment changes nothing and gives no models;
//   - leaving Contractor after models were requested this period gets no proration credit;
//   - leaving it with nothing requested is prorated as before.
// Stripe is only ever a mocked fetch, with obviously fake keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';

const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: 'whsec_FAKE_FOR_TESTS', PUBLIC_URL: 'https://blumodel.example' };
const DAY = 86_400_000;

/** A Stripe stand-in serving one subscription, `sub_fix`. `decline` makes updates fail as a card error. */
function stripeMock() {
  const calls = [];
  const state = { decline: false, amount: 1500, plan: 'unlimited' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const sub = (userId) => ({
    id: 'sub_fix',
    object: 'subscription',
    status: 'active',
    currency: 'cad',
    customer: 'cus_fix',
    cancel_at_period_end: false,
    metadata: { user_id: userId, plan: state.plan },
    items: { data: [{ id: 'si_fix', current_period_end: Math.floor((Date.now() + 20 * DAY) / 1000), price: { unit_amount: state.amount, currency: 'cad' } }] },
  });
  let userId = null;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body ?? '');
    calls.push({ method: init.method, path: u.pathname, form });
    if (u.hostname !== 'api.stripe.com') return json({ error: { type: 'invalid_request_error' } }, 400);
    if (u.pathname === '/v1/products') return json({ id: `prod_${form.get('metadata[blumodel_plan]')}` });
    if (u.pathname === '/v1/subscriptions/sub_fix' && init.method === 'GET') return json(sub(userId));
    if (u.pathname === '/v1/subscriptions/sub_fix' && init.method === 'POST') {
      if (state.decline) return json({ error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' } }, 402);
      state.amount = Number(form.get('items[0][price_data][unit_amount]'));
      state.plan = form.get('metadata[plan]');
      return json(sub(userId));
    }
    return json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
  };
  return { fetch, calls, state, setUser: (id) => (userId = id) };
}

async function unlimitedOnStripe(s, mock) {
  const ann = await s.user();
  mock.setUser(ann.id);
  const t = Date.now();
  s.db
    .prepare(
      `INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, created_at, updated_at, amount_cents, currency)
       VALUES ('sub_row_fix', ?, 'unlimited', 'active', 'stripe', 'cus_fix', 'sub_fix', ?, ?, ?, 1500, 'cad')`,
    )
    .run(ann.id, t + 20 * DAY, t - 10 * DAY, t);
  return ann;
}

async function submitThree(agent) {
  const up = await agent.putRaw('/api/files?kind=reference&name=photo.png', makePng({ w: 6, h: 6, rgba: [120, 90, 60, 255] }), 'image/png');
  assert.equal(up.status, 201, up.text);
  const items = [1, 2, 3].map((i) => ({ brief: { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name: `Harbor Base ${i}`, widthIn: 30, depthIn: 24, heightIn: 34.5, notes: '', referenceFileIds: [up.body.file.id] } }));
  return agent.post('/api/orders', { target: 'contractor', items });
}

const lastUpdate = (mock) => mock.calls.filter((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_fix').at(-1)?.form;

test('an upgrade to Contractor is charged at once; leaving after requesting models gives no credit back', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await unlimitedOnStripe(s, mock);
    const up = await ann.post('/api/billing/change', { plan: 'contractor' });
    assert.equal(up.status, 200, up.text);
    let f = lastUpdate(mock);
    assert.equal(f.get('items[0][price_data][unit_amount]'), '9900');
    assert.equal(f.get('proration_behavior'), 'always_invoice', 'the difference is invoiced now, not on the next bill');
    assert.equal(f.get('payment_behavior'), 'error_if_incomplete', 'Stripe refuses the change if that invoice isn’t paid');

    const o = await submitThree(ann);
    assert.equal(o.status, 201, o.text);

    const down = await ann.post('/api/billing/change', { plan: 'unlimited' });
    assert.equal(down.status, 200, down.text);
    f = lastUpdate(mock);
    assert.equal(f.get('items[0][price_data][unit_amount]'), '1500');
    assert.equal(f.get('proration_behavior'), 'none', 'no credit back for a period whose models were used');
    assert.equal(f.get('payment_behavior'), null);
    assert.equal((await ann.get('/api/billing/me')).body.plan.id, 'unlimited');
  } finally {
    await s.close();
  }
});

test('a declined upgrade payment leaves the plan as it was and no models can be requested', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await unlimitedOnStripe(s, mock);
    mock.state.decline = true;
    const up = await ann.post('/api/billing/change', { plan: 'contractor' });
    assert.equal(up.status, 402, up.text);
    assert.equal(up.body.code, 'upgrade_payment_failed');
    assert.equal((await ann.get('/api/billing/me')).body.plan.id, 'unlimited');
    const o = await submitThree(ann);
    assert.equal(o.status, 403, o.text);
  } finally {
    await s.close();
  }
});

test('leaving Contractor with no models requested this period is prorated as before', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await unlimitedOnStripe(s, mock);
    assert.equal((await ann.post('/api/billing/change', { plan: 'contractor' })).status, 200);
    const down = await ann.post('/api/billing/change', { plan: 'unlimited' });
    assert.equal(down.status, 200, down.text);
    assert.equal(lastUpdate(mock).get('proration_behavior'), 'create_prorations');
  } finally {
    await s.close();
  }
});
