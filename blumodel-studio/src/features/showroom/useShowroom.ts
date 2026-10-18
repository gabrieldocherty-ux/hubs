import { useEffect } from 'react';
import { loadConfig, useConfig } from '../../lib/config';
import { looksLikeShowroomHost, type PublicTenant } from './site';

/**
 * The showroom this page is on, for any screen: null on the sales site (and while the config
 * hasn't answered). Small and in the main chunk: the shell, the top bars and the editor read it.
 */
export function useShowroom(): PublicTenant | null {
  const tenant = useConfig((s) => s.config?.tenant ?? null);
  const status = useConfig((s) => s.status);
  useEffect(() => {
    if (status === 'idle') void loadConfig();
  }, [status]);
  return tenant;
}

/** The same outside React (the export runners, the catalog filter). */
export function currentShowroom(): PublicTenant | null {
  return useConfig.getState().config?.tenant ?? null;
}

/**
 * Which site the shell should draw: 'sales', 'showroom', or 'unknown' while the config is still on
 * its way on an address that looks like a showroom (so a company's visitors never see our own brand
 * flash first). On our own addresses the sales site draws at once, as it always has.
 */
export function useSiteKind(): 'sales' | 'showroom' | 'unknown' {
  const config = useConfig((s) => s.config);
  const status = useConfig((s) => s.status);
  if (config) return config.site;
  if (status === 'error') return looksLikeShowroomHost(location.hostname) ? 'unknown' : 'sales';
  return looksLikeShowroomHost(location.hostname) ? 'unknown' : 'sales';
}

/** True on a showroom whose company turned on "fill the gaps with BluModel Basics" (and on the sales site, always). */
export function basicsAllowed(t: PublicTenant | null = currentShowroom()): boolean {
  return !t || t.features.fillGaps;
}
