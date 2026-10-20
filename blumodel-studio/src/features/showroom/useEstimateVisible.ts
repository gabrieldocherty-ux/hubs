/**
 * Whether the designer shows the Estimate (prices and a running total). The business decides:
 *  - on a showroom, the company's own setting (Showroom > "Show visitors an estimate", off by
 *    default); its owner and staff always see it;
 *  - on the main site, the person's own setting (Account settings > Preferences), which is a
 *    contractor's to turn on for their quoting.
 */
import { useShowEstimator } from '../../lib/prefs';
import { useSession } from '../../store/useSession';
import { useShowroom } from './useShowroom';

export function useEstimateVisible(): boolean {
  const tenant = useShowroom();
  const own = useShowEstimator();
  const team = useSession((s) => {
    const r = (s.user as { showroom?: { role?: unknown } | null } | null)?.showroom?.role;
    return r === 'owner' || r === 'staff';
  });
  if (tenant) return team || !!tenant.features.visitorEstimate;
  return own;
}
