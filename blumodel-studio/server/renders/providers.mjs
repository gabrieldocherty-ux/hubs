// Who turns a captured 3D view into a photoreal image (docs/SHOWROOM_PIVOT.md §7).
//
//   interface RenderProvider {
//     id: 'architect' | 'demo'
//     render({ image: Buffer, mime, scene, prompt, requestId, signal }) -> Promise<{ image: Buffer }>
//   }
//
// 'demo'       for tests, QA and a development server: the captured view, graded and stamped
//              "DEMO RENDER" (server/renders/png.mjs). Never calls anything.
// 'architect'  Gabe's architecture AI over HTTP, at ARCHITECT_AI_URL with ARCHITECT_AI_KEY. Its API
//              isn't settled, so this adapter speaks a small contract (docs/handoff/renders.md):
//                POST <ARCHITECT_AI_URL>
//                  Authorization: Bearer <ARCHITECT_AI_KEY>
//                  Content-Type: application/json
//                  { requestId, prompt, scene, image: { mimeType, data: <base64> },
//                    output: { format: 'png', widthPx, heightPx } }
//                -> 200 with the image itself (Content-Type image/png|jpeg|webp), or JSON with the
//                   image as base64 or a data: URL in `image`, `imageBase64`, `output` or
//                   `images[0]` (a string, or an object with `data` / `b64_json`).
//              Anything else is a failure: the credits go back and the team sees a plain message.
//              The key is sent only in that header and is never logged or put in an error.

import { decodePng, demoCard, encodePng, stampDemo } from './png.mjs';

export const MAX_RESULT_BYTES = 25 * 1024 * 1024;
const RESULT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** 'png' | 'jpeg' | 'webp' by the file's first bytes, or null: the Content-Type alone isn't trusted. */
export function imageKind(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * The answer's body, read chunk by chunk and given up (the stream cancelled, the request aborted)
 * as soon as it passes `max` bytes, whatever Content-Length says or doesn't. A long answer still
 * stops at the render's timeout, since `signal` covers the body as well as the headers.
 */
export async function readCapped(res, max, signal) {
  const tooLarge = () => new RenderFailure('The rendering service sent an image that is too large. Your credits were returned.', { code: 'render_bad_result' });
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) {
    await res.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch (err) {
    if (err instanceof RenderFailure) throw err;
    if (signal?.aborted) throw new RenderFailure('The rendering service took too long. Your credits were returned.', { code: 'render_timeout' });
    throw new RenderFailure('The rendering service’s answer was cut off. Your credits were returned.', { code: 'render_failed' });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* still reading: cancelled above */
    }
  }
  return Buffer.concat(parts, total);
}

/** A failure safe to show the team (no key, no response body). */
export class RenderFailure extends Error {
  constructor(message, { code = 'render_failed' } = {}) {
    super(message);
    this.code = code;
  }
}

export function createDemoProvider({ delayMs = 0 } = {}) {
  return {
    id: 'demo',
    async render({ image, mime, scene, signal }) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (signal?.aborted) throw new RenderFailure('The render took too long.', { code: 'render_timeout' });
      const decoded = mime === 'image/png' ? decodePng(image, { maxPixels: 2560 * 1600 }) : null;
      const out = decoded ? stampDemo(decoded) : demoCard(scene?.camera?.widthPx ?? 1280, scene?.camera?.heightPx ?? 720);
      return { image: encodePng(out) };
    },
  };
}

const B64 = /^[A-Za-z0-9+/=_\s-]+$/;
function fromBase64(v) {
  if (typeof v !== 'string' || !v) return null;
  const s = v.startsWith('data:') ? v.slice(v.indexOf(',') + 1) : v;
  if (!B64.test(s.slice(0, 4096))) return null;
  const buf = Buffer.from(s.replace(/\s+/g, ''), s.includes('-') || s.includes('_') ? 'base64url' : 'base64');
  return buf.length ? buf : null;
}

/** The image in a JSON answer, in any of the shapes the contract allows. */
export function imageFromJson(body) {
  if (!body || typeof body !== 'object') return null;
  const pick = (v) => (typeof v === 'string' ? fromBase64(v) : v && typeof v === 'object' ? fromBase64(v.data ?? v.b64_json ?? v.base64 ?? v.image) : null);
  return pick(body.image) ?? pick(body.imageBase64) ?? pick(body.output) ?? (Array.isArray(body.images) ? pick(body.images[0]) : null) ?? (Array.isArray(body.data) ? pick(body.data[0]) : null);
}

/**
 * @param {{ url: string, key: string, fetch: typeof fetch, timeoutMs: number, log?: any }} o
 */
export function createArchitectProvider({ url, key, fetch, timeoutMs, log }) {
  return {
    id: 'architect',
    async render({ image, mime, scene, prompt, requestId, signal }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'image/png, image/jpeg, image/webp, application/json' },
          body: JSON.stringify({
            requestId,
            prompt,
            scene,
            image: { mimeType: mime, data: image.toString('base64') },
            output: { format: 'png', widthPx: scene?.camera?.widthPx ?? null, heightPx: scene?.camera?.heightPx ?? null },
          }),
          signal: sig,
          redirect: 'error',
        });
      } catch (err) {
        if (sig.aborted) throw new RenderFailure('The rendering service took too long. Your credits were returned.', { code: 'render_timeout' });
        log?.warn?.(`renders: the rendering service could not be reached (${err?.name ?? 'error'})`);
        throw new RenderFailure('The rendering service couldn’t be reached. Your credits were returned.', { code: 'render_unreachable' });
      }
      if (!res.ok) {
        log?.warn?.(`renders: the rendering service answered ${res.status}`);
        throw new RenderFailure(`The rendering service answered ${res.status}. Your credits were returned.`, { code: 'render_failed' });
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      const asImage = RESULT_TYPES.has(type);
      if (!asImage && !/^application\/([\w.+-]+\+)?json$/.test(type)) {
        await res.body?.cancel?.().catch(() => {});
        throw new RenderFailure('The rendering service didn’t send an image back. Your credits were returned.', { code: 'render_bad_result' });
      }
      const buf = await readCapped(res, MAX_RESULT_BYTES, sig);
      if (asImage) {
        if (!imageKind(buf)) throw new RenderFailure('The rendering service didn’t send an image back. Your credits were returned.', { code: 'render_bad_result' });
        return { image: buf };
      }
      let body = null;
      try {
        body = JSON.parse(buf.toString('utf8'));
      } catch {
        body = null;
      }
      const img = imageFromJson(body);
      if (img && imageKind(img)) return { image: img };
      throw new RenderFailure('The rendering service didn’t send an image back. Your credits were returned.', { code: 'render_bad_result' });
    },
  };
}

/**
 * The provider this server uses (config.rendersProvider), or null when renders aren't set up.
 * `override` (tests) replaces it.
 */
export function pickProvider({ config, fetch, log, override }) {
  if (override !== undefined) return override;
  if (config.rendersProvider === 'architect') return createArchitectProvider({ url: config.ARCHITECT_AI_URL, key: config.ARCHITECT_AI_KEY, fetch, timeoutMs: config.RENDER_TIMEOUT_MS, log });
  if (config.rendersProvider === 'demo') return createDemoProvider();
  return null;
}
