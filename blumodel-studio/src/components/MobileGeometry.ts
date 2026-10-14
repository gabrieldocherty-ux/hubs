/**
 * Pure layout and gesture arithmetic for the floating selection toolbar, the
 * bottom sheets and tap-to-place. No DOM, so it is unit-tested directly.
 * All positions are client pixels.
 */
import type { ScreenRect } from '../lib/interaction';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export interface ToolbarSpot {
  left: number;
  top: number;
  /** Where it ended up relative to the item. */
  side: 'above' | 'below' | 'over' | 'docked';
}

/**
 * Where a w×h toolbar goes for a selected item whose on-screen box is `item`, kept
 * inside `bounds` (the visible canvas) with `edge` px to spare. Prefers centred above
 * the item; flips below when there is no room above; if neither fits (a tall item
 * filling the view) it sits at the top of the item, inside the view. Returns null when
 * the item is entirely outside `bounds` (scrolled or zoomed away).
 */
export function placeToolbar(item: ScreenRect, w: number, h: number, bounds: ScreenRect, gap = 10, edge = 8): ToolbarSpot | null {
  const bRight = bounds.left + bounds.width;
  const bBottom = bounds.top + bounds.height;
  const iRight = item.left + item.width;
  const iBottom = item.top + item.height;
  if (iRight < bounds.left || item.left > bRight || iBottom < bounds.top || item.top > bBottom) return null;

  const minL = bounds.left + edge;
  const maxL = bRight - edge - w;
  const minT = bounds.top + edge;
  const maxT = bBottom - edge - h;
  const left = clamp(item.left + item.width / 2 - w / 2, minL, maxL);

  const above = item.top - gap - h;
  if (above >= minT) return { left, top: above, side: 'above' };
  const below = iBottom + gap;
  if (below <= maxT) return { left, top: below, side: 'below' };
  return { left, top: clamp(item.top + gap, minT, maxT), side: 'over' };
}

/** A toolbar parked at the bottom centre of `bounds` (phones, when the item's box isn't known). */
export function dockToolbar(w: number, h: number, bounds: ScreenRect, edge = 12): ToolbarSpot {
  return {
    left: clamp(bounds.left + bounds.width / 2 - w / 2, bounds.left + 8, bounds.left + bounds.width - 8 - w),
    top: bounds.top + bounds.height - edge - h,
    side: 'docked',
  };
}

/** The part of `a` that is also inside `b` (zero-size when they don't meet). */
export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export type SheetSnap = 'half' | 'full';

/** Down-flick speed (px/ms) that counts as a swipe regardless of distance. */
export const FLICK = 0.45;

/**
 * Where a bottom sheet settles when the user lets go of its handle.
 * `height` is the sheet's height at release, `velocity` px/ms (positive = moving down),
 * `moved` the total vertical travel. A flick down steps full→half→closed, a flick up
 * opens fully; otherwise the nearest stop wins, and a sheet dragged well below half
 * height closes.
 */
export function sheetRelease(from: SheetSnap, height: number, velocity: number, moved: number, half: number, full: number): SheetSnap | 'closed' {
  if (Math.abs(moved) > 12) {
    if (velocity > FLICK) return from === 'full' && height > half * 0.7 ? 'half' : 'closed';
    if (velocity < -FLICK) return 'full';
  }
  if (height < half * 0.65) return 'closed';
  return height > (half + full) / 2 ? 'full' : 'half';
}

/** A press that barely moved and didn't linger: a tap, not a pan or a long press. */
export function isTap(dx: number, dy: number, ms: number, slop = 10, maxMs = 700): boolean {
  return Math.hypot(dx, dy) <= slop && ms <= maxMs;
}
