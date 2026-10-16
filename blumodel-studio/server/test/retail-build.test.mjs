// The real-retailer catalog build (server/catalog/retailBuild.mjs) and the data it ships
// (src/data/retail.json): merged and cleaned research, every entry placeable as an app product
// type, store links only on the store's own Canadian site, and the shipped file up to date.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRetailCatalog, OUT_FILE, readResearch, retailId, serialize, STORES } from '../catalog/retailBuild.mjs';
import { brandsInCategory, cleanAffiliate, isListing, loadRetail } from '../catalog/retail.mjs';
import { BUILTIN_ID_RE } from '../lib/ids.mjs';
import kinds from '../../src/data/kinds.json' with { type: 'json' };

const store = (name, url, extra = {}) => ({ store: name, url, sku: null, priceCad: null, inStockOnline: null, ...extra });
const entry = (over) => ({
  key: 'acme-thing',
  brand: 'Acme',
  name: `Thing ${over.key ?? ''}`.trim(),
  line: null,
  upc: null,
  category: 'cabinets',
  kind: 'base-cabinet',
  widthIn: 30,
  depthIn: 24,
  heightIn: 34.5,
  widthOptionsIn: null,
  doorStyle: 'shaker',
  finishes: [{ name: 'White', hex: '#f3f3ef' }],
  stores: [store('RONA', 'https://www.rona.ca/en/product/acme-thing-1')],
  sources: [],
  confidence: 'high',
  notes: '',
  ...over,
});
const build = (products, checkedAt = '2026-10-15') => buildRetailCatalog([{ group: 't', checkedAt, products }]);

test('the shipped src/data/retail.json is exactly what the research builds (run node server/catalog/retailBuild.mjs)', () => {
  const { data } = buildRetailCatalog(readResearch());
  assert.equal(fs.readFileSync(OUT_FILE, 'utf8'), serialize(data));
});

test('every shipped product is a placeable app product with real store links', () => {
  const { data, log } = buildRetailCatalog(readResearch());
  assert.ok(data.products.length >= 100, `${data.products.length} products`);
  // Every researched entry is shipped, merged into another, or left out with a reason.
  assert.equal(data.researched, data.products.length + data.leftOut.count + log.merged.length);
  const domains = new Map(STORES.map((s) => [s.slug, s.domain]));
  const ids = new Set();
  for (const p of data.products) {
    assert.match(p.id, /^r-/);
    assert.match(p.id, BUILTIN_ID_RE, `${p.id} is a valid product id`);
    assert.ok(!ids.has(p.id), `${p.id} is unique`);
    ids.add(p.id);
    assert.ok(kinds.kinds.includes(p.kind), `${p.id}: kind ${p.kind}`);
    if (p.variant) assert.ok(kinds.variants[p.kind].includes(p.variant), `${p.id}: variant ${p.variant}`);
    assert.equal(p.category, kinds.kindCategory[p.kind]);
    for (const k of ['widthIn', 'depthIn', 'heightIn', 'elevationIn']) assert.ok(Number.isFinite(p[k]) && p[k] >= 0, `${p.id}: ${k}`);
    assert.ok(p.widthIn > 0 && p.depthIn > 0 && p.heightIn > 0);
    assert.ok(p.finishes.length > 0 && p.finishes.every((f) => /^#[0-9a-f]{6}$/.test(f.hex) && f.id && f.name));
    assert.ok(p.price === null || (Number.isInteger(p.price) && p.price > 0));
    assert.match(p.retail.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.retail.stores.length > 0);
    for (const l of p.retail.stores) {
      const u = new URL(l.url);
      assert.equal(u.protocol, 'https:');
      const d = domains.get(l.store);
      assert.ok(d && (u.hostname === d || u.hostname.endsWith(`.${d}`)), `${p.id}: ${l.url} is on ${d}`);
      if (l.finish) assert.ok(p.finishes.some((f) => f.id === l.finish), `${p.id}: listing finish ${l.finish}`);
    }
    // Factual fields only: no photos and no copied descriptions.
    assert.equal(p.images, undefined);
    assert.equal(p.thumbnailUrl, undefined);
    assert.match(p.blurb, /^Listed at /);
  }
  // The research's RONA, Home Depot, Home Hardware and IKEA cabinet lines all made it.
  for (const s of ['rona', 'home-depot', 'home-hardware', 'ikea']) assert.ok(data.products.some((p) => p.category === 'cabinets' && p.retail.stores.some((l) => l.store === s)), s);
});

test('the same product listed twice (brand + model number, or UPC) merges its stores', () => {
  const { data, log } = build([
    entry({ key: 'acme-dw-1', kind: 'dishwasher', category: 'appliances', name: 'Dishwasher 24 in (DW24X)', widthIn: 24, stores: [store('RONA', 'https://www.rona.ca/en/product/dw24x', { priceCad: 799 })] }),
    entry({ key: 'acme-dw-2', kind: 'dishwasher', category: 'appliances', name: '24 in dishwasher, stainless (DW24X)', widthIn: 24, stores: [store('Best Buy', 'https://www.bestbuy.ca/en-ca/product/dw24x/1', { priceCad: 749.99 })] }),
    entry({ key: 'acme-fridge-a', kind: 'fridge', category: 'appliances', upc: '012345678905', widthIn: 36, stores: [store('Home Depot', 'https://www.homedepot.ca/product/a/1')] }),
    entry({ key: 'acme-fridge-b', kind: 'fridge', category: 'appliances', upc: '012345678905', widthIn: 36, stores: [store('The Home Depot', 'https://www.homedepot.ca/product/a/2')] }),
  ]);
  assert.equal(data.products.length, 2);
  const dw = data.products.find((p) => p.kind === 'dishwasher');
  assert.equal(dw.id, 'r-acme-dw-1');
  assert.equal(dw.code, 'DW24X');
  assert.deepEqual(dw.retail.stores.map((l) => l.store).sort(), ['best-buy', 'rona']);
  assert.equal(dw.price, 750); // the lowest checked price, in whole dollars
  assert.equal(data.products.find((p) => p.kind === 'fridge').retail.stores.length, 2);
  assert.equal(log.merged.length, 2);
});

test('round 2: the same store listing under another key merges by store SKU; Structube is a store, appliance dealers are not', () => {
  const { data, log } = build([
    entry({ key: 'hd-edson-b24', name: 'Edson 24 in base', widthIn: 24, stores: [store('Home Depot', 'https://www.homedepot.ca/product/edson-b24/1001421090', { sku: '1001421090' })] }),
    entry({ key: 'hampton-bay-edson-b24-white', name: 'Edson 24 in assembled base cabinet', widthIn: 24, stores: [store('Home Depot', 'https://www.homedepot.ca/product/hampton-bay-edson-24/1001421090', { sku: '1001421090', priceCad: 289 })] }),
    entry({ key: 'structube-laval', kind: 'stool', category: 'seating', name: 'Laval counter stool', widthIn: 17.3, depthIn: 19.7, heightIn: 36.6, stores: [store('Structube', 'https://www.structube.com/en_ca/laval-counter-stool?pid=1', { priceCad: 159 })] }),
    entry({ key: 'dealer-dw', kind: 'dishwasher', category: 'appliances', name: 'Dishwasher (SHE3AEM2N)', widthIn: 24, stores: [store('Tasco Appliance', 'https://www.tascoappliance.ca/bosch-she3aem2n'), store('CANEX', 'https://www.canex.ca/she3aem2n')] }),
  ]);
  assert.deepEqual(data.products.map((p) => p.retail.key).sort(), ['hd-edson-b24', 'structube-laval']);
  assert.ok(log.merged.includes('hampton-bay-edson-b24-white → hd-edson-b24'));
  assert.equal(data.products.find((p) => p.retail.key === 'hd-edson-b24').price, 289);
  assert.ok(data.stores.some((s) => s.slug === 'structube'));
  assert.equal(data.leftOut.byReason['no store link on a known store’s Canadian site'], 1);
});

test('a stool or pendant with no listed size places at the type’s typical size, marked typical; other kinds still need a width', () => {
  const { data } = build([
    entry({ key: 'stool', kind: 'stool', category: 'seating', name: 'Swivel counter stool with back', widthIn: null, depthIn: null, heightIn: null }),
    entry({ key: 'pendant', kind: 'pendant', category: 'lighting', name: 'Opal globe pendant', widthIn: null, depthIn: null, heightIn: null }),
    entry({ key: 'hood', kind: 'hood', category: 'appliances', name: 'Hood insert', widthIn: null }),
  ]);
  const by = (k) => data.products.find((p) => p.retail.key === k);
  assert.equal(by('hood'), undefined);
  assert.deepEqual([by('stool').retail.type, by('stool').widthIn, by('stool').heightIn], ['stool-backed', 19, 38]);
  assert.deepEqual(by('stool').retail.typical, ['width', 'depth', 'height']);
  assert.deepEqual([by('pendant').retail.type, by('pendant').widthIn, by('pendant').depthIn], ['pendant-globe', 12, 12]);
  assert.deepEqual(by('pendant').retail.typical, ['width', 'depth', 'height']);
});

test('one cabinet researched once per finish becomes one product whose listings name their finish', () => {
  const { data } = build([
    entry({ key: 'acme-b30-white', name: 'Edson 30 in base cabinet, White', stores: [store('Home Depot', 'https://www.homedepot.ca/product/w/1', { sku: '1' })] }),
    entry({ key: 'acme-b30-grey', name: 'Edson 30 in base cabinet, Grey', finishes: [{ name: 'Grey', hex: '#8c9093' }], stores: [store('Home Depot', 'https://www.homedepot.ca/product/g/2', { sku: '2' })] }),
    entry({ key: 'acme-b33-grey', name: 'Edson 33 in base cabinet, Grey', widthIn: 33, finishes: [{ name: 'Grey', hex: '#8c9093' }], stores: [store('Home Depot', 'https://www.homedepot.ca/product/g/3')] }),
  ]);
  assert.equal(data.products.length, 2);
  const p = data.products.find((x) => x.widthIn === 30);
  assert.equal(p.name, 'Edson 30 in base cabinet');
  assert.deepEqual(p.finishes.map((f) => f.id), ['white', 'grey']);
  assert.deepEqual(p.retail.stores.map((l) => [l.sku, l.finish]), [['1', 'white'], ['2', 'grey']]);
  // A single-finish product's listing doesn't name one.
  assert.equal(data.products.find((x) => x.widthIn === 33).retail.stores[0].finish, undefined);
});

test('entries without enough facts to place them are left out, with the reason counted', () => {
  const { data, log } = build([
    entry({ key: 'no-width', widthIn: null }),
    entry({ key: 'faucet', kind: 'faucet', category: 'faucets' }),
    entry({ key: 'pull', kind: 'pull', category: 'hardware' }),
    entry({ key: 'top-pantry', kind: 'tall-cabinet', name: 'Top Pantry Cabinet 15 x 49 in', heightIn: 49 }),
    entry({ key: 'us-ikea', stores: [store('IKEA', 'https://www.ikea.com/us/en/p/thing-1/')] }),
    entry({ key: 'off-site', stores: [store('RONA', 'https://rona.example.com/thing')] }),
    entry({ key: 'plain-http', stores: [store('RONA', 'http://www.rona.ca/en/product/thing')] }),
    entry({ key: 'unknown-store', stores: [store('Some Shop', 'https://someshop.ca/thing')] }),
    entry({ key: 'tall-island', kind: 'island', category: 'storage', heightIn: 69 }),
    entry({ key: 'ok', stores: [store('IKEA', 'https://www.ikea.com/ca/en/p/thing-2/')] }),
  ]);
  assert.deepEqual(data.products.map((p) => p.id), ['r-ok']);
  assert.equal(data.leftOut.count, 9);
  assert.equal(log.dropped.length, 9);
  assert.equal(data.leftOut.byReason['no published width'], 1);
  assert.equal(data.leftOut.byReason['no store link on a known store’s Canadian site'], 4);
  assert.ok(log.links.some((l) => /not the Canadian site/.test(l)));
});

test('sizes: a listed size is used as is, a missing one is the type’s typical size and marked; sinks sit in a base', () => {
  const { data } = build([
    entry({ key: 'base', depthIn: null, heightIn: null }),
    entry({ key: 'sink', kind: 'sink', category: 'sinks', name: '32 in undermount single bowl', widthIn: 32, depthIn: 19, heightIn: 10 }),
    entry({ key: 'bridge', kind: 'wall-cabinet', name: 'Wall cabinet 30 x 18 in', widthIn: 30, depthIn: 12, heightIn: 18 }),
    entry({ key: 'oven', kind: 'wall-oven', category: 'appliances', name: '30 in single wall oven', widthIn: 30, depthIn: 23, heightIn: 29 }),
  ]);
  const by = (k) => data.products.find((p) => p.retail.key === k);
  assert.deepEqual([by('base').widthIn, by('base').depthIn, by('base').heightIn], [30, 24, 36]);
  assert.deepEqual(by('base').retail.typical, ['depth', 'height']);
  assert.deepEqual(by('base').retail.size, { w: 30, d: null, h: null });
  assert.equal(by('sink').widthIn, 36); // a 32″ sink needs a 36″ sink base
  assert.match(by('sink').retail.note, /32″ sink, drawn in a 36″ sink base/);
  assert.equal(by('bridge').variant, 'bridge');
  assert.equal(by('bridge').elevationIn + by('bridge').heightIn, 84); // tops line up with the uppers
  assert.equal(by('oven').kind, 'oven-tower');
});

test('ids are r- + the research key, at most 40 characters, and never change for a key', () => {
  assert.equal(retailId('landon-co-elite-rd-b30-sd'), 'r-landon-co-elite-rd-b30-sd');
  const long = retailId('broan-30-under-cabinet-350cfm-black-stainless-steel-energy-star');
  assert.ok(long.length <= 40);
  assert.match(long, BUILTIN_ID_RE);
  assert.equal(long, retailId('broan-30-under-cabinet-350cfm-black-stainless-steel-energy-star'));
});

test('the server’s view: listings, brand counts per category and the affiliate parameter rule', () => {
  const retail = loadRetail();
  const p = retail.products.find((x) => x.retail.stores.some((l) => l.store === 'rona'));
  assert.ok(isListing(retail, p.id, 'rona'));
  assert.ok(!isListing(retail, p.id, 'no-such-store'));
  assert.ok(!isListing(retail, 'r-no-such-product', 'rona'));
  for (const c of kinds.categories.map((x) => x.id)) {
    const list = brandsInCategory(retail, c);
    assert.equal(list.reduce((n, b) => n + b.products, 0), retail.products.filter((x) => x.category === c).length, c);
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].products >= list[i].products);
  }
  const cabinets = brandsInCategory(retail, 'cabinets');
  const landon = cabinets.find((b) => b.brand === 'Landon & Co');
  assert.ok(landon && landon.stores.includes('RONA') && landon.storeSlugs.includes('rona'));
  assert.equal(cleanAffiliate(''), '');
  assert.equal(cleanAffiliate('?aff=blumodel'), 'aff=blumodel');
  assert.equal(cleanAffiliate('utm_source=blumodel&utm_medium=referral'), 'utm_source=blumodel&utm_medium=referral');
  for (const bad of ['javascript:alert(1)', 'a=b c', 'a=<b>', 'https://evil.example/', `a=${'x'.repeat(300)}`, 'a', '=b', 1]) assert.equal(cleanAffiliate(bad), null, String(bad));
});
