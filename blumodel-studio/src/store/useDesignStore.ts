import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DesignDoc, EdgeStyle, EstimateExtra, PlacedItem, PlanStyle, Product, Room, Rotation, Surfaces, ViewMode } from '../types';
import { getProduct, isBuiltin, isOpening, itemWidth, snapsToWall } from '../data/catalog';
import { CABINET_FINISHES } from '../data/finishes';
import { buildTemplate, type TemplateId } from '../data/templates';
import { DEFAULT_KITCHEN_NAME, DEFAULT_ROOM, DEFAULT_SURFACES } from '../data/defaults';
import type { StylePreset } from '../data/styles';
import {
  alongWall,
  boxesOverlap,
  clamp,
  boxInRoom,
  flushSeg,
  flushWall,
  footprint,
  keepInside,
  segLength,
  overlap1D,
  placeOnWall,
  resolve,
  resolveAll,
  snapItem,
  WALL_ROTATION,
  type DragResult,
  type Resolved,
} from '../lib/geometry';
import * as edit from '../lib/roomEdit';
import { planBounds, wallSegs, type Pt } from '../lib/outline';
import { defaultFinishIndex, finishAt, finishById, itemHasFinish } from '../lib/finish';
import { makeId } from '../lib/id';
import { cleanExtras, prepareDocForSave, sanitizeDoc, withFinishIds } from '../lib/doc';
import { track } from '../lib/track';
import { useCatalog, useCatalogVersion } from './useCatalog';
import { qaExpose } from '../lib/qa';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'warn';
}

export type LeftTab = 'products' | 'room';
export type RightTab = 'details' | 'checks' | 'estimate';

interface UIState {
  viewMode: ViewMode;
  planStyle: PlanStyle;
  showGrid: boolean;
  showTriangle: boolean;
  showDims: boolean;
  leftTab: LeftTab;
  rightTab: RightTab;
}

interface State {
  doc: DesignDoc;
  /** View-only (share links): every action that changes the kitchen is a no-op. */
  readOnly: boolean;
  selectedId: string | null;
  hoverId: string | null;
  past: DesignDoc[];
  future: DesignDoc[];
  dragging: boolean;
  ui: UIState;
  toasts: Toast[];
  cameraRequest: { preset: CameraPreset; nonce: number } | null;

  setName: (name: string) => void;
  setRoom: (room: Partial<Room>) => void;
  /** Replace the main room's walls with a drawn outline (items stay where they are). Returns an error message, or null. */
  setOutline: (outline: Pt[]) => string | null;
  /** Move one wall (by its id in `wallSegs`) to a new position; things standing against it move with it. Returns an error message, or null. */
  moveWall: (segId: number, to: number) => string | null;
  /** Add another room to the plan. Returns its id, or an error message in `error`. */
  addRoom: (outline: Pt[], name?: string, kind?: 'room' | 'zone') => { id?: string; error?: string };
  /** Add a room of a known kind (living room, bathroom...) beside the others. Returns its id, or an error message. */
  addRoomKind: (kindId: string) => { id?: string; error?: string };
  removeRoom: (id: string) => string | null;
  /** Set what stands along every edge of a room or open area (`spaceIndex` 0 is the main room). */
  setSpaceStyle: (spaceIndex: number, style: EdgeStyle) => string | null;
  /** Set what stands along one wall. */
  setEdgeStyle: (segId: number, style: EdgeStyle) => string | null;
  renameRoom: (id: string, name: string) => string | null;
  /** A room's own floor ('main' sets the kitchen's); null puts an added room back on the kitchen's floor. */
  setRoomFloor: (id: string, flooringId: string | null) => string | null;
  /** Replace the room and its items with an edited draft (the Walls & rooms dialog) as one undo step. */
  applyRoomEdit: (draft: edit.Draft) => void;
  setSurfaces: (s: Partial<Surfaces>) => void;
  /** Replaces the extra estimate lines (installation, delivery…). An empty list removes them. */
  setExtras: (extras: EstimateExtra[]) => void;
  applyStyle: (preset: StylePreset) => void;
  /**
   * Adds a product and selects it. With `at` (room inches, footprint centre) the
   * piece is snapped there exactly like a drag; without it, it goes to the first
   * free spot. Returns the new item's id, or null for an unknown product.
   */
  addItem: (productId: string, at?: { x: number; y: number }) => string | null;
  /*
   * Drag protocol shared by the 2D plan and the 3D view. Coordinates are ROOM
   * INCHES of the item's FOOTPRINT CENTRE, i.e. the same numbers as PlacedItem.x/y:
   * origin at the inside north-west corner, +x east (0..room.widthIn), +y south
   * (0..room.lengthIn). In 3D world units (feet) that is worldX = x / 12,
   * worldZ = y / 12 (+Y is up); see worldToRoom/roomToWorld in lib/interaction.
   *
   *   dragStart(id)        selects the item and opens a drag. Nothing is recorded yet.
   *   dragMove(id, x, y)   snaps the proposed centre (walls, neighbours, room bounds)
   *                        and moves the item live, without touching undo history.
   *                        Returns where it actually landed, or null for an unknown id.
   *                        Calling it without dragStart opens the drag implicitly.
   *   dragEnd(id?)         closes the drag: ONE undo step if anything moved, none for
   *                        a click that didn't. Returns true when a step was recorded.
   *   dragCancel()         puts everything back where the drag started, no undo step.
   *
   * `dragging` is true between start and end (autosave waits for it to clear).
   */
  dragStart: (id: string) => boolean;
  /**
   * Dragging a wall on the plan: each move puts the wall's line at `to` (things against it travel
   * with it) as a live preview; the end records one undo step and rebases the plan, returning how far
   * the origin moved so the view can stay put. A move the room can't take is ignored.
   */
  wallDragMove: (segId: number, to: number) => boolean;
  wallDragEnd: () => { dx: number; dy: number };
  dragMove: (id: string, x: number, y: number) => DragResult | null;
  dragEnd: (id?: string) => boolean;
  dragCancel: () => void;
  moveTo: (id: string, x: number, y: number) => void;
  nudge: (id: string, dx: number, dy: number) => void;
  rotate: (id: string, dir: 1 | -1) => void;
  /** A list position (from the UI) or a finish id. */
  setFinish: (id: string, finish: number | string) => void;
  setWidth: (id: string, widthIn: number) => void;
  toggleMirror: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  /** A position in CABINET_FINISHES or a cabinet finish id. */
  applyCabinetFinishToAll: (finish: number | string) => void;
  applyTemplate: (id: TemplateId) => void;
  /** Lay out a grid of pot lights over the floor (replacing any already placed); `remove` takes them all out. Returns how many. */
  potLights: (remove?: boolean) => number;
  clearItems: () => void;
  importDoc: (doc: DesignDoc) => void;
  /** Opens a different kitchen for editing: replaces the document and clears undo history and selection. */
  loadDoc: (doc: DesignDoc) => void;
  /** Opens a kitchen view-only (share links): registers its products, then loads it read-only. */
  openReadOnly: (doc: DesignDoc, products?: Product[]) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setUI: (patch: Partial<UIState>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  requestCamera: (preset: CameraPreset) => void;
}

export type CameraPreset = 'overview' | 'eye' | 'top' | 'front';

export { sanitizeDoc };

const LOCAL_DRAFT = 'blumodel-local-draft';

/** The design kept on this device for people using BluModel Studio without an account. */
export function loadLocalDraft(): DesignDoc | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT);
    return raw ? (JSON.parse(raw) as DesignDoc) : null;
  } catch {
    return null;
  }
}

/** Forgets the device design (once a showroom visitor's draft is saved to their new account). */
export function clearLocalDraft() {
  try {
    localStorage.removeItem(LOCAL_DRAFT);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

export function saveLocalDraft(doc: DesignDoc) {
  try {
    localStorage.setItem(LOCAL_DRAFT, JSON.stringify(prepareDocForSave(doc)));
  } catch {
    // Storage full or blocked: the in-memory design still works for this visit.
  }
}

export { DEFAULT_ROOM, DEFAULT_SURFACES };

export function initialDoc(): DesignDoc {
  const { items } = buildTemplate('l-island', DEFAULT_ROOM, DEFAULT_SURFACES);
  return { name: DEFAULT_KITCHEN_NAME, room: DEFAULT_ROOM, surfaces: DEFAULT_SURFACES, items: withFinishIds(items), version: 2 };
}

const HISTORY_LIMIT = 120;
let toastSeq = 0;

function updateItem(doc: DesignDoc, id: string, fn: (it: PlacedItem) => PlacedItem): DesignDoc {
  return { ...doc, items: doc.items.map((it) => (it.id === id ? fn(it) : it)) };
}

function collider(product: Product, w: number, others: Resolved[]) {
  const z0 = product.elevationIn;
  const z1 = z0 + product.heightIn;
  return (x: number, y: number, rotation: Rotation) => {
    const box = footprint(x, y, rotation, w, product.depthIn);
    return others.some((o) => boxesOverlap(o.box, box) && overlap1D(z0, z1, o.z0, o.z1) > 0.25);
  };
}

/** Finds a sensible first home for a new product so a click-to-add never lands on top of something. */
function findFreeSpot(productId: string, doc: DesignDoc, width?: number): { x: number; y: number; rotation: Rotation } {
  const product = getProduct(productId)!;
  const w = width ?? product.widthIn;
  const d = product.depthIn;
  const { room } = doc;
  const collides = collider(product, w, resolveAll(doc.items));

  if (isOpening(product) || snapsToWall(product)) {
    for (const seg of wallSegs(room)) {
      const rotation = WALL_ROTATION[seg.wall];
      const inset = isOpening(product) ? 0 : d / 2;
      for (let along = seg.a0 + w / 2; along <= seg.a1 - w / 2; along += 3) {
        const { x, y } = placeOnWall(seg, along, inset);
        if (!collides(x, y, rotation)) return { x, y, rotation };
      }
    }
  }
  const mid = planMiddle(room);
  return spiralFrom(mid.x, mid.y, 0, w, d, room, collides) ?? { x: mid.x, y: mid.y, rotation: 0 };
}

/** A point well inside the main room: the middle of its bounding box, or the nearest floor to it in an L. */
function planMiddle(room: Room): { x: number; y: number } {
  const cx = room.widthIn / 2;
  const cy = room.lengthIn / 2;
  return keepInside(room, cx, cy, 1, 1);
}

function spiralFrom(cx: number, cy: number, rotation: Rotation, w: number, d: number, room: Room, collides: (x: number, y: number, r: Rotation) => boolean) {
  const swap = rotation === 90 || rotation === 270;
  const hx = (swap ? d : w) / 2;
  const hy = (swap ? w : d) / 2;
  const pb = planBounds(room);
  for (let r = 0; r < Math.max(pb.maxX, pb.maxY); r += 4) {
    const steps = r === 0 ? 1 : 24;
    for (let a = 0; a < steps; a++) {
      const x = clamp(cx + Math.cos((a / steps) * Math.PI * 2) * r, hx, pb.maxX - hx);
      const y = clamp(cy + Math.sin((a / steps) * Math.PI * 2) * r, hy, pb.maxY - hy);
      if (!boxInRoom(room, { minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy }, 0.1)) continue;
      if (!collides(x, y, rotation)) return { x, y, rotation };
    }
  }
  return null;
}

export const useDesignStore = create<State>()(
  persist(
    (set, get) => {
      /** The document as it was when the current drag began; null when no drag is open. */
      let dragOrigin: DesignDoc | null = null;

      const commit = (fn: (doc: DesignDoc) => DesignDoc, extra?: Partial<State>) => {
        const { doc, readOnly } = get();
        if (readOnly) return;
        let { past } = get();
        const next = fn(doc);
        if (next === doc) return;
        // An edit mid-drag (a rotate key, say) first banks the drag so far as its own step.
        if (dragOrigin) {
          if (dragOrigin !== doc) past = [...past, dragOrigin];
          dragOrigin = next;
        }
        set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], ...extra });
      };

      /** Commits an edit from lib/roomEdit as one undo step; returns its error message, or null. */
      const applyEdit = (out: edit.Edit): string | null => {
        if (edit.isError(out)) return out.error;
        commit((doc) => ({ ...doc, room: out.room, items: out.items }));
        return null;
      };

      return {
        doc: initialDoc(),
        readOnly: false,
        selectedId: null,
        hoverId: null,
        past: [],
        future: [],
        dragging: false,
        toasts: [],
        cameraRequest: null,
        ui: {
          viewMode: 'split',
          planStyle: 'rendered',
          showGrid: true,
          showTriangle: true,
          showDims: true,
          leftTab: 'products',
          rightTab: 'details',
        },

        setName: (name) => commit((doc) => ({ ...doc, name })),

        setRoom: (patch) =>
          commit((doc) => {
            const room = { ...doc.room, ...patch };
            room.widthIn = clamp(Math.round(room.widthIn), 72, 1200);
            room.lengthIn = clamp(Math.round(room.lengthIn), 72, 1200);
            room.ceilingIn = clamp(Math.round(room.ceilingIn), 90, 144);
            const W0 = doc.room.widthIn;
            const L0 = doc.room.lengthIn;
            // Keep things glued to the east/south walls when those walls move.
            const items = doc.items.map((it) => {
              const r = resolve(it);
              if (!r) return it;
              const wall = flushWall(r, doc.room);
              if (wall === 'east') return { ...it, x: it.x + (room.widthIn - W0) };
              if (wall === 'south') return { ...it, y: it.y + (room.lengthIn - L0) };
              return it;
            });
            return { ...doc, room, items };
          }),

        setOutline: (outline) => applyEdit(edit.setMainOutline({ room: get().doc.room, items: get().doc.items }, outline)),

        moveWall: (segId, to) => applyEdit(edit.moveWallTo({ room: get().doc.room, items: get().doc.items }, segId, to)),

        addRoom: (outline, name, kind) => {
          const out = edit.addRoom({ room: get().doc.room, items: get().doc.items }, outline, name, kind);
          const error = applyEdit(out);
          return error ? { error } : { id: out.id };
        },

        addRoomKind: (kindId) => {
          const out = edit.addRoomOfKind({ room: get().doc.room, items: get().doc.items }, kindId);
          const error = applyEdit(out);
          return error ? { error } : { id: out.id };
        },

        setSpaceStyle: (spaceIndex, style) => applyEdit(edit.setSpaceStyle({ room: get().doc.room, items: get().doc.items }, spaceIndex, style)),

        setEdgeStyle: (segId, style) => applyEdit(edit.setEdgeStyle({ room: get().doc.room, items: get().doc.items }, segId, style)),

        removeRoom: (id) => applyEdit(edit.removeRoom({ room: get().doc.room, items: get().doc.items }, id)),

        renameRoom: (id, name) => applyEdit(edit.renameRoom({ room: get().doc.room, items: get().doc.items }, id, name)),

        setRoomFloor: (id, flooringId) => {
          if (id === 'main') {
            if (flooringId) get().setSurfaces({ flooringId });
            return null;
          }
          return applyEdit(edit.setRoomFloor({ room: get().doc.room, items: get().doc.items }, id, flooringId));
        },

        applyRoomEdit: (draft) => {
          const out = edit.rebase(draft);
          commit((doc) => ({ ...doc, room: out.room, items: out.items }));
        },

        setSurfaces: (patch) =>
          commit((doc) => {
            const surfaces = { ...doc.surfaces, ...patch };
            let items = doc.items;
            if (patch.cabinetFinishId && patch.cabinetFinishId !== doc.surfaces.cabinetFinishId) {
              const oldId = doc.surfaces.cabinetFinishId;
              const newId = patch.cabinetFinishId;
              // Items that followed the old kitchen-wide finish follow the new one; deliberate accents (a navy island) stay.
              items = items.map((it) => {
                const p = getProduct(it.productId);
                return p?.finishes === 'cabinet' && itemHasFinish(it, p, oldId) ? { ...it, ...finishById(p, newId) } : it;
              });
            }
            return { ...doc, surfaces, items };
          }),

        setExtras: (extras) =>
          commit((doc) => {
            const next = cleanExtras(extras);
            if (!next.length) {
              if (!doc.extras) return doc;
              const { extras: _gone, ...rest } = doc;
              return rest;
            }
            return { ...doc, extras: next };
          }),

        applyStyle: (preset) =>
          commit((doc) => {
            const items = doc.items.map((it) => {
              const p = getProduct(it.productId);
              if (!p || p.finishes !== 'cabinet') return it;
              return { ...it, ...finishById(p, p.kind === 'island' ? preset.island : preset.surfaces.cabinetFinishId) };
            });
            return { ...doc, surfaces: { ...preset.surfaces }, items };
          }),

        addItem: (productId, at) => {
          const product = getProduct(productId);
          if (!product || get().readOnly) return null;
          const { doc } = get();
          const id = makeId();
          let pos: { x: number; y: number; rotation: Rotation };
          if (at) {
            const snapped = snapItem({ id, x: at.x, y: at.y, rotation: 0 }, product, product.widthIn, doc.room, resolveAll(doc.items));
            pos = snapped;
          } else {
            pos = findFreeSpot(productId, doc);
          }
          const item: PlacedItem = {
            id,
            productId,
            x: pos.x,
            y: pos.y,
            rotation: pos.rotation,
            ...finishAt(product, defaultFinishIndex(product, doc.surfaces)),
          };
          commit((d) => ({ ...d, items: [...d.items, item] }), { selectedId: id });
          get().setUI({ rightTab: 'details' });
          if (!isBuiltin(productId)) track(productId, 'add');
          return id;
        },

        dragStart: (id) => {
          const { doc, readOnly } = get();
          if (readOnly) return false;
          if (!doc.items.some((i) => i.id === id)) return false;
          // A second pointer joining an open drag keeps the original origin: still one step.
          if (!dragOrigin) dragOrigin = doc;
          set({ dragging: true, selectedId: id });
          return true;
        },

        dragMove: (id, x, y) => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const { doc, readOnly } = get();
          if (readOnly) return null;
          const it = doc.items.find((i) => i.id === id);
          const product = it && getProduct(it.productId);
          if (!it || !product) return null;
          if (!dragOrigin) get().dragStart(id);
          const others: Resolved[] = resolveAll(doc.items.filter((o) => o.id !== id));
          const snap = snapItem({ id, x, y, rotation: it.rotation }, product, itemWidth(it, product), doc.room, others);
          if (snap.x !== it.x || snap.y !== it.y || snap.rotation !== it.rotation) {
            set({ doc: updateItem(get().doc, id, (i) => ({ ...i, x: snap.x, y: snap.y, rotation: snap.rotation })) });
          }
          return snap;
        },

        dragEnd: () => {
          const origin = dragOrigin;
          dragOrigin = null;
          const { doc, past } = get();
          const moved = !!origin && origin !== doc;
          if (moved) set({ past: [...past, origin].slice(-HISTORY_LIMIT), future: [], dragging: false });
          else set({ dragging: false });
          return moved;
        },

        wallDragMove: (segId, to) => {
          const { doc, readOnly } = get();
          if (readOnly || !Number.isFinite(to)) return false;
          if (!dragOrigin) dragOrigin = doc;
          const out = edit.moveWallTo({ room: dragOrigin.room, items: dragOrigin.items }, segId, to, { keepOrigin: true });
          if (edit.isError(out)) return false;
          set({ doc: { ...get().doc, room: out.room, items: out.items }, dragging: true });
          return true;
        },

        wallDragEnd: () => {
          const origin = dragOrigin;
          dragOrigin = null;
          const { doc, past } = get();
          if (!origin || origin === doc) {
            set({ dragging: false });
            return { dx: 0, dy: 0 };
          }
          const before = planBounds(doc.room);
          const out = edit.rebase({ room: doc.room, items: doc.items });
          set({ doc: { ...doc, room: out.room, items: out.items }, past: [...past, origin].slice(-HISTORY_LIMIT), future: [], dragging: false });
          return { dx: -before.minX, dy: -before.minY };
        },

        dragCancel: () => {
          const origin = dragOrigin;
          dragOrigin = null;
          set(origin ? { doc: origin, dragging: false } : { dragging: false });
        },

        moveTo: (id, x, y) => commit((doc) => updateItem(doc, id, (i) => ({ ...i, x, y }))),

        nudge: (id, dx, dy) =>
          commit((doc) =>
            updateItem(doc, id, (i) => {
              const r = resolve(i);
              if (!r) return i;
              const hx = (r.box.maxX - r.box.minX) / 2;
              const hy = (r.box.maxY - r.box.minY) / 2;
              const open = isOpening(r.product);
              const pb = planBounds(doc.room);
              if (open) return { ...i, x: clamp(i.x + dx, pb.minX - 3, pb.maxX + 3), y: clamp(i.y + dy, pb.minY - 3, pb.maxY + 3) };
              return { ...i, ...keepInside(doc.room, i.x + dx, i.y + dy, hx, hy) };
            }),
          ),

        rotate: (id, dir) =>
          commit((doc) =>
            updateItem(doc, id, (i) => {
              const rotation = (((i.rotation + dir * 90) % 360) + 360) % 360 as Rotation;
              const p = getProduct(i.productId);
              if (!p) return i;
              const box = footprint(i.x, i.y, rotation, itemWidth(i, p), p.depthIn);
              const hx = (box.maxX - box.minX) / 2;
              const hy = (box.maxY - box.minY) / 2;
              if (isOpening(p)) return { ...i, rotation };
              return { ...i, rotation, ...keepInside(doc.room, i.x, i.y, hx, hy) };
            }),
          ),

        setFinish: (id, finish) =>
          commit((doc) =>
            updateItem(doc, id, (i) => {
              const p = getProduct(i.productId);
              if (!p) return i;
              return { ...i, ...(typeof finish === 'string' ? finishById(p, finish) : finishAt(p, finish)) };
            }),
          ),

        setWidth: (id, widthIn) =>
          commit((doc) =>
            updateItem(doc, id, (i) => {
              const r = resolve(i);
              if (!r) return i;
              const seg = flushSeg(r, doc.room);
              const next: PlacedItem = { ...i, widthIn: widthIn === r.product.widthIn ? undefined : widthIn };
              if (!seg || isOpening(r.product)) return next;
              // Grow away from the fixed left edge, like extending a run of cabinets.
              const [start] = alongWall(seg.wall, r.box);
              const along = clamp(start + widthIn / 2, seg.a0 + widthIn / 2, seg.a1 - widthIn / 2);
              const pos = placeOnWall(seg, along, r.d / 2);
              return { ...next, ...pos };
            }),
          ),

        toggleMirror: (id) => commit((doc) => updateItem(doc, id, (i) => ({ ...i, mirrored: !i.mirrored }))),

        duplicate: (id) => {
          const { doc, readOnly } = get();
          if (readOnly) return;
          const it = doc.items.find((i) => i.id === id);
          const r = it && resolve(it);
          if (!it || !r) return;
          const newId = makeId();
          const others = resolveAll(doc.items);
          const collides = collider(r.product, r.w, others);
          const seg = flushSeg(r, doc.room);
          let spot: { x: number; y: number; rotation: Rotation } | null = null;
          if (seg) {
            // Walk outward along the same wall, right side first, until the copy fits.
            const len = segLength(seg);
            const [start, end] = alongWall(seg.wall, r.box);
            const inset = isOpening(r.product) ? 0 : r.d / 2;
            for (let k = 0; k < len && !spot; k += 3) {
              for (const along of [end + r.w / 2 + k, start - r.w / 2 - k]) {
                if (along < seg.a0 + r.w / 2 || along > seg.a1 - r.w / 2) continue;
                const p = placeOnWall(seg, along, inset);
                if (!collides(p.x, p.y, it.rotation)) {
                  spot = { ...p, rotation: it.rotation };
                  break;
                }
              }
            }
          } else {
            const step = r.box.maxX - r.box.minX + 2;
            const there = footprint(it.x + step, it.y, it.rotation, r.w, r.d);
            spot = !collides(it.x + step, it.y, it.rotation) && boxInRoom(doc.room, there)
              ? { x: it.x + step, y: it.y, rotation: it.rotation }
              : spiralFrom(it.x, it.y, it.rotation, r.w, r.d, doc.room, collides);
          }
          if (!spot) {
            get().toast('No free space left for another one.', 'warn');
            return;
          }
          const copy: PlacedItem = { ...it, id: newId, x: spot.x, y: spot.y, rotation: spot.rotation };
          commit((d) => ({ ...d, items: [...d.items, copy] }), { selectedId: newId });
        },

        remove: (id) =>
          commit((doc) => ({ ...doc, items: doc.items.filter((i) => i.id !== id) }), {
            selectedId: get().selectedId === id ? null : get().selectedId,
          }),

        applyCabinetFinishToAll: (finish) =>
          commit((doc) => {
            const cab = CABINET_FINISHES[typeof finish === 'number' ? finish : CABINET_FINISHES.findIndex((f) => f.id === finish)];
            if (!cab) return doc;
            return {
              ...doc,
              surfaces: { ...doc.surfaces, cabinetFinishId: cab.id },
              items: doc.items.map((it) => {
                const p = getProduct(it.productId);
                return p?.finishes === 'cabinet' ? { ...it, ...finishById(p, cab.id) } : it;
              }),
            };
          }),

        potLights: (remove = false) => {
          const { doc } = get();
          const out = remove ? { room: doc.room, items: doc.items.filter((i) => i.productId !== 'pot-light') } : edit.layoutPotLights({ room: doc.room, items: doc.items });
          commit((d) => ({ ...d, items: out.items }));
          return out.items.filter((i) => i.productId === 'pot-light').length;
        },

        applyTemplate: (id) => {
          const { doc, readOnly } = get();
          if (readOnly) return;
          // The kitchen's brand choices (setup wizard) fill the layout here too, as they did there.
          const built = buildTemplate(id, doc.room, doc.surfaces, doc.brandPrefs);
          const { note } = built;
          const items = withFinishIds(built.items);
          if (!items.length) {
            get().toast(note ?? 'That layout does not fit this room.', 'warn');
            return;
          }
          commit((d) => ({ ...d, items }), { selectedId: null });
          get().toast(note ? `Layout applied. ${note}` : 'Layout applied. Press Ctrl+Z to go back.', note ? 'warn' : 'ok');
        },

        clearItems: () => commit((doc) => ({ ...doc, items: [] }), { selectedId: null }),

        importDoc: (incoming) => commit(() => sanitizeDoc(incoming), { selectedId: null }),

        loadDoc: (doc) => {
          dragOrigin = null;
          set({ doc: sanitizeDoc(doc), readOnly: false, past: [], future: [], selectedId: null, hoverId: null, dragging: false });
        },

        openReadOnly: (doc, products) => {
          dragOrigin = null;
          if (products?.length) useCatalog.getState().register(products);
          set({ doc: sanitizeDoc(doc), readOnly: true, past: [], future: [], selectedId: null, hoverId: null, dragging: false });
        },

        undo: () => {
          // Undo mid-drag closes the drag first, so the step being undone includes it.
          if (dragOrigin) get().dragEnd();
          const { past, doc, future, readOnly } = get();
          if (!past.length || readOnly) return;
          const prev = past[past.length - 1];
          const selectedId = prev.items.some((i) => i.id === get().selectedId) ? get().selectedId : null;
          set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY_LIMIT), selectedId });
        },

        redo: () => {
          if (dragOrigin) get().dragEnd();
          const { past, doc, future, readOnly } = get();
          if (!future.length || readOnly) return;
          const next = future[0];
          const selectedId = next.items.some((i) => i.id === get().selectedId) ? get().selectedId : null;
          set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: future.slice(1), selectedId });
        },

        select: (id) => set({ selectedId: id }),
        hover: (id) => set({ hoverId: id }),
        setUI: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),

        toast: (text, tone = 'info') => {
          const id = ++toastSeq;
          set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
          window.setTimeout(() => get().dismissToast(id), 3800);
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

        requestCamera: (preset) => set({ cameraRequest: { preset, nonce: Date.now() } }),
      };
    },
    {
      name: 'blumodel-kitchen-v1',
      version: 1,
      partialize: (s) => ({
        ui: { ...s.ui, leftTab: 'products' as LeftTab, rightTab: 'details' as RightTab },
      }),
      merge: (persisted, current) => {
        const p = persisted as (Partial<State> & { doc?: DesignDoc }) | undefined;
        // Before accounts existed the open design lived in this key; carry it over as the on-device draft.
        if (p?.doc && !loadLocalDraft()) saveLocalDraft(p.doc);
        return { ...current, ui: { ...current.ui, ...(p?.ui ?? {}) } };
      },
    },
  ),
);

qaExpose({ store: useDesignStore });

export function useSelected(): Resolved | null {
  const item = useDesignStore((s) => s.doc.items.find((i) => i.id === s.selectedId) ?? null);
  // The catalog version is a dependency because it changes what `resolve` returns for the same item.
  const catalogVersion = useCatalogVersion();
  return useMemo(() => (item ? resolve(item) : null), [item, catalogVersion]);
}
