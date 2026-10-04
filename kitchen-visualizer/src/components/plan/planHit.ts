/**
 * Which plan item a pointer press means, in room inches. Pure (no Konva, no DOM)
 * so it can be unit-tested.
 *
 * Konva's own hit graph answered "which shape is drawn on top here". In a plan that
 * is the wrong question: pendants, hoods and wall cabinets are drawn over the floor
 * pieces they hang above, so pressing the middle of the island grabbed a pendant and
 * pressing the fridge grabbed the bridge cabinet over it. Here a press means:
 *
 *   1. the selected item, if the press is on it (so whatever you picked stays grabbable,
 *      even when it is buried under something else);
 *   2. otherwise floor pieces before openings before overheads before pendants, and the
 *      smallest piece within a layer (a stool tucked under the island's overhang);
 *   3. rugs last, and an unselected rug is treated as floor for dragging (see `pickAt`),
 *      or a runner in the aisle would make one-finger panning impossible on a phone.
 *
 * Tapping the same spot again cycles through everything stacked there (`cycleAfter`).
 */
import type { AABB, Resolved } from '../../lib/geometry';
import { WALL_T } from './planStyle';

/** The item's drawn box in its own (unrotated) coordinates, centred on item.x/y. */
export interface LocalBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OVERHEAD = new Set(['wall', 'hood', 'microwave', 'shelf']);

/**
 * The box PlanItem draws its outline around. Openings sit IN the wall (local y from
 * -WALL_T to just inside the room), everything else is its footprint.
 */
export function itemLocalBox(r: Resolved): LocalBox {
  const k = r.product.kind;
  if (k === 'window' || k === 'door') return { x: -r.w / 2, y: -WALL_T, w: r.w, h: WALL_T + (k === 'door' ? 4 : 1.5) };
  return { x: -r.w / 2, y: -r.d / 2, w: r.w, h: r.d };
}

/** Konva rotates clockwise in a y-down space: local (lx, ly) -> room. */
export function localToRoom(item: { x: number; y: number; rotation: number }, lx: number, ly: number): { x: number; y: number } {
  const t = (item.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: item.x + lx * c - ly * s, y: item.y + lx * s + ly * c };
}

/** Room point -> the item's local coordinates (the inverse of localToRoom). */
export function roomToLocal(item: { x: number; y: number; rotation: number }, px: number, py: number): { x: number; y: number } {
  const t = (item.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = px - item.x;
  const dy = py - item.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** The drawn box as a room-inch AABB (what the selection overlay is published from). */
export function itemRoomBox(r: Resolved): AABB {
  const b = itemLocalBox(r);
  const pts = [
    localToRoom(r.item, b.x, b.y),
    localToRoom(r.item, b.x + b.w, b.y),
    localToRoom(r.item, b.x, b.y + b.h),
    localToRoom(r.item, b.x + b.w, b.y + b.h),
  ];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Lower ranks win: floor pieces, then openings, overheads, pendants, rugs. */
export function hitRank(r: Resolved): number {
  const k = r.product.kind;
  if (k === 'rug') return 4;
  if (k === 'pendant') return 3;
  if (k === 'window' || k === 'door') return 1;
  if (OVERHEAD.has(k) || r.z0 >= 48) return 2;
  return 0;
}

export interface Hit {
  id: string;
  /** True when the point is inside the drawn box itself, false when only inside its padding. */
  exact: boolean;
  /** Distance (room inches) from the point to the drawn box; 0 when exact. */
  dist: number;
  rank: number;
  area: number;
  rug: boolean;
}

/**
 * Every item under room point (px, py), best first (see the module comment).
 * `pad(r)` grows each item's box by that many room inches; touch input uses it so a
 * 24″ cabinet that is 19px on a phone still has a finger-sized target. Exact hits
 * always beat padded ones, so padding never steals a press from the item actually
 * under the finger.
 */
export function hitsAt(all: Resolved[], px: number, py: number, pad: (r: Resolved) => number, selectedId: string | null): Hit[] {
  const hits: Hit[] = [];
  for (const r of all) {
    const b = itemLocalBox(r);
    const p = roomToLocal(r.item, px, py);
    const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
    const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
    const dist = Math.hypot(dx, dy);
    const exact = dist === 0;
    if (!exact && dist > Math.max(0, pad(r))) continue;
    hits.push({ id: r.item.id, exact, dist, rank: hitRank(r), area: b.w * b.h, rug: r.product.kind === 'rug' });
  }
  hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    // A selected rug does not jump the queue: it lies under everything else.
    const sa = a.id === selectedId && !a.rug;
    const sb = b.id === selectedId && !b.rug;
    if (sa !== sb) return sa ? -1 : 1;
    if (!a.exact) return a.dist - b.dist || a.rank - b.rank;
    return a.rank - b.rank || a.area - b.area;
  });
  return hits;
}

export interface Pick {
  /** The item a press here grabs for dragging, or null to pan the view instead. */
  dragId: string | null;
  /** The item a tap here selects, or null to deselect. */
  tapId: string | null;
  /** Everything under the point, best first. */
  hits: Hit[];
}

/**
 * What a press at (px, py) does. An unselected rug is floor for dragging (the press
 * pans) but a tap still selects it; once selected it drags like anything else.
 */
export function pickAt(all: Resolved[], px: number, py: number, pad: (r: Resolved) => number, selectedId: string | null): Pick {
  const hits = hitsAt(all, px, py, pad, selectedId);
  const top = hits[0] ?? null;
  if (!top) return { dragId: null, tapId: null, hits };
  const dragId = top.rug && top.id !== selectedId ? null : top.id;
  return { dragId, tapId: cycleAfter(hits, selectedId), hits };
}

/**
 * Tap cycling: when the selected item is one of the exact hits under the point and
 * something else is stacked there too, a tap selects the next one down the stack
 * (island -> the pendant over it -> island ...). Otherwise the best hit.
 */
export function cycleAfter(hits: Hit[], selectedId: string | null): string | null {
  if (!hits.length) return null;
  // Natural stacking order, ignoring the selected-first preference. Rugs only take part
  // where nothing else is (tapping a selected stool must not hop to the rug under it).
  const exact = hits.filter((h) => h.exact);
  const solid = exact.filter((h) => !h.rug);
  const stack = (solid.length ? solid : exact).sort((a, b) => a.rank - b.rank || a.area - b.area);
  const i = stack.findIndex((h) => h.id === selectedId);
  if (i >= 0) return stack[(i + 1) % stack.length].id;
  return hits[0].id;
}

/**
 * Touch padding in room inches: grows a small item until it is at least `minPx`
 * across on screen, plus `basePx` all round.
 */
export function touchPad(r: Resolved, scale: number, minPx = 44, basePx = 4): number {
  const b = itemLocalBox(r);
  const shortPx = Math.min(b.w, b.h) * scale;
  return (Math.max(0, (minPx - shortPx) / 2) + basePx) / scale;
}
