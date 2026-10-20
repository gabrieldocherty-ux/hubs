import type { BrandPrefs, PlacedItem, Product, Room, Rotation, Surfaces } from '../../types';
import { getProduct, isOpening } from '../../data/catalog';
import { WALL_ROTATION, placeOnWall, wallLength, resolveAll, findOverlaps, outsideRoom, type Wall } from '../geometry';
import { defaultFinishIndex } from '../finish';
import { makeId } from '../id';
import { brandPicker, type BrandSwap } from './brands';

/**
 * Declarative kitchen layouts (BUILD_PLAN D-T2). A `LayoutSpec` says what goes where in terms
 * of roles ("a farmhouse sink", "a 36″ fridge") and wall runs; `buildFromSpec` resolves the roles
 * to built-in products and places real cabinet sizes. The five starting templates
 * (`src/data/templates.ts`) and the photo builder (`photoModel.ts`) are both specs.
 *
 * Pure apart from the catalog registry (built-ins are always there) and random item ids.
 */

export type Role =
  | 'sink'
  | 'range'
  | 'cooktop'
  | 'fridge'
  | 'dishwasher'
  | 'base'
  | 'drawer'
  | 'trash'
  | 'corner'
  | 'tall'
  | 'pantry'
  | 'oven-tower'
  | 'wall-oven'
  | 'wine'
  | 'microwave'
  | 'hood'
  | 'wall'
  | 'wall-glass'
  | 'bridge';

/** A product chosen by role. `variant` matches a product variant or id; `widthIn` a size. */
export interface RoleSlot {
  role: Role;
  widthIn?: number;
  variant?: string;
  /** Dropped first when the run is too short. */
  optional?: boolean;
}

/** A fixed stretch of the run filled with standard base cabinets (photo runs between appliances). */
export interface GapSlot {
  gap: number;
  /** Where inches the cabinet sizes can't cover go. Default: away from a range, else first. */
  spareAt?: 'start' | 'end';
}

/** `'flex'` shares whatever length is left in the run with the other flex slots. */
export type Slot = RoleSlot | GapSlot | 'flex';

export interface RunOptions {
  /** A window centred over the run's sink (templates). */
  window?: boolean;
  /** Wall cabinets over the run (default true). */
  uppers?: boolean;
  /** Uppers in glass-front doors where the size exists. */
  glassUppers?: boolean;
  /** `'auto'` (default) hangs a chimney hood over each range when the run has uppers. */
  hood?: 'auto' | 'none';
  /** Along-wall spans kept free of wall cabinets: windows and overhead appliances. */
  clearUpper?: [number, number][];
}

export interface RunSpec {
  wall: Wall;
  start: number;
  end: number;
  slots: Slot[];
  opts?: RunOptions;
}

export interface IslandSpec {
  /** Centre, in room inches. */
  x: number;
  y: number;
  widthIn: number;
  /** 0: long side runs east–west. 90: north–south. */
  rotation?: 0 | 90;
  seats: number;
  seatSide?: Wall;
  pendants: number;
  finishIndex?: number;
}

/** A window, door or cased opening in a wall, centred `along` it. */
export interface OpeningSpec {
  productId: string;
  wall: Wall;
  along: number;
  widthIn?: number;
  finishIndex?: number;
}

/** Anything placed as-is: rugs, plants, overhead appliances, corner cabinets. */
export interface FixedSpec {
  productId: string;
  x: number;
  y: number;
  rotation: Rotation;
  widthIn?: number;
  finishIndex?: number;
}

export interface LayoutSpec {
  runs: RunSpec[];
  island?: IslandSpec | null;
  openings?: OpeningSpec[];
  /** Placed after the island; rugs go before the openings, everything else after. */
  decor?: FixedSpec[];
  /** Placed before the runs, so they win any collision (photo models: corners, hoods). */
  fixed?: FixedSpec[];
  /** Openings before everything else, so a window seen in a photo is never the piece dropped. */
  openingsFirst?: boolean;
}

export interface BuildResult {
  items: PlacedItem[];
  /** Plain-language notes: roles with no product, pieces that didn't fit. */
  notes: string[];
  /** Pieces left out by `prune`. */
  dropped: PlacedItem[];
}

// ─── Products by role ─────────────────────────────────────────────────────

/** Built-in products per role, in preference order. The first match is the default. */
const ROLE_CANDIDATES: Record<Role, string[]> = {
  sink: ['sink-under', 'sink-farm', 'sink-double', 'sink-prep'],
  range: ['range-30', 'induction-30', 'pro-36', 'heritage-36', 'pro-48'],
  cooktop: ['induction-30', 'range-30', 'pro-36', 'pro-48'],
  fridge: ['fridge-36', 'fridge-column', 'fridge-retro'],
  dishwasher: ['dishwasher'],
  base: ['base'],
  drawer: ['drawer-base'],
  trash: ['trash-base'],
  corner: ['corner'],
  tall: ['pantry'],
  pantry: ['pantry'],
  'oven-tower': ['oven-tower'],
  'wall-oven': ['oven-tower'],
  wine: ['wine-24', 'bev-15'],
  microwave: ['microwave'],
  hood: ['hood-chimney', 'hood-plaster'],
  wall: ['wall'],
  'wall-glass': ['wall-glass', 'wall'],
  bridge: ['bridge'],
};

export interface PickPrefs {
  variant?: string;
  widthIn?: number;
  /** Product ids to try before the built-ins. (Brand preference is `brandPicker`, applied after the pick.) */
  preferIds?: string[];
}

export interface Picked {
  productId: string;
  product: Product;
  widthIn: number;
}

const sizesOf = (p: Product) => (p.widthOptions?.length ? p.widthOptions : [p.widthIn]);

/**
 * The product for a role: the preferred ids, then the built-ins for the role, narrowed by
 * variant (when any match) and by width (exact size, then a width option, then the nearest size).
 * Null when nothing for the role is in the catalog, so callers skip it with a note.
 */
export function pickProduct(role: Role, prefs: PickPrefs = {}): Picked | null {
  const ids = [...(prefs.preferIds ?? []), ...ROLE_CANDIDATES[role]];
  const kinds = new Set(ROLE_CANDIDATES[role].map((id) => getProduct(id)?.kind).filter(Boolean));
  let list = ids.map((id) => getProduct(id)).filter((p): p is Product => !!p && p.source !== 'missing' && (kinds.size === 0 || kinds.has(p.kind)));
  list = list.filter((p, i) => list.findIndex((q) => q.id === p.id) === i);
  if (!list.length) return null;
  if (prefs.variant) {
    const v = list.filter((p) => p.variant === prefs.variant || p.id === prefs.variant);
    if (v.length) list = v;
  }
  const w = prefs.widthIn;
  if (!w) return { productId: list[0].id, product: list[0], widthIn: list[0].widthIn };
  const exact = list.find((p) => p.widthIn === w);
  if (exact) return { productId: exact.id, product: exact, widthIn: w };
  const option = list.find((p) => p.widthOptions?.includes(w));
  if (option) return { productId: option.id, product: option, widthIn: w };
  let best: Picked | null = null;
  let bestDiff = Infinity;
  for (const p of list) {
    for (const s of sizesOf(p)) {
      const diff = Math.abs(s - w);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = { productId: p.id, product: p, widthIn: s };
      }
    }
  }
  return best;
}

// ─── Placing ─────────────────────────────────────────────────────────────

function placed(product: Product, x: number, y: number, rotation: Rotation, surfaces: Surfaces, width?: number, finishIndex?: number): PlacedItem {
  return {
    id: makeId(),
    productId: product.id,
    x,
    y,
    rotation,
    finishIndex: defaultFinishIndex(product, surfaces),
    ...(width && width !== product.widthIn ? { widthIn: width } : {}),
    ...(finishIndex !== undefined ? { finishIndex } : {}),
  };
}

/** A placed item by product id, or null (with no crash) when the product isn't in the catalog. */
export function placeProduct(productId: string, x: number, y: number, rotation: Rotation, surfaces: Surfaces, width?: number, finishIndex?: number): PlacedItem | null {
  const product = getProduct(productId);
  return product ? placed(product, x, y, rotation, surfaces, width, finishIndex) : null;
}

const BASE_SIZES = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9];
const DRAWER_SIZES = [36, 30, 24, 18, 15, 12];

/**
 * Splits a gap into standard cabinet widths, preferring fewer, larger boxes and avoiding 9–12″
 * slivers (it may leave up to 8″ empty rather than use one). A drawer stack goes on whichever
 * side touches the range.
 */
export function fill(space: number, drawerSide: 'start' | 'end' | null): { role: 'base' | 'drawer'; width: number }[] {
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
  const out: { role: 'base' | 'drawer'; width: number }[] = widths.map((w) => ({ role: 'base', width: w }));
  if (drawerSide && out.length) {
    const i = drawerSide === 'start' ? 0 : out.length - 1;
    if (drawerSide === 'end') out.reverse();
    if (DRAWER_SIZES.includes(out[i].width) && out[i].width >= 15) out[i].role = 'drawer';
  }
  return out;
}

interface Resolvedslot {
  slot: RoleSlot;
  pick: Picked;
}
type Working = Resolvedslot | GapSlot | 'flex';

const isGap = (s: Slot | Working): s is GapSlot => typeof s === 'object' && 'gap' in s;
const isRole = (s: Working): s is Resolvedslot => typeof s === 'object' && 'pick' in s;

/** A Basics pick as a `Picked`, for the pieces the builder names by id (hood, uppers, island). */
const asPick = (product: Product, widthIn: number): Picked => ({ productId: product.id, product, widthIn });
/** How far from the wall a piece hung at `inset` for the Basics one sits, so its back stays on the wall. */
const insetFor = (chosen: Product, basic: Product, inset: number) => (chosen === basic ? inset : inset + (chosen.depthIn - basic.depthIn) / 2);

/**
 * Lays one run of base units along a wall, then the window over its sink and the uppers over it.
 * Too-long runs lose optional slots first, then the last fixed ones; flex slots are filled with
 * standard cabinet sizes. `swap` (the kitchen's brand preference) can replace any pick with a
 * chosen brand's product of the same type and size, so the run's geometry is the same either way.
 */
export function layRun(run: RunSpec, room: Room, surfaces: Surfaces, notes: string[] = [], swap?: BrandSwap): PlacedItem[] {
  const { wall, start, end, opts = {} } = run;
  let working: Working[] = [];
  for (const s of run.slots) {
    if (s === 'flex' || isGap(s)) {
      working.push(s);
      continue;
    }
    const basic = pickProduct(s.role, { variant: s.variant, widthIn: s.widthIn });
    const pick = basic && swap ? swap(basic, s.variant) : basic;
    if (!pick) {
      notes.push(`No product for a ${s.role}; left a gap.`);
      continue;
    }
    working.push({ slot: s, pick });
  }
  // A fridge at a run's end against a side wall gets a 3″ filler there, so its door opens past 90°
  // and the crisper drawers come out (the fridge check flags it otherwise).
  const isFridge = (w: Working | undefined) => !!w && isRole(w) && w.pick.product.kind === 'fridge';
  if (isFridge(working[0]) && start <= 0.5) working.unshift({ gap: 3 });
  if (isFridge(working[working.length - 1]) && end >= wallLength(wall, room) - 0.5) working.push({ gap: 3 });
  const widthOf = (s: Working) => (s === 'flex' ? 0 : isGap(s) ? s.gap : s.pick.widthIn);
  const fixed = () => working.reduce((sum, s) => sum + widthOf(s), 0);
  const optionalIdx = () => working.map((s, i) => (isRole(s) && s.slot.optional ? i : -1)).filter((i) => i >= 0);
  const avail = end - start;
  while (fixed() > avail) {
    const idx = optionalIdx().pop();
    if (idx === undefined) break;
    working.splice(idx, 1);
  }
  while (fixed() > avail && working.length) {
    const lastFixed = working.map((s, i) => (s !== 'flex' ? i : -1)).filter((i) => i >= 0).pop();
    if (lastFixed === undefined) break;
    working.splice(lastFixed, 1);
  }
  const flexCount = working.filter((s) => s === 'flex').length;
  while (flexCount && optionalIdx().length && (avail - fixed()) / flexCount < 15) {
    working.splice(optionalIdx().pop()!, 1);
  }
  working = working.filter(Boolean);
  const remaining = Math.max(0, avail - fixed());
  const per = flexCount ? remaining / flexCount : 0;

  const isRange = (n: Working | undefined) => !!n && isRole(n) && n.pick.product.kind === 'range';
  /** `id: null` is empty space: filler strips the cabinet sizes can't cover. */
  const seq: { id: string | null; width: number }[] = [];
  const fillIds = (chunk: { role: 'base' | 'drawer'; width: number }[]) =>
    chunk.map((c) => {
      const basic = pickProduct(c.role, { widthIn: c.width });
      return { id: (basic && swap ? swap(basic) : basic)?.productId ?? null, width: c.width };
    });
  let carry = 0;
  working.forEach((s, i) => {
    const side = isRange(working[i + 1]) ? 'end' : isRange(working[i - 1]) ? 'start' : null;
    if (s === 'flex') {
      const chunk = fill(Math.floor(per + carry), side);
      const used = chunk.reduce((a, c) => a + c.width, 0);
      carry = per + carry - used;
      seq.push(...fillIds(chunk));
    } else if (isGap(s)) {
      const chunk = fill(s.gap, side);
      const used = chunk.reduce((a, c) => a + c.width, 0);
      const spare = s.gap - used;
      // Leftover space sits away from a range (so it keeps its landing), else at the run's start side.
      const spareFirst = s.spareAt ? s.spareAt === 'start' : side !== 'start';
      if (spare > 0 && spareFirst) seq.push({ id: null, width: spare });
      seq.push(...fillIds(chunk));
      if (spare > 0 && !spareFirst) seq.push({ id: null, width: spare });
    } else seq.push({ id: s.pick.productId, width: s.pick.widthIn });
  });

  const rotation = WALL_ROTATION[wall];
  const out: PlacedItem[] = [];
  let cursor = start;
  const laid: { product: Product; width: number; along: number }[] = [];
  for (const s of seq) {
    const p = s.id ? getProduct(s.id) : undefined;
    if (!p) {
      cursor += s.width;
      continue;
    }
    const along = cursor + s.width / 2;
    const pos = placeOnWall(wall, along, p.depthIn / 2, room);
    out.push(placed(p, pos.x, pos.y, p.kind === 'corner' ? 0 : rotation, surfaces, s.width));
    laid.push({ product: p, width: s.width, along });
    cursor += s.width;
  }

  let windowSpan: [number, number] | null = null;
  if (opts.window) {
    const sink = laid.find((p) => p.product.kind === 'sink');
    const win = getProduct('window');
    if (sink && win) {
      const ww = [48, 36, 30, 24].find((w) => w <= sink.width + 6) ?? 24;
      const pos = placeOnWall(wall, sink.along, 0, room);
      out.push(placed(win, pos.x, pos.y, rotation, surfaces, ww));
      windowSpan = [sink.along - ww / 2, sink.along + ww / 2];
    }
  }

  if (opts.uppers !== false) {
    const clear = [...(windowSpan ? [windowSpan] : []), ...(opts.clearUpper ?? [])];
    for (const p of laid) {
      const s0 = p.along - p.width / 2;
      const s1 = p.along + p.width / 2;
      const blocked = clear.some(([c0, c1]) => Math.min(s1, c1) - Math.max(s0, c0) > 0);
      if (p.product.kind === 'range') {
        if (opts.hood === 'none') continue;
        const basicHood = getProduct('hood-chimney');
        if (!basicHood) continue;
        const hw = [30, 36, 48].find((w) => w >= p.width) ?? 48;
        const hood = swap ? swap(asPick(basicHood, hw)).product : basicHood;
        const pos = placeOnWall(wall, p.along, insetFor(hood, basicHood, 10), room);
        out.push(placed(hood, pos.x, pos.y, rotation, surfaces, hw));
      } else if (p.product.kind === 'fridge' && p.product.variant === 'french') {
        const basicBridge = getProduct('bridge');
        if (!basicBridge || blocked) continue;
        const bridge = swap ? swap(asPick(basicBridge, p.width)).product : basicBridge;
        const pos = placeOnWall(wall, p.along, insetFor(bridge, basicBridge, 12), room);
        out.push(placed(bridge, pos.x, pos.y, rotation, surfaces, p.width));
      } else if (['base', 'sink', 'dishwasher', 'wine'].includes(p.product.kind) && !blocked) {
        const glass = opts.glassUppers ? getProduct('wall-glass') : undefined;
        const basicUpper = glass?.widthOptions?.includes(p.width) ? glass : getProduct('wall');
        if (!basicUpper) continue;
        const upper = swap ? swap(asPick(basicUpper, p.width)).product : basicUpper;
        const pos = placeOnWall(wall, p.along, insetFor(upper, basicUpper, 6), room);
        out.push(placed(upper, pos.x, pos.y, rotation, surfaces, p.width));
      }
    }
  }
  return out;
}

/** Drops anything that collides with an earlier piece or leaves the room, so small rooms degrade gracefully. */
export function prune(items: PlacedItem[], room: Room): { kept: PlacedItem[]; dropped: PlacedItem[] } {
  const kept: PlacedItem[] = [];
  const dropped: PlacedItem[] = [];
  for (const it of items) {
    const trial = resolveAll([...kept, it]);
    const me = trial[trial.length - 1];
    if (!me || me.item !== it || outsideRoom(me, room)) {
      dropped.push(it);
      continue;
    }
    const clash = findOverlaps(trial).some(([a, b]) => a === me || b === me);
    if (clash) {
      dropped.push(it);
      continue;
    }
    kept.push(it);
  }
  return { kept, dropped };
}

/** The island, its stools along the seating side and pendants over it (`swap`: the brand preference, as in `layRun`). */
export function layIsland(spec: IslandSpec, surfaces: Surfaces, swap?: BrandSwap): PlacedItem[] {
  const basicIsland = getProduct('island');
  if (!basicIsland) return [];
  const island = swap ? swap(asPick(basicIsland, spec.widthIn)).product : basicIsland;
  // A brand's island or pendant wears its own first finish; the spec's finish index is the Basics piece's.
  const out: PlacedItem[] = [placed(island, spec.x, spec.y, spec.rotation ?? 0, surfaces, spec.widthIn, island === basicIsland ? spec.finishIndex : undefined)];
  const ns = (spec.rotation ?? 0) === 0;
  const side: Wall = spec.seatSide ?? (ns ? 'south' : 'east');
  const W = spec.widthIn;
  // Kept in this exact arithmetic order: the templates' golden output depends on it to the last bit.
  const alongX = (i: number, n: number) => spec.x - W / 2 + (W / n) * (i + 0.5);
  const alongY = (i: number, n: number) => spec.y - W / 2 + (W / n) * (i + 0.5);
  const stool = getProduct('stool-backed');
  if (stool) {
    for (let s = 0; s < spec.seats; s++) {
      const at =
        side === 'south'
          ? { x: alongX(s, spec.seats), y: spec.y + island.depthIn / 2 + 2, r: 180 as Rotation }
          : side === 'north'
            ? { x: alongX(s, spec.seats), y: spec.y - island.depthIn / 2 - 2, r: 0 as Rotation }
            : side === 'east'
              ? { x: spec.x + island.depthIn / 2 + 2, y: alongY(s, spec.seats), r: 90 as Rotation }
              : { x: spec.x - island.depthIn / 2 - 2, y: alongY(s, spec.seats), r: 270 as Rotation };
      out.push(placed(stool, at.x, at.y, at.r, surfaces, undefined, 1));
    }
  }
  const basicPendant = getProduct('pendant-dome');
  if (basicPendant) {
    const pendant = swap ? swap(asPick(basicPendant, basicPendant.widthIn)).product : basicPendant;
    for (let l = 0; l < spec.pendants; l++) {
      out.push(placed(pendant, ns ? alongX(l, spec.pendants) : spec.x, ns ? spec.y : alongY(l, spec.pendants), 0, surfaces, undefined, pendant === basicPendant ? 1 : undefined));
    }
  }
  return out;
}

function fixedItem(f: FixedSpec, surfaces: Surfaces): PlacedItem | null {
  return placeProduct(f.productId, f.x, f.y, f.rotation, surfaces, f.widthIn, f.finishIndex);
}

function openingItem(o: OpeningSpec, room: Room, surfaces: Surfaces): PlacedItem | null {
  const pos = placeOnWall(o.wall, o.along, 0, room);
  return placeProduct(o.productId, pos.x, pos.y, WALL_ROTATION[o.wall], surfaces, o.widthIn, o.finishIndex);
}

/** Every piece of a spec in build order, before `prune`. */
function collect(spec: LayoutSpec, room: Room, surfaces: Surfaces, notes: string[], swap?: BrandSwap): PlacedItem[] {
  const items: PlacedItem[] = [];
  const push = (it: PlacedItem | null) => it && items.push(it);
  const isRug = (f: FixedSpec) => getProduct(f.productId)?.kind === 'rug';

  for (const f of spec.fixed ?? []) push(fixedItem(f, surfaces));
  if (spec.openingsFirst) for (const o of spec.openings ?? []) push(openingItem(o, room, surfaces));
  for (const run of spec.runs) items.push(...layRun(run, room, surfaces, notes, swap));
  if (spec.island) items.push(...layIsland(spec.island, surfaces, swap));
  for (const f of (spec.decor ?? []).filter(isRug)) push(fixedItem(f, surfaces));
  if (!spec.openingsFirst) for (const o of spec.openings ?? []) push(openingItem(o, room, surfaces));
  for (const f of (spec.decor ?? []).filter((d) => !isRug(d))) push(fixedItem(f, surfaces));
  return items;
}

/**
 * A brand piece must never cost the kitchen a piece the Basics build keeps. `branded` and `plain`
 * are the same spec built with and without the brand preference: piece for piece the same slots
 * (when a swap changed what else gets placed, the counts differ, and the plain build is used if
 * the branded one keeps fewer pieces). A branded piece `prune` would drop where its Basics twin
 * survives goes back to the Basics piece; a Basics piece pushed out by a brand piece before it
 * gets the nearest such piece reverted. Repeats until nothing is lost.
 */
function keepEveryPiece(branded: PlacedItem[], plain: PlacedItem[], room: Room): PlacedItem[] {
  const plainKept = new Set(prune(plain, room).kept);
  if (branded.length !== plain.length) return prune(branded, room).kept.length >= plainKept.size ? branded : plain;
  let items = branded;
  for (let round = 0; round < 40; round++) {
    const dropped = new Set(prune(items, room).dropped);
    const lost = items.findIndex((it, i) => dropped.has(it) && plainKept.has(plain[i]));
    if (lost < 0) return items;
    let revert = lost;
    if (items[lost] === plain[lost]) {
      const at = items[lost];
      const culprits = items
        .map((it, j) => ({ j, d: Math.hypot(it.x - at.x, it.y - at.y) }))
        .filter(({ j }) => j < lost && items[j] !== plain[j])
        .sort((p, q) => p.d - q.d);
      if (!culprits.length) return plain;
      revert = culprits[0].j;
    }
    items = items.map((it, i) => (i === revert ? plain[i] : it));
  }
  return plain;
}

/**
 * Builds a spec into placed items. Order (which decides who wins a collision in `prune`):
 * fixed pieces, then (with `openingsFirst`) the openings, the runs, the island, rugs, the
 * openings, then the rest of the decor. `brands` (the kitchen's preferred brands) puts a chosen
 * brand's product in every run, upper, hood, island and pendant slot it sells in that size;
 * without it the output is exactly the BluModel Basics build.
 */
export function buildFromSpec(spec: LayoutSpec, room: Room, surfaces: Surfaces, brands?: BrandPrefs): BuildResult {
  const notes: string[] = [];
  const swap = brandPicker(brands, { ceilingIn: room.ceilingIn });
  let items = collect(spec, room, surfaces, notes, swap);
  if (swap) items = keepEveryPiece(items, collect(spec, room, surfaces, [], undefined), room);

  const { kept, dropped } = prune(items, room);
  const solid = dropped.filter((i) => {
    const p = getProduct(i.productId);
    return p && !isOpening(p);
  });
  if (solid.length) notes.push(`${solid.length} piece${solid.length > 1 ? 's' : ''} didn't fit and were left out.`);
  return { items: kept, notes, dropped };
}
