import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from '../data/retail.json';
import type { DesignDoc } from '../types';
import { DEFAULT_ROOM, DEFAULT_SURFACES } from '../data/defaults';
import { applyRetailData, retailOf, useRetail, type RetailData } from './retail';
import { fixtureFromWire, getFixture, resolveFaucet, resolveHardware, TYPICAL_FIXTURE_PRICE, resetFixtures } from '../lib/fixtures';
import { prepareDocForSave, sanitizeDoc } from '../lib/doc';
import { buildEstimate } from '../lib/estimate';

const data = raw as unknown as RetailData;
const fixtures = data.fixtures ?? [];
const pricedPull = fixtures.find((f) => f.kind === 'pull' && f.price !== null)!;
const faucet = fixtures.find((f) => f.kind === 'faucet' && f.price !== null)!;
const unpricedKnob = fixtures.find((f) => f.kind === 'knob' && f.price === null)!;

const kitchen = (surfaces: Partial<DesignDoc['surfaces']>): DesignDoc => ({
  name: 'K',
  room: DEFAULT_ROOM,
  surfaces: { ...DEFAULT_SURFACES, ...surfaces },
  items: [
    { id: 'a', productId: 'base', x: 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 },
    { id: 'b', productId: 'sink-under', x: 70, y: 12, rotation: 0, finishIndex: 0 },
    { id: 'c', productId: 'sink-prep', x: 100, y: 60, rotation: 0, finishIndex: 0 },
  ],
});

test('the retail data carries faucets, pulls and knobs, registered as fixtures with their store facts', () => {
  assert.ok(fixtures.length >= 40, `${fixtures.length} fixtures`);
  applyRetailData(data);
  assert.equal(useRetail.getState().fixtures.length, fixtures.length);
  assert.equal(getFixture(pricedPull.id)?.price, pricedPull.price);
  assert.equal(getFixture(unpricedKnob.id)?.price, TYPICAL_FIXTURE_PRICE.knob);
  assert.equal(getFixture(unpricedKnob.id)?.priceKnown, false);
  assert.equal(retailOf(faucet.id)?.key, faucet.retail.key, 'link-outs find the listing');
  // None is a placeable product: they are not in the catalog panel.
  assert.ok(!useRetail.getState().products.some((p) => p.id === faucet.id));
});

test('the kitchen draws and prices the chosen pull and faucet; an unknown id draws the default finish', () => {
  applyRetailData(data);
  const doc = kitchen({ hardwareId: pricedPull.id, faucetId: faucet.id });
  const est = buildEstimate(doc);
  const hw = est.lines.find((l) => l.key === 'hardware')!;
  assert.equal(hw.unitPrice, pricedPull.price);
  assert.equal(hw.fixtureId, pricedPull.id);
  assert.match(hw.label, new RegExp(pricedPull.brand));
  const fl = est.lines.find((l) => l.key === 'faucet')!;
  assert.equal(fl.qty, 2, 'one faucet per sink');
  assert.equal(fl.unitPrice, faucet.price);
  assert.equal(fl.group, 'Sinks & faucets');
  assert.equal(fl.productId, undefined, 'not a placed product (the share page lists placed products)');

  // What the 3D models draw (sceneCtx.ts reads these two).
  assert.equal(resolveHardware(doc.surfaces).fixture?.id, pricedPull.id);
  assert.equal(resolveHardware(doc.surfaces).hex, pricedPull.finish.hex);
  assert.equal(resolveFaucet(doc.surfaces)?.fixture.id, faucet.id);

  // No faucet chosen: no faucet line, the sinks draw their own in the hardware finish.
  const plain = kitchen({});
  assert.equal(buildEstimate(plain).lines.find((l) => l.key === 'faucet'), undefined);
  assert.equal(resolveFaucet(plain.surfaces), null);
  assert.equal(resolveHardware(plain.surfaces).fixture, null);
  assert.equal(resolveHardware({ hardwareId: 'r-no-such-pull' }).id, 'brass');
  assert.equal(resolveFaucet({ faucetId: 'r-no-such-faucet' }), null);
  // The typical price is said to be one.
  const knob = buildEstimate(kitchen({ hardwareId: unpricedKnob.id })).lines.find((l) => l.key === 'hardware')!;
  assert.match(knob.sub, /typical price/);
});

test('a saved kitchen carries snapshots of its fixtures, so it draws and prices before the catalog loads', () => {
  applyRetailData(data);
  const saved = prepareDocForSave(kitchen({ hardwareId: pricedPull.id, faucetId: faucet.id }));
  assert.deepEqual(Object.keys(saved.fixtures ?? {}).sort(), [faucet.id, pricedPull.id].sort());
  assert.equal(prepareDocForSave(kitchen({})).fixtures, undefined);

  // A fresh device: nothing registered, the snapshot fills in.
  resetFixtures();
  const opened = sanitizeDoc(JSON.parse(JSON.stringify(saved)));
  assert.equal(opened.surfaces.faucetId, faucet.id);
  assert.equal(opened.fixtures, undefined, 'the working doc keeps none; the registry holds them');
  assert.equal(getFixture(faucet.id)?.name, fixtureFromWire(faucet).name);
  assert.equal(buildEstimate(opened).lines.find((l) => l.key === 'faucet')?.unitPrice, faucet.price);
  // And the server's export kit prices from the saved doc alone.
  resetFixtures();
  assert.equal(buildEstimate(saved).lines.find((l) => l.key === 'hardware')?.unitPrice, pricedPull.price);
});

test('a product carrying a UPC (a delivered custom model) finds the retail listing with that UPC', async () => {
  const { retailIdByUpc, upcKey } = await import('./retail');
  const listed = data.products.find((p) => p.retail.upc)!;
  assert.equal(retailIdByUpc(listed.retail.upc, data), listed.id);
  // Typed with spaces, or as the EAN-13 with a leading 0: the same code.
  assert.equal(retailIdByUpc(`0${listed.retail.upc}`, data), listed.id);
  assert.equal(retailIdByUpc(listed.retail.upc!.replace(/(\d{6})/, '$1 '), data), listed.id);
  assert.equal(upcKey('0036000291452'), '036000291452');
  assert.equal(retailIdByUpc('036000291452', data), undefined);
  assert.equal(retailIdByUpc('', data), undefined);
  assert.equal(retailIdByUpc(listed.retail.upc, null), undefined);
});
