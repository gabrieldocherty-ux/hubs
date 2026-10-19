// Package E (share) demo seed: one kitchen for demo-customer@blumodel.test with share links in
// every state the share dialog shows (prices on and never expiring, prices off for 30 days,
// and one turned off), so the dialog and the shared page (#/s/<token>) have something to show
// on a fresh demo server. The summary prints the two live links.
//
//   export async function seed(ctx)   ctx = { db, config, services, now, demo? }
//
// Idempotent: the kitchen has a fixed id and each link a fixed label, and anything already
// there is left alone (a second run adds nothing and changes nothing). Tokens are random per
// database, like every other link: a seeded link is never guessable. Built-in products only;
// the kitchen and its client are fictional. The seed runner (server/seed/index.mjs) owns the
// production guard (--force-demo).

import crypto from 'node:crypto';
import { normalizeDoc } from '../lib/doc.mjs';
import { randomId } from '../lib/ids.mjs';

const DAY = 86_400_000;
const CUSTOMER_EMAIL = 'demo-customer@blumodel.test';

/** Fixed so a second run finds it (a UUID, like every kitchen id). */
export const SHARE_DEMO_PROJECT_ID = 'd3e05ea7-0000-4000-8000-00000000e5e1';
export const SHARE_DEMO_NAME = 'Harbor Lane Kitchen (Demo)';

/** The links, by label (the owner's own note; viewers never see it). */
export const SHARE_DEMO_LINKS = Object.freeze([
  Object.freeze({ label: 'Demo: for the family', showPrices: true, expiresInDays: null, revoked: false }),
  Object.freeze({ label: 'Demo: walk-through, no prices', showPrices: false, expiresInDays: 30, revoked: false }),
  Object.freeze({ label: 'Demo: an old link, turned off', showPrices: true, expiresInDays: null, revoked: true }),
]);

/** Built-in products: [productId, x, y, rotation, finishIndex, finishId, extra?]. The starter layout (an L with an island) in sage. */
const ITEMS = [
  ['corner', 18, 18, 0, 4, 'sage'],
  ['trash-base', 45, 12, 0, 4, 'sage'],
  ['sink-farm', 72, 12, 0, 0, 'fireclay'],
  ['dishwasher', 102, 12, 0, 0, 'stainless'],
  ['base', 132, 12, 0, 4, 'sage', { widthIn: 36 }],
  ['base', 162, 12, 0, 4, 'sage'],
  ['pantry', 186, 12, 0, 4, 'sage'],
  ['window', 72, 0, 0, 0, 'white'],
  ['wall', 45, 6, 0, 4, 'sage', { widthIn: 18 }],
  ['wall', 102, 6, 0, 4, 'sage', { widthIn: 24 }],
  ['wall', 132, 6, 0, 4, 'sage', { widthIn: 36 }],
  ['wall', 162, 6, 0, 4, 'sage', { widthIn: 24 }],
  ['fridge-36', 15, 54, 270, 0, 'stainless'],
  ['base', 12, 85.5, 270, 4, 'sage', { widthIn: 27 }],
  ['range-30', 14, 114, 270, 0, 'stainless'],
  ['base', 12, 142.5, 270, 4, 'sage', { widthIn: 27 }],
  ['bridge', 12, 54, 270, 4, 'sage'],
  ['wall', 6, 85.5, 270, 4, 'sage', { widthIn: 27 }],
  ['hood-chimney', 10, 114, 270, 0, 'stainless'],
  ['wall', 6, 142.5, 270, 4, 'sage', { widthIn: 27 }],
  ['island', 118, 89, 0, 6, 'navy'],
  ['stool-backed', 90, 112, 180, 1, 'boucle'],
  ['stool-backed', 118, 112, 180, 1, 'boucle'],
  ['stool-backed', 146, 112, 180, 1, 'boucle'],
  ['pendant-dome', 90, 89, 0, 1, 'brass'],
  ['pendant-dome', 118, 89, 0, 1, 'brass'],
  ['pendant-dome', 146, 89, 0, 1, 'brass'],
  ['opening', 200, 126, 90, 0, 'white', { widthIn: 36 }],
];

export function shareDemoDoc() {
  return {
    version: 2,
    name: SHARE_DEMO_NAME,
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'sage', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' },
    items: ITEMS.map(([productId, x, y, rotation, finishIndex, finishId, extra], i) => ({ id: `seed-share-${i + 1}`, productId, x, y, rotation, finishIndex, finishId, ...(extra ?? {}) })),
  };
}

/** @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number, demo?: { users?: Record<string, string> } }} ctx */
export async function seed(ctx) {
  const { db } = ctx;
  const now = ctx.now ?? Date.now;
  const customerId = ctx.demo?.users?.customer ?? db.prepare('SELECT id FROM users WHERE email = ?').get(CUSTOMER_EMAIL)?.id;
  if (!customerId) return { summary: `skipped: no ${CUSTOMER_EMAIL} (run the core seed first)` };

  let made = 0;
  const project = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(SHARE_DEMO_PROJECT_ID);
  if (project && project.user_id !== customerId) return { summary: `skipped: kitchen ${SHARE_DEMO_PROJECT_ID} belongs to someone else` };
  if (!project) {
    const v = normalizeDoc(shareDemoDoc());
    if (!v.ok) throw new Error(`server/seed/share.mjs: the demo kitchen is not a valid doc (${v.message ?? v.error ?? 'invalid'})`);
    const t = now();
    db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(
      SHARE_DEMO_PROJECT_ID,
      customerId,
      SHARE_DEMO_NAME,
      'The Lindqvists (fictional)',
      JSON.stringify({ ...v.doc, name: SHARE_DEMO_NAME }),
      t - 3 * DAY,
      t - DAY,
    );
    made++;
  }

  const live = [];
  for (const l of SHARE_DEMO_LINKS) {
    let row = db.prepare('SELECT * FROM share_links WHERE project_id = ? AND label = ?').get(SHARE_DEMO_PROJECT_ID, l.label);
    if (!row) {
      const t = now();
      const id = randomId('sh_', 16);
      db.prepare(
        `INSERT INTO share_links (id, project_id, token, created_by, label, show_prices, expires_at, revoked_at, view_count, last_viewed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
      ).run(id, SHARE_DEMO_PROJECT_ID, crypto.randomBytes(24).toString('base64url'), customerId, l.label, l.showPrices ? 1 : 0, l.expiresInDays ? t + l.expiresInDays * DAY : null, l.revoked ? t : null, t);
      row = db.prepare('SELECT * FROM share_links WHERE id = ?').get(id);
      made++;
    }
    const isLive = row.revoked_at == null && (row.expires_at == null || row.expires_at > now());
    if (isLive) live.push(`#/s/${row.token} (${row.show_prices ? 'prices on' : 'prices off'})`);
  }

  return {
    summary: `${made ? `${made} rows created` : 'already there'}: "${SHARE_DEMO_NAME}" for ${CUSTOMER_EMAIL}; live links ${live.join(', ') || 'none'}`,
  };
}
