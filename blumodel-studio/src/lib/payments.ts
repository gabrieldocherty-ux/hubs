import { ApiError } from './api';
import { pageQuery } from './router';

/**
 * Payment helpers every paying screen shares: the "payments open soon" answer, and what happened
 * on the trip to the checkout page (Stripe's hosted page, or the labelled DEMO page).
 */

/** The server's answer while payments are off (`GET /api/config` → `payments: 'none'`). */
export function isPaymentsUnavailable(e: unknown): boolean {
  return e instanceof ApiError && e.status === 503 && (e.body as { code?: string } | undefined)?.code === 'payments_unavailable';
}

export const PAYMENTS_SOON = 'Payments open soon. Designing, saving and sharing are free and work today.';

/** The message for a failed attempt to start a payment. */
export function paymentError(e: unknown, fallback = 'Could not start the payment. Try again.'): string {
  if (isPaymentsUnavailable(e)) return PAYMENTS_SOON;
  return e instanceof ApiError ? e.message : fallback;
}

// ── the trip to checkout and back ────────────────────────────────────────────
// Stripe sends a buyer back with `?session_id=` after paying, and to the plain return page when
// they cancel. The DEMO page navigates back in the app either way. A marker left before leaving
// tells the page they come back to which of those happened, so it can say so.

const KEY = 'blumodel.checkout';
const TTL = 2 * 3600 * 1000;

export type CheckoutWhat = 'kitchen_unlock' | 'unlimited' | 'contractor' | 'order';

interface Marker {
  what: CheckoutWhat;
  /** The hash the buyer comes back to, e.g. `#/k/<id>` or `#/account/billing`. */
  returnTo: string;
  at: number;
  /** Set by the DEMO page just before it navigates back. */
  outcome?: 'success' | 'cancel';
}

function read(): Marker | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const m = raw ? (JSON.parse(raw) as Marker) : null;
    return m && typeof m.returnTo === 'string' && typeof m.at === 'number' ? m : null;
  } catch {
    return null;
  }
}

function write(m: Marker | null) {
  try {
    if (m) sessionStorage.setItem(KEY, JSON.stringify(m));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the return page just won't say "cancelled".
  }
}

/** Called right before going to a checkout page. */
export function markCheckout(what: CheckoutWhat, returnTo: string) {
  write({ what, returnTo, at: Date.now() });
}

/** The DEMO page records how its simulated checkout ended before it navigates back. */
export function settleDemoCheckout(outcome: 'success' | 'cancel') {
  const m = read();
  if (m) write({ ...m, outcome });
}

export interface CheckoutReturn {
  outcome: 'success' | 'cancel';
  what: CheckoutWhat | null;
  /** Stripe's Checkout Session id, to confirm the payment without waiting for the webhook. */
  sessionId: string | null;
}

const hashPath = (h: string) => h.replace(/\?.*$/, '').replace(/\/+$/, '');

/**
 * What the buyer is coming back from on this page (`hash`, defaulting to the current one), read
 * once: the marker is cleared. Null when they aren't coming back from a checkout.
 */
export function takeCheckoutReturn(hash: string = location.hash, now = Date.now()): CheckoutReturn | null {
  const sessionId = pageQuery().get('session_id');
  const m = read();
  const fresh = m && now - m.at < TTL && hashPath(m.returnTo) === hashPath(hash) ? m : null;
  if (fresh || (m && now - m.at >= TTL)) write(null);
  if (sessionId) return { outcome: 'success', what: fresh?.what ?? null, sessionId };
  if (!fresh) return null;
  return { outcome: fresh.outcome ?? 'cancel', what: fresh.what, sessionId: null };
}

/** Drops Stripe's `?session_id=` from the address bar (so a reload doesn't confirm it again), keeping the rest. */
export function clearSessionId() {
  const q = pageQuery();
  if (!q.has('session_id')) return;
  q.delete('session_id');
  const s = q.toString();
  history.replaceState(null, '', `${location.pathname}${s ? `?${s}` : ''}${location.hash}`);
}
