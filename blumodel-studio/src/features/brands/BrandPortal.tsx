import { useEffect } from 'react';
import { navigate } from '../../lib/router';
import { portalRedirect } from './logic';

/**
 * `#/brand`, `#/brand/<rest>`: the old brand portal. Brands now live inside the Contractor
 * workspace (BRAND_PAGE §2), so this only redirects to `#/pro/brand/…`, replacing the history
 * entry. Contractors land on their Brand page tab; everyone else sees the Contractor plan pitch.
 */
export default function BrandPortal({ rest }: { rest: string }) {
  useEffect(() => {
    navigate({ name: 'pro', rest: portalRedirect(rest) }, true);
  }, [rest]);
  return <div className="screen-msg">Opening your brand page…</div>;
}
