import type { DesignDoc, Room } from '../types';
import { buildTemplate, type TemplateId } from './templates';
import type { StylePreset } from './styles';
import { CABINET_FINISHES } from './finishes';
import { getProduct } from './catalog';
import { DEFAULT_SURFACES } from '../store/useDesignStore';

/** Builds a starting design from the setup wizard's answers. */
export function composeDoc(name: string, room: Room, templateId: TemplateId | null, preset: StylePreset | null): DesignDoc {
  const surfaces = preset ? { ...preset.surfaces } : { ...DEFAULT_SURFACES };
  let items = templateId ? buildTemplate(templateId, room, surfaces).items : [];
  if (preset) {
    const islandIdx = Math.max(0, CABINET_FINISHES.findIndex((f) => f.id === preset.island));
    items = items.map((it) => (getProduct(it.productId)?.kind === 'island' ? { ...it, finishIndex: islandIdx } : it));
  }
  return { name, room, surfaces, items };
}
