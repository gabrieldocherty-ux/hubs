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
 * Where "Design your kitchen" goes: the wizard when signed in; otherwise creating an account on
 * this showroom first (it keeps the design and is how the design reaches the company), coming
 * back to the wizard after.
 */
export function designHref(room: RoomKind, signedIn: boolean, line?: string): string {
  const to = newDesignHash(room, line);
  return signedIn ? to : `#/signup?next=${encodeURIComponent(to)}`;
}

/** `?room=bathroom` in the wizard's own query. */
export const roomFromQuery = (q: URLSearchParams): RoomKind => (q.get('room') === 'bathroom' ? 'bathroom' : 'kitchen');
