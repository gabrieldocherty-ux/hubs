import { call, type Project } from '../../lib/api';
import type { ShareLink, SharedKitchenWire } from '../../types/platform';

/** `GET /api/share/:token`: the frozen wire plus when the link stops working. */
export interface SharedWire extends SharedKitchenWire {
  expiresAt?: number | null;
}

/** Why a share link didn't open (`404 { reason }`). */
export type GoneReason = 'missing' | 'revoked' | 'expired';

export type ExpiryDays = 7 | 30 | 90 | null;

export interface NewShare {
  label?: string;
  showPrices?: boolean;
  expiresInDays?: ExpiryDays;
}

const p = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/shares`;

export const shareApi = {
  list: (projectId: string) => call<{ shares: ShareLink[]; now: number }>('GET', p(projectId)),
  create: (projectId: string, body: NewShare) => call<{ share: ShareLink }>('POST', p(projectId), body),
  revoke: (projectId: string, shareId: string) => call<{ share: ShareLink }>('DELETE', `${p(projectId)}/${encodeURIComponent(shareId)}`),
  read: (token: string) => call<SharedWire>('GET', `/api/share/${encodeURIComponent(token)}`),
  duplicate: (token: string) => call<{ project: Project }>('POST', `/api/share/${encodeURIComponent(token)}/duplicate`),
};

/** The address a share link opens. */
export const shareUrl = (token: string) => `${location.origin}/#/s/${token}`;

/** Copies text to the clipboard; false when the browser refuses (the caller shows the link to copy by hand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection trick (clipboard permission denied, or not a secure context).
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** "in 29 days", "in 3 hours", "today". */
export function inFuture(ts: number, now = Date.now()): string {
  const ms = ts - now;
  if (ms <= 0) return 'now';
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'within the hour';
  if (h < 36) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(ms / 86_400_000);
  return `in ${d} days`;
}
