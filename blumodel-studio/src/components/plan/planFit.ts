// Where "Fit" puts the room in the plan pane. Pure, so it is unit-tested (planFit.test.ts).
import { clamp } from '../../lib/geometry';
import { WALL_T } from './planStyle';

/**
 * Fit margin per side, in px. A desktop pane keeps 72px for the dimension strings; a
 * phone pane (390x244 in split view) can't spare that, so the room gets the space and
 * the outer dimension strings may clip. Pinching out shows them.
 */
export function fitMargin(w: number, h: number): number {
  return clamp((Math.min(w, h) - 200) * 0.2, 12, 72);
}

/** Px the overall dimension string needs outside the north and west walls (Dimensions.tsx: line 40px out, label ~16px beyond it, 2px spare). */
export const FIT_NEAR_PX = 58;
/** Px the chained strings need outside the south and east walls (line 16px out, 4px ticks, 2px spare; their labels sit on the room side). */
export const FIT_FAR_PX = 22;

/**
 * Where the room's near (west or north) wall goes along one axis of the pane, in px, for a room
 * `roomPx` long at scale `s`. When the pane has room for the dimension strings on both sides, the
 * drawing is centred *with* them, so the room's overall size never clips (it used to on the split
 * view's plan pane and on a phone's plan). When it doesn't (a phone's 390x244 split pane), the
 * room is centred and nudged towards the far side, as before.
 */
export function fitOffset(pane: number, roomPx: number, s: number, nudgePx: number): number {
  const near = WALL_T * s + FIT_NEAR_PX;
  const far = WALL_T * s + FIT_FAR_PX;
  const spare = pane - roomPx - near - far;
  // -0.5: a scale chosen to fit the strings exactly may miss by a rounding error.
  return spare >= -0.5 ? near + spare / 2 : (pane - roomPx) / 2 + nudgePx;
}

/** How much smaller than its margin-based size Fit may draw the room to keep the strings in view. */
export const FIT_MAX_SHRINK = 0.85;

/**
 * The view "Fit" applies: scale and the room's top-left corner in pane px. The scale comes from
 * the margin above; if that leaves the dimension strings a few px short (a 360px phone), the room
 * is drawn up to 15% smaller so they fit. A pane far too small for them keeps the margin scale.
 */
export function fitView(w: number, h: number, widthIn: number, lengthIn: number, minScale: number, maxScale: number): { scale: number; x: number; y: number } {
  const m = fitMargin(w, h);
  const byMargin = Math.min((w - m * 2) / (widthIn + 20), (h - m * 2) / (lengthIn + 20));
  const withStrings = Math.min((w - FIT_NEAR_PX - FIT_FAR_PX) / (widthIn + 2 * WALL_T), (h - FIT_NEAR_PX - FIT_FAR_PX) / (lengthIn + 2 * WALL_T));
  const s = clamp(withStrings >= byMargin * FIT_MAX_SHRINK ? Math.min(byMargin, withStrings) : byMargin, minScale, maxScale);
  const nudge = m / 72;
  return { scale: s, x: fitOffset(w, widthIn * s, s, 12 * nudge), y: fitOffset(h, lengthIn * s, s, 14 * nudge) };
}
