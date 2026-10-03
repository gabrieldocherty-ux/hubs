import type { PatternSpec } from '../../lib/textures';
import { getPattern } from '../../lib/textures';

export const INK = '#29251f';
export const INK_SOFT = '#6f675b';
export const PAPER = '#f3eee5';
export const WALL = '#2f2a25';
export const ACCENT = '#c2542d';
export const BAD = '#c43d2f';
export const WARN = '#c98a1b';
export const OK = '#3f7d52';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const FONT_SANS = '"Instrument Sans", system-ui, -apple-system, sans-serif';
export const WALL_T = 5;

/** Konva props that paint a shape with a procedural texture at true inch scale. */
export function patternFill(spec: PatternSpec) {
  const t = getPattern(spec);
  return {
    fillPatternImage: t.canvas as unknown as HTMLImageElement,
    fillPatternScale: { x: 1 / t.pxPerIn, y: 1 / t.pxPerIn },
    fillPatternRepeat: 'repeat' as const,
  };
}
