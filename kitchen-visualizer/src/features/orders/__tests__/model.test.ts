import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OrderStatus } from '../../../types/platform';
import { dollars, eventTitle, inFilter, isUnpaid, LIST_FILTERS, parseInches, relative, STATUS_LABEL, statusTone, stepProblem, suggestedTier, type DraftItem } from '../model';

const ALL: OrderStatus[] = ['draft', 'pending_payment', 'payment_failed', 'paid', 'in_progress', 'delivered', 'revision_requested', 'completed', 'cancelled', 'refunded', 'expired'];

const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  productTypeId: 'sink-farmhouse',
  name: 'Fireclay sink',
  widthIn: 33,
  depthIn: 22,
  heightIn: 10,
  notes: '',
  referenceFileIds: ['f_aaaaaaaaaaaaaaaaaaaaaaaa'],
  tier: 'standard',
  extraFinishes: 0,
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

test('step checks mirror the server: name, size limits, photos, notes, tier', () => {
  assert.equal(stepProblem(item(), 'review'), null);
  assert.match(stepProblem(item({ productTypeId: '' }), 'what')!, /product type/);
  assert.match(stepProblem(item({ name: '  ' }), 'what')!, /Name/);
  assert.match(stepProblem(item({ widthIn: null }), 'size')!, /width/);
  assert.match(stepProblem(item({ widthIn: 300 }), 'size')!, /between 1 and 240/);
  assert.match(stepProblem(item({ heightIn: 0.1 }), 'size')!, /between 0.25 and 144/);
  assert.match(stepProblem(item({ referenceFileIds: [] }), 'photos')!, /photo/);
  // Starting from a catalog product makes photos optional, as on the server.
  assert.equal(stepProblem(item({ referenceFileIds: [], refProductId: 'range-30' }), 'photos'), null);
  assert.match(stepProblem(item({ referenceFileIds: Array.from({ length: 9 }, (_, i) => `f_${i}`) }), 'photos')!, /up to 8/);
  assert.match(stepProblem(item({ notes: 'x'.repeat(4001) }), 'notes')!, /4,000/);
  assert.match(stepProblem(item({ tier: null }), 'tier')!, /tier/);
  assert.match(stepProblem(item({ tier: null }), 'review')!, /tier/);
});

test('suggested tiers and timeline titles', () => {
  assert.equal(suggestedTier('pendant'), 'simple');
  assert.equal(suggestedTier('range'), 'standard');
  assert.equal(suggestedTier('island'), 'complex');
  assert.equal(eventTitle({ type: 'paid', toStatus: 'paid', note: '', by: 'system' }), 'Payment received');
  assert.equal(eventTitle({ type: 'created', toStatus: 'draft', note: '', by: 'you' }), 'You sent the request');
  assert.equal(eventTitle({ type: 'note', toStatus: null, note: 'hi', by: 'studio' }), 'Note from the studio');
  assert.equal(eventTitle({ type: 'something_new', toStatus: null, note: '', by: 'system' }), 'something new');
});
