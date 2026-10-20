import type { EdgeStyle, PlacedItem, Room } from '../types';
import { getProduct, isOpening, itemWidth } from '../data/catalog';
import { makeId } from './id';
import { ROOM_KINDS } from './roomKinds';
import { flushSeg, resolve } from './geometry';
import {
  EDGE_STYLES,
  bounds,
  bumpStyled,
  floorOutlines,
  rectOutline as rectPts,
  moveEdge,
  normalizeStyled,
  outlineProblem,
  outlinesOverlap,
  planBounds,
  pointInOutline,
  rectOutline,
  setEdgeLength,
  spaces,
  wallSegs,
  type Pt,
  type Space,
  type WallSeg,
} from './outline';

/**
 * Pure editing of a room and what stands in it, shared by the setup wizard's sketcher, the editor's
 * "Walls & rooms" dialog, the plan's own Add a room, and the design store. Each function returns a
 * new `Draft`, or `{ error }` in plain words when the change would not make a room.
 */
export interface Draft {
  room: Room;
  items: PlacedItem[];
}
export type Edit = Draft | { error: string };
export const isError = (e: Edit): e is { error: string } => 'error' in e;

const MAX_EXTRA = 8;

const isCanonicalRect = (p: Pt[], w: number, l: number) => {
  const r = rectOutline(w, l);
  return p.length === 4 && p.every((q, i) => q[0] === r[i][0] && q[1] === r[i][1]);
};

const allDefault = (st: EdgeStyle[], fallback: EdgeStyle) => st.every((x) => x === fallback);

/** Puts the spaces back into a room, tidying: no `outline` for a plain rectangle, no `styles` that say nothing. */
function build(room: Room, sp: Space[]): Room {
  const main = sp[0];
  const b = bounds(main.pts);
  const w = Math.round((b.maxX - b.minX) * 4) / 4;
  const l = Math.round((b.maxY - b.minY) * 4) / 4;
  // A plain rectangle is only dropped to its two numbers when it sits at the origin in the usual corner order.
  const plain = isCanonicalRect(main.pts, w, l);
  const out: Room = { ...room, widthIn: w, lengthIn: l };
  delete out.outline;
  delete out.styles;
  delete out.extra;
  if (!plain) out.outline = main.pts;
  if (!allDefault(main.styles, 'wall')) out.styles = main.styles;
  const extra = sp.slice(1).map((s) => {
    const e = (room.extra ?? [])[s.index - 1];
    return {
      id: s.id,
      name: s.name,
      outline: s.pts,
      ...(e?.ceilingIn ? { ceilingIn: e.ceilingIn } : {}),
      ...(s.zone ? { kind: 'zone' as const } : {}),
      ...(!allDefault(s.styles, s.zone ? 'open' : 'wall') ? { styles: s.styles } : {}),
    };
  });
  if (extra.length) out.extra = extra;
  return out;
}

/** Shifts the plan so its north-west corner is the origin and refreshes the main room's width and length. */
export function rebase(d: Draft): Draft {
  const pb = planBounds(d.room);
  const dx = -pb.minX;
  const dy = -pb.minY;
  const move = (o: Pt[]): Pt[] => (dx || dy ? o.map(([x, y]): Pt => [x + dx, y + dy]) : o);
  const sp = spaces(d.room).map((s) => ({ ...s, pts: move(s.pts) }));
  const room = build(d.room, sp);
  const items = dx || dy ? d.items.map((it) => ({ ...it, x: it.x + dx, y: it.y + dy })) : d.items;
  return { room, items };
}

/** Which space a wall belongs to, and the index of its first corner in that space. */
function locate(room: Room, seg: WallSeg): { sp: Space; i: number } {
  const all = spaces(room);
  let offset = 0;
  for (let r = 0; r < seg.room; r++) offset += all[r].pts.length;
  return { sp: all[seg.room], i: seg.id - offset };
}

function withSpace(room: Room, sp: Space, pts: Pt[], styles: EdgeStyle[]): Room {
  const all = spaces(room).map((s) => (s.index === sp.index ? { ...s, pts, styles } : s));
  return build(room, all);
}

/** Rooms may touch but not overlap; open areas may not overlap each other; every open area must sit on a floor. */
function spacesProblem(room: Room): string | null {
  const all = spaces(room);
  const rooms = all.filter((s) => !s.zone);
  const zones = all.filter((s) => s.zone);
  for (let a = 0; a < rooms.length; a++) {
    for (let b = a + 1; b < rooms.length; b++) {
      if (outlinesOverlap(rooms[a].pts, rooms[b].pts)) return 'Two rooms can’t overlap. Draw the new room beside the other, sharing a wall.';
    }
  }
  for (let a = 0; a < zones.length; a++) {
    for (let b = a + 1; b < zones.length; b++) {
      if (outlinesOverlap(zones[a].pts, zones[b].pts)) return 'Two open areas can’t overlap. Draw the new one beside the other.';
    }
  }
  const floors = floorOutlines(room);
  for (const z of zones) {
    const bb = bounds(z.pts);
    for (let y = bb.minY + 3; y < bb.maxY; y += 6) {
      for (let x = bb.minX + 3; x < bb.maxX; x += 6) {
        if (pointInOutline(z.pts, x, y) && !floors.some((f) => pointInOutline(f, x, y))) return 'An open area has to sit on the floor of your rooms. Draw it inside them.';
      }
    }
  }
  return null;
}

function checked(room: Room, items: PlacedItem[], keepOrigin = false): Edit {
  const bad = spacesProblem(room);
  if (bad) return { error: bad };
  // Mid-drag the plan keeps its origin (a wall dragged past it would shift everything under the
  // pointer); the drag rebases once when it ends.
  return keepOrigin ? { room: build(room, spaces(room)), items } : rebase({ room, items });
}

/** Replaces the main room's walls (all plain walls again). Things stay where they are. */
export function setMainOutline(d: Draft, outline: Pt[]): Edit {
  const n = normalizeStyled(outline);
  const bad = outlineProblem(n.pts);
  if (bad) return { error: bad };
  const all = spaces(d.room).map((s) => (s.index === 0 ? { ...s, pts: n.pts, styles: n.styles } : s));
  return checked(build(d.room, all), d.items);
}

/** Moves a wall's line to `to`; things standing against it (cabinets, doors, windows) move with it. */
export function moveWallTo(d: Draft, segId: number, to: number, opts: { keepOrigin?: boolean } = {}): Edit {
  const seg = wallSegs(d.room).find((q) => q.id === segId);
  if (!seg) return { error: 'That wall is gone.' };
  const { sp, i } = locate(d.room, seg);
  const target = Math.round(to * 2) / 2;
  const n = normalizeStyled(moveEdge(sp.pts, i, target), sp.styles, sp.zone ? 'open' : 'wall');
  const bad = outlineProblem(n.pts);
  if (bad) return { error: bad };
  const horizontal = seg.wall === 'north' || seg.wall === 'south';
  const delta = target - seg.at;
  const items = d.items.map((it) => {
    const r = resolve(it);
    if (!r || flushSeg(r, d.room)?.id !== seg.id) return it;
    return horizontal ? { ...it, y: it.y + delta } : { ...it, x: it.x + delta };
  });
  return checked(withSpace(d.room, sp, n.pts, n.styles), items, opts.keepOrigin);
}

/** Sets a wall's length by moving the wall at its far end. */
export function setWallLength(d: Draft, segId: number, length: number): Edit {
  const seg = wallSegs(d.room).find((q) => q.id === segId);
  if (!seg) return { error: 'That wall is gone.' };
  const { sp, i } = locate(d.room, seg);
  const n = normalizeStyled(setEdgeLength(sp.pts, i, Math.round(length * 2) / 2), sp.styles, sp.zone ? 'open' : 'wall');
  const bad = outlineProblem(n.pts);
  if (bad) return { error: bad };
  return checked(withSpace(d.room, sp, n.pts, n.styles), d.items);
}

/** Pushes a section of a wall out (positive depth) or in (negative): a bay, a pantry nook, a chimney breast. */
export function bumpWall(d: Draft, segId: number, from: number, to: number, depth: number): Edit {
  const seg = wallSegs(d.room).find((q) => q.id === segId);
  if (!seg) return { error: 'That wall is gone.' };
  const { sp, i } = locate(d.room, seg);
  const out = bumpStyled(sp.pts, sp.styles, i, from, to, depth, sp.zone ? 'open' : 'wall');
  if (!out) return { error: 'The section has to be at least 1′ wide and sit on the wall.' };
  const n = normalizeStyled(out.pts, out.styles, sp.zone ? 'open' : 'wall');
  const bad = outlineProblem(n.pts);
  if (bad) return { error: bad };
  return checked(withSpace(d.room, sp, n.pts, n.styles), d.items);
}

/**
 * Adds a space. A `room` has a floor and walls and sits beside the others. A `zone` (the kitchen
 * part of an open-plan room) is drawn inside the rooms; its border is open until styled.
 */
export function addRoom(d: Draft, outline: Pt[], name?: string, kind: 'room' | 'zone' = 'room'): Edit & { id?: string } {
  const zone = kind === 'zone';
  const n = normalizeStyled(outline, undefined, zone ? 'open' : 'wall');
  const bad = outlineProblem(n.pts);
  if (bad) return { error: bad };
  if ((d.room.extra?.length ?? 0) >= MAX_EXTRA) return { error: `A plan can hold up to ${MAX_EXTRA} more rooms and open areas.` };
  const id = makeId();
  const count = (d.room.extra ?? []).filter((e) => (e.kind === 'zone') === zone).length;
  const label = name?.trim().slice(0, 40) || (zone ? (count === 0 ? 'Kitchen' : `Area ${count + 1}`) : `Room ${count + 2}`);
  const extra = [...(d.room.extra ?? []), { id, name: label, outline: n.pts, ...(zone ? { kind: 'zone' as const } : {}), ...(zone ? {} : n.styles.some((x) => x !== 'wall') ? { styles: n.styles } : {}) }];
  const out = checked({ ...d.room, extra }, d.items);
  return isError(out) ? out : { ...out, id };
}

export function removeRoom(d: Draft, id: string): Draft {
  const extra = d.room.extra?.filter((e) => e.id !== id);
  const room: Room = { ...d.room, extra: extra?.length ? extra : undefined };
  if (!room.extra) delete room.extra;
  return { room, items: d.items };
}

export function renameRoom(d: Draft, id: string, name: string): Draft {
  return { ...d, room: { ...d.room, extra: d.room.extra?.map((e) => (e.id === id ? { ...e, name: name.trim().slice(0, 40) || e.name } : e)) } };
}

/** Do two walls lie along the same line, facing each other, with most of one running along the other? */
function coincident(a: WallSeg, b: WallSeg): boolean {
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;
  if (b.wall !== opposite[a.wall] || Math.abs(a.at - b.at) > 1) return false;
  const ov = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0);
  return ov > 0.5 * Math.min(a.a1 - a.a0, b.a1 - b.a0);
}

function withStyles(d: Draft, change: Map<string, EdgeStyle>): Room {
  // key: `${spaceIndex}:${edge}`
  const all = spaces(d.room).map((s) => ({ ...s, styles: s.styles.map((st, i) => change.get(`${s.index}:${i}`) ?? st) }));
  return build(d.room, all);
}

/**
 * Sets what stands along one wall. A wall shared by two rooms changes on both sides, so "open" is
 * open from either room. A style that cannot hold doors and windows is refused while any are in it.
 */
export function setEdgeStyle(d: Draft, segId: number, style: EdgeStyle): Edit {
  const segs = wallSegs(d.room);
  const seg = segs.find((q) => q.id === segId);
  if (!seg) return { error: 'That wall is gone.' };
  const targets = [seg, ...segs.filter((o) => o.id !== seg.id && o.zone === seg.zone && coincident(seg, o))];
  if (!EDGE_STYLES[style].holdsOpenings) {
    const blocking = d.items.some((it) => {
      const r = resolve(it);
      if (!r || !isOpening(r.product)) return false;
      const own = flushSeg(r, d.room);
      return !!own && targets.some((t) => t.id === own.id);
    });
    if (blocking) return { error: `Take the doors and windows out of this wall first: a ${EDGE_STYLES[style].label.toLowerCase()} can’t hold them.` };
  }
  const change = new Map<string, EdgeStyle>();
  for (const t of targets) {
    const { sp, i } = locate(d.room, t);
    change.set(`${sp.index}:${i}`, style);
  }
  return rebase({ room: withStyles(d, change), items: d.items });
}

/** Sets every edge of a space at once (an open area's whole border: half wall, railing, open…). Doors and windows on its walls stay put when the style is `wall`; otherwise they must be removed first. */
export function setSpaceStyle(d: Draft, spaceIndex: number, style: EdgeStyle): Edit {
  const sp = spaces(d.room)[spaceIndex];
  if (!sp) return { error: 'That area is gone.' };
  const segs = wallSegs(d.room).filter((q) => q.room === spaceIndex);
  let out: Edit = d;
  for (const sg of segs) {
    out = setEdgeStyle(isError(out) ? d : out, sg.id, style);
    if (isError(out)) return out;
  }
  return out;
}

/** Puts a door or window on a wall at `along` (plan inches), clamped to the wall and clear of other openings. */
export function placeOpening(d: Draft, productId: string, segId: number, along: number, widthIn?: number): Edit & { id?: string } {
  const product = getProduct(productId);
  const seg = wallSegs(d.room).find((q) => q.id === segId);
  if (!product || !isOpening(product) || !seg) return { error: 'That can’t go there.' };
  if (!EDGE_STYLES[seg.style].holdsOpenings) return { error: `A ${EDGE_STYLES[seg.style].label.toLowerCase()} can’t hold a door or window. Make it a wall first.` };
  const w = widthIn ?? product.widthIn;
  if (seg.a1 - seg.a0 < w) return { error: 'That wall is too short for it.' };
  const a = Math.min(Math.max(Math.round(along), seg.a0 + w / 2), seg.a1 - w / 2);
  const alongX = seg.wall === 'north' || seg.wall === 'south';
  const { x, y } = alongX ? { x: a, y: seg.at } : { x: seg.at, y: a };
  const rotation = ({ north: 0, east: 90, south: 180, west: 270 } as const)[seg.wall];
  const id = makeId();
  const item: PlacedItem = { id, productId, x, y, rotation, finishIndex: 0, ...(widthIn ? { widthIn } : {}) };
  // Not on top of another opening on the same wall.
  const mine = resolve(item);
  const clash = d.items.some((o) => {
    const r = resolve(o);
    if (!r || !mine || !isOpening(r.product) || flushSeg(r, d.room)?.id !== seg.id) return false;
    const [s0, s1] = alongX ? [r.box.minX, r.box.maxX] : [r.box.minY, r.box.maxY];
    const [m0, m1] = alongX ? [mine.box.minX, mine.box.maxX] : [mine.box.minY, mine.box.maxY];
    return Math.min(s1, m1) - Math.max(s0, m0) > 1;
  });
  if (clash) return { error: 'There’s already a door or window there.' };
  return { room: d.room, items: [...d.items, item], id };
}

export const openingWidth = (it: PlacedItem): number => {
  const p = getProduct(it.productId);
  return p ? itemWidth(it, p) : 0;
};

/** How much of a new room's edge runs along walls already there (inches), counting each edge in 6" steps. */
function sharedWall(rect: Pt[], floors: Pt[][]): number {
  const [x0, y0] = rect[0];
  const [x1, y1] = rect[2];
  let n = 0;
  const probe = (x: number, y: number) => floors.some((f) => pointInOutline(f, x, y));
  for (let x = x0 + 3; x < x1; x += 6) {
    if (probe(x, y0 - 1)) n += 6;
    if (probe(x, y1 + 1)) n += 6;
  }
  for (let y = y0 + 3; y < y1; y += 6) {
    if (probe(x0 - 1, y)) n += 6;
    if (probe(x1 + 1, y)) n += 6;
  }
  return n;
}

/**
 * Adds a room of a known kind (living room, bathroom, pantry...) at its usual size, set beside the
 * rooms already there so it shares a wall (east first, then south, west, north). Resize it afterwards.
 */
export function addRoomOfKind(d: Draft, kindId: string): Edit & { id?: string } {
  const kind = ROOM_KINDS.find((k) => k.id === kindId);
  if (!kind) return { error: 'That kind of room isn’t available.' };
  const floors = floorOutlines(d.room);
  const { widthIn: w, lengthIn: l } = kind;
  const spots: [number, number][] = [];
  for (const f of floors) {
    const b = bounds(f);
    spots.push([b.maxX, b.minY], [b.maxX, b.maxY - l], [b.minX, b.maxY], [b.maxX - w, b.maxY], [b.minX - w, b.minY], [b.minX - w, b.maxY - l], [b.minX, b.minY - l], [b.maxX - w, b.minY - l]);
  }
  for (const [x, y] of spots) {
    const rect = rectPts(w, l).map(([px, py]): Pt => [px + x, py + y]);
    if (floors.some((f) => outlinesOverlap(f, rect))) continue;
    if (sharedWall(rect, floors) < 36) continue;
    const out = addRoom(d, rect, kind.label);
    if (!isError(out)) {
      // Join it to what it sits beside: a walkway for an open room, a door for a bath or bedroom.
      const joined = connectNewRoom(out, out.id!, kind.link.productId, kind.link.widthIn);
      // A second "Bathroom" is "Bathroom 2".
      const same = (out.room.extra ?? []).filter((e) => e.name === kind.label || e.name.startsWith(`${kind.label} `));
      if (same.length > 1) {
        const last = out.room.extra![out.room.extra!.length - 1];
        return { ...renameRoom(joined, last.id, `${kind.label} ${same.length}`), id: out.id };
      }
      return { ...joined, id: out.id };
    }
  }
  return { error: 'There’s no free wall to put it beside. Use Draw to place it yourself.' };
}

/**
 * Cuts a passage (a walkway, a doorway or a door) through the longest wall a room shares with
 * another. Returns the draft unchanged when they share no wall long enough.
 */
export function connectNewRoom(d: Draft, roomId: string, productId: string, widthIn: number): Draft {
  const all = spaces(d.room);
  const me = all.find((s) => s.id === roomId);
  if (!me) return d;
  const segs = wallSegs(d.room);
  let best: { seg: WallSeg; from: number; to: number } | null = null;
  for (const mine of segs.filter((q) => q.room === me.index)) {
    for (const other of segs.filter((q) => q.room !== me.index && !q.zone && coincident(mine, q))) {
      const from = Math.max(mine.a0, other.a0);
      const to = Math.min(mine.a1, other.a1);
      if (to - from >= widthIn + 12 && (!best || to - from > best.to - best.from)) best = { seg: mine, from, to };
    }
  }
  if (!best) return d;
  // Doors swing into the new room, so they go on its side of the wall; a walkway has no side.
  const out = placeOpening(d, productId, best.seg.id, (best.from + best.to) / 2, widthIn);
  return isError(out) ? d : { room: out.room, items: out.items };
}
