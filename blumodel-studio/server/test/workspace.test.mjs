// The company workspace's prices and "Request more products" (server/routes/workspace.mjs):
// costs and markup private to a showroom's team, the request -> quote -> approve -> start ->
// deliver flow with our studio, UPC checks, photos only from the showroom's own uploads, and that
// one showroom never sees or touches another's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, defaultSpec, startTestServer } from './helpers.mjs';
import { makePng } from '../lib/synth.mjs';

const item = (over = {}) => ({ name: 'Blanco Precis 30" sink', brand: 'Blanco', sku: '441102', upc: '0 36000 29145 2', widthIn: 30, depthIn: 18, heightIn: 9.5, finishes: 'Anthracite, White', notes: 'Undermount', ...over });

async function setup() {
  const t = await startTestServer();
  const A = t.tenant({ name: 'Alpha Kitchens', slug: 'ws-a' });
  const B = t.tenant({ name: 'Bravo Baths', slug: 'ws-b' });
  const aOwner = await t.showroomUser(A, { role: 'owner' });
  const aStaff = await t.showroomUser(A, { role: 'staff' });
  const aVisitor = await t.showroomUser(A);
  const bOwner = await t.showroomUser(B, { role: 'owner' });
  const studio = await t.user({ role: 'studio' });
  return { t, A, B, aOwner, aStaff, aVisitor, bOwner, studio };
}

test('prices: cost and markup per product and a default markup, private to the team and to the showroom', async () => {
  const { t, A, aOwner, aStaff, aVisitor, bOwner } = await setup();
  try {
    const made = await aStaff.post('/api/workspace/products', { spec: defaultSpec({ name: 'Alpha Range' }) });
    assert.equal(made.status, 201, made.text);
    const pid = made.body.product.id;

    assert.deepEqual((await aOwner.get('/api/workspace/pricing')).body, { defaultMarkupPct: 0, rows: {} });
    assert.equal((await aStaff.put('/api/workspace/pricing', { defaultMarkupPct: 35 })).body.defaultMarkupPct, 35);
    assert.equal((await aStaff.put('/api/workspace/pricing', { defaultMarkupPct: -1 })).status, 400);

    const set = await aStaff.put(`/api/workspace/pricing/${pid}`, { costCents: 120000, costByWidth: { 24: 90000, 30: null }, markupPct: 40 });
    assert.equal(set.status, 200, set.text);
    assert.deepEqual(set.body.row, { costCents: 120000, costByWidth: { 24: 90000 }, markupPct: 40 });
    assert.equal((await aStaff.put(`/api/workspace/pricing/${pid}`, { costCents: 1.5 })).status, 400);
    assert.equal((await aStaff.put(`/api/workspace/pricing/${pid}`, { markupPct: 2000 })).status, 400);
    assert.deepEqual((await aOwner.get('/api/workspace/pricing')).body.rows[pid], { costCents: 120000, costByWidth: { 24: 90000 }, markupPct: 40 });

    // Costs never reach a visitor, another showroom or the sales site.
    assert.equal((await aVisitor.get('/api/workspace/pricing')).status, 403);
    assert.equal((await new Agent(t.url, { host: A.host }).get('/api/workspace/pricing')).status, 401);
    assert.equal((await bOwner.get('/api/workspace/pricing')).body.defaultMarkupPct, 0);
    assert.deepEqual((await bOwner.get('/api/workspace/pricing')).body.rows, {});
    assert.equal((await bOwner.put(`/api/workspace/pricing/${pid}`, { costCents: 1 })).status, 404);
    assert.equal((await t.agent().get('/api/workspace/pricing')).status, 404);
    // Deleting the product drops its row (no orphan costs).
    t.db.prepare('DELETE FROM products WHERE id = ?').run(pid);
    assert.deepEqual((await aOwner.get('/api/workspace/pricing')).body.rows, {});
  } finally {
    await t.close();
  }
});

test('request more products: requested, quoted by the studio, accepted by an owner, started, delivered; nothing is paid in the app', async () => {
  const { t, aOwner, aStaff, aVisitor, studio } = await setup();
  try {
    // Validation: a name, a real UPC, a web address.
    const noName = await aStaff.post('/api/workspace/requests', { items: [item({ name: '' })] });
    assert.equal(noName.status, 400);
    assert.equal(noName.body.errors[0].field, 'items[0].name');
    const badUpc = await aStaff.post('/api/workspace/requests', { items: [item(), item({ upc: '036000291453' })] });
    assert.equal(badUpc.status, 400);
    assert.equal(badUpc.body.errors[0].field, 'items[1].upc');
    assert.equal((await aStaff.post('/api/workspace/requests', { items: [item({ url: 'javascript:alert(1)' })] })).status, 400);
    assert.equal((await aStaff.post('/api/workspace/requests', { items: [] })).status, 400);
    assert.equal((await aStaff.post('/api/workspace/requests', { items: Array.from({ length: 41 }, () => item()) })).status, 400);
    assert.equal((await aVisitor.post('/api/workspace/requests', { items: [item()] })).status, 403);

    // A photo the team uploaded on this showroom.
    const up = await aStaff.putRaw('/api/files?kind=reference&name=box.png', makePng({ w: 6, h: 6 }), 'image/png');
    assert.equal(up.status, 201, up.text);
    const made = await aStaff.post('/api/workspace/requests', { items: [item({ referenceFileIds: [up.body.file.id] }), { name: 'Kohler Purist faucet', url: 'https://maker.example/purist' }], note: 'For the spring catalogue' });
    assert.equal(made.status, 201, made.text);
    const r = made.body.request;
    assert.match(r.id, /^pr_/);
    assert.equal(r.status, 'requested');
    assert.equal(r.items[0].upc, '036000291452');
    assert.equal(r.items.length, 2);
    assert.equal(r.quote, null);
    assert.equal(r.references.length, 1);
    assert.equal(r.events[0].by, 'you');

    // Not quoted yet: nothing to accept. The studio quotes it.
    assert.equal((await aOwner.post(`/api/workspace/requests/${r.id}/approve`)).status, 409);
    const queue = (await studio.get('/api/studio/product-requests')).body;
    assert.equal(queue.groups.length, 1);
    assert.equal(queue.groups[0].tenant.name, 'Alpha Kitchens');
    assert.equal(queue.groups[0].items, 2);
    assert.equal((await studio.post(`/api/studio/product-requests/${r.id}/quote`, { amountCents: 0 })).status, 400);
    const q = await studio.post(`/api/studio/product-requests/${r.id}/quote`, { amountCents: 18000, note: 'Two products at $90', turnaroundDays: 10 });
    assert.equal(q.status, 200, q.text);
    assert.equal(q.body.request.status, 'quoted');
    assert.deepEqual({ ...q.body.request.quote, at: 0 }, { amountCents: 18000, currency: 'cad', note: 'Two products at $90', turnaroundDays: 10, includedInLicense: false, at: 0 });
    // The studio can't start before the company accepts.
    assert.equal((await studio.post(`/api/studio/product-requests/${r.id}/start`)).status, 409);

    // A priced quote is an owner's to accept.
    const staffTry = await aStaff.post(`/api/workspace/requests/${r.id}/approve`);
    assert.equal(staffTry.status, 403);
    assert.equal(staffTry.body.code, 'owner_only');
    const ok = await aOwner.post(`/api/workspace/requests/${r.id}/approve`);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.request.status, 'approved');
    // Too late to cancel once accepted; a note still goes through.
    assert.equal((await aStaff.post(`/api/workspace/requests/${r.id}/cancel`)).status, 409);
    assert.equal((await aStaff.post(`/api/workspace/requests/${r.id}/note`, { note: 'Matte black too, please' })).status, 200);

    assert.equal((await studio.post(`/api/studio/product-requests/${r.id}/start`)).body.request.status, 'in_progress');
    const done = await studio.post(`/api/studio/product-requests/${r.id}/deliver`, { note: 'In your catalog now.' });
    assert.equal(done.body.request.status, 'delivered');
    const seen = (await aStaff.get(`/api/workspace/requests/${r.id}`)).body.request;
    assert.deepEqual(
      seen.events.map((e) => [e.type, e.by]),
      [
        ['requested', 'you'],
        ['quoted', 'BluModel studio'],
        ['approved', seen.events[2].by],
        ['note', 'you'],
        ['started', 'BluModel studio'],
        ['delivered', 'BluModel studio'],
      ],
    );
    assert.notEqual(seen.events[2].by, 'you');
    // Nothing anywhere took money.
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_payments WHERE kind <> ?').get('license').n, 0);
  } finally {
    await t.close();
  }
});

test('requests: included in the license (any of the team accepts), cancel before work, decline by an owner or the studio', async () => {
  const { t, aOwner, aStaff, studio } = await setup();
  try {
    const one = (await aStaff.post('/api/workspace/requests', { items: [item(), item({ name: 'Second' })] })).body.request;
    const inc = await studio.post(`/api/studio/product-requests/${one.id}/quote`, { includedInLicense: true, amountCents: 5000 });
    assert.equal(inc.body.request.quote.amountCents, 0);
    assert.equal(inc.body.request.quote.includedInLicense, true);
    assert.equal((await aStaff.post(`/api/workspace/requests/${one.id}/approve`)).body.request.status, 'approved');
    const list = (await aStaff.get('/api/workspace/requests')).body;
    assert.equal(list.included.products, 50);
    assert.equal(list.included.inLicense, 2);

    const two = (await aStaff.post('/api/workspace/requests', { items: [item()] })).body.request;
    assert.equal((await aStaff.post(`/api/workspace/requests/${two.id}/cancel`)).body.request.status, 'cancelled');
    assert.equal((await aStaff.post(`/api/workspace/requests/${two.id}/cancel`)).status, 409);
    assert.equal((await studio.post(`/api/studio/product-requests/${two.id}/quote`, { amountCents: 100 })).status, 409);

    const three = (await aStaff.post('/api/workspace/requests', { items: [item()] })).body.request;
    await studio.post(`/api/studio/product-requests/${three.id}/quote`, { amountCents: 9000 });
    assert.equal((await aStaff.post(`/api/workspace/requests/${three.id}/decline`, { note: 'Too much' })).status, 403);
    assert.equal((await aOwner.post(`/api/workspace/requests/${three.id}/decline`, { note: 'Not this season' })).body.request.status, 'declined');

    const four = (await aStaff.post('/api/workspace/requests', { items: [item()] })).body.request;
    assert.equal((await studio.post(`/api/studio/product-requests/${four.id}/decline`, {})).status, 400);
    assert.equal((await studio.post(`/api/studio/product-requests/${four.id}/decline`, { note: 'We can’t find specs for this one.' })).body.request.status, 'declined');

    // The studio's filters.
    assert.equal((await studio.get('/api/studio/product-requests?status=all')).body.requests.length, 4);
    assert.equal((await studio.get('/api/studio/product-requests')).body.requests.length, 1);
    assert.equal((await studio.get('/api/studio/product-requests?status=declined')).body.requests.length, 2);
    assert.equal((await studio.get('/api/studio/product-requests?status=nope')).status, 400);
  } finally {
    await t.close();
  }
});

test('requests: isolation between showrooms, and who reaches the studio queue', async () => {
  const { t, A, B, aStaff, bOwner, studio } = await setup();
  try {
    const r = (await aStaff.post('/api/workspace/requests', { items: [item()] })).body.request;
    // Showroom B sees nothing of A's and can't act on it.
    assert.deepEqual((await bOwner.get('/api/workspace/requests')).body.requests, []);
    assert.equal((await bOwner.get(`/api/workspace/requests/${r.id}`)).status, 404);
    for (const a of ['approve', 'cancel']) assert.equal((await bOwner.post(`/api/workspace/requests/${r.id}/${a}`)).status, 404);
    assert.equal((await bOwner.post(`/api/workspace/requests/${r.id}/note`, { note: 'hi' })).status, 404);
    // B's photo can't go on a request of A's.
    const bUp = await bOwner.putRaw('/api/files?kind=reference&name=b.png', makePng({ w: 5, h: 5 }), 'image/png');
    assert.equal(bUp.status, 201, bUp.text);
    const cross = await aStaff.post('/api/workspace/requests', { items: [item({ referenceFileIds: [bUp.body.file.id] })] });
    assert.equal(cross.status, 400);
    assert.equal(cross.body.errors[0].field, 'items[0].referenceFileIds');

    // The workspace routes don't exist on the sales site; the studio's don't exist on a showroom.
    const sales = await t.user();
    assert.equal((await sales.get('/api/workspace/requests')).status, 404);
    const studioOnShowroom = new Agent(t.url, { host: A.host });
    assert.equal((await studioOnShowroom.get('/api/studio/product-requests')).status, 404);
    assert.equal((await new Agent(t.url, { host: B.host }).post(`/api/studio/product-requests/${r.id}/quote`, { amountCents: 1 })).status, 404);
    // Only studio and admin reach the queue.
    assert.equal((await sales.get('/api/studio/product-requests')).status, 403);
    assert.equal((await studio.get(`/api/studio/product-requests/${r.id}`)).body.request.tenant.slug, 'ws-a');
    assert.equal((await studio.get('/api/studio/product-requests/pr_doesnotexist0000')).status, 404);
  } finally {
    await t.close();
  }
});
