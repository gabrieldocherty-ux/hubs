// Package 'finder': GET /api/contractors, the public list behind "Need a contractor?" and the
// #/contractors directory. Only live, verified contractor pages; only their public page fields;
// search by city, region or postal code against service areas; rate-limited.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, legacyCheckout } from './helpers.mjs';
import { matchScore, normaliseNear, FINDER_RATE } from '../routes/finder.mjs';

let t;
let admin;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo' } });
  admin = await t.user({ role: 'admin' });
});
after(async () => {
  await t?.close();
});

const DAY = 86_400_000;
let n = 0;

async function buy(server, agent, body) {
  const c = await legacyCheckout(agent, body);
  assert.equal(c.status, 200, c.text);
  assert.equal((await agent.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);
}

/** A Contractor-plan user with a company (phone and email private by default). */
async function contractor(server, profile = {}) {
  const a = await server.user();
  await buy(server, a, { kind: 'subscription', plan: 'contractor' });
  n += 1;
  const r = await a.put('/api/pro/profile', {
    company: `Finder Cabinet Co ${n}`,
    phone: '905-555-0142',
    email: `owner${n}@finder.test`,
    website: `finder${n}.test`,
    serviceArea: 'Hamilton and Burlington',
    defaultMarkupPct: 35,
    ...profile,
  });
  assert.equal(r.status, 200, r.text);
  return a;
}

/** Sets up the brand page and submits it; `approve` has an admin make it live and verified. */
async function page(server, c, adminAgent, { approve = true, ...over } = {}) {
  const s = await c.put('/api/pro/brand', { tagline: 'Kitchens done right', about: 'Since 2001.', ...over });
  assert.equal(s.status, 200, s.text);
  const sub = await c.post('/api/pro/brand/submit');
  assert.equal(sub.status, 200, sub.text);
  if (!approve) return sub.body.brand;
  const ok = await adminAgent.post(`/api/admin/brand-pages/${sub.body.brand.id}/approve`);
  assert.equal(ok.status, 200, ok.text);
  return ok.body.brand;
}

const list = async (server, q = '') => {
  const r = await server.agent().get(`/api/contractors${q}`);
  assert.equal(r.status, 200, r.text);
  return r.body;
};

test('with no contractors the list is empty (the link then renders nothing)', async () => {
  const s = await startTestServer();
  try {
    const body = await list(s);
    assert.deepEqual(body, { contractors: [], matched: 0, total: 0, near: '' });
    // A partner brand (catalog content, not a contractor) never counts.
    s.brand(null, { name: 'Partner Appliances', verified: true });
    assert.equal((await list(s)).total, 0);
  } finally {
    await s.close();
  }
});

test('lists only live, verified contractor pages, with public page fields only', async () => {
  const c = await contractor(t);
  const live = await page(t, c, admin);
  const pending = await contractor(t, { serviceArea: 'Hamilton' });
  await page(t, pending, admin, { approve: false });
  const anon = t.agent();

  let body = await list(t, '?limit=50');
  const mine = body.contractors.find((x) => x.slug === live.slug);
  assert.ok(mine, 'the live page is listed');
  assert.ok(!body.contractors.some((x) => x.name === 'Finder Cabinet Co 2'), 'a page in review is not');
  assert.deepEqual(Object.keys(mine).sort(), ['isDemo', 'leadForm', 'logoUrl', 'name', 'serviceArea', 'slug', 'tagline', 'verified', 'website']);
  assert.equal(mine.serviceArea, 'Hamilton and Burlington');
  assert.equal(mine.verified, true);
  assert.equal(mine.leadForm, true);
  // Nothing private: no phone or email unless shown, no owner, no markup, no ids.
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /555-0142|owner1@finder\.test|defaultMarkup|markup|cost|margin|ownerUserId|"id"/i);
  assert.ok(!raw.includes(c.user.email) && !raw.includes(c.user.id));

  // The contractor chooses to show phone and email: then (and only then) they're listed.
  assert.equal((await c.put('/api/pro/brand', { showPhone: true, showEmail: true })).status, 200);
  body = await list(t, '?limit=50');
  const shown = body.contractors.find((x) => x.slug === live.slug);
  assert.match(shown.phone, /555-0142/);
  assert.equal(shown.email, 'owner1@finder.test');

  // Unverified, suspended: gone. Reinstated and verified again: back.
  assert.equal((await admin.post(`/api/admin/brands/${live.id}/unverify`)).status, 200);
  assert.ok(!(await list(t, '?limit=50')).contractors.some((x) => x.slug === live.slug), 'unverified');
  assert.equal((await admin.post(`/api/admin/brands/${live.id}/verify`)).status, 200);
  assert.equal((await admin.post(`/api/admin/brands/${live.id}/suspend`, { note: 'Spam' })).status, 200);
  assert.ok(!(await list(t, '?limit=50')).contractors.some((x) => x.slug === live.slug), 'suspended');
  assert.equal((await admin.post(`/api/admin/brands/${live.id}/reinstate`)).status, 200);
  assert.ok((await list(t, '?limit=50')).contractors.some((x) => x.slug === live.slug), 'reinstated');

  // Lead form off: still listed (View works), but no "Ask for a quote".
  assert.equal((await c.put('/api/pro/brand', { leadForm: false })).status, 200);
  assert.equal((await list(t, '?limit=50')).contractors.find((x) => x.slug === live.slug).leadForm, false);
  assert.equal((await anon.get('/api/contractors')).headers.get('cache-control'), 'no-store');
});

test('a lapsed Contractor plan hides the page from the list; renewal brings it back', async () => {
  const t0 = Date.now();
  t.setNow(t0);
  try {
    const c = await contractor(t, { serviceArea: 'Lapse Town' });
    const live = await page(t, c, admin);
    assert.ok((await list(t, '?near=lapse+town')).contractors.some((x) => x.slug === live.slug));
    await c.post('/api/billing/demo/simulate', { event: 'renewal_failed' });
    t.setNow(t0 + 8 * DAY);
    assert.ok(!(await list(t, '?near=lapse+town')).contractors.some((x) => x.slug === live.slug), 'hidden while lapsed');
    await buy(t, c, { kind: 'subscription', plan: 'contractor' });
    assert.ok((await list(t, '?near=lapse+town')).contractors.some((x) => x.slug === live.slug), 'back after renewal');
  } finally {
    t.setNow(null);
  }
});

test('near= searches service areas by city, postal code or region; limit is clamped', async () => {
  const toronto = await page(t, await contractor(t, { serviceArea: 'Toronto, North York and Etobicoke' }), admin);
  const fsa = await page(t, await contractor(t, { serviceArea: 'L8P, L8L, L9A (central Hamilton)' }), admin);
  const ontario = await page(t, await contractor(t, { serviceArea: 'Anywhere in Southern Ontario' }), admin);
  const quebec = await page(t, await contractor(t, { serviceArea: 'Montréal et Laval' }), admin);

  const slugs = async (q) => (await list(t, q)).contractors.map((x) => x.slug);

  // A city: exact place matches only.
  let s = await slugs('?near=Toronto&limit=50');
  assert.ok(s.includes(toronto.slug) && !s.includes(fsa.slug) && !s.includes(quebec.slug));
  // Accents and case don't matter; "Montreal, QC" finds "Montréal et Laval".
  assert.ok((await slugs('?near=montreal%2C%20QC&limit=50')).includes(quebec.slug));
  // A postal code: its area (FSA) first, then pages covering its province.
  s = await slugs('?near=l8p%204r5&limit=50');
  assert.ok(s.indexOf(fsa.slug) >= 0 && s.indexOf(ontario.slug) > s.indexOf(fsa.slug), `FSA match ranks first: ${s}`);
  assert.ok(!s.includes(quebec.slug));
  // A Quebec postal code finds the Montréal page through its region.
  assert.ok((await slugs('?near=H2X1Y4&limit=50')).includes(quebec.slug));
  // Nothing matches: an empty list, with the total so the page can offer "see all".
  const none = await list(t, '?near=Yellowknife');
  assert.equal(none.contractors.length, 0);
  assert.equal(none.matched, 0);
  assert.ok(none.total >= 4);
  // Junk is folded away, never echoed raw; limit 0 and 9999 are clamped to 1 and 50.
  const junk = await list(t, `?near=${encodeURIComponent('<script>alert(1)</script>')}`);
  assert.doesNotMatch(junk.near, /[<>()]/);
  assert.equal((await list(t, '?limit=0')).contractors.length, 1);
  assert.ok((await list(t, '?limit=9999')).contractors.length <= 50);
  assert.equal((await list(t, '?limit=2')).contractors.length, 2);
});

test('the same order all day for everyone (a daily rotation), and real pages before demo ones', async () => {
  const a = await list(t, '?limit=50');
  const b = await list(t, '?limit=50');
  assert.deepEqual(
    a.contractors.map((x) => x.slug),
    b.contractors.map((x) => x.slug),
  );
  const c = await contractor(t, { serviceArea: 'Demo Valley' });
  const demo = await page(t, c, admin);
  t.db.prepare('UPDATE brands SET is_demo = 1 WHERE id = ?').run(demo.id);
  const all = (await list(t, '?limit=50')).contractors;
  assert.equal(all[all.length - 1].slug, demo.slug, 'demo pages sort last');
  assert.equal(all[all.length - 1].isDemo, true);
});

test('production never lists demo pages', async () => {
  const s = await startTestServer({ env: { NODE_ENV: 'production', PAYMENTS: 'demo', DEMO_PAYMENTS: '1' } });
  try {
    const adm = await s.user({ role: 'admin' });
    const real = await page(s, await contractor(s, { serviceArea: 'Prod City' }), adm);
    const demo = await page(s, await contractor(s, { serviceArea: 'Prod City' }), adm);
    s.db.prepare('UPDATE brands SET is_demo = 1 WHERE id = ?').run(demo.id);
    const body = await list(s, '?near=prod+city');
    assert.deepEqual(
      body.contractors.map((x) => x.slug),
      [real.slug],
    );
    assert.equal(body.total, 1);
  } finally {
    await s.close();
  }
});

test(`rate-limited per address (${FINDER_RATE.max} per ${FINDER_RATE.windowMs / 60_000} minutes)`, async () => {
  const s = await startTestServer({ rateLimits: true });
  try {
    const anon = s.agent();
    for (let i = 0; i < FINDER_RATE.max; i++) assert.equal((await anon.get('/api/contractors?limit=3')).status, 200);
    const over = await anon.get('/api/contractors?limit=3');
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get('retry-after')) > 0);
  } finally {
    await s.close();
  }
});

test('matchScore and normaliseNear', () => {
  assert.equal(normaliseNear('  Hamilton,  ON '), 'hamilton on');
  assert.equal(normaliseNear(42), '');
  assert.equal(normaliseNear('x'.repeat(500)).length, 60);
  assert.equal(matchScore('Hamilton and Burlington', 'hamilton'), 3);
  assert.equal(matchScore('Hamilton and Burlington', 'hamilton on'), 3);
  assert.equal(matchScore('Hamilton and Burlington', 'ham'), 0, 'whole words only');
  assert.equal(matchScore('Hamilton and Burlington', 'downtown burlington'), 2);
  assert.equal(matchScore('Greater Toronto Area', 'm5v 2t6'), 1);
  assert.equal(matchScore('M5V, M5A and M4M', 'm5v 2t6'), 3);
  assert.equal(matchScore('Vancouver, B.C.', 'v6b1a1'), 1);
  assert.equal(matchScore('Kitchens across Canada', 'k1a 0b1'), 1);
  assert.equal(matchScore('Buffalo NY 14201', '14201'), 3);
  assert.equal(matchScore('Buffalo NY 14201', '14202'), 0);
  assert.equal(matchScore('', 'hamilton'), 0);
  assert.equal(matchScore('Hamilton', ''), 0);
});
