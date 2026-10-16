import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from '../../data/retail.json';
import type { DesignDoc } from '../../types';
import { applyRetailData, toProduct, type RetailData } from '../../catalog/retail';
import { getProduct, priceFor } from '../../data/catalog';
import { buildEstimate, pricedAtStore } from '../estimate';
import { estimateCsv } from '../csv';

// A retail product with no checked store price borrows a BluModel Basics typical price only for
// sorting. The estimate must not show that number as its price or add it to the total: the line
// reads "Price at store", it is 0 in the total, and a note counts the items priced at the store.

const data = raw as unknown as RetailData;
applyRetailData(data);
const unpriced = data.products.find((p) => p.price === null && p.kind === 'base')!;
const priced = data.products.find((p) => p.price !== null && p.kind === 'base')!;

const doc = (ids: string[]): DesignDoc => ({
  name: 'At store',
  room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
  surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
  items: ids.map((productId, i) => ({ id: `it-${i}`, productId, x: 20 + i * 40, y: 14, rotation: 0, finishIndex: 0 })),
});

test('an unpriced retail product is flagged; a priced one is not', () => {
  assert.equal(toProduct(unpriced).priceAtStore, true);
  assert.equal(toProduct(priced).priceAtStore, undefined);
  assert.equal(pricedAtStore(getProduct(unpriced.id)!), true);
  assert.equal(pricedAtStore(getProduct(priced.id)!), false);
});

test('the estimate leaves an unpriced retail product out of the total and counts it', () => {
  const p = getProduct(unpriced.id)!;
  const q = getProduct(priced.id)!;
  const both = buildEstimate(doc([unpriced.id, unpriced.id, priced.id]));
  const onlyPriced = buildEstimate(doc([priced.id]));
  const line = both.lines.find((l) => l.productId === p.id)!;
  assert.equal(line.atStore, true);
  assert.equal(line.qty, 2);
  assert.equal(line.total, 0);
  assert.match(line.sub, /Price at store/);
  assert.equal(both.atStore, 2);
  assert.equal(onlyPriced.atStore, 0);
  // The priced one uses its checked store price.
  assert.equal(both.lines.find((l) => l.productId === q.id)!.unitPrice, priceFor(q, q.widthIn));
  // The product lines add up to the priced one alone: the typical price is nowhere in the total.
  const productTotal = (e: typeof both) => e.lines.filter((l) => l.productId).reduce((s, l) => s + l.total, 0);
  assert.equal(productTotal(both), productTotal(onlyPriced));
  assert.ok(priceFor(p, p.widthIn) > 0, 'it does have a typical price, used only for sorting');
  const csv = estimateCsv(doc([unpriced.id]), buildEstimate(doc([unpriced.id])));
  assert.match(csv, /Price at store/);
  assert.match(csv, /1 item is priced at the store and not in this total\./);
});

test('a contractor’s own cost for an unpriced retail product prices it', () => {
  const est = buildEstimate(doc([unpriced.id]), { priceOf: () => ({ sell: 420, list: 300, cost: 350, markupPct: 20 }) });
  const line = est.lines.find((l) => l.productId === unpriced.id)!;
  assert.equal(line.atStore, undefined);
  assert.equal(line.unitPrice, 420);
  assert.equal(est.atStore, 0);
});
