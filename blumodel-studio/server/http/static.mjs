// Static files: the built app (DIST_DIR) and uploaded blobs. Containment is checked
// with path.relative, a malformed %-escape is a 400, and the SPA fallback (index.html)
// applies only to extensionless paths, so a missing asset is a real 404.
//
// The built app is served with an ETag (304 when it matches), brotli or gzip for text when the
// browser takes it (compressed once per file version, off the event loop, and kept in a bounded
// memory cache), `immutable` for Vite's content-hashed /assets/ and `no-cache` for everything
// else, index.html included, so a deploy is picked up on the next load.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { HttpError, send } from './respond.mjs';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.hdr': 'image/vnd.radiance',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/**
 * Resolves `rel` (a URL pathname, still %-encoded) inside `root`. Throws 400 for a
 * malformed escape, a NUL, a colon (Windows drive letters and alternate data streams)
 * or anything that escapes `root`.
 */
export function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    throw new HttpError(400, 'Bad path.');
  }
  if (decoded.includes('\0') || decoded.includes(':')) throw new HttpError(400, 'Bad path.');
  const base = path.resolve(root);
  const file = path.resolve(base, '.' + path.posix.normalize('/' + decoded.replace(/\\/g, '/')));
  const raw = path.resolve(base, '.' + '/' + decoded);
  for (const candidate of [file, raw]) {
    const rel = path.relative(base, candidate);
    if (rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('../') || path.isAbsolute(rel)) throw new HttpError(400, 'Bad path.');
  }
  return { file: raw, decoded };
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Streams one file with the given headers. Handles HEAD. Resolves once the response
 * has been handed off.
 */
export function serveFile(req, res, file, headers = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    send(res, 404, { error: 'Not found.' });
    return;
  }
  res.writeHead(200, { 'Content-Length': stat.size, ...headers });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** Text types worth compressing. Images, models and fonts are already compressed. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.wasm', '.webmanifest']);
const MIN_COMPRESS = 1024;
const CACHE_BUDGET = 64 * 1024 * 1024;

/** Compressed bodies by `<file>|<mtime>|<size>|<enc>`, oldest dropped past CACHE_BUDGET bytes. */
const cache = new Map();
let cached = 0;
const inflight = new Map();

function remember(key, buf) {
  cache.set(key, buf);
  cached += buf.length;
  for (const [k, v] of cache) {
    if (cached <= CACHE_BUDGET) break;
    cache.delete(k);
    cached -= v.length;
  }
}

/** The compressed body for a file version, compressing it (once) if needed. */
async function compressed(file, stat, enc) {
  const key = `${file}|${stat.mtimeMs}|${stat.size}|${enc}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const raw = await fs.promises.readFile(file);
    const out =
      enc === 'br'
        ? await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
        : await gzip(raw, { level: 9 });
    remember(key, out);
    return out;
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

/** 'br' | 'gzip' | null from Accept-Encoding (q=0 means "not this one"). */
export function pickEncoding(header) {
  const offered = new Map();
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    offered.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  const ok = (n) => (offered.get(n) ?? offered.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

/** True when If-None-Match lists `etag` (or *). */
export function etagMatches(header, etag) {
  if (!header) return false;
  return String(header)
    .split(',')
    .map((s) => s.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

/**
 * Serves the built single-page app from `distDir`. GET and HEAD only. `indexHtml(html)`, when
 * given, rewrites the app document (a showroom's head; server/tenancy/pages.mjs) before it's sent.
 */
export async function serveDist(req, res, url, distDir, { indexHtml = null } = {}) {
  const indexFile = path.join(distDir, 'index.html');
  if (!isFile(indexFile)) return send(res, 404, { error: 'Run `npm run build` first, or use `npm run dev`.' });
  const { file, decoded } = safeJoin(distDir, url.pathname);
  let target = file;
  if (!isFile(target)) {
    // Only an extensionless path is an app route; a missing asset is a real 404.
    if (path.posix.extname(decoded) !== '') return send(res, 404, { error: 'Not found.' });
    target = indexFile;
  }
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return send(res, 404, { error: 'Not found.' });
  }
  const ext = path.extname(target).toLowerCase();
  if (target === indexFile && indexHtml) {
    let body;
    try {
      body = Buffer.from(indexHtml(fs.readFileSync(indexFile, 'utf8')), 'utf8');
    } catch {
      return send(res, 500, { error: 'Could not read the app.' });
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'] || 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  // Vite content-hashes everything under /assets/: a changed file gets a new name.
  const immutable = url.pathname.startsWith('/assets/') && target !== indexFile;
  const enc = COMPRESSIBLE.has(ext) && stat.size >= MIN_COMPRESS ? pickEncoding(req.headers['accept-encoding']) : null;
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${enc ? `-${enc}` : ''}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    ...(COMPRESSIBLE.has(ext) ? { Vary: 'Accept-Encoding' } : {}),
  };
  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  if (!enc) return serveFile(req, res, target, headers);
  let body;
  try {
    body = await compressed(target, stat, enc);
  } catch {
    return serveFile(req, res, target, { ...headers, ETag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"` });
  }
  res.writeHead(200, { ...headers, 'Content-Encoding': enc, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * Compresses every compressible file in `distDir` in the background (brotli and gzip), so the
 * first visitor after a deploy doesn't wait for it. Resolves when done; never rejects.
 */
export async function warmDist(distDir) {
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (COMPRESSIBLE.has(path.extname(e.name).toLowerCase())) files.push(p);
    }
  };
  walk(distDir);
  for (const f of files) {
    try {
      const stat = fs.statSync(f);
      if (stat.size < MIN_COMPRESS) continue;
      await compressed(f, stat, 'br');
      await compressed(f, stat, 'gzip');
    } catch {
      /* served uncompressed then */
    }
  }
}
