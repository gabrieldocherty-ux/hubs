import { QA, isLoopbackHost } from '../../lib/qa';
import type { RendersStatus } from './api';

/**
 * QA only: `?qa` on this machine (127.0.0.1, localhost or a *.localhost showroom, which always
 * resolve to this machine) with `qa-renders=setup` in the hash shows the editor's dialog as if the
 * server had no rendering service, so QA can screenshot "Photoreal renders are being set up"
 * against its one demo server. The server's own refusal (503, nothing charged) is covered by
 * server/test/renders.test.mjs. Inert anywhere else.
 */
const local = () => QA && (isLoopbackHost(location.hostname) || /\.localhost$/i.test(location.hostname));

export function qaSetupWanted(hash: string): boolean {
  const q = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  return q.get('qa-renders') === 'setup';
}

export function qaOverrideStatus(s: RendersStatus): RendersStatus {
  if (!local() || !qaSetupWanted(location.hash)) return s;
  return { ...s, configured: false, provider: null, demo: false, canRender: false, reason: 'not_configured' };
}
