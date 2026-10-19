/**
 * Opening the app with `?qa` in the URL (e.g. `/?qa#/local`) exposes a few internals on
 * `window.__blumodelQA` so headless screenshot scripts can drive the store and the 3D camera.
 * Without the flag this is inert: nothing is attached to `window`.
 */
export const QA = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('qa');

/** 127.0.0.1 (any 127.x), localhost or [::1]: this machine, never the public site. */
export function isLoopbackHost(hostname: string): boolean {
  return /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1)$/i.test(hostname);
}

/**
 * QA switches that change what a page SAYS (the payment state, who runs the site) work only when
 * the page is opened on this machine, as the QA runner always does. On blumodel.studio a crafted
 * `?qa` link could otherwise show a DEMO banner over real checkout, or another business's name
 * on the Terms.
 */
export const QA_LOCAL = QA && isLoopbackHost(window.location.hostname);

export function qaExpose(values: Record<string, unknown>) {
  if (!QA) return;
  const w = window as unknown as { __blumodelQA?: Record<string, unknown> };
  w.__blumodelQA = { ...(w.__blumodelQA ?? {}), ...values };
}
