/** What a visitor designs: a kitchen, or (when the company offers it) a bathroom. */
export type RoomKind = 'kitchen' | 'bathroom';

/** The new-design wizard for a room kind and, optionally, a product line to start with. */
export function newDesignHash(room: RoomKind = 'kitchen', line?: string): string {
  const q = new URLSearchParams();
  if (room === 'bathroom') q.set('room', 'bathroom');
  if (line) q.set('line', line);
  const s = q.toString();
  return s ? `#/new?${s}` : '#/new';
}

/**
 * Where "Design your kitchen" goes: straight to the wizard, signed in or not (SHOWROOM_PIVOT §5:
 * visitors design signed out). A signed-out design is kept on this device (#/local) and the
 * account is asked for only when they send it to the company or keep it in an account.
 * `signedIn` is kept for callers; it no longer changes the link.
 */
export function designHref(room: RoomKind, _signedIn: boolean, line?: string): string {
  return newDesignHash(room, line);
}

/** Sign up, then the device design becomes a saved design of the new account (#/local claims it). */
export const CLAIM_DRAFT_HREF = `#/signup?next=${encodeURIComponent('#/local')}`;

/** `?room=bathroom` in the wizard's own query. */
export const roomFromQuery = (q: URLSearchParams): RoomKind => (q.get('room') === 'bathroom' ? 'bathroom' : 'kitchen');
