/**
 * Contrast for the showroom's colours (WCAG 2.x relative luminance and contrast ratio), so the
 * Showroom tab can warn before a company picks a button colour its visitors can't read.
 */

export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** "#abc" / "abc" / "#AABBCC" → "#aabbcc"; null when it isn't a colour. */
export function normalizeHex(v: string): string | null {
  let s = v.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX_RE.test(s) ? s : null;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex) ?? '#000000';
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of white or near-black reads better on `bg`. */
export function textOn(bg: string): '#ffffff' | '#1a1a1a' {
  return contrast(bg, '#ffffff') >= contrast(bg, '#1a1a1a') ? '#ffffff' : '#1a1a1a';
}

export interface ContrastCheck {
  ok: boolean;
  ratio: number;
  message: string | null;
}

/**
 * The main colour carries the buttons and the header, with white or near-black text on it
 * (whichever reads better, which always reaches 4.5:1), and has to stand out on a white page:
 * 3:1 or more against white (WCAG's minimum for large text and interface parts).
 */
export function checkPrimary(hex: string): ContrastCheck {
  const h = normalizeHex(hex);
  if (!h) return { ok: false, ratio: 0, message: 'Use a colour like #2e3d55.' };
  const onPage = contrast(h, '#ffffff');
  if (onPage < 3) return { ok: false, ratio: onPage, message: `This colour is faint on a white page (${onPage.toFixed(1)}:1; aim for 3:1 or more), so buttons, headings and links in it will be hard to see. Try a darker shade.` };
  return { ok: true, ratio: onPage, message: null };
}

/** The accent is decoration (chips, highlights): only warn when it vanishes into white or the main colour. */
export function checkAccent(accent: string, primary: string): ContrastCheck {
  const a = normalizeHex(accent);
  const p = normalizeHex(primary);
  if (!a) return { ok: false, ratio: 0, message: 'Use a colour like #9aa892.' };
  const onPage = contrast(a, '#ffffff');
  if (onPage < 1.3) return { ok: false, ratio: onPage, message: 'The accent almost disappears on a white page.' };
  if (p && contrast(a, p) < 1.3) return { ok: false, ratio: contrast(a, p), message: 'The accent is very close to the main colour, so the two won’t tell apart.' };
  return { ok: true, ratio: onPage, message: null };
}
