// Review fix: custom-model allowance periods tile exactly around short months. periodOf used to
// start a period "one month before its end", so a period ending Feb 28 started Jan 28, inside the
// January period that ended Jan 31, and a request made Jan 29 counted against both months. Now a
// period starts at the subscription's recorded period start (pricing-003 keeps it as the previous
// period end), and rolled or walked periods chain end to start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { periodOf, createAllowance } from '../payments/allowance.mjs';

const at = (y, m, d) => Date.UTC(y, m - 1, d, 15);
const DAY = 86_400_000;

/** The periods a subscription with these successive period ends lives through, as periodOf sees them. */
function walk(ends) {
  const out = [];
  let start = null;
  for (const end of ends) {
    const p = periodOf({ id: 'contractor', periodEnd: end, periodStart: start }, end - DAY);
    out.push(p);
    start = end;
  }
  return out;
}

function assertTiles(periods) {
  for (let i = 1; i < periods.length; i++) {
    assert.equal(periods[i].start, periods[i - 1].end, `period ${i} starts where period ${i - 1} ended (${new Date(periods[i].start).toISOString()} vs ${new Date(periods[i - 1].end).toISOString()})`);
  }
}

test('month-end anchors tile: Jan 31 -> Feb 28 -> Mar 31 -> Apr 30, and through a leap February (pure)', () => {
  const p = walk([at(2027, 1, 31), at(2027, 2, 28), at(2027, 3, 31), at(2027, 4, 30)]);
  assertTiles(p);
  assert.deepEqual(p[1], { start: at(2027, 1, 31), end: at(2027, 2, 28) }, 'February starts Jan 31, not Jan 28');
  assert.deepEqual(p[2], { start: at(2027, 2, 28), end: at(2027, 3, 31) });
  const leap = walk([at(2028, 1, 31), at(2028, 2, 29), at(2028, 3, 31)]);
  assertTiles(leap);
  assert.deepEqual(leap[1], { start: at(2028, 1, 31), end: at(2028, 2, 29) });

  // A request on Jan 29 belongs to exactly one period.
  const jan29 = at(2027, 1, 29);
  const owners = p.filter((x) => x.start <= jan29 && jan29 < x.end);
  assert.equal(owners.length, 1);

  // Rolled forward past an end not yet renewed, and walked back from a far end: still chained.
  const rolled = [];
  for (let k = 0; k < 4; k++) rolled.push(periodOf({ periodEnd: at(2027, 1, 31), periodStart: at(2026, 12, 31) }, at(2027, 2, 1) + k * 31 * DAY));
  const uniq = [...new Map(rolled.map((r) => [r.start, r])).values()];
  assertTiles(uniq);
  assert.equal(uniq[0].start, at(2027, 1, 31));

  // A start from long before (a renewal after a lapse) is cut to a month before the end.
  const lapsed = periodOf({ periodEnd: at(2027, 6, 15), periodStart: at(2027, 1, 15) }, at(2027, 6, 1));
  assert.equal(lapsed.start, at(2027, 5, 15));
});

test('the database records the period start on renewal, and the allowance period starts there', async () => {
  const t = await startTestServer();
  try {
    const ann = await t.user();
    const uid = ann.user.id;
    t.db.prepare("INSERT INTO subscriptions (id, user_id, plan, status, provider, current_period_end, created_at, updated_at) VALUES ('sub_x', ?, 'contractor', 'active', 'stripe', ?, 0, 0)").run(uid, at(2027, 1, 31));
    // Stripe renews: the end moves to Feb 28; the trigger keeps the old end as the start.
    t.db.prepare('UPDATE subscriptions SET current_period_end = ? WHERE id = ?').run(at(2027, 2, 28), 'sub_x');
    assert.equal(t.db.prepare('SELECT current_period_start FROM subscriptions WHERE id = ?').get('sub_x').current_period_start, at(2027, 1, 31));
    // A write that sets the start itself is kept as written.
    t.db.prepare('UPDATE subscriptions SET current_period_end = ?, current_period_start = ? WHERE id = ?').run(at(2027, 3, 31), at(2027, 2, 28), 'sub_x');
    assert.equal(t.db.prepare('SELECT current_period_start FROM subscriptions WHERE id = ?').get('sub_x').current_period_start, at(2027, 2, 28));

    // Back to January with no recorded start (a row from before pricing-003), then renewed to Feb 28.
    const clock = at(2027, 2, 10);
    const allowance = createAllowance({ db: t.db, now: () => clock, billing: t.services.billing, config: t.config });
    t.setNow(clock);
    t.db.prepare('UPDATE subscriptions SET current_period_end = ?, current_period_start = NULL WHERE id = ?').run(at(2027, 1, 31), 'sub_x');
    t.db.prepare('UPDATE subscriptions SET current_period_end = ? WHERE id = ?').run(at(2027, 2, 28), 'sub_x');
    const feb = allowance.of(uid);
    assert.equal(feb.periodStart, at(2027, 1, 31), 'February starts where January ended');
    assert.equal(feb.periodEnd, at(2027, 2, 28));
  } finally {
    t.setNow(null);
    await t.close();
  }
});
