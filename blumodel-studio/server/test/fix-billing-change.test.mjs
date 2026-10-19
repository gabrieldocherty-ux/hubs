// Plan changes on a legacy Stripe subscription. Before the showroom pivot an upgrade to Contractor
// was invoiced at once and a downgrade after requesting models gave no credit back (fixer finding);
// since the pivot (docs/SHOWROOM_PIVOT.md §3) no plan change is sold at all, so the route refuses
// it before Stripe is called, and cancelling still works.
// Stripe is only ever a mocked fetch, with obviously fake keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';

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

test('since the showroom pivot a plan change is not sold: refused before Stripe is called, up or down; cancel still works', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await unlimitedOnStripe(s, mock);
    for (const plan of ['contractor', 'unlimited']) {
      const r = await ann.post('/api/billing/change', { plan });
      assert.equal(r.status, 410, r.text);
      assert.equal(r.body.code, 'not_for_sale');
    }
    assert.equal(mock.calls.length, 0, 'Stripe was never called');
    assert.equal((await ann.get('/api/billing/me')).body.plan.id, 'unlimited');
    const cancel = await ann.post('/api/billing/cancel');
    assert.equal(cancel.status, 200, cancel.text);
    assert.equal(mock.calls.filter((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_fix').at(-1)?.form.get('cancel_at_period_end'), 'true');
  } finally {
    await s.close();
  }
});
