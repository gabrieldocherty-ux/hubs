import type { PlacedItem, Room, Rotation, Surfaces } from '../types';
import { getProduct, isOpening } from './catalog';
import { WALL_ROTATION, placeOnWall, resolveAll, findOverlaps, outsideRoom, type Wall } from '../lib/geometry';
import { defaultFinishIndex } from '../lib/finish';
import { makeId } from '../lib/id';

export type TemplateId = 'one-wall' | 'galley' | 'l-shape' | 'u-shape' | 'l-island';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  blurb: string;
  minWidth: number;
  minLength: number;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'one-wall', name: 'One Wall', blurb: 'Everything on one run. Great for lofts.', minWidth: 120, minLength: 72 },
  { id: 'galley', name: 'Galley', blurb: 'Two parallel runs, a chef\'s favorite.', minWidth: 96, minLength: 96 },
  { id: 'l-shape', name: 'L-Shape', blurb: 'Open corner layout with a clean triangle.', minWidth: 108, minLength: 96 },
  { id: 'u-shape', name: 'U-Shape', blurb: 'Wraps three walls, maximum counter.', minWidth: 132, minLength: 96 },
  { id: 'l-island', name: 'L + Island', blurb: 'The open-plan classic with seating.', minWidth: 156, minLength: 150 },
];

type Slot = { id: string; width?: number; optional?: boolean } | 'flex';

const BASE_SIZES = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9];
const DRAWER_SIZES = [36, 30, 24, 18, 15, 12];

function item(productId: string, x: number, y: number, rotation: Rotation, surfaces: Surfaces, width?: number, extra?: Partial<PlacedItem>): PlacedItem {
  const product = getProduct(productId)!;
  return {
    id: makeId(),
    productId,
    x,
    y,
    rotation,
    finishIndex: defaultFinishIndex(product, surfaces),
    ...(width && width !== product.widthIn ? { widthIn: width } : {}),
    ...extra,
  };
}

function slotWidth(s: Exclude<Slot, 'flex'>): number {
  return s.width ?? getProduct(s.id)!.widthIn;
}

/**
 * Splits a gap into standard cabinet widths, preferring fewer, larger boxes and
 * avoiding 9–12″ slivers. A drawer stack goes on whichever side touches the range.
 */
function fill(space: number, drawerSide: 'start' | 'end' | null): { id: string; width: number }[] {
  const S = Math.max(0, Math.floor(space));
  const penalty = (w: number) => 1 + (w < 12 ? 3 : 0) + (w < 15 ? 1 : 0);
  const best = new Array<number>(S + 1).fill(Infinity);
  const pick = new Array<number>(S + 1).fill(0);
  best[0] = 0;
  for (let s = 1; s <= S; s++) {
    for (const w of BASE_SIZES) {
      if (w <= s && best[s - w] + penalty(w) < best[s]) {
        best[s] = best[s - w] + penalty(w);
        pick[s] = w;
      }
    }
  }
  let target = 0;
  let bestCost = Infinity;
  for (let s = Math.max(0, S - 8); s <= S; s++) {
    const cost = best[s] + (S - s) * 0.4;
    if (cost < bestCost) {
      bestCost = cost;
      target = s;
    }
  }
  const widths: number[] = [];
  for (let s = target; s > 0; s -= pick[s]) widths.push(pick[s]);
  widths.sort((a, b) => b - a);
  const out = widths.map((w) => ({ id: 'base', width: w }));
  if (drawerSide && out.length) {
    const i = drawerSide === 'start' ? 0 : out.length - 1;
    if (drawerSide === 'end') out.reverse();
    if (DRAWER_SIZES.includes(out[i].width) && out[i].width >= 15) out[i].id = 'drawer-base';
  }
  return out;
}

interface RunOptions {
  window?: boolean;
  uppers?: boolean;
}

function layRun(wall: Wall, start: number, end: number, slots: Slot[], room: Room, surfaces: Surfaces, opts: RunOptions = {}): PlacedItem[] {
  let working = [...slots];
  const fixed = () => working.reduce((s, sl) => s + (sl === 'flex' ? 0 : slotWidth(sl)), 0);
  const avail = end - start;
  while (fixed() > avail) {
    const idx = working.map((s, i) => (s !== 'flex' && s.optional ? i : -1)).filter((i) => i >= 0).pop();
    if (idx === undefined) break;
    working.splice(idx, 1);
  }
  while (fixed() > avail && working.length) {
    const lastFixed = working.map((s, i) => (s !== 'flex' ? i : -1)).filter((i) => i >= 0).pop();
    if (lastFixed === undefined) break;
    working.splice(lastFixed, 1);
  }
  const flexCount = working.filter((s) => s === 'flex').length;
  const hasOptional = () => working.some((s) => s !== 'flex' && s.optional);
  while (flexCount && hasOptional() && (avail - fixed()) / flexCount < 15) {
    const idx = working.map((s, i) => (s !== 'flex' && s.optional ? i : -1)).filter((i) => i >= 0).pop()!;
    working.splice(idx, 1);
  }
  const remaining = Math.max(0, avail - fixed());
  const per = flexCount ? remaining / flexCount : 0;

  const isRange = (n: Slot | undefined) => !!n && n !== 'flex' && getProduct(n.id)?.kind === 'range';
  const seq: { id: string; width: number }[] = [];
  let carry = 0;
  working.forEach((s, i) => {
    if (s === 'flex') {
      const side = isRange(working[i + 1]) ? 'end' : isRange(working[i - 1]) ? 'start' : null;
      const chunk = fill(Math.floor(per + carry), side);
      const used = chunk.reduce((a, c) => a + c.width, 0);
      carry = per + carry - used;
      seq.push(...chunk);
    } else seq.push({ id: s.id, width: slotWidth(s) });
  });

  const rotation = WALL_ROTATION[wall];
  const out: PlacedItem[] = [];
  let cursor = start;
  const placed: { id: string; width: number; along: number }[] = [];
  for (const s of seq) {
    const p = getProduct(s.id)!;
    const along = cursor + s.width / 2;
    const pos = placeOnWall(wall, along, p.depthIn / 2, room);
    const isCorner = p.kind === 'corner';
    out.push(item(s.id, pos.x, pos.y, isCorner ? 0 : rotation, surfaces, s.width));
    placed.push({ id: s.id, width: s.width, along });
    cursor += s.width;
  }

  let windowSpan: [number, number] | null = null;
  if (opts.window) {
    const sink = placed.find((p) => getProduct(p.id)?.kind === 'sink');
    if (sink) {
      const ww = [48, 36, 30, 24].find((w) => w <= sink.width + 6) ?? 24;
      const pos = placeOnWall(wall, sink.along, 0, room);
      out.push(item('window', pos.x, pos.y, rotation, surfaces, ww));
      windowSpan = [sink.along - ww / 2, sink.along + ww / 2];
    }
  }

  if (opts.uppers !== false) {
    for (const p of placed) {
      const prod = getProduct(p.id)!;
      const s0 = p.along - p.width / 2;
      const s1 = p.along + p.width / 2;
      const underWindow = windowSpan && Math.min(s1, windowSpan[1]) - Math.max(s0, windowSpan[0]) > 0;
      if (prod.kind === 'range') {
        const hw = [30, 36, 48].find((w) => w >= p.width) ?? 48;
        const pos = placeOnWall(wall, p.along, 10, room);
        out.push(item('hood-chimney', pos.x, pos.y, rotation, surfaces, hw));
      } else if (prod.kind === 'fridge' && prod.variant === 'french') {
        const pos = placeOnWall(wall, p.along, 12, room);
        out.push(item('bridge', pos.x, pos.y, rotation, surfaces, p.width));
      } else if (['base', 'sink', 'dishwasher', 'wine'].includes(prod.kind) && !underWindow) {
        const pos = placeOnWall(wall, p.along, 6, room);
        out.push(item('wall', pos.x, pos.y, rotation, surfaces, p.width));
      }
    }
  }
  return out;
}

/** Drops anything that collides with an earlier piece or leaves the room, so small rooms degrade gracefully. */
function prune(items: PlacedItem[], room: Room): PlacedItem[] {
  const kept: PlacedItem[] = [];
  for (const it of items) {
    const trial = resolveAll([...kept, it]);
    const me = trial[trial.length - 1];
    if (!me || outsideRoom(me, room)) continue;
    const clash = findOverlaps(trial).some(([a, b]) => a === me || b === me);
    if (clash) continue;
    kept.push(it);
  }
  return kept;
}

export function buildTemplate(id: TemplateId, room: Room, surfaces: Surfaces): { items: PlacedItem[]; note?: string } {
  const info = TEMPLATES.find((t) => t.id === id)!;
  if (room.widthIn < info.minWidth || room.lengthIn < info.minLength) {
    return {
      items: [],
      note: `${info.name} needs a room at least ${Math.ceil(info.minWidth / 12)}′ × ${Math.ceil(info.minLength / 12)}′.`,
    };
  }
  const W = room.widthIn;
  const L = room.lengthIn;
  let items: PlacedItem[] = [];

  switch (id) {
    case 'one-wall': {
      items = layRun('north', 0, W, [{ id: 'fridge-36' }, 'flex', { id: 'trash-base', optional: true }, { id: 'sink-farm' }, { id: 'dishwasher' }, 'flex', { id: 'range-30' }, 'flex', { id: 'pantry', optional: true }], room, surfaces, { window: true });
      const op = placeOnWall('south', W / 2, 0, room);
      items.push(item('opening', op.x, op.y, WALL_ROTATION.south, surfaces, 48));
      break;
    }
    case 'galley': {
      items = [
        ...layRun('north', 0, W, [{ id: 'fridge-36' }, 'flex', { id: 'range-30' }, 'flex', { id: 'pantry', optional: true }], room, surfaces),
        ...layRun('south', 0, W, ['flex', { id: 'sink-under' }, { id: 'dishwasher' }, 'flex'], room, surfaces, { window: true }),
      ];
      const aisle = L - 48;
      if (aisle >= 42) items.push(item('rug-runner', W / 2, L / 2, 90, surfaces, undefined, { finishIndex: 0 }));
      const op = placeOnWall('east', L / 2, 0, room);
      items.push(item('opening', op.x, op.y, WALL_ROTATION.east, surfaces, Math.min(48, Math.floor((aisle - 4) / 12) * 12)));
      break;
    }
    case 'l-shape':
    case 'l-island': {
      // Sink tucked near the corner and the fridge just around it keeps every triangle leg under 9′.
      items = layRun('north', 0, W, [{ id: 'corner' }, { id: 'trash-base', optional: true }, { id: 'sink-farm' }, { id: 'dishwasher' }, 'flex', { id: 'pantry', optional: true }], room, surfaces, { window: true });
      const westEnd = L > 168 ? L - 36 : L;
      items.push(...layRun('west', 36, westEnd, [{ id: 'fridge-36' }, 'flex', { id: 'range-30' }, 'flex'], room, surfaces));
      if (id === 'l-island') {
        const minX = 30 + 44;
        const maxX = W - 38;
        const width = [108, 96, 84, 72, 60].find((w) => w <= maxX - minX);
        const minY = 24 + 44;
        if (width && minY + 42 + 40 <= L) {
          const cx = (minX + maxX) / 2;
          const cy = minY + 21;
          items.push(item('island', cx, cy, 0, surfaces, width, { finishIndex: 6 }));
          const seats = Math.max(2, Math.floor(width / 26));
          for (let s = 0; s < seats; s++) {
            const sx = cx - width / 2 + (width / seats) * (s + 0.5);
            items.push(item('stool-backed', sx, cy + 21 + 2, 180, surfaces, undefined, { finishIndex: 1 }));
          }
          const lights = width >= 84 ? 3 : 2;
          for (let l = 0; l < lights; l++) {
            const lx = cx - width / 2 + (width / lights) * (l + 0.5);
            items.push(item('pendant-dome', lx, cy, 0, surfaces, undefined, { finishIndex: 1 }));
          }
        }
      }
      const op = placeOnWall('east', L - 30, 0, room);
      items.push(item('opening', op.x, op.y, WALL_ROTATION.east, surfaces, 36));
      if (westEnd < L - 20) items.push(item('olive-tree', 16, L - 16, 0, surfaces));
      break;
    }
    case 'u-shape': {
      items = [
        ...layRun('north', 0, W, [{ id: 'corner' }, 'flex', { id: 'sink-farm' }, { id: 'dishwasher' }, 'flex', { id: 'corner' }], room, surfaces, { window: true }),
        ...layRun('west', 36, L - 6, ['flex', { id: 'range-30' }, 'flex'], room, surfaces),
        ...layRun('east', 36, L - 6, [{ id: 'fridge-36' }, 'flex'], room, surfaces),
      ];
      const op = placeOnWall('south', W / 2, 0, room);
      items.push(item('opening', op.x, op.y, WALL_ROTATION.south, surfaces, Math.min(48, Math.floor((W - 56) / 12) * 12)));
      break;
    }
  }

  const kept = prune(items, room);
  const dropped = items.filter((i) => !isOpening(getProduct(i.productId)!)).length - kept.filter((i) => !isOpening(getProduct(i.productId)!)).length;
  return { items: kept, note: dropped > 0 ? `${dropped} piece${dropped > 1 ? 's' : ''} didn't fit and were left out.` : undefined };
}
