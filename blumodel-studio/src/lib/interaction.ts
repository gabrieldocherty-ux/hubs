/**
 * Shared plumbing for moving and placing things, used by the 2D plan, the 3D view,
 * the catalog and the floating selection toolbar. Nothing here renders.
 *
 * COORDINATES. Every "room point" is ROOM INCHES, the same numbers as
 * `PlacedItem.x/y`: origin at the inside north-west corner of the room, +x east
 * (0..room.widthIn), +y south (0..room.lengthIn). For an item it is the CENTRE of
 * its footprint. The 3D scene draws items at world (x / 12, elevation / 12, y / 12)
 * in feet with +Y up (see `worldToRoom` / `roomToWorld`). Screen positions are
 * client pixels (`PointerEvent.clientX/Y`, `getBoundingClientRect()`).
 */
import { create } from 'zustand';
import { getProduct } from '../data/catalog';
import { useDesignStore } from '../store/useDesignStore';
import { QA, qaExpose } from './qa';

export type ViewId = 'plan' | '3d';

/** Room inches; see the module comment. */
export interface RoomPoint {
  x: number;
  y: number;
}

/** Maps a client-pixel position over a view to the room point under it, or null (e.g. a 3D ray that misses the floor). */
export type ToRoom = (clientX: number, clientY: number) => RoomPoint | null;

/** Client pixels, as from getBoundingClientRect(). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ─── Coordinate helpers (pure) ─────────────────────────────────────────

/** The 3D scene is drawn in feet: one world unit is 12 room inches. */
export const INCHES_PER_WORLD_UNIT = 12;

/** A point on the 3D floor (world x, world z in feet) to room inches. */
export function worldToRoom(worldX: number, worldZ: number): RoomPoint {
  return { x: worldX * INCHES_PER_WORLD_UNIT, y: worldZ * INCHES_PER_WORLD_UNIT };
}

/** Room inches (plus a height above the floor, in inches) to a 3D world position [x, y, z] in feet. */
export function roomToWorld(x: number, y: number, elevationIn = 0): [number, number, number] {
  return [x / INCHES_PER_WORLD_UNIT, elevationIn / INCHES_PER_WORLD_UNIT, y / INCHES_PER_WORLD_UNIT];
}

/**
 * Client pixels over the 2D plan to room inches. `container` is the Konva stage's
 * container rect; `view` is the stage transform (stage.x(), stage.y(), stage.scaleX()).
 * The plan's world group has no transform of its own, so stage-local = room inches.
 */
export function planClientToRoom(
  clientX: number,
  clientY: number,
  container: { left: number; top: number },
  view: { x: number; y: number; scale: number },
): RoomPoint {
  return { x: (clientX - container.left - view.x) / view.scale, y: (clientY - container.top - view.y) / view.scale };
}

/** Room inches to client pixels over the 2D plan; the inverse of planClientToRoom. */
export function planRoomToClient(
  p: RoomPoint,
  container: { left: number; top: number },
  view: { x: number; y: number; scale: number },
): { x: number; y: number } {
  return { x: container.left + view.x + p.x * view.scale, y: container.top + view.y + p.y * view.scale };
}

/** Left/top edges inclusive, right/bottom exclusive, so adjacent views never both claim a pixel. */
export function pointInRect(x: number, y: number, r: ScreenRect): boolean {
  return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
}

/** Same rect to within half a pixel (or both null). */
export function rectsEqual(a: ScreenRect | null, b: ScreenRect | null, tol = 0.5): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) <= tol &&
    Math.abs(a.top - b.top) <= tol &&
    Math.abs(a.width - b.width) <= tol &&
    Math.abs(a.height - b.height) <= tol
  );
}

// ─── Drop targets ──────────────────────────────────────────────────────

interface DropTarget {
  id: ViewId;
  el: HTMLElement;
  toRoom: ToRoom;
}

export interface DropHit {
  id: ViewId;
  el: HTMLElement;
  /** Room inches under the pointer. */
  point: RoomPoint;
}

let targets: DropTarget[] = [];

/**
 * A view announces "things can be dropped on me". `el` is the element whose
 * on-screen rect counts as the view (the plan's `.plan-view`, the 3D canvas
 * wrapper); `toRoom` converts a client position over it to room inches.
 * Registering an id again replaces the earlier registration. Returns an
 * unregister function that only removes this registration (safe under StrictMode).
 */
export function registerDropTarget(id: ViewId, el: HTMLElement, toRoom: ToRoom): () => void {
  const entry: DropTarget = { id, el, toRoom };
  targets = [...targets.filter((t) => t.id !== id), entry];
  return () => {
    targets = targets.filter((t) => t !== entry);
  };
}

/**
 * The view under a client position and the room point there, or null when the
 * position is over no registered view (or the view can't map it, e.g. sky in 3D).
 * Hit-testing is by bounding rect; if rects overlap the latest registration wins.
 */
export function findDropTarget(clientX: number, clientY: number): DropHit | null {
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (t.el.isConnected === false) continue;
    const r = t.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || !pointInRect(clientX, clientY, r)) continue;
    const point = t.toRoom(clientX, clientY);
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return { id: t.id, el: t.el, point };
  }
  return null;
}

/** Ids of the currently registered views, oldest first (for QA and tests). */
export function dropTargetIds(): ViewId[] {
  return targets.map((t) => t.id);
}

// ─── Tap-to-place ──────────────────────────────────────────────────────

export interface PlacementState {
  /** A catalog product waiting for the user to tap where it goes; null when nothing is armed. */
  armedProductId: string | null;
  /** Arms a product (ignored for unknown ids). Arming another replaces it. */
  arm: (productId: string) => void;
  disarm: () => void;
}

export const usePlacement = create<PlacementState>()((set) => ({
  armedProductId: null,
  arm: (productId) => {
    if (getProduct(productId)) set({ armedProductId: productId });
  },
  disarm: () => set({ armedProductId: null }),
}));

// ─── Selection overlay ─────────────────────────────────────────────────

export interface OverlayState {
  /** The selected item's on-screen bounding rect in client pixels, or null when it isn't visible. */
  rect: ScreenRect | null;
  /** Which view published `rect`. */
  source: ViewId | null;
  /** True while the selected item is being dragged (a toolbar should get out of the way). */
  dragging: boolean;
  /**
   * Publishes the selection's position. Views call this whenever the selected item or
   * their camera/zoom moves; unchanged values (within half a pixel) are dropped, so
   * calling it every frame is fine.
   */
  set: (patch: Partial<Pick<OverlayState, 'rect' | 'source' | 'dragging'>>) => void;
  /** Withdraws the rect. With `source`, only if that view is the one that published it. */
  clear: (source?: ViewId) => void;
}

export const useOverlay = create<OverlayState>()((set, get) => ({
  rect: null,
  source: null,
  dragging: false,
  set: (patch) => {
    const s = get();
    // Copied to a plain object so a DOMRect can be passed straight in.
    const r = patch.rect;
    const rect = 'rect' in patch ? (r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null) : s.rect;
    const source = 'source' in patch ? patch.source ?? null : s.source;
    const dragging = 'dragging' in patch ? !!patch.dragging : s.dragging;
    const sameRect = rectsEqual(rect, s.rect);
    if (sameRect && source === s.source && dragging === s.dragging) return;
    set({ rect: sameRect ? s.rect : rect, source, dragging });
  },
  clear: (source) => {
    const s = get();
    if (source && s.source !== source) return;
    if (s.rect === null && s.source === null && !s.dragging) return;
    set({ rect: null, source: null, dragging: false });
  },
}));

// ─── Placing products ──────────────────────────────────────────────────

/**
 * Adds `productId` with its footprint centre at room point (x, y), snapped exactly
 * like a drag (walls, neighbours, room bounds), selects it, and disarms tap-to-place.
 * One undo step. Returns the new item id, or null if nothing was added.
 */
export function placeAt(productId: string, x: number, y: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const id = useDesignStore.getState().addItem(productId, { x, y });
  if (id) usePlacement.getState().disarm();
  return id;
}

/** placeAt for a client position: drops onto whichever registered view is under it. Null if none is. */
export function placeAtClient(productId: string, clientX: number, clientY: number): string | null {
  const hit = findDropTarget(clientX, clientY);
  return hit ? placeAt(productId, hit.point.x, hit.point.y) : null;
}

// ─── QA hook ───────────────────────────────────────────────────────────

/**
 * With `?qa` in the URL (e.g. `/?qa#/local`) puts the stores on `window.__mise` so
 * headless checks can read item positions and drive placement; also merges them
 * into `window.__miseQA`. Inert without the flag.
 */
export function installQaHook(): void {
  if (!QA) return;
  const hook = {
    store: useDesignStore,
    placement: usePlacement,
    overlay: useOverlay,
    findDropTarget,
    dropTargetIds,
    placeAt,
    placeAtClient,
  };
  (window as unknown as { __mise?: typeof hook }).__mise = hook;
  qaExpose({ store: useDesignStore, placement: usePlacement, overlay: useOverlay });
}
