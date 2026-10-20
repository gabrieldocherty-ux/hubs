/**
 * The scope of work: what each trade does to build the design, with quantities, in the order the
 * work happens on site. Taken from the design itself (what is placed, the room, the finishes) and
 * from the estimate (areas and runs it already measured), so the two always agree. A planning list
 * for the company's conversation with the homeowner, not a permit drawing.
 */
import type { DesignDoc } from '../types';
import type { Estimate } from './estimate';
import { resolveAll } from './geometry';
import { EDGE_STYLES, floorSqFt, wallSegs } from './outline';
import { feetInches } from './format';
import { WALL_PANELS } from './wallFinish';

export interface ScopeTask {
  text: string;
  /** "12", "86 sq ft", "24 lin ft"; absent for a task without a count. */
  qty?: string;
}

export interface ScopeTrade {
  id: 'prep' | 'framing' | 'plumbing' | 'electrical' | 'drywall' | 'flooring' | 'cabinets' | 'counters' | 'tile' | 'finish' | 'appliances';
  trade: string;
  tasks: ScopeTask[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function scopeOfWork(doc: DesignDoc, est: Estimate): ScopeTrade[] {
  const all = resolveAll(doc.items);
  const count = (pred: (k: string, v: string | undefined, id: string) => boolean) => all.filter((r) => pred(r.product.kind, r.product.variant, r.product.id)).length;
  const line = (key: string) => est.lines.find((l) => l.key === key);
  const lines = (pre: string) => est.lines.filter((l) => l.key === pre || l.key.startsWith(`${pre}:`));
  const q = (l: { qty: number; unit: string } | undefined) => (l ? `${l.qty} ${l.unit}` : undefined);
  const trades: ScopeTrade[] = [];
  const add = (id: ScopeTrade['id'], trade: string, tasks: (ScopeTask | false | null | undefined)[]) => {
    const t = tasks.filter((x): x is ScopeTask => !!x);
    if (t.length) trades.push({ id, trade, tasks: t });
  };

  const sq = floorSqFt(doc.room);
  const cabinets = count((k) => ['base', 'corner', 'wall', 'tall', 'oven-tower', 'island', 'shelf', 'sink'].includes(k));
  add('prep', 'Demolition and protection', [
    { text: 'Protect the floors and rooms next to the work; dust walls and floor protection', qty: `${sq} sq ft` },
    cabinets > 0 && { text: 'Remove the existing cabinets, countertops and backsplash' },
    { text: 'Remove the existing flooring down to the subfloor', qty: `${sq} sq ft` },
    { text: 'Haul away and dispose of the debris' },
  ]);

  // New walls and openings: what the plan changes about the room's walls.
  const styled = wallSegs(doc.room).filter((s) => s.style !== 'wall');
  const byStyle = new Map<string, number>();
  for (const s of styled) byStyle.set(s.style, (byStyle.get(s.style) ?? 0) + (s.a1 - s.a0));
  const doorways = count((k, v, id) => k === 'door' && (v === 'opening' || id === 'walkway'));
  const doors = count((k, v) => k === 'door' && v !== 'opening');
  const windows = count((k) => k === 'window');
  add('framing', 'Framing and openings', [
    ...[...byStyle].map(([style, len]) => ({ text: `${EDGE_STYLES[style as keyof typeof EDGE_STYLES]?.label ?? style}`, qty: feetInches(len) })),
    doorways > 0 && { text: 'Frame and case open walkways and doorways (check for load-bearing walls first)', qty: plural(doorways, 'opening') },
    doors > 0 && { text: 'Hang interior doors with casing', qty: plural(doors, 'door') },
    windows > 0 && { text: 'Windows: supply and install, or keep the existing ones', qty: plural(windows, 'window') },
    count((k) => k === 'hood') > 0 && { text: 'Range hood duct run to the outside, with a wall or roof cap' },
  ]);

  const sinks = count((k) => k === 'sink');
  const vanities = count((k) => k === 'vanity');
  const toilets = count((k) => k === 'toilet');
  const tubs = count((k) => k === 'tub');
  const showers = count((k) => k === 'shower');
  const gas = count((k, v) => k === 'range' && v !== 'induction');
  add('plumbing', 'Plumbing and gas', [
    sinks > 0 && { text: 'Rough in and connect the kitchen sink, faucet and drain', qty: plural(sinks, 'sink') },
    count((k) => k === 'dishwasher') > 0 && { text: 'Dishwasher water supply and drain', qty: plural(count((k) => k === 'dishwasher'), 'dishwasher') },
    count((k) => k === 'fridge') > 0 && { text: 'Water line to the fridge for its ice maker and dispenser' },
    gas > 0 && { text: 'Gas line to the range, by a licensed gas fitter', qty: plural(gas, 'range') },
    vanities > 0 && { text: 'Vanity supplies, faucets and drains', qty: plural(vanities, 'vanity', 'vanities') },
    toilets > 0 && { text: 'Toilet flanges and supplies', qty: plural(toilets, 'toilet') },
    tubs + showers > 0 && { text: 'Tub and shower valves, drains and waterproofing', qty: plural(tubs + showers, 'tub or shower', 'tubs and showers') },
  ]);

  const outlets = all.filter((r) => r.product.kind === 'outlet');
  const ov = (v: string) => outlets.filter((r) => r.product.variant === v).length;
  const pots = count((k, v) => k === 'pendant' && v === 'recessed');
  const pendants = count((k, v) => k === 'pendant' && v !== 'recessed');
  const induction = count((k, v) => k === 'range' && v === 'induction');
  add('electrical', 'Electrical', [
    induction > 0 && { text: 'Dedicated 40 A, 240 V circuit for the induction range', qty: plural(induction, 'circuit') },
    gas > 0 && { text: 'A 120 V outlet behind each gas range (igniters and clock)', qty: plural(gas, 'outlet') },
    count((k) => k === 'oven-tower') > 0 && { text: 'Dedicated circuit for each wall oven', qty: plural(count((k) => k === 'oven-tower'), 'oven') },
    count((k) => k === 'dishwasher' || k === 'microwave' || k === 'fridge') > 0 && { text: 'Dedicated circuits for the dishwasher, microwave and fridge', qty: plural(count((k) => k === 'dishwasher' || k === 'microwave' || k === 'fridge'), 'appliance') },
    count((k) => k === 'hood') > 0 && { text: 'Power to the range hood' },
    ov('duplex') + ov('usb') > 0 && { text: 'Counter outlets (within 900 mm of every point along the counter)', qty: plural(ov('duplex') + ov('usb'), 'outlet') },
    ov('gfci') > 0 && { text: 'GFCI outlets near the sinks', qty: plural(ov('gfci'), 'outlet') },
    ov('low') > 0 && { text: 'Wall outlets', qty: plural(ov('low'), 'outlet') },
    ov('switch') + ov('dimmer') > 0 && { text: `Light switches${ov('dimmer') ? ` (${ov('dimmer')} dimmer${ov('dimmer') === 1 ? '' : 's'})` : ''}`, qty: plural(ov('switch') + ov('dimmer'), 'switch', 'switches') },
    pots > 0 && { text: 'Recessed LED pot lights, cut in and wired on a switch', qty: plural(pots, 'light') },
    pendants > 0 && { text: 'Ceiling boxes and wiring for the pendants', qty: plural(pendants, 'pendant') },
    line('ucl') && { text: 'Under-cabinet LED strips, drivers and a switch', qty: q(line('ucl')) },
    { text: 'Permit and inspection by the electrical safety authority' },
  ]);

  add('drywall', 'Drywall and patching', [{ text: 'Patch, tape and sand the walls and ceiling opened for plumbing and wiring; prime' }]);

  add(
    'flooring',
    'Flooring',
    lines('floor').map((l) => ({ text: `${l.label}${l.sub.includes(' · ') ? ` (${l.sub.split(' · ').slice(1).join(' · ')})` : ''}, with underlayment and transitions`, qty: q(l) })),
  );

  const cabs = (pred: (k: string, v?: string) => boolean) => all.filter((r) => pred(r.product.kind, r.product.variant)).length;
  add('cabinets', 'Cabinetry', [
    cabs((k) => k === 'base' || k === 'corner' || k === 'sink') > 0 && { text: 'Base cabinets, levelled and fastened', qty: plural(cabs((k) => k === 'base' || k === 'corner' || k === 'sink'), 'cabinet') },
    cabs((k) => k === 'wall') > 0 && { text: 'Wall cabinets', qty: plural(cabs((k) => k === 'wall'), 'cabinet') },
    cabs((k) => k === 'tall' || k === 'oven-tower') > 0 && { text: 'Tall pantry and oven cabinets', qty: plural(cabs((k) => k === 'tall' || k === 'oven-tower'), 'cabinet') },
    cabs((k) => k === 'island') > 0 && { text: 'Island, anchored to the floor', qty: plural(cabs((k) => k === 'island'), 'island') },
    vanities > 0 && { text: 'Bathroom vanities', qty: plural(vanities, 'vanity', 'vanities') },
    line('hardware') && { text: 'Install the pulls and knobs', qty: q(line('hardware')) },
    line('crown') && { text: 'Crown moulding along the uppers', qty: q(line('crown')) },
  ]);

  add('counters', 'Countertops', [
    line('counter') && { text: `Template, fabricate and install: ${line('counter')!.label}`, qty: q(line('counter')) },
    sinks > 0 && { text: 'Sink cut-outs and faucet holes', qty: plural(sinks, 'sink') },
  ]);

  add('tile', 'Tile', [
    line('splash') && { text: `Backsplash: ${line('splash')!.label}`, qty: q(line('splash')) },
    ...lines('walltile').map((l) => ({ text: `Wall tile, floor to ceiling: ${l.label}`, qty: q(l) })),
    tubs + showers > 0 && { text: 'Tub and shower surrounds' },
  ]);

  add('finish', 'Paint and trim', [
    ...lines('paint').map((l) => ({ text: `${l.sub.startsWith('Feature') ? 'Feature wall' : 'Walls'}: ${l.label}, two coats`, qty: q(l) })),
    { text: 'Ceiling paint' },
    line('baseboard') && { text: 'Baseboard, caulked and painted', qty: q(line('baseboard')) },
    ...lines('panel').map((l) => ({ text: WALL_PANELS.find((p) => `panel:${p.id}` === l.key)?.label ?? l.label, qty: q(l) })),
  ]);

  const apps = all.filter((r) => r.product.category === 'appliances');
  add('appliances', 'Appliances and final connections', [
    apps.length > 0 && { text: `Set and connect: ${[...new Set(apps.map((r) => r.product.name))].join(', ')}`, qty: plural(apps.length, 'appliance') },
    { text: 'Final clean and walk-through with the homeowner' },
  ]);
  return trades;
}
