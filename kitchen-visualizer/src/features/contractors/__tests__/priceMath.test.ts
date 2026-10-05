import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Product } from '../../../types';
import type { PriceBookData } from '../../../types/platform';
import { brandKeyOf, makePriceOf, markupPctFor, quoteFor, sellPricesOf } from '../priceMath';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p_aaaaaaaaaaaaaaaaaaaaaaaa',
  kind: 'base',
  category: 'cabinets',
  brand: 'Smith Kitchens',
  name: 'Shaker Base',
  code: 'SSB{w}',
  widthIn: 24,
  depthIn: 24,
  heightIn: 34.5,
  elevationIn: 0,
  price: 0,
  finishes: 'cabinet',
  blurb: '',
  source: 'contractor',
  ...over,
});

const book = (over: Partial<PriceBookData> = {}): PriceBookData => ({ defaultMarkupPct: 30, taxPct: 0, brands: {}, rows: {}, ...over });

test('brand keys: built-ins, brands, and everything else is the contractor’s own', () => {
  assert.equal(brandKeyOf(product({ id: 'range-30' })), 'builtin');
  assert.equal(brandKeyOf(product({ brandId: 'b_x' })), 'b_x');
  assert.equal(brandKeyOf(product()), 'own');
  // A snapshot keeps its key even though its source says "snapshot".
  assert.equal(brandKeyOf(product({ source: 'snapshot' })), 'own');
});

test('no cost: the list price, flagged', () => {
  const p = product({ price: 499 });
  assert.deepEqual(quoteFor(book(), p, 24), { sell: 499, list: 499, noCost: true });
  assert.deepEqual(makePriceOf(null)(p, 24), { sell: 499, list: 499, noCost: true });
});

test('cost × (1 + markup), with product → line → brand → default precedence', () => {
  const p = product({ line: 'Smith Shaker' });
  const rows = { [p.id]: { costCents: 20000, costByWidth: null, markupPct: null } };
  assert.equal(quoteFor(book({ rows }), p, 24).sell, 260, 'company default 30%');
  assert.equal(quoteFor(book({ rows, brands: { own: { enabled: true, pctOffList: null, markupPct: 40 } } }), p, 24).sell, 280, 'own-catalog markup');
  const lineBook = book({ rows, brands: { own: { enabled: true, pctOffList: null, markupPct: 40 }, 'line:smith shaker': { enabled: true, pctOffList: null, markupPct: 50 } } });
  assert.equal(quoteFor(lineBook, p, 24).sell, 300, 'line beats brand (case-insensitive)');
  const productBook = book({ ...lineBook, rows: { [p.id]: { costCents: 20000, costByWidth: null, markupPct: 10 } } });
  assert.equal(quoteFor(productBook, p, 24).sell, 220, 'product beats line');
  assert.equal(markupPctFor(productBook, p), 10);
});

test('per-width costs win; one cost scales across widths like the list price', () => {
  const p = product({ id: 'base', widthOptions: [12, 24, 36], price: 400, source: 'builtin' });
  const exact = book({ rows: { base: { costCents: null, costByWidth: { 36: 30000 }, markupPct: 0 } } });
  assert.equal(quoteFor(exact, p, 36).sell, 300);
  assert.equal(quoteFor(exact, p, 24).noCost, true, 'a width without a cost falls back to list');
  const scaled = book({ rows: { base: { costCents: 20000, costByWidth: null, markupPct: 0 } } });
  // list at 36″: 400 × (0.45 + 0.55 × 1.5) = 510 → cost scales by 510 / 400.
  assert.equal(quoteFor(scaled, p, 36).cost, 255);
  assert.equal(quoteFor(scaled, p, 24).cost, 200);
});

test('a brand’s % off list is the cost when the product has none of its own', () => {
  const p = product({ id: 'p_bbbbbbbbbbbbbbbbbbbbbbbb', brandId: 'b_k', source: 'brand', price: 2000 });
  const q = quoteFor(book({ defaultMarkupPct: 25, brands: { b_k: { enabled: true, pctOffList: 40, markupPct: null } } }), p, p.widthIn);
  assert.deepEqual(q, { sell: 1500, cost: 1200, markupPct: 25, list: 2000 });
});

test('sell prices for clients carry every width and never a cost', () => {
  const p = product({ widthOptions: [12, 24], price: 0 });
  const out = sellPricesOf(book({ rows: { [p.id]: { costCents: null, costByWidth: { 12: 10000, 24: 15000 }, markupPct: null } } }), p);
  assert.deepEqual(out, { price: 195, priceByWidth: { 12: 130, 24: 195 } });
  assert.ok(!JSON.stringify(out).includes('cost'));
});
