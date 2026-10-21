import { ApiError } from '../../../lib/api';

/** Where a picture goes (server/tenancy/images.mjs `cleanTarget`). */
export interface ImageTarget {
  slot: 'hero' | 'heroTall' | 'line' | 'gallery' | 'dream' | 'promo';
  source: 'render' | 'photo';
  line?: string;
  index?: number;
  title?: string;
}

async function send<T>(method: string, path: string, { body, ticket }: { body?: Blob; ticket?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'X-BluModel': '1' } : {}),
        ...(body ? { 'Content-Type': body.type || 'application/octet-stream' } : {}),
        ...(ticket ? { 'X-Showroom-Ticket': ticket } : {}),
      },
      body,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong.', data);
  return data as T;
}

async function sendJson(path: string, body: unknown, ticket: string): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-BluModel': '1', 'Content-Type': 'application/json', 'X-Showroom-Ticket': ticket },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, 'Something went wrong.', null);
}

const query = (t: ImageTarget) => {
  const q = new URLSearchParams({ slot: t.slot, source: t.source });
  if (t.line) q.set('line', t.line);
  if (t.index) q.set('index', String(t.index));
  if (t.title) q.set('title', t.title);
  return q.toString();
};

export const imagesApi = {
  access: (ticket?: string) => send<{ ok: true; via: 'staff' | 'ticket' }>('GET', '/api/showroom-images/access', { ticket }),
  upload: <T = unknown>(blob: Blob, target: ImageTarget, ticket?: string) => send<T>('PUT', `/api/showroom-images?${query(target)}`, { body: blob, ticket }),
  remove: <T = unknown>(target: ImageTarget) => send<T>('DELETE', `/api/showroom-images?${query(target)}`),
  /** Tells the server the run is over, so an admin's Quick setup waiting on this ticket can move on. */
  done: (ticket: string, made: number, failed: number) => sendJson('/api/showroom-images/done', { made, failed }, ticket),
};

/**
 * A photo the company uploads, made web-sized in the browser first: at most `maxWidth` wide (a
 * phone's 4000-pixel photo becomes 2400) and saved as WebP (JPEG where WebP can't be made), so a
 * visitor never downloads megabytes for the top of the page.
 */
export async function shrinkPhoto(file: Blob, maxWidth = 2400): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('That file isn’t a picture this browser can open. Use a JPEG, PNG or WebP.');
  });
  const k = Math.min(1, maxWidth / bmp.width, 4096 / bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const webp: Blob | null = await new Promise((r) => c.toBlob(r, 'image/webp', 0.84));
  if (webp?.type === 'image/webp') return webp;
  const jpeg: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
  if (!jpeg) throw new Error('This browser couldn’t prepare the picture.');
  return jpeg;
}
