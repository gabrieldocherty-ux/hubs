import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderStatus } from '../../../types/platform';
import {
  briefSize,
  dollars,
  errorTarget,
  eventTitle,
  inFilter,
  isUnpaid,
  itemProblem,
  itemProblems,
  LIST_FILTERS,
  packFill,
  packOf,
  parseInches,
  pricingLabel,
  relative,
  STATUS_LABEL,
  statusTone,
  type DraftItem,
} from '../model';
import { expandUpcE, formatUpc, gs1CheckDigit, normalizeUpc, scannedCode, upcWhileTyping } from '../upc';
// The server's rules, to prove the two implementations agree (esbuild bundles it for the test).
import { normalizeUpc as serverNormalizeUpc } from '../../../../server/payments/upc.mjs';

const ALL: OrderStatus[] = ['draft', 'pending_payment', 'payment_failed', 'paid', 'in_progress', 'delivered', 'revision_requested', 'completed', 'cancelled', 'refunded', 'expired'];

const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  productTypeId: 'sink-farmhouse',
  name: 'Fireclay sink',
  brand: '',
  upc: '',
  widthIn: 33,
  depthIn: 22,
  heightIn: 10,
  notes: '',
  referenceFileIds: ['f_aaaaaaaaaaaaaaaaaaaaaaaa'],
  ...over,
});

test('every status has a label and a tone; unpaid is draft, pending and declined', () => {
  for (const s of ALL) {
    assert.ok(STATUS_LABEL[s], s);
    assert.ok(statusTone(s), s);
  }
  assert.deepEqual(
    ALL.filter(isUnpaid),
    ['draft', 'pending_payment', 'payment_failed'],
  );
  assert.equal(statusTone('payment_failed'), 'bad');
  assert.equal(statusTone('delivered'), 'ok');
});

test('list filters: "All" holds everything and the others partition it', () => {
  for (const s of ALL) {
    assert.ok(inFilter(s, 'all'));
    const hits = LIST_FILTERS.filter((f) => f.id !== 'all' && inFilter(s, f.id));
    assert.equal(hits.length, 1, `${s} is in exactly one filter`);
  }
});

test('money: whole dollars stay whole, cents show two places', () => {
  assert.equal(dollars(12_900), '$129');
  assert.equal(dollars(41_850), '$418.50');
  assert.equal(dollars(123_456), '$1,234.56');
  assert.equal(dollars(0), '$0');
});

test('relative times read naturally both ways', () => {
  const now = 1_700_000_000_000;
  assert.equal(relative(now + 3 * 3_600_000, now), 'in 3 h');
  assert.equal(relative(now - 3 * 86_400_000, now), '3 days ago');
  assert.equal(relative(now + 20 * 60_000, now), 'in 20 min');
});

test('inch parsing: plain inches, decimals, feet and inches; junk is null', () => {
  assert.equal(parseInches('33'), 33);
  assert.equal(parseInches('33.5"'), 33.5);
  assert.equal(parseInches(`2' 9"`), 33);
  assert.equal(parseInches('2′ 9″'), 33);
  assert.equal(parseInches(`3'`), 36);
  assert.equal(parseInches(''), null);
  assert.equal(parseInches('abc'), null);
  assert.equal(parseInches('-4'), null);
});

test('product checks mirror the server: type, name, brand, UPC, optional size, photos or UPC, notes', () => {
  assert.equal(itemProblem(item()), null);
  assert.match(itemProblems(item({ productTypeId: '' })).productTypeId!, /kind of product/);
  assert.match(itemProblems(item({ name: '  ' })).name!, /Name/);
  assert.match(itemProblems(item({ brand: 'x'.repeat(61) })).brand!, /60/);
  // The size is optional; a size that is given must be in range.
  assert.equal(itemProblem(item({ widthIn: null, depthIn: null, heightIn: null })), null);
  assert.match(itemProblems(item({ widthIn: 300 })).widthIn!, /between 1 and 240/);
  assert.match(itemProblems(item({ heightIn: 0.1 })).heightIn!, /between 0.25 and 144/);
  // Something must identify it: a photo, a valid UPC, a barcode photo or a catalog product.
  assert.match(itemProblems(item({ referenceFileIds: [] })).referenceFileIds!, /photo or the UPC/);
  assert.equal(itemProblem(item({ referenceFileIds: [], upc: '036000291452' })), null);
  assert.equal(itemProblem(item({ referenceFileIds: [], barcodeFileId: 'f_bbbbbbbbbbbbbbbbbbbbbbbb' })), null);
  assert.equal(itemProblem(item({ referenceFileIds: [], refProductId: 'range-30' })), null);
  // A bad UPC is its own message, not the "add a photo" one.
  const bad = itemProblems(item({ referenceFileIds: [], upc: '036000291453' }));
  assert.match(bad.upc!, /doesn’t check out/);
  assert.equal(bad.referenceFileIds, undefined);
  assert.match(itemProblems(item({ referenceFileIds: Array.from({ length: 9 }, (_, i) => `f_${i}`) })).referenceFileIds!, /up to 8/);
  assert.match(itemProblems(item({ notes: 'x'.repeat(4001) })).notes!, /4,000/);
});

test('UPCs: UPC-A, EAN-13, EAN-8, check digits, normalising, and the same answers as the server', () => {
  const cases = ['036000291452', '0 36000 29145 2', '0036000291452', '4006381333931', '400-638133393-1', '96385074', '036000291453', '4006381333932', '96385075', '12345', '03600029145', '0360002914AB', '', '   '];
  for (const c of cases) assert.deepEqual(normalizeUpc(c), serverNormalizeUpc(c), `client and server agree on ${JSON.stringify(c)}`);
  assert.deepEqual(normalizeUpc('0036000291452'), { ok: true, code: '036000291452', format: 'upc_a' });
  assert.deepEqual(normalizeUpc('4006381333931'), { ok: true, code: '4006381333931', format: 'ean_13' });
  assert.deepEqual(normalizeUpc('96385074'), { ok: true, code: '96385074', format: 'ean_8' });
  assert.equal(gs1CheckDigit('03600029145'), 2);
  // Typing: quiet until there's enough to judge.
  assert.equal(upcWhileTyping(''), null);
  assert.equal(upcWhileTyping('0360'), null);
  assert.equal(upcWhileTyping('03600029145')?.ok, false);
  assert.equal(upcWhileTyping('036000291452')?.ok, true);
  assert.equal(upcWhileTyping('03a')?.ok, false, 'letters are wrong at once');
  assert.equal(formatUpc('036000291452'), '0 36000 29145 2');
  assert.equal(formatUpc('96385074'), '9638 5074');
  // A scanned UPC-E becomes the UPC-A it stands for, which then checks out.
  assert.equal(expandUpcE('04252614'), '042100005264');
  assert.equal(normalizeUpc(expandUpcE('04252614')!).ok, true);
  assert.equal(scannedCode('04252614', 'upc_e'), '042100005264');
  assert.equal(scannedCode(' 4006381333931 ', 'ean_13'), '4006381333931');
  assert.equal(expandUpcE('9425261'), null);
});

test('packs: counts only (the server prices), which pack a product is in, labels', () => {
  assert.deepEqual(packFill(1, 8), { packs: 1, inLast: 1, roomInLast: 7 });
  assert.deepEqual(packFill(8, 8), { packs: 1, inLast: 8, roomInLast: 0 });
  assert.deepEqual(packFill(9, 8), { packs: 2, inLast: 1, roomInLast: 7 });
  assert.deepEqual(packFill(0, 8), { packs: 1, inLast: 0, roomInLast: 8 });
  assert.deepEqual([0, 7, 8, 15, 16].map((i) => packOf(i, 8)), [1, 1, 2, 2, 3]);
  assert.equal(pricingLabel({ tier: 'pack', pricing: 'pack', packs: 1 }), 'Model pack');
  assert.equal(pricingLabel({ tier: 'pack', pricing: 'pack', packs: 2 }), '2 Model packs');
  assert.equal(pricingLabel({ tier: 'standard', pricing: 'tiers', packs: 0 }), 'Standard model');
  assert.equal(briefSize({ widthIn: 33, depthIn: 22, heightIn: 36 }), '33″ W × 22″ D × 36″ H');
  assert.equal(briefSize({ widthIn: 33 }), '33″ W');
  assert.equal(briefSize({}), 'Size not given');
  assert.deepEqual(errorTarget('items[3].brief.upc'), { item: 3, field: 'upc' });
  assert.deepEqual(errorTarget('items[0]'), { item: 0, field: 'name' });
  assert.equal(errorTarget('line'), null);
});

test('timeline titles', () => {
  assert.equal(eventTitle({ type: 'paid', toStatus: 'paid', note: '', by: 'system' }), 'Payment received');
  assert.equal(eventTitle({ type: 'created', toStatus: 'draft', note: '', by: 'you' }), 'You sent the request');
  assert.equal(eventTitle({ type: 'note', toStatus: null, note: 'hi', by: 'studio' }), 'Note from the studio');
  assert.equal(eventTitle({ type: 'something_new', toStatus: null, note: '', by: 'system' }), 'something new');
});
