import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlacedItem, RoomDimensions } from '../types';

interface DesignState {
  room: RoomDimensions;
  items: PlacedItem[];
  selectedInstanceId: string | null;

  setRoom: (room: RoomDimensions) => void;
  addItem: (catalogId: string, x: number, y: number) => void;
  moveItem: (instanceId: string, x: number, y: number) => void;
  rotateItem: (instanceId: string) => void;
  setFinish: (instanceId: string, finishIndex: number) => void;
  removeItem: (instanceId: string) => void;
  selectItem: (instanceId: string | null) => void;
  clearAll: () => void;
}

let nextId = 0;

export const useDesignStore = create<DesignState>()(
  persist(
    (set, get) => ({
      room: { widthIn: 144, lengthIn: 120 },
      items: [],
      selectedInstanceId: null,

      setRoom: (room) => set({ room }),

      addItem: (catalogId, x, y) => {
        const instanceId = `item-${Date.now()}-${nextId++}`;
        const item: PlacedItem = {
          instanceId,
          catalogId,
          x,
          y,
          rotationDeg: 0,
          finishIndex: 0,
        };
        set({ items: [...get().items, item], selectedInstanceId: instanceId });
      },

      moveItem: (instanceId, x, y) =>
        set({
          items: get().items.map((it) => (it.instanceId === instanceId ? { ...it, x, y } : it)),
        }),

      rotateItem: (instanceId) =>
        set({
          items: get().items.map((it) =>
            it.instanceId === instanceId
              ? { ...it, rotationDeg: (((it.rotationDeg + 90) % 360) as PlacedItem['rotationDeg']) }
              : it
          ),
        }),

      setFinish: (instanceId, finishIndex) =>
        set({
          items: get().items.map((it) =>
            it.instanceId === instanceId ? { ...it, finishIndex } : it
          ),
        }),

      removeItem: (instanceId) =>
        set({
          items: get().items.filter((it) => it.instanceId !== instanceId),
          selectedInstanceId: get().selectedInstanceId === instanceId ? null : get().selectedInstanceId,
        }),

      selectItem: (instanceId) => set({ selectedInstanceId: instanceId }),

      clearAll: () => set({ items: [], selectedInstanceId: null }),
    }),
    { name: 'kitchen-visualizer-design' }
  )
);
