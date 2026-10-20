import type { EdgeStyle, Room, Rotation } from '../types';
import { feetInches } from './format';

/**
 * A room's footprint as a closed rectilinear outline (every wall runs north-south or east-west,
 * which is how nearly every kitchen is built). Points are inches from the room's north-west
 * origin, y growing south, the same space as `PlacedItem.x/y`. A `Room` without an `outline`
 * is the plain rectangle `widthIn x lengthIn`, so every kitchen saved before free-form rooms
 * still loads and draws exactly as it did.
 */
export type Pt = [number, number];

export type WallName = 'north' | 'east' | 'south' | 'west';

/** How each edge style looks and behaves. Heights are inches above the floor (null: floor to ceiling). */
export interface StyleInfo {
  label: string;
  blurb: string;
  heightIn: number | null;
  thicknessIn: number;
  /** A door or window can be set into it. */
  holdsOpenings: boolean;
  /** Cabinets and appliances can stand flush against it. */
  backs: boolean;
  /** Hidden by the 3D cut-away when the camera is behind it (only full opaque walls). */
  cutaway: boolean;
}

export const EDGE_STYLES: Record<EdgeStyle, StyleInfo> = {
  wall: { label: 'Wall', blurb: 'A full-height wall. Doors and windows go here.', heightIn: null, thicknessIn: 5, holdsOpenings: true, backs: true, cutaway: true },
  half: { label: 'Half wall', blurb: 'A 42″ pony wall between kitchen and living room. Cabinets can back onto it.', heightIn: 42, thicknessIn: 5, holdsOpenings: false, backs: true, cutaway: false },
  bar: { label: 'Bar wall', blurb: 'A 42″ half wall with a counter ledge for stools on the room side.', heightIn: 42, thicknessIn: 5, holdsOpenings: false, backs: true, cutaway: false },
  rail: { label: 'Railing', blurb: 'A 36″ railing for an open stair or a step down.', heightIn: 36, thicknessIn: 1.5, holdsOpenings: false, backs: false, cutaway: false },
  glass: { label: 'Glass partition', blurb: 'A full-height glass wall that keeps the sightline open.', heightIn: null, thicknessIn: 1, holdsOpenings: false, backs: true, cutaway: false },
  beam: { label: 'Dropped beam', blurb: 'No wall: a bulkhead or beam overhead marks where the kitchen ends.', heightIn: 0, thicknessIn: 0, holdsOpenings: false, backs: false, cutaway: false },
  open: { label: 'Open', blurb: 'No wall at all: the floor just continues into the next area.', heightIn: 0, thicknessIn: 0, holdsOpenings: false, backs: false, cutaway: false },
};
export const EDGE_STYLE_ORDER: EdgeStyle[] = ['wall', 'half', 'bar', 'rail', 'glass', 'beam', 'open'];
export const isEdgeStyle = (v: unknown): v is EdgeStyle => typeof v === 'string' && v in EDGE_STYLES;
/** Depth of the dropped beam below the ceiling, and how wide it is. */
export const BEAM_DROP_IN = 12;
export const BEAM_WIDTH_IN = 10;

/** One straight wall of the outline. `wall` is the side of the room it stands on (its inward normal). */
export interface WallSeg {
  /** Stable within one outline: the index of the edge's first corner. */
  id: number;
  wall: WallName;
  /** The constant coordinate: y for a north/south wall, x for an east/west wall. */
  at: number;
  /** Extent along the wall, a0 < a1 (x for north/south, y for east/west). */
  a0: number;
  a1: number;
  /** Which room (0 is the main room) this wall belongs to. */
  room: number;
  /** The corner at the `a0` / `a1` end is convex (a corner that sticks out), so the wall's thickness wraps round it. */
  convex0: boolean;
  convex1: boolean;
  /** What stands along it. */
  style: EdgeStyle;
  /** Part of an open area (a zone) rather than a room's own walls. */
  zone: boolean;
}

export const MIN_WALL_IN = 12;
export const MAX_ROOM_IN = 1200;

export function rectOutline(widthIn: number, lengthIn: number): Pt[] {
  return [
    [0, 0],
    [widthIn, 0],
    [widthIn, lengthIn],
    [0, lengthIn],
  ];
}

/** The main room's outline: the drawn one, else its rectangle. */
export function outlineOf(room: Room): Pt[] {
  return room.outline && room.outline.length >= 4 ? room.outline : rectOutline(room.widthIn, room.lengthIn);
}

/** Every outline in the plan, rooms and open areas: the main room first, then the extras in order. */
export function allOutlines(room: Room): Pt[][] {
  return [outlineOf(room), ...(room.extra ?? []).map((e) => e.outline)];
}

/** Each space in the plan with its edge styles. Index 0 is the main room; index n is `extra[n - 1]`. */
export interface Space {
  index: number;
  id: string;
  name: string;
  pts: Pt[];
  styles: EdgeStyle[];
  zone: boolean;
}

export function spaces(room: Room): Space[] {
  const main = outlineOf(room);
  const out: Space[] = [{ index: 0, id: 'main', name: 'Main room', pts: main, styles: fitStyles(room.styles, main.length, 'wall'), zone: false }];
  (room.extra ?? []).forEach((e, i) => {
    const zone = e.kind === 'zone';
    out.push({ index: i + 1, id: e.id, name: e.name, pts: e.outline, styles: fitStyles(e.styles, e.outline.length, zone ? 'open' : 'wall'), zone });
  });
  return out;
}

/** `styles` made exactly `n` long, filling with `fallback`. */
export function fitStyles(styles: EdgeStyle[] | undefined, n: number, fallback: EdgeStyle): EdgeStyle[] {
  return Array.from({ length: n }, (_, i) => (styles && isEdgeStyle(styles[i]) ? styles[i] : fallback));
}

/** Outlines that have a floor: the main room and the extra rooms, not the open areas drawn over them. */
export function floorOutlines(room: Room): Pt[][] {
  return spaces(room).filter((sp) => !sp.zone).map((sp) => sp.pts);
}

/** Every space with a floor (not open areas), with its own flooring id when it has one (else the kitchen's). */
export function floorSpaces(room: Room): { id: string; name: string; pts: Pt[]; flooringId?: string }[] {
  const own = new Map((room.extra ?? []).map((e) => [e.id, e.flooringId]));
  return spaces(room)
    .filter((sp) => !sp.zone)
    .map((sp) => ({ id: sp.id, name: sp.name, pts: sp.pts, ...(own.get(sp.id) ? { flooringId: own.get(sp.id) } : {}) }));
}

export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function area(p: Pt[]): number {
  return Math.abs(signedArea(p));
}

export function bounds(p: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** An outline with a style per edge. */
export interface Styled {
  pts: Pt[];
  styles: EdgeStyle[];
}

/** Drops repeated points and merges collinear runs, so a wall is one wall however it was drawn. A merged wall keeps its first piece's style. */
export function cleanStyled(p: Pt[], styles?: EdgeStyle[], fallback: EdgeStyle = 'wall'): Styled {
  let pts = p.map((q): Pt => [q[0], q[1]]);
  let st = fitStyles(styles, pts.length, fallback);
  // Repeated points: the zero-length edge goes, and the corner that repeats the other.
  for (let i = 0; i < pts.length && pts.length > 1; ) {
    const j = (i + 1) % pts.length;
    if (pts[i][0] === pts[j][0] && pts[i][1] === pts[j][1]) {
      pts.splice(j === 0 ? i : j, 1);
      st.splice(i, 1);
    } else i++;
  }
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) {
        // Edge i-1 (a to b) and edge i (b to c) become one; it keeps edge i-1's style.
        pts = pts.filter((_, k) => k !== i);
        st = st.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return { pts, styles: st };
}

/** Drops repeated points and merges collinear runs. */
export function cleanOutline(p: Pt[]): Pt[] {
  return cleanStyled(p).pts;
}

/** Corners in the winding the rest of the code assumes (clockwise on screen: the inside is to the right of travel), with their edge styles following. */
export function normalizeStyled(p: Pt[], styles?: EdgeStyle[], fallback: EdgeStyle = 'wall'): Styled {
  const c = cleanStyled(p, styles, fallback);
  if (signedArea(c.pts) >= 0) return c;
  const n = c.pts.length;
  // Reversed, edge j runs between the same two corners as old edge n-2-j, so styles reverse with them.
  return { pts: c.pts.slice().reverse(), styles: Array.from({ length: n }, (_, j) => c.styles[(((n - 2 - j) % n) + n) % n]) };
}

export function normalizeOutline(p: Pt[]): Pt[] {
  return normalizeStyled(p).pts;
}

function segsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  // Axis-aligned edges only: they cross when one is horizontal, one vertical, and each passes strictly through the other.
  const aH = a[1] === b[1];
  const cH = c[1] === d[1];
  if (aH === cH) {
    // Parallel: overlapping collinear runs also make an invalid outline.
    if (aH) return a[1] === c[1] && Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 0;
    return a[0] === c[0] && Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 0;
  }
  const [h0, h1, v0, v1] = aH ? [a, b, c, d] : [c, d, a, b];
  const hy = h0[1];
  const vx = v0[0];
  return vx > Math.min(h0[0], h1[0]) && vx < Math.max(h0[0], h1[0]) && hy > Math.min(v0[1], v1[1]) && hy < Math.max(v0[1], v1[1]);
}

/** A message for the person if the outline cannot be a room, else null. */
export function outlineProblem(p: Pt[]): string | null {
  const pts = cleanOutline(p);
  if (pts.length < 4) return 'A room needs at least four corners.';
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a[0] !== b[0] && a[1] !== b[1]) return 'Walls have to run straight across or straight up and down.';
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < MIN_WALL_IN) return 'A wall is shorter than 1′. Move its corner or take it out.';
  }
  const b = bounds(pts);
  if (b.maxX - b.minX > MAX_ROOM_IN || b.maxY - b.minY > MAX_ROOM_IN) return 'That room is over 100′ across.';
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (j === i + 1 || (i === 0 && j === pts.length - 1)) continue;
      if (segsIntersect(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) return 'Two walls cross each other.';
    }
  }
  if (area(pts) < 36 * 36) return 'That room is smaller than 3′ × 3′.';
  return null;
}

/** The walls of one outline. The outline is assumed normalized (see `normalizeOutline`). */
export function segsOf(p: Pt[], room = 0, styles?: EdgeStyle[], zone = false): WallSeg[] {
  const out: WallSeg[] = [];
  const st = fitStyles(styles, p.length, zone ? 'open' : 'wall');
  const n = p.length;
  // Turning right (clockwise on screen) at a corner of a normalized outline means the corner points outward.
  const convexAt = (i: number) => {
    const a = p[(i + n - 1) % n];
    const b = p[i];
    const c = p[(i + 1) % n];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0;
  };
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const cs = convexAt(i);
    const ce = convexAt((i + 1) % n);
    if (a[1] === b[1]) {
      // Travelling east, the inside is to the right (south): a north wall. Travelling west: a south wall.
      const east = b[0] > a[0];
      out.push({ id: i, wall: east ? 'north' : 'south', at: a[1], a0: Math.min(a[0], b[0]), a1: Math.max(a[0], b[0]), room, convex0: east ? cs : ce, convex1: east ? ce : cs, style: st[i], zone });
    } else {
      // Travelling south the inside is to the right (west): an east wall. Travelling north: a west wall.
      const south = b[1] > a[1];
      out.push({ id: i, wall: south ? 'east' : 'west', at: a[0], a0: Math.min(a[1], b[1]), a1: Math.max(a[1], b[1]), room, convex0: south ? cs : ce, convex1: south ? ce : cs, style: st[i], zone });
    }
  }
  return out;
}

const segCache = new WeakMap<object, WallSeg[]>();

/** Every wall in the plan, main room first. Cached per room object. */
export function wallSegs(room: Room): WallSeg[] {
  const hit = segCache.get(room);
  if (hit) return hit;
  const out: WallSeg[] = [];
  for (const sp of spaces(room)) {
    for (const sg of segsOf(sp.pts, sp.index, sp.styles, sp.zone)) out.push({ ...sg, id: out.length });
  }
  segCache.set(room, out);
  return out;
}

export function pointInOutline(p: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = true;
  }
  return inside;
}

/** True when (x, y) is inside any room of the plan, or within `tol` of a wall. */
export function pointInRoom(room: Room, x: number, y: number, tol = 0): boolean {
  if (!room.outline && !room.extra?.length) return x >= -tol && y >= -tol && x <= room.widthIn + tol && y <= room.lengthIn + tol;
  for (const o of floorOutlines(room)) {
    if (pointInOutline(o, x, y)) return true;
    if (tol > 0) {
      for (const dx of [-tol, tol]) for (const dy of [-tol, tol]) if (pointInOutline(o, x + dx, y + dy)) return true;
    }
  }
  return false;
}

/** The union bounding box of every room: what the plan view frames and what old code calls width and length. */
export function planBounds(room: Room): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = floorOutlines(room).map(bounds);
  return {
    minX: Math.min(...b.map((x) => x.minX)),
    minY: Math.min(...b.map((x) => x.minY)),
    maxX: Math.max(...b.map((x) => x.maxX)),
    maxY: Math.max(...b.map((x) => x.maxY)),
  };
}

/** The whole plan's extent from the origin (the rooms are kept at x, y >= 0): what the plan and 3D views frame. */
export function planSize(room: Room): { W: number; L: number } {
  const b = planBounds(room);
  return { W: Math.max(room.widthIn, b.maxX), L: Math.max(room.lengthIn, b.maxY) };
}

/** Re-derives `widthIn` / `lengthIn` from the outline so the many callers that still read them stay right. */
export function withOutline(room: Room, outline: Pt[]): Room {
  const pts = normalizeOutline(outline);
  const b = bounds(pts);
  const shifted = pts.map(([x, y]): Pt => [x - b.minX, y - b.minY]);
  const isRect = shifted.length === 4;
  const extra = room.extra?.map((e) => ({ ...e, outline: e.outline.map(([x, y]): Pt => [x - b.minX, y - b.minY]) }));
  return { ...room, widthIn: b.maxX - b.minX, lengthIn: b.maxY - b.minY, outline: isRect ? undefined : shifted, extra };
}

export const WALL_ROTATION_OF: Record<WallName, Rotation> = { north: 0, east: 90, south: 180, west: 270 };

// ── drawing helpers (the wall tool) ──────────────────────────────────────────

export const GRID_IN = 6;

export interface DrawSnap {
  point: Pt;
  /** What the point snapped to, for the on-screen hint. */
  kind: 'corner' | 'align' | 'grid' | 'free';
  /** Guides to draw: the x or y the point lined up with. */
  guideX?: number;
  guideY?: number;
}

/**
 * Snaps the cursor while drawing a wall from `from`: first to an existing corner (closing the
 * room), then to the horizontal/vertical through `from` (walls run square), then to another
 * corner's x or y (so two walls line up), then to the grid.
 */
export function snapDrawPoint(raw: Pt, from: Pt | null, corners: Pt[], reach = 10, grid = GRID_IN): DrawSnap {
  for (const c of corners) {
    if (Math.hypot(c[0] - raw[0], c[1] - raw[1]) <= reach) return { point: [c[0], c[1]], kind: 'corner', guideX: c[0], guideY: c[1] };
  }
  let [x, y] = raw;
  let kind: DrawSnap['kind'] = 'free';
  let guideX: number | undefined;
  let guideY: number | undefined;
  if (from) {
    // Square to the previous corner: whichever axis the cursor has moved furthest along wins.
    if (Math.abs(x - from[0]) >= Math.abs(y - from[1])) {
      y = from[1];
      guideY = from[1];
    } else {
      x = from[0];
      guideX = from[0];
    }
    kind = 'align';
  }
  const along = from && guideY !== undefined ? 'x' : from && guideX !== undefined ? 'y' : null;
  const free = (v: number) => Math.round(v / grid) * grid;
  const snapTo = (v: number, cands: number[]) => {
    let best = v;
    let bd = reach;
    for (const c of cands) if (Math.abs(c - v) < bd) { bd = Math.abs(c - v); best = c; }
    return best;
  };
  if (along === 'x') {
    const sx = snapTo(x, corners.map((c) => c[0]));
    if (sx !== x) { x = sx; guideX = sx; } else x = free(x);
  } else if (along === 'y') {
    const sy = snapTo(y, corners.map((c) => c[1]));
    if (sy !== y) { y = sy; guideY = sy; } else y = free(y);
  } else {
    const sx = snapTo(x, corners.map((c) => c[0]));
    const sy = snapTo(y, corners.map((c) => c[1]));
    x = sx !== x ? sx : free(x);
    y = sy !== y ? sy : free(y);
    if (sx !== raw[0]) guideX = sx;
    if (sy !== raw[1]) guideY = sy;
    kind = guideX !== undefined || guideY !== undefined ? 'align' : 'grid';
  }
  if (kind === 'align' && guideX === undefined && guideY === undefined) kind = 'grid';
  return { point: [x, y], kind, guideX, guideY };
}

/** Turns a single dragged rectangle into the four-corner outline (the quick way to start). */
export function rectFromCorners(a: Pt, b: Pt): Pt[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return rectOutline(x1 - x0, y1 - y0).map(([x, y]): Pt => [x + x0, y + y0]);
}

// ── editing operations (pure; the sketcher and the store both use them) ──────

/** A copy of `p` with edge `i` (corner i to corner i+1) moved so its line is at `to`. Not validated. */
export function moveEdge(p: Pt[], i: number, to: number): Pt[] {
  const q = p.map(([x, y]): Pt => [x, y]);
  const a = q[i];
  const b = q[(i + 1) % q.length];
  const horizontal = a[1] === b[1];
  a[horizontal ? 1 : 0] = to;
  b[horizontal ? 1 : 0] = to;
  return q;
}

/**
 * Pushes a section of edge `i` in or out: `from`..`to` are positions along the wall (plan inches),
 * `depth` is how far toward the outside (positive) or inside (negative) it goes. A bump-out for a
 * bay or a pantry, or a notch for a chimney breast. The front and the two pieces of the old wall
 * keep the wall's style; the two sides of the bump are plain walls. Null when the section does not
 * fit on the wall.
 */
export function bumpStyled(p: Pt[], styles: EdgeStyle[], i: number, from: number, to: number, depth: number, fallback: EdgeStyle = 'wall'): Styled | null {
  const n = p.length;
  const a = p[i];
  const b = p[(i + 1) % n];
  const horizontal = a[1] === b[1];
  const lo = Math.min(a[horizontal ? 0 : 1], b[horizontal ? 0 : 1]);
  const hi = Math.max(a[horizontal ? 0 : 1], b[horizontal ? 0 : 1]);
  const s = Math.max(lo, Math.min(from, to));
  const e = Math.min(hi, Math.max(from, to));
  if (e - s < MIN_WALL_IN || depth === 0) return null;
  // Which way is outside? The inside is to the right of travel in a normalized outline.
  const fwd = (horizontal ? b[0] - a[0] : b[1] - a[1]) > 0;
  const outwardSign = horizontal ? (fwd ? -1 : 1) : fwd ? 1 : -1; // north wall: outside is -y; east wall: +x
  const off = outwardSign * depth;
  const pt = (along: number, across: number): Pt => (horizontal ? [along, a[1] + across] : [a[0] + across, along]);
  // In travel order the section runs s..e if travelling in the positive direction, else e..s.
  const first = fwd ? s : e;
  const second = fwd ? e : s;
  const mid: Pt[] = [pt(first, 0), pt(first, off), pt(second, off), pt(second, 0)];
  const out = [...p.slice(0, i + 1), ...mid, ...p.slice(i + 1)];
  const st = fitStyles(styles, n, fallback);
  const mine = st[i];
  const outSt = [...st.slice(0, i), mine, fallback === 'open' ? 'open' : 'wall', mine, fallback === 'open' ? 'open' : 'wall', mine, ...st.slice(i + 1)] as EdgeStyle[];
  return cleanStyled(out, outSt, fallback);
}

export function bumpEdge(p: Pt[], i: number, from: number, to: number, depth: number): Pt[] | null {
  return bumpStyled(p, [], i, from, to, depth)?.pts ?? null;
}

/** Does any floor of `a` lie over any floor of `b`? (A 3″ grid of sample points: plenty for walls on 1/4″ steps.) */
export function outlinesOverlap(a: Pt[], b: Pt[], step = 3): boolean {
  const ba = bounds(a);
  const bb = bounds(b);
  const x0 = Math.max(ba.minX, bb.minX);
  const x1 = Math.min(ba.maxX, bb.maxX);
  const y0 = Math.max(ba.minY, bb.minY);
  const y1 = Math.min(ba.maxY, bb.maxY);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return false;
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInOutline(a, x, y) && pointInOutline(b, x, y)) return true;
  return false;
}

/**
 * Finishes a wall being drawn: from the last corner back to the first, adding the one corner that
 * keeps every wall square when the last corner is not already in line with the first.
 */
export function closeDrawing(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] === last[0] || first[1] === last[1]) return pts;
  const prev = pts[pts.length - 2];
  const prevHorizontal = prev[1] === last[1];
  return [...pts, prevHorizontal ? [last[0], first[1]] : [first[0], last[1]]];
}

/** Sets the length of edge `i` by moving the wall at its far end (the walls either side stretch to follow). */
export function setEdgeLength(p: Pt[], i: number, length: number): Pt[] {
  const n = p.length;
  const a = p[i];
  const b = p[(i + 1) % n];
  const horizontal = a[1] === b[1];
  const dir = (horizontal ? b[0] - a[0] : b[1] - a[1]) >= 0 ? 1 : -1;
  const target = (horizontal ? a[0] : a[1]) + dir * length;
  return moveEdge(p, (i + 1) % n, target);
}

/**
 * A length typed the way a designer writes it, in inches (or null). `12'6`, `12' 6"`, `12-6`, `12 6`,
 * `12.5` and `12` are feet (and inches); `150"` and `150in` are inches.
 */
export function parseLengthIn(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 4) / 4;
  m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot|-|\s)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/.exec(s);
  if (m) return Math.round((parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * 4) / 4;
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  return m ? Math.round(parseFloat(m[1]) * 12 * 4) / 4 : null;
}

/** A rectilinear floor as non-overlapping rectangles (horizontal slabs between corner rows), for drawing it as boxes. */
export function floorRects(p: Pt[]): { x0: number; y0: number; x1: number; y1: number }[] {
  const ys = [...new Set(p.map((q) => q[1]))].sort((a, b) => a - b);
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    const mid = (y0 + y1) / 2;
    // The vertical walls this slab crosses, left to right, pair up into the stretches of floor.
    const xs: number[] = [];
    for (let k = 0; k < p.length; k++) {
      const a = p[k];
      const b = p[(k + 1) % p.length];
      if (a[0] === b[0] && Math.min(a[1], b[1]) < mid && Math.max(a[1], b[1]) > mid) xs.push(a[0]);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) out.push({ x0: xs[k], y0, x1: xs[k + 1], y1 });
  }
  return out;
}

/** Floor area of every room in the plan, square inches. */
export function floorAreaIn2(room: Room): number {
  return floorOutlines(room).reduce((n, o) => n + area(o), 0);
}

/** Total length of every wall, inches (each room's own walls, so a shared wall counts for both rooms). */
export function perimeterIn(room: Room): number {
  return wallSegs(room).reduce((n, s) => n + (s.a1 - s.a0), 0);
}

/** Floor area in whole square feet. */
export function floorSqFt(room: Room): number {
  return Math.round(floorAreaIn2(room) / 144);
}

/** "16′ 8″ × 13′" for a plain room; "16′ × 13′ overall" for a drawn one; with the room count when there are several. */
export function roomLabel(room: Room): string {
  const size = `${feetInches(room.widthIn)} × ${feetInches(room.lengthIn)}`;
  const rooms = 1 + (room.extra ?? []).filter((e) => e.kind !== 'zone').length;
  if (rooms > 1) return `${rooms} rooms`;
  return room.outline || room.extra?.length ? `${size} overall` : size;
}
