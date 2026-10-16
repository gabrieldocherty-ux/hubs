// Faucets, pulls and knobs from the retail research (`fixtures` in src/data/retail.json): how the
// build turns a listing into a drawn fixture, what ships, and how a saved kitchen keeps the
// snapshot of the faucet and hardware it uses (server/lib/doc.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRetailCatalog, fixtureStyle, packOf, readResearch, STORES } from '../catalog/retailBuild.mjs';
import { isListing, loadRetail } from '../catalog/retail.mjs';
import { normalizeDoc } from '../lib/doc.mjs';

const store = (name, url, extra = {}) => ({ store: name, url, sku: null, priceCad: null, inStockOnline: null, ...extra });
const hd = (key, extra = {}) => store('Home Depot', `https://www.homedepot.ca/product/${key}/1001`, { sku: `sku-${key}`, ...extra });
const entry = (over) => ({ brand: 'Acme', line: null, upc: null, category: 'hardware', depthIn: null, heightIn: null, widthIn: null, widthOptionsIn: null, doorStyle: null, finishes: [{ name: 'Matte black', hex: '#1f1f20' }], sources: [], confidence: 'medium', notes: '', ...over });
const build = (products) => buildRetailCatalog([{ group: 't', checkedAt: '2026-10-16', products }]);

test('faucets, pulls and knobs ship as fixtures: drawn style, listed size or a marked typical one, price per piece', () => {
  const { data } = build([
    entry({ key: 'pd', kind: 'faucet', name: 'Ansel single-handle pull-down kitchen faucet, matte black (KPF-1675MB)', heightIn: 16.5, stores: [hd('pd', { priceCad: 298 })] }),
    entry({ key: 'po', kind: 'faucet', name: 'Renzo single handle pull-out kitchen faucet with soap dispenser, chrome', finishes: [{ name: 'Chrome', hex: '#d9dbdd' }], stores: [hd('po')] }),
    entry({ key: 'bar', kind: 'pull', name: 'Essentials 96 mm modern bar pull, matte black, 8-pack', widthIn: 6.14, stores: [hd('bar', { priceCad: 17.98 })] }),
    entry({ key: 'arch', kind: 'pull', name: 'Preston 128 mm modern arched pull, brushed nickel', finishes: [{ name: 'Brushed nickel', hex: '#b9b7b0' }], stores: [hd('arch')] }),
    entry({ key: 'knob', kind: 'knob', name: 'Crestmont 34 mm modern round cabinet knob, matte black', stores: [hd('knob')] }),
    entry({ key: 'nolink', kind: 'knob', name: 'Knob', stores: [store('Some Shop', 'https://someshop.ca/k')] }),
  ]);
  assert.equal(data.products.length, 0);
  assert.equal(data.leftOut.count, 1);
  const by = (k) => data.fixtures.find((f) => f.retail.key === k);
  assert.deepEqual([by('pd').kind, by('pd').style, by('pd').sizeIn.height, by('pd').price, by('pd').code], ['faucet', 'pulldown', 16.5, 298, 'KPF-1675MB']);
  assert.deepEqual(by('pd').retail.typical, []);
  assert.deepEqual([by('po').style, by('po').sizeIn.height, by('po').price, by('po').extras], ['pullout', 14.5, null, { soap: true }]);
  assert.deepEqual(by('po').retail.typical, ['height']);
  // A pack's price is per piece: $17.98 for eight.
  assert.deepEqual([by('bar').style, by('bar').sizeIn, by('bar').pack, by('bar').price], ['bar', { cc: 3.78, length: 6.14 }, 8, 2.25]);
  assert.deepEqual([by('arch').style, by('arch').sizeIn], ['arch', { cc: 5.04, length: 5.79 }]);
  assert.deepEqual(by('arch').retail.typical, ['length']);
  assert.deepEqual([by('knob').style, by('knob').sizeIn.dia], ['disc', 1.34]);
  assert.ok(by('bar').roughness > by('po').roughness, 'matte black is duller than chrome');
  assert.deepEqual(data.fixtures.map((f) => f.kind), ['faucet', 'faucet', 'pull', 'pull', 'knob']);
  assert.equal(fixtureStyle('faucet', 'Bolden commercial pull-down'), 'spring');
  assert.equal(fixtureStyle('faucet', 'single handle kitchen faucet with side spray'), 'side-spray');
  assert.equal(fixtureStyle('pull', 'Key 128 mm finger pull'), 'finger');
  assert.equal(fixtureStyle('pull', 'Kent rectangular pull'), 'rect');
  assert.equal(fixtureStyle('knob', 'Notre-Dame traditional round knob'), 'mushroom');
  assert.deepEqual([packOf('knob, 10-pack'), packOf('8 pk'), packOf('Copperfield 40 mm knob')], [10, 8, 1]);
});

test('the shipped fixtures: every faucet, pull and knob the research found, with real store links', () => {
  const { data } = buildRetailCatalog(readResearch());
  const domains = new Map(STORES.map((s) => [s.slug, s.domain]));
  assert.ok(data.fixtures.filter((f) => f.kind === 'faucet').length >= 20);
  assert.ok(data.fixtures.filter((f) => f.kind !== 'faucet').length >= 20);
  assert.equal(data.leftOut.byReason['faucet (no faucet shape: the sink draws its own)'], undefined);
  const ids = new Set(data.products.map((p) => p.id));
  for (const f of data.fixtures) {
    assert.match(f.id, /^r-[a-z0-9][a-z0-9-]{0,38}$/);
    assert.ok(!ids.has(f.id), `${f.id} is unique`);
    ids.add(f.id);
    assert.match(f.finish.hex, /^#[0-9a-f]{6}$/);
    assert.ok(f.price === null || f.price > 0);
    if (f.kind === 'pull') assert.ok(f.sizeIn.length >= f.sizeIn.cc && f.sizeIn.cc > 2, f.id);
    if (f.kind === 'knob') assert.ok(f.sizeIn.dia > 0.5 && f.sizeIn.dia < 3, f.id);
    if (f.kind === 'faucet') assert.ok(f.sizeIn.height >= 8 && f.sizeIn.height <= 26, f.id);
    for (const l of f.retail.stores) assert.ok(new URL(l.url).hostname.endsWith(domains.get(l.store)), `${f.id}: ${l.url}`);
  }
  // The server checks a link-out from Room & finishes against the same file.
  const retail = loadRetail();
  const f = retail.fixtures[0];
  assert.ok(isListing(retail, f.id, f.retail.stores[0].store));
});

test('a saved kitchen keeps the snapshots of the faucet and hardware its surfaces name, and nothing else', () => {
  const fixture = (id, kind, style) => ({
    id,
    kind,
    style,
    brand: 'Moen',
    name: 'Adler pull-down faucet',
    code: 'X1',
    finish: { id: 'stainless', name: 'Stainless', hex: '#C4C8CB' },
    roughness: 0.32,
    sizeIn: { height: 16, junk: 99 },
    price: 169,
    priceKnown: true,
    onclick: 'nope',
  });
  const base = { name: 'K', room: { widthIn: 150, lengthIn: 120, ceilingIn: 96 }, items: [] };
  const surfaces = { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'r-pull-a', faucetId: 'r-faucet-a', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' };
  const all = { 'r-faucet-a': fixture('r-faucet-a', 'faucet', 'pulldown'), 'r-pull-a': fixture('r-pull-a', 'pull', 'bar'), 'r-other': fixture('r-other', 'knob', 'disc') };
  const r = normalizeDoc({ ...base, surfaces, fixtures: all });
  assert.ok(r.ok, r.message);
  assert.deepEqual(Object.keys(r.doc.fixtures).sort(), ['r-faucet-a', 'r-pull-a']);
  assert.deepEqual(r.doc.fixtures['r-faucet-a'].sizeIn, { height: 16 });
  assert.equal(r.doc.fixtures['r-faucet-a'].finish.hex, '#c4c8cb');
  assert.equal(r.doc.fixtures['r-faucet-a'].onclick, undefined);
  assert.equal(r.doc.surfaces.faucetId, 'r-faucet-a');
  // A bad snapshot is dropped (the kitchen then draws the default hardware), not the whole kitchen.
  const badPull = { ...fixture('r-pull-a', 'pull', 'bar'), style: 'laser' };
  const badFaucet = { ...fixture('r-faucet-a', 'faucet', 'pulldown'), id: 'r-x' };
  const bad = normalizeDoc({ ...base, surfaces, fixtures: { 'r-pull-a': badPull, 'r-faucet-a': badFaucet } });
  assert.ok(bad.ok);
  assert.equal(bad.doc.fixtures, undefined);
  assert.equal(normalizeDoc({ ...base, surfaces: { ...surfaces, faucetId: 'javascript:alert(1)' } }).ok, false);
  assert.equal(normalizeDoc({ ...base, surfaces, fixtures: [] }).ok, false);
  // No faucet chosen: nothing to keep, and the surfaces carry no faucetId.
  const plain = normalizeDoc({ ...base, surfaces: { ...surfaces, hardwareId: 'brass', faucetId: undefined } });
  assert.ok(plain.ok);
  assert.equal(plain.doc.surfaces.faucetId, undefined);
});
