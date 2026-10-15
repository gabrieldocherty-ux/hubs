// Package C (orders) demo seed (BUILD_PLAN §7 C-T6): custom-model orders for
// demo-customer@blumodel.test in `paid`, `in_progress`, `delivered` (with a fixture deliverable
// product) and `completed`, all on the DEMO provider, so the studio queue, the order pages
// and Admin → Revenue aren't empty.
//
//   export async function seed(ctx)   ctx = { db, config, services, now }
//
// Idempotent: each order has a fixed id and is skipped when it exists. Needs the core
// seed's demo users; without them it does nothing and says why. Every product name here is
// generic and fictional (no real brands). Refuses production unless ctx.forceDemo is set,
// like the other seeds (the runner owns the --force-demo flag).

import { makeGlb, makePng } from '../lib/synth.mjs';
import { createOrderService } from '../payments/orders.mjs';
import { tx as runTx } from '../db/index.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IN = 0.0254;

/** Fixed ids (o_ + 24 [a-z0-9]) so a second run finds them. */
const ORDERS = [
  {
    id: 'o_demoseedorder00000000001',
    state: 'paid',
    ageDays: 1,
    brief: { productTypeId: 'pendant-dome', kind: 'pendant', variant: 'dome', name: 'Enamel dome pendant (Demo)', brand: 'Northlight (Demo)', upc: '200000041205', widthIn: 14, depthIn: 14, heightIn: 10, elevationIn: 68, notes: 'Matte forest-green enamel shade, brass cap and cord grip. 14 in across. Photo from the shop listing attached.' },
    rgba: [52, 84, 64, 255],
  },
  {
    id: 'o_demoseedorder00000000002',
    state: 'in_progress',
    ageDays: 4,
    brief: { productTypeId: 'range-gas-6', kind: 'range', variant: 'gas-6', name: 'Heritage 36″ dual-fuel range (Demo)', brand: 'Heritage Ranges (Demo)', upc: '200000041212', widthIn: 36, depthIn: 28, heightIn: 36, notes: 'Six burners, two oven doors, chrome rails. I want it in cream and in matte black (3 finishes total with stainless).' },
    rgba: [228, 220, 200, 255],
    note: 'Blocking out the oven doors and rail now. Expect a first look in a few days.',
  },
  {
    id: 'o_demoseedorder00000000003',
    state: 'delivered',
    ageDays: 12,
    brief: { productTypeId: 'sink-farmhouse', kind: 'sink', variant: 'farmhouse', name: 'Fireclay apron-front sink (Demo)', widthIn: 33, depthIn: 22, heightIn: 36, notes: 'Single bowl, 10 in deep, slightly rounded apron. White glaze.' },
    rgba: [240, 240, 236, 255],
    deliver: { w: 33, h: 36, d: 22, hex: '#f2f1ec', material: 'ceramic', finish: 'White glaze' },
  },
  {
    id: 'o_demoseedorder00000000004',
    state: 'completed',
    ageDays: 30,
    brief: { productTypeId: 'stool-backed', kind: 'stool', variant: 'backed', name: 'Walnut counter stool (Demo)', widthIn: 19, depthIn: 20, heightIn: 38, notes: 'Low curved back, walnut with a natural oil finish; also in ebonised black.' },
    rgba: [110, 74, 48, 255],
    deliver: { w: 19, h: 38, d: 20, hex: '#6e4a30', material: 'wood', finish: 'Natural walnut' },
  },
];

/**
 * @param {{ db: any, config: any, services: any, now?: () => number, forceDemo?: boolean, log?: any }} ctx
 * @returns {Promise<{ created: number, skipped?: string }>}
 */
export async function seed(ctx) {
  const { db, config, services } = ctx;
  if (config?.PROD && !ctx.forceDemo) return { created: 0, skipped: 'production (pass --force-demo to the seed runner)' };
  const userBy = (email) => db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(email) ?? null;
  const customer = userBy('demo-customer@blumodel.test');
  const studio = userBy('demo-studio@blumodel.test');
  if (!customer || !studio) return { created: 0, skipped: 'the demo customer and studio users do not exist yet (run the core seed first)' };

  const realNow = ctx.now ?? Date.now;
  let clock = realNow();
  const orders = createOrderService({ db, now: () => clock, services, config: { ...config, paymentsProvider: 'demo' }, log: ctx.log ?? console, tx: (fn) => runTx(db, fn) });
  const { files } = services;

  let created = 0;
  for (const spec of ORDERS) {
    if (orders.rowOf(spec.id)) continue;
    const start = realNow() - spec.ageDays * DAY;
    clock = start;
    runTx(db, () => {
      const ref = files.saveBuffer(makePng({ w: 32, h: 24, rgba: spec.rgba }), { kind: 'reference', visibility: 'private', ownerUserId: customer.id, originalName: 'reference-photo.png' });
      // Validated by the same rules as the API (category is derived from the kind).
      const valid = orders.readRequest({ target: 'customer', items: [{ brief: { ...spec.brief, referenceFileIds: [ref.id] } }] }, customer);
      const row = orders.create(customer, valid, { id: spec.id });
      clock += 10 * 60_000;
      orders.transition(row.id, ['draft'], 'pending_payment', { by: customer.id, type: 'checkout', data: { provider: 'demo', attempt: 1 }, set: { provider_ref: `demo_${row.id}`, checkout_attempts: 1, pending_since: clock } });
      clock += 2 * 60_000;
      orders.markOrderPaid(row.id, { ref: `demo_${row.id}`, amountCents: row.amount_cents, currency: row.currency, by: customer.id, source: 'demo' });
      if (spec.state === 'paid') return;

      clock += 6 * HOUR;
      orders.transition(row.id, ['paid'], 'in_progress', { by: studio.id, type: 'started', set: { assigned_to: studio.id } });
      if (spec.note) {
        clock += HOUR;
        orders.addEvent(row.id, { type: 'note', by: studio.id, note: spec.note });
      }
      if (spec.state === 'in_progress') return;

      const d = spec.deliver;
      const glb = files.saveBuffer(makeGlb({ w: d.w * IN, h: d.h * IN, d: d.d * IN }), { kind: 'model', visibility: 'private', ownerUserId: studio.id, originalName: 'deliverable.glb' });
      const thumb = files.saveBuffer(makePng({ w: 64, h: 64, rgba: spec.rgba }), { kind: 'image', visibility: 'private', ownerUserId: studio.id, originalName: 'thumbnail.png' });
      clock += 5 * DAY;
      orders.deliver(row.id, studio, {
        modelFileId: glb.id,
        thumbFileId: thumb.id,
        finishes: [{ id: 'standard', name: d.finish, hex: d.hex, material: d.material }],
      });
      if (spec.state === 'delivered') return;

      clock += 2 * DAY;
      orders.transition(row.id, ['delivered'], 'completed', { by: customer.id, type: 'completed', set: { completed_at: clock } });
    });
    created++;
  }
  return { created };
}
