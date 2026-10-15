/**
 * Package 'finder' pure helpers: no React, no DOM beyond the arguments, so they unit-test.
 */

/**
 * The editor's export-success toasts (TopBar, ElevationsView): "Shopping list saved as CSV.",
 * "Floor plan saved as PNG.", "North wall elevation saved as SVG.", "Project saved. Open it…".
 * The finder's after-export link keys on these, so the toasts themselves need no change.
 */
export function isExportToast(text: string, tone: string): boolean {
  if (tone !== 'ok') return false;
  return /\bsaved as (CSV|PNG|SVG|PDF)\.$/.test(text) || /^Project saved\./.test(text);
}

/** "AP" for "Alder & Pine Cabinetry (Demo)": the logo stand-in. */
export function initials(name: string): string {
  return (
    name
      .replace(/\(.*?\)/g, '')
      .split(/[\s&]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '·'
  );
}

/** A website without its scheme or trailing slash, for display. */
export function siteLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the popover goes for a link at `anchor`: above it when there's more room above (the
 * link sits near the bottom of a panel or the screen), else below; right-aligned with the link
 * and kept 8px inside the viewport. On a phone-width screen it spans the width less 12px gutters.
 */
export function placePopover(anchor: Rect, size: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number; width: number; above: boolean } {
  const gap = 8;
  const narrow = view.width <= 560;
  const width = narrow ? view.width - 24 : Math.min(size.width, view.width - 16);
  const roomAbove = anchor.top - gap;
  const roomBelow = view.height - anchor.bottom - gap;
  const above = roomAbove >= size.height || roomAbove > roomBelow;
  const top = above ? Math.max(gap, anchor.top - gap - size.height) : Math.min(view.height - gap - size.height, anchor.bottom + gap);
  const left = narrow ? 12 : Math.min(Math.max(gap, anchor.right - width), view.width - gap - width);
  return { left: Math.round(left), top: Math.round(Math.max(gap, top)), width: Math.round(width), above };
}

/** The next element in tab order after `el` (to leave the popover forwards), or null. */
export function nextTabbable(el: Element, root: ParentNode = document): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(
    (x) => x.tabIndex >= 0 && !x.closest('[data-finder-pop]') && (x.offsetParent !== null || x === el),
  );
  const i = all.indexOf(el as HTMLElement);
  return i >= 0 ? all[i + 1] ?? null : null;
}
