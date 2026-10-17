import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from '../data/retail.json';
import { BUILTIN_PRODUCTS } from '../data/builtins';
import { brandPicker } from '../lib/generate/brands';
import { toProduct, type RetailData } from './retail';

// The wizard's known gaps (docs/handoff/wizard.md): IKEA SEKTION bases listed at their 30″ box never
// replaced a 36″ counter-height base, and most sinks fitted only one base width, never the
// layouts' 33″ sink slot. The build now maps them to the sizes the real products stand at or fit.
const data = raw as unknown as RetailData;
const catalog = [...BUILTIN_PRODUCTS, ...data.products.map(toProduct)];
const basic = (id: string, widthIn: number) => {
  const product = BUILTIN_PRODUCTS.find((p) => p.id === id)!;
  return { productId: id, product, widthIn };
};

test('IKEA SEKTION cabinets stand on their legs (34½″) and fill a counter-height base slot', () => {
  const sektion = data.products.filter((p) => p.brand === 'IKEA' && /sektion/i.test(p.name) && p.kind === 'base');
  assert.ok(sektion.length > 0);
  for (const p of sektion) {
    assert.equal(p.retail.size.h, 30, `${p.id} keeps the listed box height in its facts`);
    assert.equal(p.heightIn, 34.5, p.id);
    assert.match(p.retail.note ?? '', /4½″ legs/);
  }
  const swap = brandPicker({ cabinets: ['IKEA'] }, { catalog, ceilingIn: 96 })!;
  const got = swap(basic('base', 24));
  assert.equal(got.product.brand, 'IKEA', `a 24″ base slot takes ${got.productId}`);
});

test('a drop-in or undermount sink fits the base widths that take it, so it can fill the 33″ sink slot', () => {
  const kraus30 = data.products.find((p) => p.id === 'r-kraus-khu100-30-single-undermount')!;
  assert.deepEqual(kraus30.widthOptions, [33, 36]);
  assert.equal(kraus30.retail.size.w, 30);
  // An apron-front sink is as wide as its base: one size.
  for (const p of data.products.filter((x) => x.kind === 'sink' && x.variant === 'farmhouse')) assert.equal(p.widthOptions, undefined, p.id);
  const swap = brandPicker({ sinks: ['Kraus'] }, { catalog, ceilingIn: 96 })!;
  const got = swap(basic('sink-under', 33), 'undermount');
  assert.equal(got.product.brand, 'Kraus', `the 33″ sink slot takes ${got.productId}`);
  assert.equal(got.widthIn, 33);
});

test('a pendant listed by its overall drop is drawn as its shade under a standard ceiling', () => {
  const tall = data.products.filter((p) => p.kind === 'pendant' && (p.retail.size.h ?? 0) > 24);
  assert.ok(tall.length > 0);
  for (const p of tall) {
    assert.ok(p.elevationIn + p.heightIn <= 96, `${p.id} fits under 8′`);
    assert.match(p.retail.note ?? '', /overall with its cord or rod/);
  }
});
