import type { Room } from '../types';
import { hasCountertop, isOpening } from '../data/catalog';
import {
  alongWall,
  boxGap,
  findOverlaps,
  clearToWall,
  flushSeg,
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

/** The middle of an item's front face: where a cook stands to use it. */
export function frontCenter(r: Resolved): [number, number] {
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
  // Bathroom fixtures have their own clearances (bathChecks), not the kitchen's 42″ work aisle.
  const BATH = new Set(['vanity', 'toilet', 'tub', 'shower', 'mirror']);
  const floor = all.filter((r) => isFloorMass(r) && !BATH.has(r.product.kind));
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
    const walls: [string, number, AABB][] = [];
    for (const dir of ['north', 'south', 'west', 'east'] as const) {
      const hit = clearToWall(room, b, dir);
      if (!hit) continue;
      const zone: AABB =
        dir === 'north' ? { minX: b.minX, maxX: b.maxX, minY: b.minY - hit.gap, maxY: b.minY }
        : dir === 'south' ? { minX: b.minX, maxX: b.maxX, minY: b.maxY, maxY: b.maxY + hit.gap }
        : dir === 'west' ? { minX: b.minX - hit.gap, maxX: b.minX, minY: b.minY, maxY: b.maxY }
        : { minX: b.maxX, maxX: b.maxX + hit.gap, minY: b.minY, maxY: b.maxY };
      walls.push([dir, hit.gap, zone]);
    }
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

  // Work triangle between the sink, the cooktop and the fridge: the best of every combination,
  // so a second sink or fridge never makes a good kitchen look bad because of list order.
  const best = bestTriangle(all, room);
  let triangle: Triangle | null = null;
  if (best) {
    const { sink, cook, fridge, legs, total, oneWall, ok } = best;
    const pts = [frontCenter(sink), frontCenter(cook), frontCenter(fridge)];
    const sorted = [...legs].sort((a, b) => a - b);
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
    const sink = all.some((r) => r.product.kind === 'sink');
    const cook = all.some((r) => r.product.kind === 'range' || r.product.kind === 'oven-tower');
    const fridge = all.some((r) => r.product.kind === 'fridge');
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
    const cover = hoodCoverage(range, all);
    const vent = cover?.vent;
    if (!cover || !vent) {
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
    } else if (cover.covered + 0.5 < range.w) {
      checks.push({
        id: `vent-offset-${range.item.id}`,
        level: 'warn',
        title: `Hood is off-centre over the ${label(range)}`,
        detail: `It covers ${feetInches(cover.covered)} of the ${feetInches(range.w)} cooktop. Slide it along the wall until it spans the whole range.`,
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
    const land = landingWidths(range, all, room);
    if (!land) {
      checks.push({
        id: `landing-range-${range.item.id}`,
        level: 'info',
        title: `${label(range)} isn’t against a wall`,
        detail: 'Its landing counter can’t be measured. Leave at least 12″ of counter on one side and 15″ on the other.',
        itemIds: [range.item.id],
      });
    } else {
      const small = Math.min(land.start, land.end);
      const big = Math.max(land.start, land.end);
      if (small < 12 || big < 15) {
        const what =
          big < 1 ? 'no counter on either side' : small < 1 ? `counter on one side only (${feetInches(big)})` : `only ${feetInches(small)} and ${feetInches(big)} of counter beside it`;
        checks.push({
          id: `landing-range-${range.item.id}`,
          level: 'warn',
          title: `${label(range)} has ${what}`,
          detail: 'Leave at least 12″ of counter on one side and 15″ on the other to set down hot pans.',
          itemIds: [range.item.id],
        });
      }
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
    const island = all.find((r) => r.product.kind === 'island' && boxGap(r.box, f.box) <= 48);
    if (island) continue;
    const land = landingWidths(f, all, room);
    if (!land) {
      checks.push({
        id: `landing-fridge-${f.item.id}`,
        level: 'info',
        title: 'The fridge isn’t against a wall',
        detail: 'Its landing counter can’t be measured. Keep at least 15″ of counter beside it, or an island within 48″.',
        itemIds: [f.item.id],
      });
    } else if (Math.max(land.start, land.end) < 15) {
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

  bathChecks(all, room, checks, problemIds);
  fridgeChecks(all, room, checks, problemIds);

  const order: Record<CheckLevel, number> = { bad: 0, warn: 1, info: 2, ok: 3 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return { checks, problemIds, triangle, tightAisles };
}

/** An item's extent along its own wall axis: x when it faces north/south, y when east/west. */
export function alongAxis(r: Resolved): [number, number] {
  return r.item.rotation === 90 || r.item.rotation === 270 ? [r.box.minY, r.box.maxY] : [r.box.minX, r.box.maxX];
}

/** An item's extent across its wall axis (depth into the room). */
export function acrossAxis(r: Resolved): [number, number] {
  return r.item.rotation === 90 || r.item.rotation === 270 ? [r.box.minX, r.box.maxX] : [r.box.minY, r.box.maxY];
}

/**
 * The hood (or over-the-range microwave) above a range, and how many inches of the cooktop it
 * covers, measured along the range's own wall axis (x on north/south walls, y on east/west; the
 * old check always used x, so it passed hoods that missed a range on an east or west wall).
 * A vent counts once it covers at least half the cooktop; null when nothing does.
 */
export function hoodCoverage(range: Resolved, all: Resolved[]): { vent: Resolved; covered: number } | null {
  const swap = range.item.rotation === 90 || range.item.rotation === 270;
  const [r0, r1] = alongAxis(range);
  const [c0, c1] = acrossAxis(range);
  let best: { vent: Resolved; covered: number } | null = null;
  for (const o of all) {
    if (o === range || (o.product.kind !== 'hood' && o.product.kind !== 'microwave')) continue;
    if (o.z0 < range.z1 - 0.5) continue;
    const [o0, o1] = swap ? [o.box.minY, o.box.maxY] : [o.box.minX, o.box.maxX];
    const [p0, p1] = swap ? [o.box.minX, o.box.maxX] : [o.box.minY, o.box.maxY];
    if (overlap1D(c0, c1, p0, p1) <= 0) continue;
    const covered = Math.max(0, overlap1D(r0, r1, o0, o1));
    if (covered <= range.w * 0.5 - 0.1) continue;
    if (!best || covered > best.covered) best = { vent: o, covered };
  }
  return best;
}

/**
 * Inches of continuous countertop on each side of an item on a wall (`start` is towards the
 * wall's west/north end). Walks across touching counter pieces on the same wall (and corner
 * cabinets), stops at a gap, a tall unit or a sink, and caps at 48″. Null when the item isn't
 * flush to a wall, so callers report that instead of passing it.
 */
export function landingWidths(r: Resolved, all: Resolved[], room: Room): { start: number; end: number } | null {
  const seg = flushSeg(r, room);
  if (!seg) return null;
  const wall = seg.wall;
  const counters = all
    .filter((o) => o !== r && hasCountertop(o.product) && o.product.kind !== 'island' && (flushSeg(o, room)?.id === seg.id || o.product.kind === 'corner'))
    .map((o) => ({ o, span: alongWall(wall, o.box) }));
  const [s, e] = alongWall(wall, r.box);
  const walk = (edge: number, dir: -1 | 1) => {
    let total = 0;
    let at = edge;
    const seen = new Set<Resolved>();
    while (total < 48) {
      const next = counters.find(({ o, span: [os, oe] }) => !seen.has(o) && oe - os > 1 && (dir < 0 ? Math.abs(oe - at) <= 1.5 : Math.abs(os - at) <= 1.5));
      if (!next || next.o.product.kind === 'sink') break;
      seen.add(next.o);
      total += next.span[1] - next.span[0];
      at = dir < 0 ? next.span[0] : next.span[1];
    }
    return Math.min(48, total);
  };
  return { start: walk(s, -1), end: walk(e, 1) };
}

export interface TriangleChoice {
  sink: Resolved;
  cook: Resolved;
  fridge: Resolved;
  /** sink → cooktop, cooktop → fridge, fridge → sink. */
  legs: number[];
  total: number;
  oneWall: boolean;
  ok: boolean;
}

/**
 * The best sink / cooktop / fridge triangle among every combination in the kitchen: a passing
 * triangle beats a failing one, then the shortest total wins. Prep sinks and oven towers only
 * stand in when there is no main sink or range. Independent of item order.
 */
export function bestTriangle(all: Resolved[], room: Room): TriangleChoice | null {
  const mainSinks = all.filter((r) => r.product.kind === 'sink' && r.product.variant !== 'prep');
  const sinks = mainSinks.length ? mainSinks : all.filter((r) => r.product.kind === 'sink');
  const ranges = all.filter((r) => r.product.kind === 'range');
  const cooks = ranges.length ? ranges : all.filter((r) => r.product.kind === 'oven-tower');
  const fridges = all.filter((r) => r.product.kind === 'fridge');
  let best: TriangleChoice | null = null;
  for (const sink of sinks) {
    for (const cook of cooks) {
      for (const fridge of fridges) {
        const pts = [frontCenter(sink), frontCenter(cook), frontCenter(fridge)];
        const legs = [0, 1, 2].map((i) => {
          const [x0, y0] = pts[i];
          const [x1, y1] = pts[(i + 1) % 3];
          return Math.hypot(x1 - x0, y1 - y0);
        });
        const total = legs.reduce((s, l) => s + l, 0);
        const walls = [sink, cook, fridge].map((r) => flushSeg(r, room)?.id ?? null);
        const oneWall = walls[0] !== null && walls.every((w) => w === walls[0]);
        const sorted = [...legs].sort((a, b) => a - b);
        const ok = oneWall ? sorted[0] >= 36 && sorted[1] >= 36 && total <= 312 : legs.every((l) => l >= 48 && l <= 108) && total <= 312;
        if (!best || (ok && !best.ok) || (ok === best.ok && total < best.total - 1e-6)) best = { sink, cook, fridge, legs, total, oneWall, ok };
      }
    }
  }
  return best;
}

export interface FacingGap {
  gap: number;
  p0: [number, number];
  p1: [number, number];
  /** The empty floor between the two faces. */
  zone: AABB;
}

export function facingGap(a: Resolved, b: Resolved): FacingGap | null {
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

type Dir4 = 'north' | 'south' | 'east' | 'west';

/** Clear distance from a face of `r` in direction `dir` to the nearest wall or floor-standing piece, over its span lo..hi. */
function clearFrom(all: Resolved[], room: Room, r: Resolved, dir: Dir4, lo: number, hi: number): number {
  const solid = (o: Resolved) => isFloorMass(o) || o.product.kind === 'toilet' || o.product.kind === 'tub';
  const b = r.box;
  let best = clearToWall(room, b, dir)?.gap ?? Infinity;
  for (const o of all) {
    if (o === r || !solid(o)) continue;
    const ob = o.box;
    const horizontal = dir === 'east' || dir === 'west';
    if ((horizontal ? overlap1D(lo, hi, ob.minY, ob.maxY) : overlap1D(lo, hi, ob.minX, ob.maxX)) <= 0.5) continue;
    const gap = dir === 'east' ? ob.minX - b.maxX : dir === 'west' ? b.minX - ob.maxX : dir === 'south' ? ob.minY - b.maxY : b.minY - ob.maxY;
    if (gap > -0.5 && gap < best) best = Math.max(0, gap);
  }
  return best;
}

const FRONT_DIR: Record<number, Dir4> = { 0: 'south', 90: 'west', 180: 'north', 270: 'east' };

/**
 * A fridge needs room to open: about 36″ clear in front for the doors and the person at them, and
 * (the classic miss) a 2–3″ filler between its hinge side and a side wall, or the door stops at 90°
 * and the crisper drawers can't come out.
 */
function fridgeChecks(all: Resolved[], room: Room, checks: Check[], problemIds: Set<string>) {
  for (const f of all.filter((r) => r.product.kind === 'fridge')) {
    const b = f.box;
    const fd = FRONT_DIR[f.item.rotation];
    const along = fd === 'south' || fd === 'north' ? [b.minX, b.maxX] : [b.minY, b.maxY];
    const front = clearFrom(all, room, f, fd, along[0], along[1]);
    if (front < 30) {
      problemIds.add(f.item.id);
      checks.push({ id: `fridge-front-${f.item.id}`, level: 'bad', title: `Only ${feetInches(front)} in front of the fridge`, detail: 'The doors need about 30″ to swing open, and 36″ leaves room to stand at them.', itemIds: [f.item.id] });
    } else if (front < 36) {
      checks.push({ id: `fridge-front-${f.item.id}`, level: 'warn', title: `${feetInches(front)} in front of the fridge`, detail: 'The doors open, but 36″ leaves room to stand at them with the doors wide.', itemIds: [f.item.id] });
    }
    // A side tight against a wall: the door on that side can't open past 90°.
    const sides: Dir4[] = fd === 'south' || fd === 'north' ? ['west', 'east'] : ['north', 'south'];
    for (const sd of sides) {
      const toWall = clearToWall(room, b, sd);
      if (toWall && toWall.gap < 1.5) {
        checks.push({ id: `fridge-side-${f.item.id}-${sd}`, level: 'warn', title: 'The fridge is tight against a side wall', detail: 'Leave a 2–3″ filler between the fridge and the wall so its door opens past 90° and the crisper drawers come out.', itemIds: [f.item.id] });
        break;
      }
    }
  }
}

/**
 * Bathroom clearances, from the building code and the NKBA bathroom guidelines: a toilet needs 15″
 * from its centre to a wall or the next fixture (18″ recommended) and 21″ clear in front (30″
 * recommended); a vanity needs 21″ clear in front (30″ recommended); a shower must be at least 30″
 * × 30″ inside (36″ × 36″ recommended).
 */
function bathChecks(all: Resolved[], room: Room, checks: Check[], problemIds: Set<string>) {
  const clear = (r: Resolved, dir: Dir4, lo: number, hi: number) => clearFrom(all, room, r, dir, lo, hi);
  const frontDir = (r: Resolved) => (({ 0: 'south', 90: 'west', 180: 'north', 270: 'east' } as const)[r.item.rotation]);
  const sides = (r: Resolved): ['north' | 'south' | 'east' | 'west', 'north' | 'south' | 'east' | 'west'] => (r.item.rotation === 0 || r.item.rotation === 180 ? ['west', 'east'] : ['north', 'south']);

  for (const t of all.filter((r) => r.product.kind === 'toilet')) {
    const b = t.box;
    const fd = frontDir(t);
    const along = fd === 'south' || fd === 'north' ? [b.minX, b.maxX] : [b.minY, b.maxY];
    const front = clear(t, fd, along[0], along[1]);
    // Side clearance is measured from the toilet's centre line: half its width plus the gap.
    const [s1, s2] = sides(t);
    const across = s1 === 'west' ? [b.minY, b.maxY] : [b.minX, b.maxX];
    const half = t.w / 2;
    const side = Math.min(clear(t, s1, across[0], across[1]), clear(t, s2, across[0], across[1])) + half;
    if (side < 15) {
      problemIds.add(t.item.id);
      checks.push({ id: `wc-side-${t.item.id}`, level: 'bad', title: `Only ${feetInches(side)} from the toilet's centre to the side`, detail: 'The building code needs 15″ from the centre of a toilet to a wall or the next fixture; 18″ is comfortable.', itemIds: [t.item.id] });
    } else if (side < 18) {
      checks.push({ id: `wc-side-${t.item.id}`, level: 'warn', title: `${feetInches(side)} from the toilet's centre to the side`, detail: 'Meets the 15″ code minimum; 18″ is the recommended comfort clearance.', itemIds: [t.item.id] });
    }
    if (front < 21) {
      problemIds.add(t.item.id);
      checks.push({ id: `wc-front-${t.item.id}`, level: 'bad', title: `Only ${feetInches(front)} clear in front of the toilet`, detail: 'The building code needs 21″ of clear floor in front of a toilet; 30″ is recommended.', itemIds: [t.item.id] });
    } else if (front < 30) {
      checks.push({ id: `wc-front-${t.item.id}`, level: 'warn', title: `${feetInches(front)} clear in front of the toilet`, detail: 'Meets the 21″ code minimum; 30″ is the recommended clearance.', itemIds: [t.item.id] });
    }
  }

  for (const v of all.filter((r) => r.product.kind === 'vanity')) {
    const b = v.box;
    const fd = frontDir(v);
    const along = fd === 'south' || fd === 'north' ? [b.minX, b.maxX] : [b.minY, b.maxY];
    const front = clear(v, fd, along[0], along[1]);
    if (front < 21) {
      problemIds.add(v.item.id);
      checks.push({ id: `vanity-front-${v.item.id}`, level: 'bad', title: `Only ${feetInches(front)} in front of the vanity`, detail: 'Leave at least 21″ of clear floor in front of a vanity to stand at it; 30″ is recommended.', itemIds: [v.item.id] });
    }
  }

  for (const sh of all.filter((r) => r.product.kind === 'shower')) {
    const inside = Math.min(sh.w, sh.d) - 2;
    if (inside < 30) {
      problemIds.add(sh.item.id);
      checks.push({ id: `shower-size-${sh.item.id}`, level: 'bad', title: `The shower is only ${feetInches(inside)} across inside`, detail: 'A shower must be at least 30″ × 30″ inside; 36″ × 36″ is the comfortable minimum.', itemIds: [sh.item.id] });
    } else if (inside < 34) {
      checks.push({ id: `shower-size-${sh.item.id}`, level: 'warn', title: `A tight ${feetInches(inside)} shower`, detail: 'Above the 30″ minimum, but 36″ × 36″ is the comfortable size.', itemIds: [sh.item.id] });
    }
  }
}
