/**
 * Prices people pay BluModel Studio, always with their currency (since 2026-10-15 every price is
 * in Canadian dollars; a receipt or order from before keeps its own currency, usually USD).
 *   money(9900)            → "$99 CAD"
 *   money(4000, 'usd')     → "$40 USD"
 *   money(550)             → "$5.50 CAD"
 *   planPrice(contractor)  → "$99 CAD/month"
 * Whole dollars stay whole. Not for product or estimate prices, which are the designer's own.
 */

/** The currency of every new price (src/data/plans.json, checked by server/lib/plans.mjs). */
export const APP_CURRENCY = 'cad';

/** "$99", "$1,234.50": the amount without its currency code. */
export function amount(cents: number): string {
  const n = Number.isFinite(cents) ? cents : 0;
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: n % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "$99 CAD": the amount and its currency code. */
export function money(cents: number, currency: string | null | undefined = APP_CURRENCY): string {
  return `${amount(cents)} ${String(currency || APP_CURRENCY).toUpperCase()}`;
}

/** A plan's price as people read it: "$15 CAD/month", or "$5 CAD" for a one-time price. */
export function planPrice(plan: { priceCents: number; currency?: string | null; interval?: null | 'month' }): string {
  return `${money(plan.priceCents, plan.currency)}${plan.interval === 'month' ? '/month' : ''}`;
}
