import type { StylePreset } from '../data/styles';
import { CABINET_FINISHES, COUNTERTOPS, FLOORING, PAINTS, byId, resolveBacksplash } from '../data/finishes';
import { patternDataUrl } from '../lib/textures';

/** Five swatches that summarise a style: cabinets, counter, tile, floor, walls. */
export function PresetStrip({ preset }: { preset: StylePreset }) {
  const s = preset.surfaces;
  const cab = byId(CABINET_FINISHES, s.cabinetFinishId);
  const strip = [
    cab.material === 'wood' ? `url(${patternDataUrl({ type: 'wood', base: cab.hex }, 48, 6)})` : cab.hex,
    `url(${patternDataUrl(byId(COUNTERTOPS, s.countertopId).pattern)})`,
    `url(${patternDataUrl(resolveBacksplash(s.backsplashId, s.countertopId).pattern)})`,
    `url(${patternDataUrl(byId(FLOORING, s.flooringId).pattern)})`,
    byId(PAINTS, s.paintId).hex,
  ];
  return (
    <span className="preset-strip">
      {strip.map((bg, i) => (
        <i key={i} style={{ background: bg, backgroundSize: 'cover' }} />
      ))}
    </span>
  );
}
