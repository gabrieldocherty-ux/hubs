import type { DesignDoc, PlacedItem, Room, Surfaces } from '../../types';
import { getProduct } from '../../data/catalog';
import { CABINET_FINISHES } from '../../data/finishes';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { buildTemplate, TEMPLATES, type TemplateId } from '../../data/templates';
import { boxGap, flushWall, alongWall, placeOnWall, resolveAll, wallLength, WALLS, type Resolved, type Wall } from '../geometry';
import { runChecks } from '../checks';
import { withFinishIds } from '../doc';
import { buildFromSpec, pickProduct, type FixedSpec, type IslandSpec, type LayoutSpec, type OpeningSpec, type Role, type RunSpec, type Slot } from './layout';
import { APPLIANCE_WIDTHS, FINISH_CHOICES, clampPhotoModel, closestFinish } from '../../../server/llm/photoModel.mjs';

/**
 * "Start from a photo" (package D): the photo model is what we know about an existing kitchen,
 * from the photo analyser or typed in by hand on "Check the space". `buildFromPhotoModel` turns
 * it into a Mise kitchen through the declarative layout specs and the built-in products.
 *
 * Conventions (the same as the editor): north is the top of the plan, x runs west → east and
 * y north → south. `offsetIn` / `startIn` are measured along a wall from its west end (north and
 * south walls) or its north end (east and west walls), to the item's near edge.
 */

export type PhotoWall = Wall;
export type ApplianceKind = 'sink' | 'range' | 'cooktop' | 'wall-oven' | 'fridge' | 'dishwasher' | 'hood' | 'microwave';
export type CabinetDoor = 'shaker' | 'slab' | 'fluted' | 'glass';

export interface PhotoOpening {
  type: 'window' | 'door';
  wall: PhotoWall;
  offsetIn: number;
  widthIn: number;
  heightIn?: number;
  /** Windows: height of the sill above the floor. */
  sillIn?: number;
}

export interface PhotoRun {
  wall: PhotoWall;
  startIn: number;
  endIn: number;
  /** Wall cabinets above the base run. */
  upper: boolean;
}

export interface PhotoAppliance {
  kind: ApplianceKind;
  wall: PhotoWall | 'island';
  offsetIn: number;
  widthIn?: number;
}

export interface PhotoIsland {
  widthIn: number;
  depthIn: number;
  seats: number;
  pendants?: boolean;
}

/** The look, matched to Mise finishes (ids from src/data/finishes.ts). */
export interface PhotoStyle {
  /** The cabinets' colour as seen; the closest cabinet finish is used. */
  cabinetHex: string;
  cabinetDoor: CabinetDoor;
  counter: string;
  backsplash: string;
  floor: string;
  hardware: string;
  /** Wall paint id. */
  wall?: string;
}

export interface PhotoModel {
  version: 1;
  room: Room;
  openings: PhotoOpening[];
  runs: PhotoRun[];
  appliances: PhotoAppliance[];
  island: PhotoIsland | null;
  style: PhotoStyle;
  /**
   * 0–1 per field, from the analyser: `room`, `style`, `island`, `openings.N`, `runs.N`,
   * `appliances.N`. Missing means "entered by hand". Below `LOW_CONFIDENCE` the form says "Check this".
   */
  confidence: Record<string, number>;
  /** What the analyser noticed that the model can't hold (≤ 6 short lines). */
  notes?: string[];
}

export const LOW_CONFIDENCE = 0.6;

/** Clamps a model to the editor's ranges (shared with the server). Null when there's no room at all. */
export function validatePhotoModel(raw: unknown): { model: PhotoModel; warnings: string[] } | null {
  return clampPhotoModel(raw);
}

// ─── Defaults, seeding and scaling ───────────────────────────────────────

export type SeedLayout = 'one-wall' | 'one-wall-island' | 'galley' | 'l-shape' | 'l-island' | 'u-shape' | 'u-island';

export const SEED_LAYOUTS: { id: SeedLayout; name: string; base: TemplateId; island: boolean }[] = [
  { id: 'one-wall', name: 'Single wall', base: 'one-wall', island: false },
  { id: 'one-wall-island', name: 'Single wall + island', base: 'one-wall', island: true },
  { id: 'galley', name: 'Galley', base: 'galley', island: false },
  { id: 'l-shape', name: 'L-shape', base: 'l-shape', island: false },
  { id: 'l-island', name: 'L + island', base: 'l-shape', island: true },
  { id: 'u-shape', name: 'U-shape', base: 'u-shape', island: false },
  { id: 'u-island', name: 'U + island', base: 'u-shape', island: true },
];

const DEFAULT_ISLAND: PhotoIsland = { widthIn: 84, depthIn: 42, seats: 3, pendants: true };

/** A sensible starting model for a room: an L-shaped kitchen in the photo's style, nothing measured yet. */
export function defaultPhotoModel(room: Room = { widthIn: 168, lengthIn: 144, ceilingIn: 108 }): PhotoModel {
  const base = clampPhotoModel({ room, openings: [], runs: [], appliances: [], island: null, style: {} })!.model;
  return seedLayout('l-shape', base);
}

/**
 * Replaces the runs, appliances and island with the given layout, laid out like the matching
 * starting template (scaled into small rooms). Windows, doors, style and room stay as they are.
 */
export function seedLayout(layout: SeedLayout, model: PhotoModel): PhotoModel {
  const info = SEED_LAYOUTS.find((l) => l.id === layout) ?? SEED_LAYOUTS[0];
  const t = TEMPLATES.find((x) => x.id === info.base)!;
  const room = model.room;
  const big: Room = { ...room, widthIn: Math.max(room.widthIn, t.minWidth), lengthIn: Math.max(room.lengthIn, t.minLength) };
  const { items } = buildTemplate(info.base, big, DEFAULT_SURFACES);
  const from = photoModelFromDoc({ name: '', room: big, surfaces: DEFAULT_SURFACES, items });
  const sx = room.widthIn / big.widthIn;
  const sy = room.lengthIn / big.lengthIn;
  const scaleAlong = (wall: Wall, v: number) => Math.round(v * (wall === 'north' || wall === 'south' ? sx : sy));
  const raw = {
    ...model,
    runs: from.runs.map((r) => ({ ...r, startIn: scaleAlong(r.wall, r.startIn), endIn: scaleAlong(r.wall, r.endIn) })),
    appliances: from.appliances.map((a) => (a.wall === 'island' ? a : { ...a, offsetIn: scaleAlong(a.wall, a.offsetIn) })),
    island: info.island ? { ...DEFAULT_ISLAND } : null,
    confidence: dropKeys(model.confidence, ['runs.', 'appliances.', 'island']),
  };
  return clampPhotoModel(raw)!.model;
}

function dropKeys(conf: Record<string, number>, prefixes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(conf)) if (!prefixes.some((p) => k === p || k.startsWith(p))) out[k] = v;
  return out;
}

/** Which seed layout a model looks like (for the layout picker). */
export function layoutOf(model: PhotoModel): SeedLayout | null {
  const walls = new Set(model.runs.map((r) => r.wall));
  const island = !!model.island;
  if (walls.size === 1) return island ? 'one-wall-island' : 'one-wall';
  if (walls.size === 2) {
    const opposite = (walls.has('north') && walls.has('south')) || (walls.has('east') && walls.has('west'));
    if (opposite) return island ? null : 'galley';
    return island ? 'l-island' : 'l-shape';
  }
  if (walls.size === 3) return island ? 'u-island' : 'u-shape';
  return null;
}

export const wallLen = (wall: Wall, room: Room) => wallLength(wall, room);

/**
 * "Measure one wall with a tape": scales every estimated length so `wall` measures `measuredIn`.
 * Appliance widths stay (they come in standard sizes); everything else seen in the photos scales.
 */
export function rescaleModel(model: PhotoModel, wall: Wall, measuredIn: number): PhotoModel {
  const current = wallLen(wall, model.room);
  const k = measuredIn / current;
  if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 1e-3) return model;
  const r = (v: number) => Math.round(v * k * 2) / 2;
  const raw = {
    ...model,
    room: { widthIn: r(model.room.widthIn), lengthIn: r(model.room.lengthIn), ceilingIn: r(model.room.ceilingIn) },
    openings: model.openings.map((o) => ({ ...o, offsetIn: r(o.offsetIn), widthIn: r(o.widthIn), ...(o.heightIn ? { heightIn: r(o.heightIn) } : {}), ...(o.sillIn ? { sillIn: r(o.sillIn) } : {}) })),
    runs: model.runs.map((x) => ({ ...x, startIn: r(x.startIn), endIn: r(x.endIn) })),
    appliances: model.appliances.map((a) => ({ ...a, offsetIn: r(a.offsetIn) })),
    island: model.island ? { ...model.island, widthIn: r(model.island.widthIn) } : null,
  };
  const out = clampPhotoModel(raw)!.model;
  // Whatever the clamp did, the measured wall is exactly what was typed (when it's in range).
  if (wall === 'north' || wall === 'south') out.room.widthIn = Math.min(480, Math.max(72, Math.round(measuredIn * 2) / 2));
  else out.room.lengthIn = Math.min(480, Math.max(72, Math.round(measuredIn * 2) / 2));
  return clampPhotoModel(out)!.model;
}

// ─── Style ⇄ surfaces ─────────────────────────────────────────────────────

export function surfacesFromStyle(style: PhotoStyle): Surfaces {
  return {
    cabinetFinishId: closestFinish(FINISH_CHOICES.cabinet, style.cabinetHex).id,
    doorStyle: style.cabinetDoor === 'glass' ? 'shaker' : style.cabinetDoor,
    hardwareId: style.hardware,
    countertopId: style.counter,
    backsplashId: style.backsplash,
    flooringId: style.floor,
    paintId: style.wall ?? 'chalk',
  };
}

export function styleFromSurfaces(s: Surfaces, glass = false): PhotoStyle {
  const cab = CABINET_FINISHES.find((f) => f.id === s.cabinetFinishId) ?? CABINET_FINISHES[0];
  return {
    cabinetHex: cab.hex,
    cabinetDoor: glass ? 'glass' : s.doorStyle,
    counter: s.countertopId,
    backsplash: s.backsplashId,
    floor: s.flooringId,
    hardware: s.hardwareId,
    wall: s.paintId,
  };
}

// ─── Doc → model (seeding and round trips) ───────────────────────────────

const FLOOR_KINDS = new Set(['base', 'corner', 'sink', 'dishwasher', 'range', 'fridge', 'tall', 'oven-tower', 'wine']);
const KIND_TO_APPLIANCE: Record<string, ApplianceKind> = {
  sink: 'sink',
  range: 'range',
  fridge: 'fridge',
  dishwasher: 'dishwasher',
  'oven-tower': 'wall-oven',
  hood: 'hood',
  microwave: 'microwave',
};

function touchingWalls(r: Resolved, room: Room): Wall[] {
  const b = r.box;
  const out: Wall[] = [];
  if (Math.abs(b.minY) < 1) out.push('north');
  if (Math.abs(b.maxX - room.widthIn) < 1) out.push('east');
  if (Math.abs(b.maxY - room.lengthIn) < 1) out.push('south');
  if (Math.abs(b.minX) < 1) out.push('west');
  return out;
}

/** Reads a design back into a photo model: the runs, appliances, openings, island and look it has. */
export function photoModelFromDoc(doc: DesignDoc): PhotoModel {
  const room = doc.room;
  const all = resolveAll(doc.items);
  const spans: Record<Wall, [number, number][]> = { north: [], east: [], south: [], west: [] };
  const appliances: PhotoAppliance[] = [];
  const openings: PhotoOpening[] = [];
  let island: PhotoIsland | null = null;
  let glass = false;
  for (const r of all) {
    const k = r.product.kind;
    if (k === 'island') {
      const seats = all.filter((o) => o.product.kind === 'stool' && boxGap(o.box, r.box) <= 12).length;
      const pendants = all.some((o) => o.product.kind === 'pendant' && boxGap(o.box, r.box) <= 0);
      island = { widthIn: r.w, depthIn: r.d, seats, pendants };
      continue;
    }
    if (r.product.id === 'wall-glass') glass = true;
    const wall = flushWall(r, room);
    if (k === 'window' || k === 'door') {
      if (!wall) continue;
      const [s] = alongWall(wall, r.box);
      openings.push({ type: k, wall, offsetIn: s, widthIn: r.w, heightIn: r.product.heightIn, ...(k === 'window' ? { sillIn: r.product.elevationIn } : {}) });
      continue;
    }
    if (FLOOR_KINDS.has(k)) {
      const walls = k === 'corner' ? touchingWalls(r, room) : wall ? [wall] : [];
      for (const w of walls) spans[w].push(alongWall(w, r.box));
    }
    const kind = KIND_TO_APPLIANCE[k];
    if (kind && wall) {
      const [s] = alongWall(wall, r.box);
      appliances.push({ kind, wall, offsetIn: s, widthIn: r.w });
    }
  }
  const runs: PhotoRun[] = [];
  for (const wall of WALLS) {
    const list = spans[wall].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of list) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    for (const [s, e] of merged) {
      const upper = all.some((o) => o.product.kind === 'wall' && flushWall(o, room) === wall && Math.min(e, alongWall(wall, o.box)[1]) - Math.max(s, alongWall(wall, o.box)[0]) > 1);
      runs.push({ wall, startIn: s, endIn: e, upper });
    }
  }
  return clampPhotoModel({ room, openings, runs, appliances, island, style: styleFromSurfaces(doc.surfaces, glass), confidence: {} })!.model;
}

// ─── Model → layout spec → doc ───────────────────────────────────────────

const APPLIANCE_ROLE: Partial<Record<ApplianceKind, Role>> = {
  sink: 'sink',
  range: 'range',
  cooktop: 'cooktop',
  'wall-oven': 'wall-oven',
  fridge: 'fridge',
  dishwasher: 'dishwasher',
};

const NAMES: Record<ApplianceKind, string> = {
  sink: 'sink',
  range: 'range',
  cooktop: 'cooktop',
  'wall-oven': 'wall oven',
  fridge: 'fridge',
  dishwasher: 'dishwasher',
  hood: 'hood',
  microwave: 'microwave',
};

const WALL_NAME = (w: Wall) => `${w} wall`;
const snapTo = (sizes: number[], w: number) => sizes.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), sizes[0]);
/** Gaps between appliances, in sizes base cabinets can fill (no 1–11″ slivers). */
const snapGap = (g: number) => (g < 6 ? 0 : g < 12 ? 12 : Math.round(g / 3) * 3);

interface Anchor {
  kind: ApplianceKind;
  role: Role;
  start: number;
  width: number;
  depth: number;
  /** Where the photo put it, before any corner moves. */
  photoStart?: number;
}

interface Segment {
  wall: Wall;
  start: number;
  end: number;
  upper: boolean;
  anchors: Anchor[];
  /** Ends that must meet the next run (or a corner cabinet) exactly: no filler gap there. */
  butt?: { start?: boolean; end?: boolean };
}

const buttEnd = (s: Segment, end: 'start' | 'end') => {
  s.butt = { ...s.butt, [end]: true };
};

function openingSpecs(model: PhotoModel, notes: string[], cased: Set<number>): { specs: OpeningSpec[]; doors: { wall: Wall; span: [number, number] }[]; windows: { wall: Wall; span: [number, number] }[] } {
  const specs: OpeningSpec[] = [];
  const doors: { wall: Wall; span: [number, number] }[] = [];
  const windows: { wall: Wall; span: [number, number] }[] = [];
  const taken: { wall: Wall; span: [number, number]; type: string }[] = [];
  model.openings.forEach((o, i) => {
    const center = o.offsetIn + o.widthIn / 2;
    const span: [number, number] = [o.offsetIn, o.offsetIn + o.widthIn];
    const clash = taken.find((t) => t.wall === o.wall && overlaps(t.span, span));
    if (clash) {
      notes.push(`The ${o.type} on the ${WALL_NAME(o.wall)} overlaps a ${clash.type}, so it was left out. Move one of them.`);
      return;
    }
    taken.push({ wall: o.wall, span, type: o.type });
    if (o.type === 'window') {
      windows.push({ wall: o.wall, span: [o.offsetIn, o.offsetIn + o.widthIn] });
      const tall = (o.sillIn ?? 42) < 40;
      const n = Math.max(1, Math.ceil(o.widthIn / 72));
      const each = o.widthIn / n;
      const productId = tall || each > 48 ? 'window-picture' : 'window';
      const w = snapTo(productId === 'window' ? [24, 30, 36, 48] : [48, 60, 72], each);
      for (let j = 0; j < n; j++) specs.push({ productId, wall: o.wall, along: o.offsetIn + each * (j + 0.5), widthIn: w });
      if (n > 1) notes.push(`The ${Math.round(o.widthIn)}″ window on the ${WALL_NAME(o.wall)} is drawn as ${n} windows side by side.`);
      return;
    }
    doors.push({ wall: o.wall, span: [o.offsetIn - 1, o.offsetIn + o.widthIn + 1] });
    if (cased.has(i) || (o.widthIn > 40 && o.widthIn < 54) || o.widthIn > 76) {
      specs.push({ productId: 'opening', wall: o.wall, along: center, widthIn: snapTo([36, 48, 60], o.widthIn) });
    } else if (o.widthIn >= 54) {
      specs.push({ productId: 'door-french', wall: o.wall, along: center, widthIn: snapTo([60, 72], o.widthIn) });
    } else {
      specs.push({ productId: 'door', wall: o.wall, along: center, widthIn: snapTo([28, 30, 32, 36], o.widthIn) });
    }
  });
  return { specs, doors, windows };
}

const overlaps = (a: [number, number], b: [number, number]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.5;

/**
 * Corner cabinets where two runs meet, and runs trimmed so they never share the corner square.
 * A door within a corner cabinet's reach of the corner means no corner cabinet: the other wall's
 * run goes into the corner and the door's wall starts clear of it.
 */
function joinCorners(segments: Segment[], room: Room, fixed: FixedSpec[], doors: { wall: Wall; span: [number, number] }[]) {
  const corners: { primary: Wall; secondary: Wall; pEnd: 'start' | 'end'; sEnd: 'start' | 'end'; x: number; y: number }[] = [
    { primary: 'north', secondary: 'west', pEnd: 'start', sEnd: 'start', x: 18, y: 18 },
    { primary: 'north', secondary: 'east', pEnd: 'end', sEnd: 'start', x: room.widthIn - 18, y: 18 },
    { primary: 'south', secondary: 'west', pEnd: 'start', sEnd: 'end', x: 18, y: room.lengthIn - 18 },
    { primary: 'south', secondary: 'east', pEnd: 'end', sEnd: 'end', x: room.widthIn - 18, y: room.lengthIn - 18 },
  ];
  // Two runs "meet" when both come within 48″ of the corner: photos often give the second run as
  // starting where the first one's counter ends (24″) or after a corner cabinet (36″).
  const NEAR = 48;
  const reaches = (s: Segment, end: 'start' | 'end') => (end === 'start' ? s.start <= NEAR : s.end >= wallLen(s.wall, room) - NEAR);
  const zone = (s: Segment, end: 'start' | 'end', size: number): [number, number] => {
    const len = wallLen(s.wall, room);
    return end === 'start' ? [0, size] : [len - size, len];
  };
  /** Moves a run's corner end to exactly `depth` from the corner (in or out). */
  const setEnd = (s: Segment, end: 'start' | 'end', depth: number) => {
    const len = wallLen(s.wall, room);
    if (end === 'start') s.start = Math.min(depth, s.end);
    else s.end = Math.max(len - depth, s.start);
  };
  const extend = (s: Segment, end: 'start' | 'end') => {
    if (end === 'start') s.start = 0;
    else s.end = wallLen(s.wall, room);
  };
  const doorNear = (wall: Wall, end: 'start' | 'end') =>
    doors.some((d) => d.wall === wall && (end === 'start' ? d.span[0] < 37 : d.span[1] > wallLen(wall, room) - 37));
  for (const c of corners) {
    const p = segments.find((s) => s.wall === c.primary && reaches(s, c.pEnd));
    const q = segments.find((s) => s.wall === c.secondary && reaches(s, c.sEnd));
    if (!p || !q) continue;
    const pDoor = doorNear(p.wall, c.pEnd);
    const qDoor = doorNear(q.wall, c.sEnd);
    if (pDoor || qDoor) {
      if (!pDoor) extend(p, c.pEnd);
      if (!qDoor) extend(q, c.sEnd);
      const depthIn = (s: Segment, end: 'start' | 'end') => s.anchors.filter((a) => overlaps([a.start, a.start + a.width], zone(s, end, 36))).reduce((d, a) => Math.max(d, a.depth), 24);
      if (pDoor) setEnd(p, c.pEnd, qDoor ? 24 : depthIn(q, c.sEnd));
      if (qDoor) setEnd(q, c.sEnd, pDoor ? 24 : depthIn(p, c.pEnd));
      if (pDoor && !qDoor) buttEnd(p, c.pEnd);
      if (qDoor && !pDoor) buttEnd(q, c.sEnd);
      continue;
    }
    const inZone = (s: Segment, end: 'start' | 'end', size: number) => s.anchors.filter((a) => overlaps([a.start, a.start + a.width], zone(s, end, size)));
    if (!inZone(p, c.pEnd, 36).length && !inZone(q, c.sEnd, 36).length) {
      fixed.push({ productId: 'corner', x: c.x, y: c.y, rotation: 0 });
      setEnd(p, c.pEnd, 36);
      setEnd(q, c.sEnd, 36);
      // The corner cabinet's front faces south: at the north corners it looks along the east or
      // west run, which must meet it exactly; elsewhere a filler gap beside it is harmless.
      if (c.primary === 'north') buttEnd(q, c.sEnd);
      continue;
    }
    // An appliance near the corner. One run (the "owner") goes into the corner; the other starts
    // flush against the owner's front. The owner's corner square is blind (its front faces the
    // other run), so it holds a cabinet, never an appliance: the owner is the run with nothing in
    // its square, and an appliance there anyway is moved out of it (with a note) later on.
    const pSquare = inZone(p, c.pEnd, 27).length;
    const qSquare = inZone(q, c.sEnd, 27).length;
    const pFree = !inZone(p, c.pEnd, 36).length;
    const qFree = !inZone(q, c.sEnd, 36).length;
    const pOwns = pFree || (!qFree && (!pSquare || qSquare > 0));
    const [owner, ownerEnd, other, otherEnd] = pOwns ? [p, c.pEnd, q, c.sEnd] : [q, c.sEnd, p, c.pEnd];
    extend(owner, ownerEnd);
    setEnd(other, otherEnd, 24);
    buttEnd(other, otherEnd);
    // Owner appliances in the blind square step out of it.
    const len = wallLen(owner.wall, room);
    for (const a of inZone(owner, ownerEnd, 27)) {
      if (ownerEnd === 'start') {
        a.start = Math.max(a.start, 27);
        owner.end = Math.min(len, Math.max(owner.end, a.start + a.width));
      } else {
        a.start = Math.min(a.start, len - 27 - a.width);
        owner.start = Math.max(0, Math.min(owner.start, a.start));
      }
    }
  }
}

/**
 * Where a run goes into a corner and the next wall's run starts a little way out (typically after
 * a door), the space between them is a walkway: it is kept at 36″ or more by starting the second
 * run further out, so the builder never leaves a pinch point the photo didn't really have.
 */
function clearCornerAisles(segments: Segment[], room: Room, fixed: FixedSpec[]) {
  const corners: { a: Wall; aEnd: 'start' | 'end'; b: Wall; bEnd: 'start' | 'end'; x: number; y: number }[] = [
    { a: 'north', aEnd: 'start', b: 'west', bEnd: 'start', x: 18, y: 18 },
    { a: 'north', aEnd: 'end', b: 'east', bEnd: 'start', x: room.widthIn - 18, y: 18 },
    { a: 'south', aEnd: 'start', b: 'west', bEnd: 'end', x: 18, y: room.lengthIn - 18 },
    { a: 'south', aEnd: 'end', b: 'east', bEnd: 'end', x: room.widthIn - 18, y: room.lengthIn - 18 },
  ];
  const atCorner = (s: Segment, end: 'start' | 'end') => (end === 'start' ? s.start <= 0.5 : s.end >= wallLen(s.wall, room) - 0.5);
  for (const c of corners) {
    const cornerCab = fixed.some((f) => f.productId === 'corner' && Math.abs(f.x - c.x) < 1 && Math.abs(f.y - c.y) < 1);
    for (const [P, pEnd, Q, qEnd] of [
      [c.a, c.aEnd, c.b, c.bEnd],
      [c.b, c.bEnd, c.a, c.aEnd],
    ] as const) {
      const p = segments.find((s) => s.wall === P && atCorner(s, pEnd));
      if (!p && !cornerCab) continue;
      const depth = cornerCab ? 36 : Math.max(24, ...p!.anchors.filter((a) => (pEnd === 'start' ? a.start < 36 : a.start + a.width > wallLen(P, room) - 36)).map((a) => a.depth));
      const len = wallLen(Q, room);
      for (const q of segments.filter((s) => s.wall === Q)) {
        const gap = qEnd === 'start' ? q.start - depth : len - depth - q.end;
        if (gap <= 0.5 || gap >= 36) continue;
        // Only when its appliances still fit: an appliance the photo shows beats a tidy walkway.
        const need = q.anchors.reduce((n, a) => n + a.width, 0);
        if (qEnd === 'start') {
          const start = depth + 36;
          if (need && start + need > (q.butt?.end ? q.end : len)) continue;
          q.start = Math.min(start, Math.max(q.end, need ? start : 0));
          if (!need) q.start = Math.min(start, q.end);
        } else {
          const end = len - depth - 36;
          if (need && end - need < (q.butt?.start ? q.start : 0)) continue;
          q.end = need ? end : Math.max(q.start, end);
        }
      }
    }
  }
}

/**
 * Anchors outside a trimmed run move inside it (growing the run away from a corner when that
 * end isn't butted); they are left out, with a note, only when the wall is too short.
 */
function fitAnchors(seg: Segment, room: Room, notes: string[]) {
  const len = wallLen(seg.wall, room);
  seg.anchors = seg.anchors.filter((a) => {
    if (a.start < seg.start - 0.5) a.start = seg.start;
    else if (a.start + a.width > seg.end + 0.5) a.start = seg.end - a.width;
    if (a.start < seg.start - 0.5) {
      if (seg.butt?.start || a.start < 0) {
        notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(seg.wall)} ran into the corner and was left out.`);
        return false;
      }
      seg.start = a.start;
    }
    if (a.start + a.width > seg.end + 0.5) {
      if (seg.butt?.end || a.start + a.width > len) {
        notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(seg.wall)} ran into the corner and was left out.`);
        return false;
      }
      seg.end = a.start + a.width;
    }
    return true;
  });
  seg.anchors.sort((a, b) => a.start - b.start);
}

/**
 * The slots for one run: a fixed gap of base cabinets before each appliance (snapped to sizes
 * cabinets come in), the appliance, then flex fill to the run's end. Appliances pushed past the
 * end stretch the run (up to the wall); any that still don't fit are left out with a note.
 */
function runSlots(seg: Segment, room: Room, notes: string[]): Slot[] {
  const len = wallLen(seg.wall, room);
  const slots: Slot[] = [];
  let cursor = seg.start;
  const limit = seg.butt?.end ? seg.end : len;
  seg.anchors.forEach((a, i) => {
    const g = a.start - cursor;
    let gap = g <= 0 ? 0 : snapGap(g);
    if (cursor + gap + a.width > limit) gap = Math.max(0, Math.floor((limit - cursor - a.width) / 3) * 3);
    // The last appliance before a butted end: close enough to meet the corner run exactly.
    const short = limit - (cursor + gap + a.width);
    if (seg.butt?.end && i === seg.anchors.length - 1 && short > 0.5 && short < 9) {
      const exact = limit - a.width - cursor;
      // Any spare inches then sit before it, unless that is a butted start too.
      const blocked = i === 0 && seg.butt.start && exact > 0.5 && exact < 9;
      if (exact >= 0 && !blocked) gap = exact < 0.5 ? 0 : exact;
    }
    if (cursor + gap + a.width > limit + 0.5) {
      notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(seg.wall)} didn’t fit and was left out.`);
      return;
    }
    // At a butted start, cabinets meet the corner and any spare inch goes beside the appliance.
    if (gap) slots.push(!slots.length && seg.butt?.start ? { gap, spareAt: 'end' } : { gap });
    if (g < -6) notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(seg.wall)} overlapped its neighbour and was moved ${Math.round(-g)}″ along.`);
    slots.push({ role: a.role, widthIn: a.width });
    cursor = cursor + gap + a.width;
  });
  seg.end = Math.min(len, Math.max(seg.end, cursor));
  const rest = seg.end - cursor;
  if (rest > 0.5) {
    if (!seg.butt?.end) slots.push('flex');
    else if (rest >= 18 && !slots.length && seg.butt.start) {
      // Butted at both ends: whatever the cabinet sizes can't cover goes in the middle.
      const half = Math.round(rest / 6) * 3;
      slots.push({ gap: half, spareAt: 'end' }, { gap: rest - half, spareAt: 'start' });
    } else if (rest >= 9) slots.push({ gap: rest, spareAt: 'start' });
    else if (!seg.butt.start) {
      // Too little to fill: slide everything along so the run still meets the corner.
      const first = slots[0];
      if (first && typeof first === 'object' && 'gap' in first) slots[0] = { ...first, gap: first.gap + rest, spareAt: 'start' };
      else slots.unshift({ gap: rest });
    }
  } else if (!slots.length) slots.push('flex');
  return slots;
}

function islandSpec(model: PhotoModel, room: Room, segments: Segment[], fixed: FixedSpec[], widthCap: number | null, notes: string[]): IslandSpec | null {
  const isl = model.island;
  if (!isl) return null;
  const island = getProduct('island');
  if (!island) return null;
  const corners = fixed.filter((f) => f.productId === 'corner');
  /** How far a wall's cabinets reach into the room: the runs, and (when `withCorners`) any 36″ corner cabinet on it. */
  const depthOf = (wall: Wall, withCorners: boolean) => {
    let d = 0;
    for (const s of segments) if (s.wall === wall) d = Math.max(d, 24, ...s.anchors.map((a) => a.depth));
    if (withCorners) {
      for (const f of corners) {
        const touches = (wall === 'north' && f.y < 30) || (wall === 'south' && f.y > room.lengthIn - 30) || (wall === 'west' && f.x < 30) || (wall === 'east' && f.x > room.widthIn - 30);
        if (touches) d = Math.max(d, 36);
      }
    }
    return d;
  };
  const sizes = (island.widthOptions ?? [island.widthIn]).slice().sort((a, b) => b - a);

  /** The island between the runs with `clear` walkways, or null when it doesn't fit. */
  const fit = (withCorners: boolean, clear: number) => {
    const x0 = depthOf('west', withCorners);
    const x1 = room.widthIn - depthOf('east', withCorners);
    const y0 = depthOf('north', withCorners);
    const y1 = room.lengthIn - depthOf('south', withCorners);
    const fw = x1 - x0;
    const fl = y1 - y0;
    const rotation: 0 | 90 = fw >= fl ? 0 : 90;
    const long = rotation === 0 ? fw : fl;
    const short = rotation === 0 ? fl : fw;
    if (short < island.depthIn + clear * 2) return null;
    const want = Math.min(snapTo(sizes, isl.widthIn), widthCap ?? Infinity);
    const width = sizes.find((w) => w <= want && w <= long - clear * 2);
    if (!width) return null;
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;
    // Measured from the runs alone, the island must still keep a full walkway from the corner
    // cabinets (36″ squares in the room's corners), diagonally included.
    if (!withCorners) {
      const hx = (rotation === 0 ? width : island.depthIn) / 2;
      const hy = (rotation === 0 ? island.depthIn : width) / 2;
      const gap = (f: FixedSpec) => Math.hypot(Math.max(0, Math.abs(f.x - x) - hx - 18), Math.max(0, Math.abs(f.y - y) - hy - 18));
      if (corners.some((f) => gap(f) < clear)) return null;
    }
    return { x, y, width, rotation };
  };

  for (const clear of [42, 37]) {
    const at = fit(false, clear) ?? fit(true, clear);
    if (!at) continue;
    const { x, y, width, rotation } = at;
    if (width + 6 < isl.widthIn) notes.push(`The island is drawn ${width}″ long so walkways stay at least ${clear === 42 ? 42 : 36}″.`);
    if (Math.abs(isl.depthIn - island.depthIn) > 6) notes.push(`The island is drawn ${island.depthIn}″ deep (the depth Mise has); yours looks about ${Math.round(isl.depthIn)}″.`);
    const maxSeats = Math.floor(width / 20);
    if (isl.seats > maxSeats) notes.push(`${maxSeats} stools fit along a ${width}″ island; ${isl.seats} were asked for.`);
    const runLen = (w: Wall) => segments.filter((s) => s.wall === w).reduce((n, s) => n + s.end - s.start, 0);
    const seatSide: Wall = rotation === 0 ? (runLen('south') > runLen('north') ? 'north' : 'south') : runLen('east') > runLen('west') ? 'west' : 'east';
    return {
      x,
      y,
      widthIn: width,
      rotation,
      seats: Math.min(isl.seats, maxSeats),
      seatSide,
      pendants: isl.pendants ? (width >= 84 ? 3 : 2) : 0,
    };
  }
  notes.push('The island was left out: there isn’t room for it with 36″ walkways all round.');
  return null;
}

export interface PhotoSpecOptions {
  /** Doors (by index in `model.openings`) to draw as cased openings, so their swing hits nothing. */
  cased?: Set<number>;
  /** Longest island to try (used when the first try blocks a walkway). */
  islandCap?: number | null;
}

/** The layout spec for a photo model, plus notes about anything it had to change or leave out. */
export function photoSpec(model: PhotoModel, opts: PhotoSpecOptions = {}): { spec: LayoutSpec; notes: string[] } {
  const notes: string[] = [];
  const room = model.room;
  const fixed: FixedSpec[] = [];
  const { specs: openings, doors, windows } = openingSpecs(model, notes, opts.cased ?? new Set());

  const segments: Segment[] = [];
  for (const wall of WALLS) {
    const len = wallLen(wall, room);
    const doorSpans = doors.filter((d) => d.wall === wall).map((d) => d.span);
    // The runs on this wall, split around doors.
    let pieces: { start: number; end: number; upper: boolean }[] = [];
    for (const r of model.runs.filter((x) => x.wall === wall).sort((a, b) => a.startIn - b.startIn)) {
      // A run that ends within 6″ of a wall reaches it (photo estimates are a few inches out).
      let parts = [{ start: r.startIn <= 6 ? 0 : r.startIn, end: r.endIn >= len - 6 ? len : r.endIn }];
      for (const [d0, d1] of doorSpans) {
        parts = parts.flatMap((p) => (overlaps([p.start, p.end], [d0, d1]) ? [{ start: p.start, end: Math.min(p.end, d0) }, { start: Math.max(p.start, d1), end: p.end }] : [p]));
      }
      pieces.push(...parts.filter((p) => p.end - p.start >= 12).map((p) => ({ ...p, upper: r.upper })));
    }
    pieces = pieces.sort((a, b) => a.start - b.start);
    const segs: Segment[] = [];
    for (const p of pieces) {
      const last = segs[segs.length - 1];
      if (last && p.start <= last.end) {
        last.end = Math.max(last.end, p.end);
        last.upper = last.upper || p.upper;
      } else segs.push({ wall, start: p.start, end: p.end, upper: p.upper, anchors: [] });
    }

    for (const a of model.appliances.filter((x) => x.wall === wall)) {
      const role = APPLIANCE_ROLE[a.kind];
      const width = a.widthIn ?? APPLIANCE_WIDTHS[a.kind].def;
      if (!role) {
        // Hoods and microwaves hang over the counter.
        const productRole: Role = a.kind === 'hood' ? 'hood' : 'microwave';
        const pick = pickProduct(productRole, { widthIn: width });
        if (!pick) continue;
        const along = Math.min(Math.max(a.offsetIn + width / 2, pick.widthIn / 2), len - pick.widthIn / 2);
        const pos = placeOnWall(wall, along, pick.product.depthIn / 2, room);
        fixed.push({ productId: pick.productId, x: pos.x, y: pos.y, rotation: wall === 'north' ? 0 : wall === 'east' ? 90 : wall === 'south' ? 180 : 270, widthIn: pick.widthIn });
        continue;
      }
      const pick = pickProduct(role, { widthIn: width });
      if (!pick) {
        notes.push(`No ${NAMES[a.kind]} in the catalog; it was left out.`);
        continue;
      }
      const span: [number, number] = [a.offsetIn, a.offsetIn + pick.widthIn];
      if (doorSpans.some((d) => overlaps(span, d))) {
        notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(wall)} overlaps a door, so it was left out. Move one of them.`);
        continue;
      }
      if (pick.product.heightIn + pick.product.elevationIn > 40 && windows.some((w) => w.wall === wall && overlaps(span, w.span))) {
        notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(wall)} is under a window, so it was left out. Move one of them.`);
        continue;
      }
      const anchor: Anchor = { kind: a.kind, role, start: a.offsetIn, width: pick.widthIn, depth: pick.product.depthIn, photoStart: a.offsetIn };
      let seg = segs.find((s) => span[0] < s.end + 6 && span[1] > s.start - 6);
      if (!seg) {
        seg = { wall, start: span[0], end: Math.min(len, span[1]), upper: false, anchors: [] };
        segs.push(seg);
      }
      seg.start = Math.max(0, Math.min(seg.start, span[0]));
      seg.end = Math.min(len, Math.max(seg.end, span[1]));
      seg.anchors.push(anchor);
    }
    // Merge segments that grew into each other.
    segs.sort((a, b) => a.start - b.start);
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].start <= segs[i - 1].end) {
        segs[i - 1].end = Math.max(segs[i - 1].end, segs[i].end);
        segs[i - 1].upper ||= segs[i].upper;
        segs[i - 1].anchors.push(...segs[i].anchors);
        segs.splice(i--, 1);
      }
    }
    for (const s of segs) s.anchors.sort((a, b) => a.start - b.start);
    segments.push(...segs);
  }

  joinCorners(segments, room, fixed, doors);
  for (const s of segments) fitAnchors(s, room, notes);
  clearCornerAisles(segments, room, fixed);
  for (const s of segments) fitAnchors(s, room, notes);
  for (const s of segments) {
    for (const a of s.anchors) {
      const by = Math.abs(a.start - (a.photoStart ?? a.start));
      if (by > 6) notes.push(`The ${NAMES[a.kind]} on the ${WALL_NAME(s.wall)} was moved ${Math.round(by)}″ so it clears the corner.`);
    }
  }

  for (const a of model.appliances.filter((x) => x.wall === 'island')) {
    notes.push(`Mise can’t put a ${NAMES[a.kind]} in an island yet, so the island ${NAMES[a.kind]} was left out.`);
  }

  const runs: RunSpec[] = [];
  for (const seg of segments) {
    if (seg.end - seg.start < 9) continue;
    const clearUpper: [number, number][] = [
      ...windows.filter((w) => w.wall === seg.wall).map((w) => w.span),
      ...fixed
        .filter((f) => {
          const p = getProduct(f.productId);
          return p && (p.kind === 'hood' || p.kind === 'microwave') && wallOfFixed(f, room) === seg.wall;
        })
        .map((f) => {
          const w = f.widthIn ?? getProduct(f.productId)!.widthIn;
          const along = seg.wall === 'north' || seg.wall === 'south' ? f.x : f.y;
          return [along - w / 2, along + w / 2] as [number, number];
        }),
    ];
    const slots = runSlots(seg, room, notes);
    runs.push({
      wall: seg.wall,
      start: seg.start,
      end: seg.end,
      slots,
      opts: { uppers: seg.upper, hood: 'none', glassUppers: model.style.cabinetDoor === 'glass', clearUpper },
    });
  }

  const island = islandSpec(model, room, segments, fixed, opts.islandCap ?? null, notes);
  return { spec: { runs, fixed, openings, island, openingsFirst: true }, notes };
}

/** The wall meeting `wall` at its start (along = 0) or end, and which end of that wall the corner is. */
function cornerNeighbour(wall: Wall, end: 'start' | 'end'): { wall: Wall; end: 'start' | 'end' } {
  if (wall === 'north' || wall === 'south') return { wall: end === 'start' ? 'west' : 'east', end: wall === 'north' ? 'start' : 'end' };
  return { wall: end === 'start' ? 'north' : 'south', end: wall === 'west' ? 'start' : 'end' };
}

/**
 * Photos often put a door a few inches too close to a corner, so the cabinets on the next wall
 * would stand in the doorway. A door within reach of a run on the next wall moves along its own
 * wall (up to 24″) until it clears that run's depth, with a note. Returns a new openings list.
 */
export function clearCornerDoors(model: PhotoModel, notes: string[] = []): PhotoOpening[] {
  const room = model.room;
  return model.openings.map((o) => {
    if (o.type !== 'door') return o;
    const len = wallLen(o.wall, room);
    // The door may sit anywhere in [lo, hi] along its wall without meeting a neighbour's run.
    let lo = 0;
    let hi = len - o.widthIn;
    const blockers: Wall[] = [];
    for (const end of ['start', 'end'] as const) {
      const n = cornerNeighbour(o.wall, end);
      const nLen = wallLen(n.wall, room);
      // Along the neighbour wall, the door's swing reaches `o.widthIn` out from the corner.
      const near = (s: number, e: number) => (n.end === 'start' ? s < o.widthIn : e > nLen - o.widthIn);
      if (!model.runs.some((r) => r.wall === n.wall && near(r.startIn, r.endIn))) continue;
      let depth = 24;
      for (const a of model.appliances) {
        if (a.wall !== n.wall) continue;
        const role = APPLIANCE_ROLE[a.kind];
        const pick = role ? pickProduct(role, { widthIn: a.widthIn ?? APPLIANCE_WIDTHS[a.kind].def }) : null;
        if (pick && near(a.offsetIn, a.offsetIn + pick.widthIn)) depth = Math.max(depth, pick.product.depthIn);
      }
      if (end === 'start') lo = Math.max(lo, depth);
      else hi = Math.min(hi, len - depth - o.widthIn);
      blockers.push(n.wall);
    }
    if (lo > hi) return o;
    const next = Math.min(hi, Math.max(lo, o.offsetIn));
    if (next === o.offsetIn || Math.abs(next - o.offsetIn) > 36) return o;
    const by = next < o.offsetIn ? blockers[blockers.length - 1] : blockers[0];
    notes.push(`The door on the ${WALL_NAME(o.wall)} was moved ${Math.round(Math.abs(next - o.offsetIn))}″ so the cabinets on the ${WALL_NAME(by)} don’t stand in it.`);
    return { ...o, offsetIn: next };
  });
}

function wallOfFixed(f: FixedSpec, room: Room): Wall {
  if (f.rotation === 0) return 'north';
  if (f.rotation === 180) return 'south';
  if (f.rotation === 90) return 'east';
  void room;
  return 'west';
}

export interface PhotoBuild {
  doc: DesignDoc;
  /** Everything the builder changed or left out, in plain words. */
  notes: string[];
}

/**
 * Turns a photo model into a kitchen: validated, laid out with real cabinet sizes and built-in
 * products, with the look matched to Mise finishes. Pure apart from random item ids. It never
 * leaves a collision, an item outside the room, a door swinging into a cabinet or a blocked
 * island walkway: doors that would swing into something become cased openings, and an island
 * that blocks a walkway shrinks or is left out (with a note).
 */
export function buildFromPhotoModel(input: PhotoModel, name = 'My kitchen'): PhotoBuild {
  const checked = clampPhotoModel(input);
  const model = checked?.model ?? defaultPhotoModel();
  const surfaces = surfacesFromStyle(model.style);
  const cased = new Set<number>();
  let islandCap: number | null = null;
  let result: { items: PlacedItem[]; notes: string[] } = { items: [], notes: [] };
  const extra: string[] = [];
  model.openings = clearCornerDoors(model, extra);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { spec, notes } = photoSpec(model, { cased, islandCap });
    const built = buildFromSpec(spec, model.room, surfaces);
    result = { items: built.items, notes: [...notes, ...built.notes] };
    const report = runChecks(resolveAll(built.items), model.room);
    const bad = report.checks.filter((c) => c.level === 'bad');
    let retry = false;
    for (const c of bad.filter((k) => k.id.startsWith('swing-'))) {
      const door = built.items.find((i) => i.id === c.itemIds[0]);
      const idx = door ? doorIndex(model, door) : -1;
      if (idx >= 0 && !cased.has(idx)) {
        cased.add(idx);
        extra.push(`A door on the ${WALL_NAME(model.openings[idx].wall)} would swing into the cabinets, so it is drawn as a cased opening. Check its swing in the editor.`);
        retry = true;
      }
    }
    const islandItem = built.items.find((i) => getProduct(i.productId)?.kind === 'island');
    if (islandItem && bad.some((c) => c.itemIds.includes(islandItem.id))) {
      const w = islandItem.widthIn ?? getProduct('island')!.widthIn;
      islandCap = w - 12;
      retry = true;
      if (islandCap < 60) {
        model.island = null;
        extra.push('The island was left out: it would block a walkway.');
      }
    }
    if (!retry) break;
  }
  const notes = [...new Set([...(checked?.warnings ?? []), ...extra, ...result.notes])];
  return { doc: { name, room: model.room, surfaces, items: withFinishIds(result.items), version: 2 }, notes };
}

function doorIndex(model: PhotoModel, door: PlacedItem): number {
  let best = -1;
  let bestD = Infinity;
  model.openings.forEach((o, i) => {
    if (o.type !== 'door') return;
    const at = placeOnWall(o.wall, o.offsetIn + o.widthIn / 2, 0, model.room);
    const d = Math.hypot(at.x - door.x, at.y - door.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return bestD < 24 ? best : -1;
}
