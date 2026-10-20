/**
 * Feature walls: one wall in an accent colour, wainscoting or board and batten to chair-rail
 * height, shiplap, or tile from floor to ceiling (a bathroom's wet wall).
 *
 * Stored on the room as `wallFinishes`, keyed `${spaceId}:${edge}` (the edge's index in that
 * room's outline, as WallSeg.id). Editing walls renumbers edges, so after every room edit the
 * finishes are carried over by geometry, not index (carryWallFinishes): each new wall takes the
 * finish of the old wall in the same room, facing the same way, that it overlaps, the nearest one
 * when there are several. A wall that is moved, lengthened or split by a bump-out keeps its finish;
 * the two new sides of a bump-out start plain.
 */
import type { Room, WallFinish, WallPanel } from '../types';
import { spaces, wallSegs, type WallSeg } from './outline';

export const WALL_PANELS: { id: WallPanel; label: string; blurb: string; heightIn?: number }[] = [
  { id: 'wainscot', label: 'Wainscoting', blurb: 'Framed panels to chair-rail height, in trim white', heightIn: 36 },
  { id: 'board-batten', label: 'Board & batten', blurb: 'Flat panel with battens every 16″, in trim white', heightIn: 54 },
  { id: 'shiplap', label: 'Shiplap', blurb: '6″ boards, floor to ceiling, in the wall colour' },
  { id: 'tile', label: 'Tile', blurb: 'Floor to ceiling: a bathroom’s wet wall or a feature wall' },
];

/** Installed price per square foot (tile is the tile's own price plus 10% overage). */
export const PANEL_PRICE: Record<Exclude<WallPanel, 'tile'>, number> = { wainscot: 22, 'board-batten': 16, shiplap: 12 };

export const isPanel = (v: unknown): v is WallPanel => v === 'wainscot' || v === 'board-batten' || v === 'shiplap' || v === 'tile';

/** The key a wall's finish is stored under. */
export function wallKey(room: Room, seg: WallSeg): string {
  return `${spaces(room)[seg.room]?.id ?? 'main'}:${seg.id}`;
}

/** The finish on one wall, if it has one (full walls only). */
export function finishFor(room: Room, seg: WallSeg): WallFinish | undefined {
  if (seg.style !== 'wall' || seg.zone) return undefined;
  return room.wallFinishes?.[wallKey(room, seg)];
}

/** How high a panel finish goes on a wall `ceilingIn` tall. */
export function panelTop(f: WallFinish, ceilingIn: number): number {
  if (f.panel === 'tile' || f.panel === 'shiplap') return ceilingIn;
  const def = WALL_PANELS.find((p) => p.id === f.panel)?.heightIn ?? 36;
  return Math.max(12, Math.min(ceilingIn - 6, f.panelHeightIn ?? def));
}

/** `next` with its wall finishes carried over from `prev` by geometry (see the top of this file). */
export function carryWallFinishes(prev: Room, next: Room): Room {
  const old = prev.wallFinishes;
  if (!old || !Object.keys(old).length) {
    if (!next.wallFinishes) return next;
    const { wallFinishes: _drop, ...rest } = next;
    return rest;
  }
  const prevIds = spaces(prev).map((s) => s.id);
  const was = wallSegs(prev)
    .filter((s) => s.style === 'wall' && !s.zone)
    .map((s) => ({ s, space: prevIds[s.room], f: old[`${prevIds[s.room]}:${s.id}`] }))
    .filter((x) => !!x.f);
  const nextIds = spaces(next).map((s) => s.id);
  const out: Record<string, WallFinish> = {};
  for (const s of wallSegs(next)) {
    if (s.style !== 'wall' || s.zone) continue;
    const space = nextIds[s.room];
    let best: { f: WallFinish; d: number; ov: number } | null = null;
    for (const w of was) {
      if (w.space !== space || w.s.wall !== s.wall) continue;
      const ov = Math.min(w.s.a1, s.a1) - Math.max(w.s.a0, s.a0);
      if (ov <= 1) continue;
      const d = Math.abs(w.s.at - s.at);
      if (!best || d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && ov > best.ov)) best = { f: w.f, d, ov };
    }
    if (best) out[`${space}:${s.id}`] = best.f;
  }
  const { wallFinishes: _old, ...rest } = next;
  return Object.keys(out).length ? { ...rest, wallFinishes: out } : rest;
}

/** Sets (or, with null, clears) one wall's finish. */
export function setWallFinish(room: Room, key: string, finish: WallFinish | null): Room {
  const all = { ...(room.wallFinishes ?? {}) };
  const clean: WallFinish = {};
  if (finish?.paintId) clean.paintId = finish.paintId;
  if (finish?.panel) {
    clean.panel = finish.panel;
    if (finish.panelHeightIn && (finish.panel === 'wainscot' || finish.panel === 'board-batten')) clean.panelHeightIn = Math.round(finish.panelHeightIn);
    if (finish.panel === 'tile' && finish.tileId) clean.tileId = finish.tileId;
  }
  if (Object.keys(clean).length) all[key] = clean;
  else delete all[key];
  const { wallFinishes: _old, ...rest } = room;
  return Object.keys(all).length ? { ...rest, wallFinishes: all } : rest;
}
