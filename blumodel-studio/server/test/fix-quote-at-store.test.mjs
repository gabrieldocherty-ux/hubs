// A retail product with no checked store price (its saved snapshot says priceAtStore) is listed
// on a contractor's quote and in the shopping-list CSV as "Price at store" and left out of the
// total; the quote counts the items priced at the store. Payments are demo only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, sampleDoc, legacyCheckout } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const retail = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/retail.json'), 'utf8'));

test('a contractor quote lists an unpriced retail product as Price at store, outside the total', async () => {
  const wire = retail.products.find((p) => p.price === null && p.kind === 'base');
  assert.ok(wire, 'the retail data has an unpriced base cabinet');
  const { retail: _r, ...rest } = wire;
  // What the editor saves for it (src/catalog/retail.ts toProduct): a typical price, flagged.
  const snapshot = { ...rest, sku: wire.code, price: 345, priceAtStore: true, source: 'brand' };
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const c = await s.user();
    const co = await legacyCheckout(c, { kind: 'subscription', plan: 'contractor' });
    assert.equal((await c.post(`/api/billing/demo/${co.body.ref}/complete`, { outcome: 'success' })).status, 200);
    assert.equal((await c.put('/api/pro/profile', { company: 'Smith Kitchens', phone: '905-555-0100', email: 'hello@smith.test', defaultMarkupPct: 30 })).status, 200);

    const items = [
      { id: 'a', productId: wire.id, x: 20, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'b', productId: wire.id, x: 60, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'c', productId: 'range-30', x: 120, y: 14, rotation: 0, finishIndex: 0 },
    ];
    const k = (await c.post('/api/projects', { name: 'At store', client: 'Pat', doc: sampleDoc({ items, products: { [wire.id]: snapshot } }) })).body.project;
    const q = await c.get(`/api/pro/quotes/${k.id}`);
    assert.equal(q.status, 200, q.text);
    const lines = q.body.groups.flatMap((g) => g.lines);
    const line = lines.find((l) => l.label.includes(wire.name));
    assert.ok(line, 'the retail product is on the quote');
    assert.equal(line.atStore, true);
    assert.equal(line.total, 0);
    assert.equal(line.qty, 2);
    assert.equal(q.body.atStore, 2);
    const sum = Math.round(lines.reduce((n, l) => n + l.total, 0) * 100) / 100;
    assert.equal(q.body.subtotal, sum, 'the subtotal is the lines, with nothing for the store-priced items');
    assert.ok(!lines.some((l) => l.unitPrice === 345), 'the typical price shows nowhere');
  } finally {
    await s.close();
  }
});
