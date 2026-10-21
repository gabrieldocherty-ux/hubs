/**
 * Whether a floor change is one a person just made (Room & Finishes), so the 3D lays the new floor
 * over the old one (components/three/FloorPiece). A whole design loading, an undo, a template or the
 * picture generator switching scenes changes floors too, and must just show them.
 */
let cuedAt = -Infinity;

/** Called by the store when someone picks a floor. */
export function cueFloorLay(): void {
  cuedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** True for a floor change that follows a pick within half a second. */
export function floorLayCued(): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now - cuedAt < 500;
}
