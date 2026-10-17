import { hexToRgb, luminance, mix, rgbToHex, shade } from '../../lib/color';

/**
 * A company's colours as the app's colour tokens (styles.css), for its showroom.
 *
 * The showroom never paints with the raw brand colour: it derives the accent tokens from it so
 * that every pairing the stylesheets use still reads at WCAG AA (4.5:1 for text) in both themes,
 * whatever colour the company picked. A pale brand colour is darkened until white text on it
 * passes; in dark mode its text form is lightened until it passes on the dark page.
 *
 *   --accent, --accent-strong  fills behind white text (buttons, the selected chip)
 *   --accent-2, --accent-text  the accent as text or a thin line on the page
 *   --accent-soft              a tint behind body text (a highlighted row)
 *   --brand, --brand-ink       the company's band (the landing hero) and the text on it
 *   --brand-2, --brand-2-soft  the company's second colour, for decoration only (never text)
 */

export const LIGHT_PAGE = { paper: '#f3eee5', panel: '#fbf9f4', card: '#ffffff', ink: '#211e1a' } as const;
export const DARK_PAGE = { paper: '#161411', panel: '#1c1916', card: '#23201c', ink: '#f1ece3' } as const;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` / `#aabbcc` (any case) as `#aabbcc`, or null for anything else. */
export function cleanHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!HEX.test(s)) return null;
  const [r, g, b] = hexToRgb(s);
  return rgbToHex(r, g, b);
}

/** WCAG contrast ratio of two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour itself when it reaches `ratio` against every one of `against`; else stepped toward black or white until it does. */
function reach(hex: string, against: string[], ratio: number, toward: 'dark' | 'light'): string {
  let c = hex;
  for (let i = 0; i <= 40; i++) {
    if (against.every((bg) => contrast(c, bg) >= ratio)) return c;
    c = shade(hex, toward === 'dark' ? -i / 40 : i / 40);
  }
  return toward === 'dark' ? '#000000' : '#ffffff';
}

export interface BrandTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** The token values for a company's primary (and optional second) colour; null when it gave none we can use. */
export function brandTokens(primary: unknown, second?: unknown): BrandTokens | null {
  const p = cleanHex(primary);
  if (!p) return null;
  const s = cleanHex(second) ?? mix(p, '#ffffff', 0.45);
  const fill = reach(p, ['#ffffff'], 4.6, 'dark');
  const fillStrong = shade(fill, -0.18);
  const textLight = reach(p, [LIGHT_PAGE.paper, LIGHT_PAGE.panel, LIGHT_PAGE.card], 4.6, 'dark');
  const textDark = reach(p, [DARK_PAGE.paper, DARK_PAGE.panel, DARK_PAGE.card], 4.6, 'light');
  const softLight = reach(mix(LIGHT_PAGE.card, p, 0.12), [LIGHT_PAGE.ink], 7, 'light');
  const softDark = reach(mix(DARK_PAGE.paper, p, 0.28), [DARK_PAGE.ink], 7, 'dark');
  const shared = { '--accent': fill, '--accent-strong': fillStrong, '--brand': fill, '--brand-ink': '#ffffff', '--brand-2': s };
  return {
    light: { ...shared, '--accent-2': textLight, '--accent-text': textLight, '--accent-soft': softLight, '--brand-2-soft': mix(LIGHT_PAGE.card, s, 0.22) },
    dark: { ...shared, '--accent-2': textDark, '--accent-text': textDark, '--accent-soft': softDark, '--brand-2-soft': mix(DARK_PAGE.paper, s, 0.3) },
  };
}

const block = (sel: string, vars: Record<string, string>) => `${sel}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;

/**
 * The stylesheet that lays the company's tokens over the theme's: light on :root (and the printed
 * paper surfaces, which are always light), dark under [data-theme="dark"] and, for a page whose
 * theme script never ran, under the media query, mirroring styles.css.
 */
export function brandCss(t: BrandTokens): string {
  return [
    block(':root,.theme-paper,.quote-sheet', t.light),
    block(":root[data-theme='dark']", t.dark),
    `@media screen and (prefers-color-scheme: dark){${block(':root:not([data-theme])', t.dark)}}`,
    // Printed pages and paper surfaces stay light inside a dark page.
    block(":root[data-theme='dark'] .theme-paper,:root[data-theme='dark'] .quote-sheet", t.light),
  ].join('\n');
}
