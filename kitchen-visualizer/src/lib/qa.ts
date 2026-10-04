/**
 * Opening the app with `?qa` in the URL (e.g. `/?qa#/local`) exposes a few internals on
 * `window.__miseQA` so headless screenshot scripts can drive the store and the 3D camera.
 * Without the flag this is inert: nothing is attached to `window`.
 */
export const QA = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('qa');

export function qaExpose(values: Record<string, unknown>) {
  if (!QA) return;
  const w = window as unknown as { __miseQA?: Record<string, unknown> };
  w.__miseQA = { ...(w.__miseQA ?? {}), ...values };
}
