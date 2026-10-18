import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccent, checkPrimary, contrast, normalizeHex, textOn } from '../colour';
import { markupFor, parseDollars, sellFrom, workedPrices } from '../pricing';
import { tabOf } from '../tabs';

test('colours: hex codes, contrast ratios and the warnings the Showroom tab shows', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('2e3d55'), '#2e3d55');
  assert.equal(normalizeHex('navy'), null);
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(textOn('#2e3d55'), '#ffffff');
  assert.equal(textOn('#f7e27a'), '#1a1a1a');
  // The demo showroom's navy passes; a pale yellow or a light grey main colour is faint on white.
  assert.equal(checkPrimary('#2e3d55').ok, true);
  assert.match(checkPrimary('#f7e27a').message ?? '', /faint on a white page/);
  assert.match(checkPrimary('#b0b0b0').message ?? '', /faint/);
  assert.equal(checkPrimary('#767676').ok, true);
  assert.equal(checkPrimary('nope').ok, false);
  assert.equal(checkAccent('#9aa892', '#2e3d55').ok, true);
  assert.match(checkAccent('#fdfdfd', '#2e3d55').message ?? '', /disappears/);
  assert.match(checkAccent('#2f3e56', '#2e3d55').message ?? '', /close to the main colour/);
});

test('prices: cost plus markup, per width, with the default markup as the fallback', () => {
  assert.equal(sellFrom(100000, 35), 1350);
  assert.equal(sellFrom(12345, 0), 123.45);
  assert.equal(markupFor({ costCents: 1, costByWidth: null, markupPct: null }, 30), 30);
  assert.equal(markupFor({ costCents: 1, costByWidth: null, markupPct: 0 }, 30), 0);
  assert.deepEqual(workedPrices({ costCents: 50000, costByWidth: null, markupPct: 20 }, 30, [24], 24), { price: 600, priceByWidth: null });
  // Per width: a width without its own cost uses the single cost; the placed width sets `price`.
  assert.deepEqual(workedPrices({ costCents: 40000, costByWidth: { 30: 50000 }, markupPct: null }, 50, [24, 30], 30), { price: 750, priceByWidth: { 24: 600, 30: 750 } });
  assert.equal(workedPrices({ costCents: null, costByWidth: null, markupPct: 10 }, 0, [24], 24), null);
  assert.equal(parseDollars('$1,250.50'), 1250.5);
  assert.equal(parseDollars(''), null);
  assert.ok(Number.isNaN(parseDollars('abc')));
});

test('workspace routes: #/studio/<tab>/<rest>', () => {
  assert.deepEqual(tabOf(''), { tab: 'showroom', sub: '' });
  assert.deepEqual(tabOf('leads/ld_123'), { tab: 'leads', sub: 'ld_123' });
  assert.deepEqual(tabOf('products/requests/new'), { tab: 'products', sub: 'requests/new' });
  assert.deepEqual(tabOf('nope'), { tab: null, sub: '' });
});
