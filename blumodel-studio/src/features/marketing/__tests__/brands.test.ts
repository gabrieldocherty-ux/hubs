import { test } from 'node:test';
import assert from 'node:assert/strict';
import retail from '../../../data/retail.json';
import { MODELLED_BRANDS } from '../brands';

test('every brand the sales page says is modelled really has products in the library', () => {
  const r = retail as unknown as { products: { brand?: string }[]; fixtures: { brand?: string }[] };
  const have = new Set([...r.products, ...r.fixtures].map((p) => p.brand));
  for (const b of MODELLED_BRANDS) assert.ok(have.has(b), `${b} has no products or fixtures in src/data/retail.json`);
  assert.equal(new Set(MODELLED_BRANDS).size, MODELLED_BRANDS.length);
});
