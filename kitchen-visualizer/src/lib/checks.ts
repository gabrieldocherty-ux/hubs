import type { Room } from '../types';
import { hasCountertop, isOpening } from '../data/catalog';
import {
  alongWall,
  boxGap,
  findOverlaps,
  flushWall,
  frontVector,
  outsideRoom,
  overlap1D,
  type AABB,
  type Resolved,
} from './geometry';
import { feetInches } from './format';

export type CheckLevel = 'ok' | 'warn' | 'bad' | 'info';

export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  itemIds: string[];
}

export interface Triangle {
  points: [number, number][];
  legs: number[];
  total: number;
  ok: boolean;
}

export interface CheckReport {
  checks: Check[];
  problemIds: Set<string>;
  triangle: Triangle | null;
  tightAisles: { a: [number, number]; b: [number, number]; gap: number; level: CheckLevel }[];
}

const AISLE_MIN = 36;
const AISLE_GOOD = 42;

function label(r: Resolved) {
  return r.product.name.replace(/ \d+″$/, '');
}

function frontCenter(r: Resolved): [number, number] {
  const [fx, fy] = frontVector(r.item.rotation);
  return [r.item.x + (fx * r.d) / 2, r.item.y + (fy * r.d) / 2];
}

const isFloorMass = (r: Resolved) =>
  r.z0 < 30 && r.product.heightIn > 20 && !['stool', 'chair', 'rug', 'plant', 'pendant'].includes(r.product.kind) && !isOpening(r.product);
const isFreestanding = (r: Resolved) => r.product.kind === 'island' || r.product.kind === 'table';

export function runChecks(all: Resolved[], room: Room): CheckReport {
  const checks: Check[] = [];
  const problemIds = new Set<string>();
  const tightAisles: CheckReport['tightAisles'] = [];

  for (const [a, b] of findOverlaps(all)) {
    problemIds.add(a.item.id);
    problemIds.add(b.item.id);
    checks.push({
      id: `overlap-${a.item.id}-${b.item.id}`,
      level: 'bad',
      title: `${label(a)} collides with ${label(b)}`,
      detail: 'They occupy the same space at the same height. Slide one along the wall or change its width.',
      itemIds: [a.item.id, b.item.id],
    });
  }

  for (const r of all) {
    if (outsideRoom(r, room)) {
      problemIds.add(r.item.id);
      checks.push({
        id: `outside-${r.item.id}`,
        level: 'bad',
        title: `${label(r)} pokes through a wall`,
        detail: 'Part of it sits outside the room. The room may have shrunk since it was placed.',
        itemIds: [r.item.id],
      });
    }
  }

  // Work aisles: anything whose front faces something else, and islands/tables on every side.
  const floor = all.filter(isFloorMass);
  let aislePairs = 0;
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      const a = floor[i];
      const b = floor[j];
      const res = facingGap(a, b);
      if (!res) continue;
      const blocked = floor.some(
        (o) => o !== a && o !== b && overlap1D(o.box.minX, o.box.maxX, res.zone.minX, res.zone.maxX) > 0.5 && overlap1D(o.box.minY, o.box.maxY, res.zone.minY, res.zone.maxY) > 0.5,
      );
      if (blocked) continue;
      aislePairs++;
      if (res.gap >= AISLE_GOOD) continue;
      const level: CheckLevel = res.gap < AISLE_MIN ? 'bad' : 'warn';
      tightAisles.push({ a: res.p0, b: res.p1, gap: res.gap, level });
      checks.push({
        id: `aisle-${a.item.id}-${b.item.id}`,
        level,
        title: `${feetInches(res.gap)} aisle between ${label(a)} and ${label(b)}`,
        detail:
          level === 'bad'
            ? `Under the 36″ minimum. Doors and drawers won't open with someone standing there.`
            : `Workable for one cook; 42″ is the recommended work aisle, 48″ for two.`,
        itemIds: [a.item.id, b.item.id],
      });
    }
  }
  for (const r of floor.filter(isFreestanding)) {
    const b = r.box;
    const walls: [string, number, AABB][] = [
      ['north', b.minY, { minX: b.minX, maxX: b.maxX, minY: 0, maxY: b.minY }],
      ['south', room.lengthIn - b.maxY, { minX: b.minX, maxX: b.maxX, minY: b.maxY, maxY: room.lengthIn }],
      ['west', b.minX, { minX: 0, maxX: b.minX, minY: b.minY, maxY: b.maxY }],
      ['east', room.widthIn - b.maxX, { minX: b.maxX, maxX: room.widthIn, minY: b.minY, maxY: b.maxY }],
    ];
    for (const [name, gap, zone] of walls) {
      if (gap >= AISLE_MIN || gap < 0) continue;
      const blocked = floor.some(
        (o) => o !== r && overlap1D(o.box.minX, o.box.maxX, zone.minX, zone.maxX) > 1 && overlap1D(o.box.minY, o.box.maxY, zone.minY, zone.maxY) > 1,
      );
      if (blocked) continue;
      problemIds.add(r.item.id);
      checks.push({
        id: `wallgap-${r.item.id}-${name}`,
        level: 'bad',
        title: `Only ${feetInches(gap)} between ${label(r)} and the ${name} wall`,
        detail: 'A walkway needs at least 36″ to pass comfortably.',
        itemIds: [r.item.id],
      });
    }
  }
  if (aislePairs > 0 && !tightAisles.length) {
    checks.push({
      id: 'aisles-ok',
      level: 'ok',
      title: 'Work aisles are 42″ or wider',
      detail: 'Room for a cook to open the dishwasher and oven without a shuffle.',
      itemIds: [],
    });
  }

  // Work triangle between the sink, the cooktop and the fridge.
  const sink = all.find((r) => r.product.kind === 'sink' && r.product.variant !== 'prep') ?? all.find((r) => r.product.kind === 'sink');
  const cook = all.find((r) => r.product.kind === 'range') ?? all.find((r) => r.product.kind === 'oven-tower');
  const fridge = all.find((r) => r.product.kind === 'fridge');
  let triangle: Triangle | null = null;
  if (sink && cook && fridge) {
    const pts = [frontCenter(sink), frontCenter(cook), frontCenter(fridge)];
    const legs = [0, 1, 2].map((i) => {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % 3];
      return Math.hypot(x1 - x0, y1 - y0);
    });
    const total = legs.reduce((s, l) => s + l, 0);
    const walls = [sink, cook, fridge].map((r) => flushWall(r, room));
    const oneWall = walls[0] !== null && walls.every((w) => w === walls[0]);
    const sorted = [...legs].sort((a, b) => a - b);
    const ok = oneWall ? sorted[0] >= 36 && sorted[1] >= 36 && total <= 312 : legs.every((l) => l >= 48 && l <= 108) && total <= 312;
    triangle = { points: pts, legs, total, ok };
    const names = ['sink → cooktop', 'cooktop → fridge', 'fridge → sink'];
    const legText = legs.map((l, i) => `${names[i]} ${feetInches(l)}`).join(' · ');
    const ids = [sink.item.id, cook.item.id, fridge.item.id];
    if (oneWall) {
      checks.push({
        id: 'triangle',
        level: ok ? 'ok' : 'warn',
        title: ok ? `One-wall workflow, ${feetInches(sorted[2])} end to end` : `One-wall run is stretched`,
        detail: ok
          ? 'All three stations share a wall, so the "triangle" is a line. Keeping it under 13′ end to end is what matters.'
          : 'With everything on one wall, keep sink, cooktop and fridge within 13′ and at least 3′ apart.',
        itemIds: ids,
      });
    } else {
      checks.push({
        id: 'triangle',
        level: ok ? 'ok' : 'warn',
        title: ok ? `Work triangle ${feetInches(total)}, well balanced` : `Work triangle ${feetInches(total)} needs attention`,
        detail: ok
          ? `${legText}. Each leg sits in the 4–9′ sweet spot and the total is under 26′.`
          : `${legText}. Aim for legs of 4–9′ and a total under 26′ so you're not sprinting between stations.`,
        itemIds: ids,
      });
    }
  } else {
    const missing = [!sink && 'a sink', !cook && 'a range', !fridge && 'a fridge'].filter(Boolean).join(', ');
    checks.push({
      id: 'triangle-missing',
      level: 'info',
      title: 'Work triangle',
      detail: `Add ${missing} to measure the sink–cooktop–fridge triangle.`,
      itemIds: [],
    });
  }

  for (const range of all.filter((r) => r.product.kind === 'range')) {
    const vent = all.find(
      (o) =>
        (o.product.kind === 'hood' || o.product.kind === 'microwave') &&
        overlap1D(range.box.minX, range.box.maxX, o.box.minX, o.box.maxX) > range.w * 0.5 - 0.1 &&
        overlap1D(range.box.minY, range.box.maxY, o.box.minY, o.box.maxY) > 0,
    );
    if (!vent) {
      checks.push({
        id: `vent-${range.item.id}`,
        level: 'warn',
        title: `${label(range)} has no hood`,
        detail: 'Add a hood (or an over-the-range microwave) above it to pull out smoke and grease.',
        itemIds: [range.item.id],
      });
    } else if (vent.w + 0.1 < range.w) {
      checks.push({
        id: `vent-narrow-${range.item.id}`,
        level: 'warn',
        title: `Hood is narrower than the ${label(range)}`,
        detail: `A ${vent.w}″ hood over a ${range.w}″ range lets smoke escape at the edges. Match or exceed the range width.`,
        itemIds: [range.item.id, vent.item.id],
      });
    } else {
      checks.push({
        id: `vent-ok-${range.item.id}`,
        level: 'ok',
        title: `Ventilation covers the ${label(range)}`,
        detail: `${vent.product.name} spans the full cooktop.`,
        itemIds: [range.item.id, vent.item.id],
      });
    }
    const sides = landingSides(range, all, room);
    if (sides < 2) {
      checks.push({
        id: `landing-range-${range.item.id}`,
        level: 'warn',
        title: `${label(range)} is missing counter on ${sides === 0 ? 'both sides' : 'one side'}`,
        detail: 'Leave at least 12″ of counter on one side and 15″ on the other to set down hot pans.',
        itemIds: [range.item.id],
      });
    }
  }

  for (const dw of all.filter((r) => r.product.kind === 'dishwasher')) {
    const sinks = all.filter((r) => r.product.kind === 'sink');
    if (!sinks.length) continue;
    const gap = Math.min(...sinks.map((s) => boxGap(dw.box, s.box)));
    if (gap > 36) {
      checks.push({
        id: `dw-${dw.item.id}`,
        level: 'warn',
        title: `Dishwasher is ${feetInches(gap)} from the sink`,
        detail: 'Keep it within 36″ of the sink so rinsed plates don\'t drip across the floor.',
        itemIds: [dw.item.id],
      });
    }
  }

  for (const f of all.filter((r) => r.product.kind === 'fridge')) {
    if (landingSides(f, all, room) === 0) {
      const island = all.find((r) => r.product.kind === 'island' && boxGap(r.box, f.box) <= 48);
      if (island) continue;
      checks.push({
        id: `landing-fridge-${f.item.id}`,
        level: 'warn',
        title: 'Nowhere to set groceries by the fridge',
        detail: 'Put at least 15″ of counter beside the fridge, or an island within 48″.',
        itemIds: [f.item.id],
      });
    }
  }

  for (const door of all.filter((r) => r.product.kind === 'door' && r.product.variant !== 'opening')) {
    const swing = doorSwingBox(door);
    const hit = all.find((o) => o !== door && isFloorMass(o) && overlap1D(o.box.minX, o.box.maxX, swing.minX, swing.maxX) > 1 && overlap1D(o.box.minY, o.box.maxY, swing.minY, swing.maxY) > 1);
    if (hit) {
      problemIds.add(door.item.id);
      checks.push({
        id: `swing-${door.item.id}`,
        level: 'bad',
        title: `Door swings into the ${label(hit)}`,
        detail: 'Move the door, flip its hinge side, or use a cased opening instead.',
        itemIds: [door.item.id, hit.item.id],
      });
    }
  }

  const order: Record<CheckLevel, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return { checks, problemIds, triangle, tightAisles };
}

/** How many sides (0–2) of an item on a wall have countertop directly beside it. */
function landingSides(r: Resolved, all: Resolved[], room: Room): number {
  const wall = flushWall(r, room);
  if (!wall) return 2;
  const [s, e] = alongWall(wall, r.box);
  let left = false;
  let right = false;
  for (const o of all) {
    if (o === r || !hasCountertop(o.product)) continue;
    if (flushWall(o, room) !== wall && o.product.kind !== 'corner') continue;
    const [os, oe] = alongWall(wall, o.box);
    if (Math.abs(oe - s) <= 1.5 && oe - os >= 9) left = true;
    if (Math.abs(os - e) <= 1.5 && oe - os >= 9) right = true;
  }
  return Number(left) + Number(right);
}

interface FacingGap {
  gap: number;
  p0: [number, number];
  p1: [number, number];
  /** The empty floor between the two faces. */
  zone: AABB;
}

function facingGap(a: Resolved, b: Resolved): FacingGap | null {
  const A = a.box;
  const B = b.box;
  const ox = overlap1D(A.minX, A.maxX, B.minX, B.maxX);
  const oy = overlap1D(A.minY, A.maxY, B.minY, B.maxY);
  let dir: [number, number] | null = null;
  let gap = 0;
  let p0: [number, number] = [0, 0];
  let p1: [number, number] = [0, 0];
  let zone: AABB = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  if (ox > 6 && oy <= 0) {
    const x0 = Math.max(A.minX, B.minX);
    const x1 = Math.min(A.maxX, B.maxX);
    const mx = (x0 + x1) / 2;
    if (A.maxY <= B.minY) {
      dir = [0, 1];
      gap = B.minY - A.maxY;
      p0 = [mx, A.maxY];
      p1 = [mx, B.minY];
    } else {
      dir = [0, -1];
      gap = A.minY - B.maxY;
      p0 = [mx, A.minY];
      p1 = [mx, B.maxY];
    }
    zone = { minX: x0, maxX: x1, minY: Math.min(p0[1], p1[1]), maxY: Math.max(p0[1], p1[1]) };
  } else if (oy > 6 && ox <= 0) {
    const y0 = Math.max(A.minY, B.minY);
    const y1 = Math.min(A.maxY, B.maxY);
    const my = (y0 + y1) / 2;
    if (A.maxX <= B.minX) {
      dir = [1, 0];
      gap = B.minX - A.maxX;
      p0 = [A.maxX, my];
      p1 = [B.minX, my];
    } else {
      dir = [-1, 0];
      gap = A.minX - B.maxX;
      p0 = [A.minX, my];
      p1 = [B.maxX, my];
    }
    zone = { minX: Math.min(p0[0], p1[0]), maxX: Math.max(p0[0], p1[0]), minY: y0, maxY: y1 };
  }
  if (!dir || gap <= 0.5 || gap > 72) return null;
  const fa = frontVector(a.item.rotation);
  const fb = frontVector(b.item.rotation);
  const aFaces = isFreestanding(a) || (fa[0] === dir[0] && fa[1] === dir[1]);
  const bFaces = isFreestanding(b) || (fb[0] === -dir[0] && fb[1] === -dir[1]);
  if (!aFaces && !bFaces) return null;
  return { gap, p0, p1, zone };
}

/** The square a hinged door sweeps into the room. */
export function doorSwingBox(r: Resolved): AABB {
  const [fx, fy] = frontVector(r.item.rotation);
  const reach = r.product.variant === 'double' ? r.w / 2 : r.w;
  const cx = r.item.x + (fx * reach) / 2;
  const cy = r.item.y + (fy * reach) / 2;
  const hx = fx !== 0 ? reach / 2 : r.w / 2;
  const hy = fy !== 0 ? reach / 2 : r.w / 2;
  return { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy };
}
