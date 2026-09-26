import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DesignDoc, PlacedItem, PlanStyle, Product, Room, Rotation, Surfaces, ViewMode } from '../types';
import { getProduct, isOpening, itemWidth, snapsToWall } from '../data/catalog';
import { CABINET_FINISHES } from '../data/finishes';
import { buildTemplate, type TemplateId } from '../data/templates';
import {
  alongWall,
  boxesOverlap,
  clamp,
  flushWall,
  footprint,
  overlap1D,
  placeOnWall,
  resolve,
  resolveAll,
  snapItem,
  WALL_ROTATION,
  WALLS,
  wallLength,
  type Resolved,
} from '../lib/geometry';
import { defaultFinishIndex } from '../lib/finish';
import { makeId } from '../lib/id';

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
  setSurfaces: (s: Partial<Surfaces>) => void;
  addItem: (productId: string, at?: { x: number; y: number }) => void;
  beginDrag: (id: string) => void;
  dragTo: (id: string, x: number, y: number) => void;
  endDrag: () => void;
  moveTo: (id: string, x: number, y: number) => void;
  nudge: (id: string, dx: number, dy: number) => void;
  rotate: (id: string, dir: 1 | -1) => void;
  setFinish: (id: string, finishIndex: number) => void;
  setWidth: (id: string, widthIn: number) => void;
  toggleMirror: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  applyCabinetFinishToAll: (finishIndex: number) => void;
  applyTemplate: (id: TemplateId) => void;
  clearItems: () => void;
  importDoc: (doc: DesignDoc) => void;
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

const DEFAULT_ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };
const DEFAULT_SURFACES: Surfaces = {
  cabinetFinishId: 'warm-white',
  doorStyle: 'shaker',
  hardwareId: 'brass',
  countertopId: 'calacatta',
  backsplashId: 'zellige-white',
  flooringId: 'herringbone',
  paintId: 'chalk',
};

function initialDoc(): DesignDoc {
  const { items } = buildTemplate('l-island', DEFAULT_ROOM, DEFAULT_SURFACES);
  return { name: 'Untitled Kitchen', room: DEFAULT_ROOM, surfaces: DEFAULT_SURFACES, items };
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
    for (const wall of WALLS) {
      const len = wallLength(wall, room);
      const rotation = WALL_ROTATION[wall];
      const inset = isOpening(product) ? 0 : d / 2;
      for (let along = w / 2; along <= len - w / 2; along += 3) {
        const { x, y } = placeOnWall(wall, along, inset, room);
        if (!collides(x, y, rotation)) return { x, y, rotation };
      }
    }
  }
  return spiralFrom(room.widthIn / 2, room.lengthIn / 2, 0, w, d, room, collides) ?? { x: room.widthIn / 2, y: room.lengthIn / 2, rotation: 0 };
}

function spiralFrom(cx: number, cy: number, rotation: Rotation, w: number, d: number, room: Room, collides: (x: number, y: number, r: Rotation) => boolean) {
  const swap = rotation === 90 || rotation === 270;
  const hx = (swap ? d : w) / 2;
  const hy = (swap ? w : d) / 2;
  for (let r = 0; r < Math.max(room.widthIn, room.lengthIn); r += 4) {
    const steps = r === 0 ? 1 : 24;
    for (let a = 0; a < steps; a++) {
      const x = clamp(cx + Math.cos((a / steps) * Math.PI * 2) * r, hx, room.widthIn - hx);
      const y = clamp(cy + Math.sin((a / steps) * Math.PI * 2) * r, hy, room.lengthIn - hy);
      if (!collides(x, y, rotation)) return { x, y, rotation };
    }
  }
  return null;
}

export const useDesignStore = create<State>()(
  persist(
    (set, get) => {
      const commit = (fn: (doc: DesignDoc) => DesignDoc, extra?: Partial<State>) => {
        const { doc, past } = get();
        const next = fn(doc);
        if (next === doc) return;
        set({ doc: next, past: [...past, doc].slice(-HISTORY_LIMIT), future: [], ...extra });
      };

      return {
        doc: initialDoc(),
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
            room.widthIn = clamp(Math.round(room.widthIn), 72, 480);
            room.lengthIn = clamp(Math.round(room.lengthIn), 72, 480);
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

        setSurfaces: (patch) =>
          commit((doc) => {
            const surfaces = { ...doc.surfaces, ...patch };
            let items = doc.items;
            if (patch.cabinetFinishId && patch.cabinetFinishId !== doc.surfaces.cabinetFinishId) {
              const oldIdx = CABINET_FINISHES.findIndex((f) => f.id === doc.surfaces.cabinetFinishId);
              const newIdx = CABINET_FINISHES.findIndex((f) => f.id === patch.cabinetFinishId);
              // Items that followed the old kitchen-wide finish follow the new one; deliberate accents (a navy island) stay.
              items = items.map((it) => {
                const p = getProduct(it.productId);
                return p?.finishes === 'cabinet' && it.finishIndex === oldIdx ? { ...it, finishIndex: newIdx } : it;
              });
            }
            return { ...doc, surfaces, items };
          }),

        addItem: (productId, at) => {
          const product = getProduct(productId);
          if (!product) return;
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
            finishIndex: defaultFinishIndex(product, doc.surfaces),
          };
          commit((d) => ({ ...d, items: [...d.items, item] }), { selectedId: id });
          get().setUI({ rightTab: 'details' });
        },

        beginDrag: (id) => {
          const { doc, past } = get();
          set({ past: [...past, doc].slice(-HISTORY_LIMIT), future: [], dragging: true, selectedId: id });
        },

        dragTo: (id, x, y) => {
          const { doc } = get();
          const it = doc.items.find((i) => i.id === id);
          const product = it && getProduct(it.productId);
          if (!it || !product) return;
          const others: Resolved[] = resolveAll(doc.items.filter((o) => o.id !== id));
          const snap = snapItem({ id, x, y, rotation: it.rotation }, product, itemWidth(it, product), doc.room, others);
          if (snap.x === it.x && snap.y === it.y && snap.rotation === it.rotation) return;
          set({ doc: updateItem(doc, id, (i) => ({ ...i, x: snap.x, y: snap.y, rotation: snap.rotation })) });
        },

        endDrag: () => set({ dragging: false }),

        moveTo: (id, x, y) => commit((doc) => updateItem(doc, id, (i) => ({ ...i, x, y }))),

        nudge: (id, dx, dy) =>
          commit((doc) =>
            updateItem(doc, id, (i) => {
              const r = resolve(i);
              if (!r) return i;
              const hx = (r.box.maxX - r.box.minX) / 2;
              const hy = (r.box.maxY - r.box.minY) / 2;
              const open = isOpening(r.product);
              return {
                ...i,
                x: open ? clamp(i.x + dx, -3, doc.room.widthIn + 3) : clamp(i.x + dx, hx, doc.room.widthIn - hx),
                y: open ? clamp(i.y + dy, -3, doc.room.lengthIn + 3) : clamp(i.y + dy, hy, doc.room.lengthIn - hy),
              };
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
              return { ...i, rotation, x: clamp(i.x, hx, doc.room.widthIn - hx), y: clamp(i.y, hy, doc.room.lengthIn - hy) };
            }),
          ),

        setFinish: (id, finishIndex) => commit((doc) => updateItem(doc, id, (i) => ({ ...i, finishIndex }))),

        setWidth: (id, widthIn) =>
          commit((doc) =>
            updateItem(doc, id, (i) => {
              const r = resolve(i);
              if (!r) return i;
              const wall = flushWall(r, doc.room);
              const next: PlacedItem = { ...i, widthIn: widthIn === r.product.widthIn ? undefined : widthIn };
              if (!wall || isOpening(r.product)) return next;
              // Grow away from the fixed left edge, like extending a run of cabinets.
              const [start] = alongWall(wall, r.box);
              const along = clamp(start + widthIn / 2, widthIn / 2, wallLength(wall, doc.room) - widthIn / 2);
              const pos = placeOnWall(wall, along, r.d / 2, doc.room);
              return { ...next, ...pos };
            }),
          ),

        toggleMirror: (id) => commit((doc) => updateItem(doc, id, (i) => ({ ...i, mirrored: !i.mirrored }))),

        duplicate: (id) => {
          const { doc } = get();
          const it = doc.items.find((i) => i.id === id);
          const r = it && resolve(it);
          if (!it || !r) return;
          const newId = makeId();
          const others = resolveAll(doc.items);
          const collides = collider(r.product, r.w, others);
          const wall = flushWall(r, doc.room);
          let spot: { x: number; y: number; rotation: Rotation } | null = null;
          if (wall) {
            // Walk outward along the same wall, right side first, until the copy fits.
            const len = wallLength(wall, doc.room);
            const [start, end] = alongWall(wall, r.box);
            const inset = isOpening(r.product) ? 0 : r.d / 2;
            for (let k = 0; k < len && !spot; k += 3) {
              for (const along of [end + r.w / 2 + k, start - r.w / 2 - k]) {
                if (along < r.w / 2 || along > len - r.w / 2) continue;
                const p = placeOnWall(wall, along, inset, doc.room);
                if (!collides(p.x, p.y, it.rotation)) {
                  spot = { ...p, rotation: it.rotation };
                  break;
                }
              }
            }
          } else {
            const step = r.box.maxX - r.box.minX + 2;
            spot = !collides(it.x + step, it.y, it.rotation) && it.x + step + (r.box.maxX - r.box.minX) / 2 <= doc.room.widthIn
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

        applyCabinetFinishToAll: (finishIndex) =>
          commit((doc) => ({
            ...doc,
            surfaces: { ...doc.surfaces, cabinetFinishId: CABINET_FINISHES[finishIndex].id },
            items: doc.items.map((it) => (getProduct(it.productId)?.finishes === 'cabinet' ? { ...it, finishIndex } : it)),
          })),

        applyTemplate: (id) => {
          const { doc } = get();
          const { items, note } = buildTemplate(id, doc.room, doc.surfaces);
          if (!items.length) {
            get().toast(note ?? 'That layout does not fit this room.', 'warn');
            return;
          }
          commit((d) => ({ ...d, items }), { selectedId: null });
          get().toast(note ? `Layout applied. ${note}` : 'Layout applied. Press Ctrl+Z to go back.', note ? 'warn' : 'ok');
        },

        clearItems: () => commit((doc) => ({ ...doc, items: [] }), { selectedId: null }),

        importDoc: (incoming) => commit(() => incoming, { selectedId: null }),

        undo: () => {
          const { past, doc, future } = get();
          if (!past.length) return;
          const prev = past[past.length - 1];
          const selectedId = prev.items.some((i) => i.id === get().selectedId) ? get().selectedId : null;
          set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY_LIMIT), selectedId });
        },

        redo: () => {
          const { past, doc, future } = get();
          if (!future.length) return;
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
      name: 'mise-kitchen-v1',
      version: 1,
      partialize: (s) => ({
        doc: s.doc,
        ui: { ...s.ui, leftTab: 'products' as LeftTab, rightTab: 'details' as RightTab },
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<State> | undefined;
        if (!p?.doc || !Array.isArray(p.doc.items)) return current;
        const items = p.doc.items.filter((i) => getProduct(i.productId));
        return {
          ...current,
          doc: { ...current.doc, ...p.doc, surfaces: { ...current.doc.surfaces, ...p.doc.surfaces }, items },
          ui: { ...current.ui, ...(p.ui ?? {}) },
        };
      },
    },
  ),
);

export function useSelected(): Resolved | null {
  const item = useDesignStore((s) => s.doc.items.find((i) => i.id === s.selectedId) ?? null);
  return useMemo(() => (item ? resolve(item) : null), [item]);
}
