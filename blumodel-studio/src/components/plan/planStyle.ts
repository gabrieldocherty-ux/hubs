import { createContext, useContext } from 'react';
import type { PatternSpec } from '../../lib/textures';
import { getPattern } from '../../lib/textures';
import type { Theme } from '../../lib/theme';

export const INK = '#29251f';
export const INK_SOFT = '#6f675b';
export const PAPER = '#f3eee5';
export const WALL = '#2f2a25';
export const ACCENT = '#c2542d';
export const BAD = '#c43d2f';
export const WARN = '#c98a1b';
export const OK = '#3f7d52';
/** Snap guides and neighbour distances while dragging: a cool blue that reads against warm floors and the accent. */
export const GUIDE = '#2a72b5';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const FONT_SANS = '"Instrument Sans", system-ui, -apple-system, sans-serif';
export const WALL_T = 5;

/**
 * The plan's own colours: what follows the app's theme. What sits on the floor in the rendered
 * style keeps its real colours and dark line work in both themes (a white cabinet is white at
 * night too); the surround, the walls, the openings, the dimensions and the whole drafting style
 * follow the theme. Exports always use PLAN_LIGHT: a plan is printed on white paper.
 */
export interface PlanPalette {
  /** Lines and labels on the drawing (drafting), and on the surround (both styles). */
  ink: string;
  inkSoft: string;
  /** Dimension strings along the walls. */
  muted: string;
  /** Selection dimensions. */
  accent: string;
  /** Rendered: around the room, and what an opening in the wall shows. */
  paper: string;
  /** Drafting: the sheet, the floor and every piece's fill. */
  sheet: string;
  /** Drafting: what an opening in the wall shows. */
  draftGap: string;
  /** Rendered walls and their outline. */
  wall: string;
  wallStroke: string;
  /** The 1′ grid in the drafting style. */
  grid: string;
}

export const PLAN_LIGHT: PlanPalette = {
  ink: INK,
  inkSoft: INK_SOFT,
  muted: '#7a7166',
  accent: ACCENT,
  paper: PAPER,
  sheet: '#ffffff',
  draftGap: PAPER,
  wall: WALL,
  wallStroke: INK,
  grid: 'rgba(41,37,31,0.09)',
};

export const PLAN_DARK: PlanPalette = {
  ink: '#ebe5da',
  inkSoft: '#b2a898',
  muted: '#aaa192',
  accent: '#ee8a61',
  paper: '#161411',
  sheet: '#201d1a',
  draftGap: '#201d1a',
  wall: '#7d7466',
  wallStroke: '#141210',
  grid: 'rgba(235,229,218,0.1)',
};

export const planPalette = (theme: Theme): PlanPalette => (theme === 'dark' ? PLAN_DARK : PLAN_LIGHT);

/** Provided by PlanView (the theme's palette, or PLAN_LIGHT while exporting). */
export const PlanPaletteContext = createContext<PlanPalette>(PLAN_LIGHT);
export const usePlanPalette = (): PlanPalette => useContext(PlanPaletteContext);

/** Konva props that paint a shape with a procedural texture at true inch scale. */
export function patternFill(spec: PatternSpec) {
  const t = getPattern(spec);
  return {
    fillPatternImage: t.canvas as unknown as HTMLImageElement,
    fillPatternScale: { x: 1 / t.pxPerIn, y: 1 / t.pxPerIn },
    fillPatternRepeat: 'repeat' as const,
  };
}
