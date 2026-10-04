// Static files: the built app (DIST_DIR) and uploaded blobs. Containment is checked
// with path.relative, a malformed %-escape is a 400, and the SPA fallback (index.html)
// applies only to extensionless paths, so a missing asset is a real 404.

import fs from 'node:fs';
import path from 'node:path';
import { HttpError, send } from './respond.mjs';

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

/** Serves the built single-page app from `distDir`. GET and HEAD only. */
export function serveDist(req, res, url, distDir) {
  const indexFile = path.join(distDir, 'index.html');
  if (!isFile(indexFile)) return send(res, 404, { error: 'Run `npm run build` first, or use `npm run dev`.' });
  const { file, decoded } = safeJoin(distDir, url.pathname);
  let target = file;
  if (!isFile(target)) {
    // Only an extensionless path is an app route; a missing asset is a real 404.
    if (path.posix.extname(decoded) !== '') return send(res, 404, { error: 'Not found.' });
    target = indexFile;
  }
  const ext = path.extname(target).toLowerCase();
  const immutable = url.pathname.startsWith('/assets/');
  return serveFile(req, res, target, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
}
