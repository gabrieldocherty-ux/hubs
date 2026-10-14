import type { ProductEventType } from '../types/platform';
import { isBuiltin } from '../data/catalog';
import { useSession } from '../store/useSession';
import { api } from './api';

/**
 * First-party product analytics (`POST /api/events`). Fire-and-forget: never throws, never
 * blocks the UI. A no-op for built-in products and when there is no server (offline or
 * device-only use). `view` is counted once per product per browser session.
 */
const viewedThisSession = new Set<string>();

function seenView(productId: string): boolean {
  const key = `mise-viewed:${productId}`;
  if (viewedThisSession.has(productId)) return true;
  viewedThisSession.add(productId);
  try {
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the in-memory set still de-duplicates for this page load.
  }
  return false;
}

export function track(productId: string, type: ProductEventType): void {
  if (!productId || isBuiltin(productId)) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (useSession.getState().status === 'offline') return;
  if (type === 'view' && seenView(productId)) return;
  // buy_click usually navigates away next, so let it outlive the page.
  api.event(productId, type, type === 'buy_click').catch(() => undefined);
}
