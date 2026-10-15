import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from '../data/retail.json';
import { productType } from '../data/productTypes';
import { BASICS_BRAND, BUILTIN_PRODUCTS } from '../data/builtins';
import { CABINET_BRAND } from '../data/finishes';
import { getProduct, isProductIdShape } from '../data/catalog';
import { useCatalog } from '../store/useCatalog';
import { applyRetailData, brandCounts, checkedLabel, isRetailId, retailOf, retailPriceKnown, sortListings, storeLink, toProduct, type RetailData, type RetailerConfig, type RetailListing } from './retail';

const data = raw as unknown as RetailData;

test('every retail product is drawn as one of the product types, at the type’s size where the listing gave none', () => {
  // server/catalog/retailBuild.mjs keeps its own copy of the type table; this is what catches a drift.
  for (const p of data.products) {
    const t = productType(p.retail.type);
    assert.ok(t, `${p.id}: type ${p.retail.type}`);
    assert.equal(p.kind, t.kind, p.id);
    assert.equal(p.variant, t.variant, p.id);
    assert.equal(p.category, t.category, p.id);
    if (p.retail.typical.includes('depth') && !p.retail.note) assert.equal(p.depthIn, t.defaults.depthIn, `${p.id} depth`);
    if (p.retail.typical.includes('height') && !p.retail.note) assert.equal(p.heightIn, t.defaults.heightIn, `${p.id} height`);
    assert.ok(isRetailId(p.id) && isProductIdShape(p.id), p.id);
  }
});

test('a retail entry becomes a catalog product: brand source, its code as the SKU, a typical Basics price when no store price was checked', () => {
  const unpriced = data.products.find((p) => p.price === null && p.kind === 'base')!;
  const priced = data.products.find((p) => p.price !== null)!;
  const a = toProduct(unpriced);
  assert.equal(a.source, 'brand');
  assert.equal(a.sku, unpriced.code);
  assert.ok(a.price > 0);
  assert.equal((a as { retail?: unknown }).retail, undefined);
  assert.equal(toProduct(priced).price, priced.price);
  assert.equal(retailPriceKnown(unpriced.retail), false);
  assert.equal(retailPriceKnown(priced.retail), true);
});

test('applying the data registers every retail product in the catalog and keeps its store facts by id', () => {
  applyRetailData(data);
  const p = data.products[0];
  assert.equal(getProduct(p.id)?.name, p.name);
  assert.equal(retailOf(p.id)?.key, p.retail.key);
  assert.ok(useCatalog.getState().products.some((x) => x.id === p.id), 'browsable in the catalog panel');
  // A forced catalog reload re-lists only built-ins and server products; the retail ones come back.
  useCatalog.setState((s) => ({ products: BUILTIN_PRODUCTS, version: s.version + 1 }));
  assert.ok(useCatalog.getState().products.some((x) => x.id === p.id));
});

test('the built-ins are BluModel Basics, and so is the kitchen-wide cabinet line; their ids are unchanged', () => {
  assert.ok(BUILTIN_PRODUCTS.every((p) => p.brand === BASICS_BRAND));
  assert.equal(CABINET_BRAND, BASICS_BRAND);
  for (const id of ['base', 'drawer-base', 'wall', 'island', 'range-30', 'fridge-36', 'sink-under', 'pendant-dome', 'stool', 'window', 'fig']) assert.ok(getProduct(id), id);
});

test('store links: the affiliate parameter is added (replacing one of the same name) and nothing else changes', () => {
  const url = 'https://www.rona.ca/en/product/thing-123?aff=old&x=1';
  assert.equal(storeLink(url, ''), url);
  assert.equal(storeLink(url, undefined), url);
  assert.equal(storeLink(url, 'aff=blumodel'), 'https://www.rona.ca/en/product/thing-123?aff=blumodel&x=1');
  assert.equal(storeLink('https://www.homedepot.ca/product/a/1', 'utm_source=blumodel&utm_medium=referral'), 'https://www.homedepot.ca/product/a/1?utm_source=blumodel&utm_medium=referral');
  assert.equal(storeLink('not a url', 'aff=1'), 'not a url');
});

test('where to buy: sponsored stores first, then the lowest checked price, then by name', () => {
  applyRetailData(data);
  const l = (store: string, priceCad: number | null): RetailListing => ({ store, url: `https://x/${store}`, sku: null, priceCad, inStock: null });
  const list = [l('rona', 900), l('home-depot', 850), l('best-buy', null), l('ikea', 999)];
  const none = new Map<string, RetailerConfig>();
  assert.deepEqual(sortListings(list, none).map((x) => x.store), ['home-depot', 'rona', 'ikea', 'best-buy']);
  const sp = new Map<string, RetailerConfig>([['ikea', { slug: 'ikea', name: 'IKEA', sponsored: true, affiliate: '' }]]);
  assert.deepEqual(sortListings(list, sp).map((x) => x.store), ['ikea', 'home-depot', 'rona', 'best-buy']);
});

test('brand lists per category: retail brands by product count with their stores, BluModel Basics last', () => {
  const cab = brandCounts('cabinets', data, BUILTIN_PRODUCTS);
  const basics = cab[cab.length - 1];
  assert.equal(basics.brand, BASICS_BRAND);
  assert.equal(basics.basics, true);
  assert.equal(basics.products, BUILTIN_PRODUCTS.filter((p) => p.category === 'cabinets').length);
  const retail = cab.slice(0, -1);
  assert.equal(retail.reduce((n, b) => n + b.products, 0), data.products.filter((p) => p.category === 'cabinets').length);
  for (let i = 1; i < retail.length; i++) assert.ok(retail[i - 1].products >= retail[i].products);
  const landon = retail.find((b) => b.brand === 'Landon & Co')!;
  assert.deepEqual(landon.stores, ['RONA']);
  assert.deepEqual(landon.storeSlugs, ['rona']);
  assert.equal(brandCounts('openings', data, []).length, 0);
});

test('checked dates read as a date', () => {
  assert.equal(checkedLabel('2026-10-15'), 'Oct 15, 2026');
  assert.equal(checkedLabel('bad'), '');
});
