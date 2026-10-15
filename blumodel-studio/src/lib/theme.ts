/**
 * Appearance: System / Light / Dark (Account settings > Preferences).
 *
 * The choice is kept in this browser (`blumodel.theme`) AND, for a signed-in person, in their
 * account (`/api/account/prefs`, see prefs.ts), so it follows them to another device. It is shown
 * as two attributes on <html>:
 *
 *   data-theme="light" | "dark"                the RESOLVED theme: System follows the device's
 *                                              prefers-color-scheme, live
 *   data-theme-pref="system" | "light" | "dark"  what the person picked
 *
 * Stylesheets only ever need `[data-theme="dark"]`. `public/theme-boot.js` (a classic script in
 * the <head>) sets the same attributes from the same key before the first paint, so a dark page
 * never flashes light while the app loads; `initTheme()` takes over from it.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'blumodel.theme';
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'];

export const isThemePref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark';

/** The stored choice, or 'system'. Never throws (storage can be blocked). */
export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemePref(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean = systemDark()): Theme {
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
}

let current: ThemePref = 'system';
let listening = false;
const listeners = new Set<(pref: ThemePref, theme: Theme) => void>();

function paint(pref: ThemePref) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  const theme = resolveTheme(pref);
  el.setAttribute('data-theme', theme);
  el.setAttribute('data-theme-pref', pref);
  for (const fn of listeners) fn(pref, theme);
}

/** Applies a choice now, remembers it in this browser, and follows the device while it is 'system'. */
export function applyTheme(pref: ThemePref, { store = true }: { store?: boolean } = {}) {
  current = isThemePref(pref) ? pref : 'system';
  if (store) {
    try {
      localStorage.setItem(THEME_KEY, current);
    } catch {
      /* storage blocked: it still applies to this page */
    }
  }
  paint(current);
}

export function themePref(): ThemePref {
  return current;
}

/** Called for every change (the setting itself, or the device switching while on System). */
export function onThemeChange(fn: (pref: ThemePref, theme: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Boot: the stored choice (theme-boot.js has usually set it already), and the live System follow. */
export function initTheme() {
  current = readThemePref();
  paint(current);
  if (listening || typeof matchMedia !== 'function') return;
  listening = true;
  try {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => current === 'system' && paint(current);
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', on);
    else mq.addListener?.(on);
  } catch {
    /* no media queries: the choice still applies */
  }
  // Another tab changed it.
  try {
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_KEY) {
        current = readThemePref();
        paint(current);
      }
    });
  } catch {
    /* not a browser */
  }
}
