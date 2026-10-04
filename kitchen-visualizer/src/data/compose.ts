import type { DesignDoc, Room } from '../types';
import { buildTemplate, type TemplateId } from './templates';
import type { StylePreset } from './styles';
import { getProduct } from './catalog';
import { DEFAULT_SURFACES } from './defaults';
import { finishById } from '../lib/finish';
import { withFinishIds } from '../lib/doc';

/** Builds a starting design from the setup wizard's answers. */
export function composeDoc(name: string, room: Room, templateId: TemplateId | null, preset: StylePreset | null): DesignDoc {
  const surfaces = preset ? { ...preset.surfaces } : { ...DEFAULT_SURFACES };
  let items = templateId ? buildTemplate(templateId, room, surfaces).items : [];
  if (preset) {
    items = items.map((it) => {
      const p = getProduct(it.productId);
      return p?.kind === 'island' ? { ...it, ...finishById(p, preset.island) } : it;
    });
  }
  return { name, room, surfaces, items: withFinishIds(items), version: 2 };
}
