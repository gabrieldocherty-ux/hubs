import type { DesignDoc, PlacedItem, Room, Surfaces } from '../types';
import { buildTemplate, type TemplateId } from './templates';
import { PLAIN_PRESET, type StylePreset } from './styles';
import { getProduct } from './catalog';
import { DEFAULT_SURFACES } from './defaults';
import { finishById } from '../lib/finish';
import { withFinishIds } from '../lib/doc';
import { buildFromSpec, type LayoutSpec } from '../lib/generate/layout';

/** What a new kitchen starts from: a template, a declarative spec, ready items, or an empty room. */
export type ComposeLayout = TemplateId | LayoutSpec | PlacedItem[] | null;

function itemsFor(layout: ComposeLayout, room: Room, surfaces: Surfaces): PlacedItem[] {
  if (!layout) return [];
  if (typeof layout === 'string') return buildTemplate(layout, room, surfaces).items;
  if (Array.isArray(layout)) return layout.map((it) => ({ ...it }));
  return buildFromSpec(layout, room, surfaces).items;
}

/**
 * Builds a starting design from the setup wizard's answers (or a generated layout). A style
 * preset sets the surfaces and gives islands its two-tone accent; `surfaces`, when given,
 * replaces both (the photo flow passes the finishes matched to the photos).
 */
export function composeDoc(name: string, room: Room, layout: ComposeLayout, preset: StylePreset | null, surfaces?: Surfaces): DesignDoc {
  const s = surfaces ? { ...surfaces } : preset ? { ...preset.surfaces } : { ...DEFAULT_SURFACES };
  let items = itemsFor(layout, room, s);
  if (preset && !surfaces) {
    items = items.map((it) => {
      const p = getProduct(it.productId);
      return p?.kind === 'island' ? { ...it, ...finishById(p, preset.island) } : it;
    });
  }
  return { name, room, surfaces: s, items: withFinishIds(items), version: 2 };
}

/**
 * A kitchen from the setup wizard: plain neutral finishes with no colour palette applied, and
 * islands in the cabinet finish rather than a palette's accent. Palettes are chosen later in
 * Room & finishes.
 */
export function composeNewKitchen(name: string, room: Room, layout: ComposeLayout): DesignDoc {
  return composeDoc(name, room, layout, PLAIN_PRESET);
}
