import type { BrandPrefs, DesignDoc, PlacedItem, Room, Surfaces } from '../types';
import { buildTemplate, type TemplateId } from './templates';
import { PLAIN_PRESET, type StylePreset } from './styles';
import { getProduct } from './catalog';
import { DEFAULT_SURFACES } from './defaults';
import { finishById } from '../lib/finish';
import { withFinishIds } from '../lib/doc';
import { buildFromSpec, type LayoutSpec } from '../lib/generate/layout';
import { cleanBrandPrefs } from '../lib/generate/brands';

/** What a new kitchen starts from: a template, a declarative spec, ready items, or an empty room. */
export type ComposeLayout = TemplateId | LayoutSpec | PlacedItem[] | null;

function itemsFor(layout: ComposeLayout, room: Room, surfaces: Surfaces, brands?: BrandPrefs): PlacedItem[] {
  if (!layout) return [];
  if (typeof layout === 'string') return buildTemplate(layout, room, surfaces, brands).items;
  if (Array.isArray(layout)) return layout.map((it) => ({ ...it }));
  return buildFromSpec(layout, room, surfaces, brands).items;
}

/**
 * Builds a starting design from the setup wizard's answers (or a generated layout). A style
 * preset sets the surfaces and gives islands its two-tone accent; `surfaces`, when given,
 * replaces both (the photo flow passes the finishes matched to the photos). `brands`, the
 * preferred brands, fill every slot one of them sells in that size and are kept on the kitchen.
 */
export function composeDoc(name: string, room: Room, layout: ComposeLayout, preset: StylePreset | null, surfaces?: Surfaces, brands?: BrandPrefs): DesignDoc {
  const s = surfaces ? { ...surfaces } : preset ? { ...preset.surfaces } : { ...DEFAULT_SURFACES };
  const brandPrefs = cleanBrandPrefs(brands);
  let items = itemsFor(layout, room, s, brandPrefs);
  if (preset && !surfaces) {
    items = items.map((it) => {
      const p = getProduct(it.productId);
      return p?.kind === 'island' ? { ...it, ...finishById(p, preset.island) } : it;
    });
  }
  return { name, room, surfaces: s, items: withFinishIds(items), ...(brandPrefs ? { brandPrefs } : {}), version: 2 };
}

/**
 * A kitchen from the setup wizard: plain neutral finishes with no colour palette applied, and
 * islands in the cabinet finish rather than a palette's accent. Palettes are chosen later in
 * Room & finishes. `brands`: the wizard's "Choose your brands" answers (none: all BluModel Basics).
 */
export function composeNewKitchen(name: string, room: Room, layout: ComposeLayout, brands?: BrandPrefs): DesignDoc {
  return composeDoc(name, room, layout, PLAIN_PRESET, undefined, brands);
}
