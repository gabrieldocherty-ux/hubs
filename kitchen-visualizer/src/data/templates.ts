import type { PlacedItem, Room, Surfaces } from '../types';
import { buildFromSpec, type LayoutSpec, type Slot } from '../lib/generate/layout';

export type TemplateId = 'one-wall' | 'galley' | 'l-shape' | 'u-shape' | 'l-island';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  blurb: string;
  minWidth: number;
  minLength: number;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'one-wall', name: 'One Wall', blurb: 'Everything on one run. Great for lofts.', minWidth: 120, minLength: 72 },
  { id: 'galley', name: 'Galley', blurb: 'Two parallel runs, a chef\'s favorite.', minWidth: 96, minLength: 96 },
  { id: 'l-shape', name: 'L-Shape', blurb: 'Open corner layout with a clean triangle.', minWidth: 108, minLength: 96 },
  { id: 'u-shape', name: 'U-Shape', blurb: 'Wraps three walls, maximum counter.', minWidth: 132, minLength: 96 },
  { id: 'l-island', name: 'L + Island', blurb: 'The open-plan classic with seating.', minWidth: 156, minLength: 150 },
];

const FRIDGE: Slot = { role: 'fridge', variant: 'french' };
const RANGE: Slot = { role: 'range' };
const FARM_SINK: Slot = { role: 'sink', variant: 'farmhouse' };
const DISHWASHER: Slot = { role: 'dishwasher' };

/**
 * Each template as a declarative spec for a room (BUILD_PLAN D-T2). The slots name roles, not
 * product ids, so a renamed product can never crash the app: a role with nothing to fill it is
 * skipped with a note. The output is pinned by the golden test in
 * `src/lib/generate/__tests__/templates.golden.test.ts`.
 */
export function templateSpec(id: TemplateId, room: Room): LayoutSpec {
  const W = room.widthIn;
  const L = room.lengthIn;
  switch (id) {
    case 'one-wall':
      return {
        runs: [
          {
            wall: 'north',
            start: 0,
            end: W,
            slots: [FRIDGE, 'flex', { role: 'trash', optional: true }, FARM_SINK, DISHWASHER, 'flex', RANGE, 'flex', { role: 'pantry', optional: true }],
            opts: { window: true },
          },
        ],
        openings: [{ productId: 'opening', wall: 'south', along: W / 2, widthIn: 48 }],
      };
    case 'galley': {
      const aisle = L - 48;
      return {
        runs: [
          { wall: 'north', start: 0, end: W, slots: [FRIDGE, 'flex', RANGE, 'flex', { role: 'pantry', optional: true }] },
          { wall: 'south', start: 0, end: W, slots: ['flex', { role: 'sink', variant: 'undermount' }, DISHWASHER, 'flex'], opts: { window: true } },
        ],
        decor: aisle >= 42 ? [{ productId: 'rug-runner', x: W / 2, y: L / 2, rotation: 90, finishIndex: 0 }] : [],
        openings: [{ productId: 'opening', wall: 'east', along: L / 2, widthIn: Math.min(48, Math.floor((aisle - 4) / 12) * 12) }],
      };
    }
    case 'l-shape':
    case 'l-island': {
      // Sink tucked near the corner and the fridge just around it keeps every triangle leg under 9′.
      const westEnd = L > 168 ? L - 36 : L;
      const spec: LayoutSpec = {
        runs: [
          {
            wall: 'north',
            start: 0,
            end: W,
            slots: [{ role: 'corner' }, { role: 'trash', optional: true }, FARM_SINK, DISHWASHER, 'flex', { role: 'pantry', optional: true }],
            opts: { window: true },
          },
          { wall: 'west', start: 36, end: westEnd, slots: [FRIDGE, 'flex', RANGE, 'flex'] },
        ],
        openings: [{ productId: 'opening', wall: 'east', along: L - 30, widthIn: 36 }],
        decor: westEnd < L - 20 ? [{ productId: 'olive-tree', x: 16, y: L - 16, rotation: 0 }] : [],
      };
      if (id === 'l-island') {
        const minX = 30 + 44;
        const maxX = W - 38;
        const width = [108, 96, 84, 72, 60].find((w) => w <= maxX - minX);
        const minY = 24 + 44;
        if (width && minY + 42 + 40 <= L) {
          spec.island = {
            x: (minX + maxX) / 2,
            y: minY + 21,
            widthIn: width,
            seats: Math.max(2, Math.floor(width / 26)),
            pendants: width >= 84 ? 3 : 2,
            finishIndex: 6,
          };
        }
      }
      return spec;
    }
    case 'u-shape':
      return {
        runs: [
          { wall: 'north', start: 0, end: W, slots: [{ role: 'corner' }, 'flex', FARM_SINK, DISHWASHER, 'flex', { role: 'corner' }], opts: { window: true } },
          { wall: 'west', start: 36, end: L - 6, slots: ['flex', RANGE, 'flex'] },
          { wall: 'east', start: 36, end: L - 6, slots: [FRIDGE, 'flex'] },
        ],
        openings: [{ productId: 'opening', wall: 'south', along: W / 2, widthIn: Math.min(48, Math.floor((W - 56) / 12) * 12) }],
      };
  }
}

export function buildTemplate(id: TemplateId, room: Room, surfaces: Surfaces): { items: PlacedItem[]; note?: string } {
  const info = TEMPLATES.find((t) => t.id === id);
  if (!info) return { items: [] };
  if (room.widthIn < info.minWidth || room.lengthIn < info.minLength) {
    return {
      items: [],
      note: `${info.name} needs a room at least ${Math.ceil(info.minWidth / 12)}′ × ${Math.ceil(info.minLength / 12)}′.`,
    };
  }
  const { items, notes } = buildFromSpec(templateSpec(id, room), room, surfaces);
  return { items, note: notes.length ? notes.join(' ') : undefined };
}
