// Who turns a captured 3D view into a photoreal image (docs/SHOWROOM_PIVOT.md §7).
//
//   interface RenderProvider {
//     id: 'architect' | 'demo'
//     render({ image: Buffer, mime, scene, prompt, requestId, signal }) -> Promise<{ image: Buffer }>
//   }
//
// 'demo'       for tests, QA and a development server: the captured view, graded and stamped
//              "DEMO RENDER" (server/renders/png.mjs). Never calls anything.
// 'architect'  MyArchitectAI (https://www.myarchitectai.com/openapi.json), with the key from
//              Admin > System > Render service or ARCHITECT_AI_KEY:
//                POST https://api.myarchitectai.com/v1/render/interior
//                  x-api-key: <key>
//                  { image: 'data:<mime>;base64,<view>', outputFormat: 'png', prompt }
//                -> 200 { output: [<image URL>, ...], balance, cost, requestId }: the first URL is
//                   downloaded (https only, no key sent there) and stored
//                -> 200 { error, code? }: a failure (CONTENT_POLICY_VIOLATION, SAFETY_CHECK_UNAVAILABLE)
//                -> 401/403 bad key, 402 out of balance, 413 too large, 429 busy, 5xx down
//              Every failure gives the credits back and shows the team a plain message: never
//              the key or the service's body. The key is sent only in that header, never logged.

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

/** MyArchitectAI's interior render endpoint (https://www.myarchitectai.com/openapi.json). */
export const MYARCHITECTAI_URL = 'https://api.myarchitectai.com/v1/render/interior';
/** The endpoint refuses a body over 10 MB (413, plain text). */
export const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
/** The JSON answer is small (a few URLs and numbers); anything bigger isn't one. */
const MAX_JSON_BYTES = 256 * 1024;

const fail = (message, code = 'render_failed') => new RenderFailure(`${message} Your credits were returned.`, { code });

/** What the team sees for each status MyArchitectAI documents. Never its body. */
function statusMessage(status) {
  if (status === 401 || status === 403) return fail('The rendering service didn’t accept the key. Check it in Admin > System > Render service.', 'render_unauthorized');
  if (status === 402) return fail('The rendering service account is out of balance.', 'render_no_balance');
  if (status === 413) return fail('The picture of the 3D view was too large for the rendering service.', 'render_bad_result');
  if (status === 429) return fail('The rendering service is busy. Try again in a moment.', 'render_busy');
  return fail(`The rendering service answered ${status}.`);
}

/**
 * @param {{ url?: string, key: string, fetch: typeof fetch, timeoutMs: number, log?: any }} o
 */
export function createArchitectProvider({ url = MYARCHITECTAI_URL, key, fetch, timeoutMs, log }) {
  return {
    id: 'architect',
    async render({ image, mime, prompt, signal }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const body = JSON.stringify({ image: `data:${mime};base64,${image.toString('base64')}`, outputFormat: 'png', prompt });
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw fail('The picture of the 3D view was too large for the rendering service.', 'render_bad_result');

      // 1. The render: the result arrives on the same request (about 13 s), as JSON.
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
          signal: sig,
          redirect: 'error',
        });
      } catch {
        if (sig.aborted) throw fail('The rendering service took too long.', 'render_timeout');
        log?.warn?.('renders: the rendering service could not be reached');
        throw fail('The rendering service couldn’t be reached.', 'render_unreachable');
      }
      if (!res.ok) {
        await res.body?.cancel?.().catch(() => {});
        log?.warn?.(`renders: the rendering service answered ${res.status}`);
        throw statusMessage(res.status);
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      if (!/^application\/([\w.+-]+\+)?json$/.test(type)) {
        await res.body?.cancel?.().catch(() => {});
        throw fail('The rendering service didn’t send an image back.', 'render_bad_result');
      }
      let answer = null;
      try {
        answer = JSON.parse((await readCapped(res, MAX_JSON_BYTES, sig)).toString('utf8'));
      } catch (err) {
        if (err instanceof RenderFailure) throw err;
        answer = null;
      }
      // A 200 can still be a failure: { error, code? } instead of { output }.
      if (answer && typeof answer.error === 'string') {
        log?.warn?.(`renders: the rendering service refused the render${typeof answer.code === 'string' ? ` (${answer.code.slice(0, 40)})` : ''}`);
        if (answer.code === 'CONTENT_POLICY_VIOLATION') throw fail('The rendering service declined this picture under its content rules.', 'render_refused');
        if (answer.code === 'SAFETY_CHECK_UNAVAILABLE') throw fail('The rendering service’s safety check is down for now. Try again later.', 'render_busy');
        throw fail('The rendering service couldn’t make this render.');
      }
      const first = Array.isArray(answer?.output) ? answer.output[0] : null;
      let link = null;
      try {
        link = typeof first === 'string' ? new URL(first) : null;
      } catch {
        link = null;
      }
      if (!link || link.protocol !== 'https:') throw fail('The rendering service didn’t send an image back.', 'render_bad_result');

      // 2. The picture, from the address it gave (no key sent there).
      let pic;
      try {
        pic = await fetch(link.href, { method: 'GET', headers: { Accept: 'image/png, image/jpeg, image/webp' }, signal: sig, redirect: 'follow' });
      } catch {
        if (sig.aborted) throw fail('The rendering service took too long.', 'render_timeout');
        throw fail('The finished render couldn’t be downloaded.', 'render_unreachable');
      }
      if (!pic.ok) {
        await pic.body?.cancel?.().catch(() => {});
        throw fail('The finished render couldn’t be downloaded.', 'render_unreachable');
      }
      const picType = String(pic.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      if (picType && !RESULT_TYPES.has(picType) && picType !== 'application/octet-stream' && picType !== 'binary/octet-stream') {
        await pic.body?.cancel?.().catch(() => {});
        throw fail('The rendering service didn’t send an image back.', 'render_bad_result');
      }
      const buf = await readCapped(pic, MAX_RESULT_BYTES, sig);
      if (!imageKind(buf)) throw fail('The rendering service didn’t send an image back.', 'render_bad_result');
      return { image: buf };
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
