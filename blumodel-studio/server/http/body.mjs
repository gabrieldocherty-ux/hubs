// Request bodies. Every reader enforces a byte cap and answers an oversized body with
// a real JSON 413: it keeps reading (and discarding) the rest first, so the client
// finishes sending and sees the response instead of a connection reset.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './respond.mjs';

/** Past this much discarded data, stop draining and let the connection drop. */
const DRAIN_CAP = 64 * 1024 * 1024;
/** A client that stalls mid-upload gets this long before we answer anyway. */
const DRAIN_MS = 15_000;

export function tooLarge(message = 'That request is too large.') {
  const err = new HttpError(413, message);
  err.closeConnection = true;
  return err;
}

const declaredLength = (req) => {
  const n = Number(req.headers['content-length']);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Consumes a request body chunk by chunk. `onChunk(chunk)` returns false once it has
 * enough (over the cap); from then on chunks are discarded until the end, the drain
 * cap or the stall timeout. Resolves `{ over }` when reading stops.
 */
function consume(req, max, onChunk) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    let settled = false;
    let timer = null;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      fn();
    };
    const markOver = () => {
      over = true;
      timer = setTimeout(() => finish(() => resolve({ over: true })), DRAIN_MS);
      timer.unref?.();
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (over) {
        if (size > max + DRAIN_CAP) finish(() => resolve({ over: true }));
        return;
      }
      if (size > max) {
        markOver();
        return;
      }
      if (onChunk(chunk) === false) markOver();
    };
    const onEnd = () => finish(() => resolve({ over }));
    const onError = (err) => finish(() => reject(err));
    const onClose = () => {
      if (!req.complete) finish(() => reject(Object.assign(new Error('Request aborted.'), { code: 'ECONNRESET' })));
    };
    const declared = declaredLength(req);
    if (declared !== null && declared > max) markOver();
    if (declared !== null && declared > max + DRAIN_CAP) {
      finish(() => resolve({ over: true }));
      return;
    }
    if (req.readableEnded) {
      finish(() => resolve({ over }));
      return;
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
    req.resume();
  });
}

/** Reads the whole body into a Buffer (≤ max bytes) or throws a 413. */
export async function readRaw(req, max = 1_000_000) {
  const chunks = [];
  const { over } = await consume(req, max, (c) => {
    chunks.push(c);
  });
  if (over) throw tooLarge();
  return Buffer.concat(chunks);
}

/**
 * Reads a JSON body. Only a plain object is accepted (JSON `null`, arrays and scalars
 * are a 400). An empty body reads as `{}`, as it always has.
 */
export async function readJson(req, { maxBytes = 1_000_000 } = {}) {
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON.');
  const buf = await readRaw(req, maxBytes);
  const text = buf.toString('utf8');
  if (!text.trim()) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Malformed JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object.');
  return value;
}

/**
 * Streams the body to a temp file in `dir` while hashing it. Returns
 * `{ path, size, sha256 }`; the caller renames or deletes the file. Over the cap → 413
 * and nothing is left on disk.
 */
export async function streamToTemp(req, max, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `upload-${process.pid}-${crypto.randomBytes(8).toString('hex')}.part`);
  const ws = fs.createWriteStream(file, { flags: 'wx' });
  const hash = crypto.createHash('sha256');
  let size = 0;
  let writeError = null;
  ws.on('error', (err) => {
    writeError = err;
  });
  let result;
  try {
    result = await consume(req, max, (c) => {
      size += c.length;
      hash.update(c);
      if (!ws.write(c)) {
        req.pause();
        ws.once('drain', () => req.resume());
      }
    });
  } catch (err) {
    ws.destroy();
    fs.rmSync(file, { force: true });
    throw err;
  }
  if (result.over || writeError) {
    ws.destroy();
    await new Promise((r) => setTimeout(r, 0));
    fs.rmSync(file, { force: true });
    if (writeError) throw writeError;
    throw tooLarge();
  }
  await new Promise((resolve, reject) => {
    ws.end((err) => (err ? reject(err) : resolve()));
  });
  return { path: file, size, sha256: hash.digest('hex') };
}
