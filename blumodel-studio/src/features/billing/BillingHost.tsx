/**
 * Mounted once by the app shell. It used to show the Unlock dialog when an export asked for a
 * payment; downloads are free since the showroom pivot (docs/SHOWROOM_PIVOT.md §3), so there is
 * nothing to show. Kept because the billing package's surface is frozen.
 */
export function BillingHost(): null {
  return null;
}
