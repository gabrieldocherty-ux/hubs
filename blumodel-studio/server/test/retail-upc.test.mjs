// A product's structured `brand` and `upc` (server/catalog/products.mjs): what the spec accepts,
// and that the UPC a product carries finds the retail listing with the same code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../catalog/products.mjs';
import { loadRetail } from '../catalog/retail.mjs';

const spec = (over = {}) => ({ kind: 'dishwasher', category: 'appliances', name: 'Dishwasher', widthIn: 24, depthIn: 24, heightIn: 34, price: 0, finishes: [{ id: 'steel', name: 'Steel', hex: '#c0c0c0', material: 'metal' }], ...over });

test('brand and UPC: trimmed brand up to 60 characters, a UPC/EAN normalised to its digits with the check digit verified', () => {
  const ok = validateSpec(spec({ brand: '  Bosch   Home ', upc: '0 36000-29145 2' }));
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.deepEqual([ok.spec.brand, ok.spec.upc], ['Bosch Home', '036000291452']);
  // An EAN-13 with a leading 0 is the UPC-A it encodes.
  assert.equal(validateSpec(spec({ upc: '0036000291452' })).spec.upc, '036000291452');
  const bad = validateSpec(spec({ brand: 'x'.repeat(61), upc: '036000291453' }));
  assert.ok(!bad.ok);
  assert.deepEqual(bad.errors.map((e) => e.field).sort(), ['brand', 'upc']);
  // Neither is required; a patch clears them with null or ''.
  assert.equal(validateSpec(spec()).spec.upc, undefined);
  const clear = validateSpec({ brand: '', upc: null }, { partial: true });
  assert.deepEqual([clear.spec.brand, clear.spec.upc], [null, null]);
});

test('a UPC on a product matches the retail listing that carries it', () => {
  const retail = loadRetail();
  const listed = retail.products.find((p) => p.retail.upc);
  assert.ok(listed, 'the retail data has at least one UPC');
  const v = validateSpec(spec({ upc: listed.retail.upc }));
  assert.ok(v.ok, `${listed.retail.upc} is a valid UPC`);
  assert.equal(v.spec.upc, listed.retail.upc);
  const match = retail.products.find((p) => p.retail.upc === listed.retail.upc);
  assert.equal(match.id, listed.id);
});
