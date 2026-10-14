// Uploads: streamed to a temp file under a byte cap, classified from their bytes,
// validated, then stored content-addressed at UPLOAD_DIR/<sha[0:2]>/<sha>.<ext>.
// Identical bytes share one blob; each upload still gets its own row (owner, brand,
// visibility). Exposed as ctx.services.files.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from '../http/respond.mjs';
import { streamToTemp, tooLarge } from '../http/body.mjs';
import { randomId, FILE_ID_RE } from '../lib/ids.mjs';
import { inspectUpload } from './meta.mjs';
import { createReadPolicy } from './policy.mjs';

const KINDS = ['model', 'image', 'reference'];
const MB = 1024 * 1024;

export function cleanName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export function createFileService({ db, config, now = Date.now, auth }) {
  const read = createReadPolicy({ db, auth });
  const tmpDir = path.join(config.UPLOAD_DIR, 'tmp');
  const blobPath = (sha, ext) => path.join(config.UPLOAD_DIR, sha.slice(0, 2), `${sha}.${ext}`);

  const parseMeta = (s) => {
    try {
      return JSON.parse(s || '{}');
    } catch {
      return {};
    }
  };

  const toRecord = (r) =>
    r && {
      id: r.id,
      sha256: r.sha256,
      ext: r.ext,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      kind: r.kind,
      visibility: r.visibility,
      ownerUserId: r.owner_user_id ?? null,
      brandId: r.brand_id ?? null,
      originalName: r.original_name,
      meta: parseMeta(r.meta),
      createdAt: r.created_at,
    };

  const capFor = (kind) => (kind === 'model' ? config.MAX_GLB_MB : kind === 'image' ? config.MAX_IMAGE_MB : Math.max(config.MAX_GLB_MB, config.MAX_IMAGE_MB)) * MB;

  /** Moves (or writes) the blob into place unless identical bytes are already stored. */
  function placeBlob(sha, ext, { tempPath, buf }) {
    const dest = blobPath(sha, ext);
    if (fs.existsSync(dest)) return dest;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let src = tempPath;
    if (!src) {
      fs.mkdirSync(tmpDir, { recursive: true });
      src = path.join(tmpDir, `blob-${process.pid}-${crypto.randomBytes(8).toString('hex')}.part`);
      fs.writeFileSync(src, buf, { flag: 'wx' });
    }
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      if (!fs.existsSync(dest)) throw err; // a concurrent identical upload won the race: fine
      fs.rmSync(src, { force: true });
    }
    return dest;
  }

  function store(buf, { sha256, tempPath, kind, visibility, ownerUserId, brandId, originalName }) {
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Choose a file kind: model, image or reference.');
    const info = inspectUpload(buf);
    if (!info.ok) throw new HttpError(400, info.error);
    if (kind === 'model' && info.ext !== 'glb') throw new HttpError(400, 'Upload a .glb model for this.');
    if (kind === 'image' && info.ext === 'glb') throw new HttpError(400, 'Upload a PNG, JPEG or WebP image for this.');
    const cap = (info.ext === 'glb' ? config.MAX_GLB_MB : config.MAX_IMAGE_MB) * MB;
    if (buf.length > cap) throw tooLarge(info.ext === 'glb' ? `Models can be at most ${config.MAX_GLB_MB} MB.` : `Images can be at most ${config.MAX_IMAGE_MB} MB.`);
    const sha = sha256 || crypto.createHash('sha256').update(buf).digest('hex');
    placeBlob(sha, info.ext, { tempPath, buf });
    const id = randomId('f_');
    const vis = kind === 'reference' ? 'private' : visibility === 'public' ? 'public' : 'private';
    db.prepare(
      `INSERT INTO files (id, sha256, ext, mime, size_bytes, kind, visibility, owner_user_id, brand_id, original_name, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, sha, info.ext, info.mime, buf.length, kind, vis, ownerUserId ?? null, brandId ?? null, cleanName(originalName), JSON.stringify(info.meta), now());
    return svc.get(id);
  }

  const svc = {
    blobPath,

    /**
     * Streams the request body into storage. The route checks brand membership first.
     * @returns {Promise<object>} the FileRecord
     */
    async saveUpload(rc, { kind, visibility = 'private', brandId = null, maxBytes, originalName } = {}) {
      const user = auth.requireUser(rc);
      if (!KINDS.includes(kind)) throw new HttpError(400, 'Choose a file kind: model, image or reference.');
      const tmp = await streamToTemp(rc.req, maxBytes ?? capFor(kind), tmpDir);
      try {
        const buf = fs.readFileSync(tmp.path);
        return store(buf, {
          sha256: tmp.sha256,
          tempPath: tmp.path,
          kind,
          visibility,
          ownerUserId: user.id,
          brandId,
          originalName: originalName ?? rc.query?.get('name'),
        });
      } finally {
        fs.rmSync(tmp.path, { force: true });
      }
    },

    /** Stores bytes that are already in memory (seeds, server-made files). Same validation. */
    saveBuffer(buf, { kind, visibility = 'private', ownerUserId = null, brandId = null, originalName = '' }) {
      return store(Buffer.from(buf), { kind, visibility, ownerUserId, brandId, originalName });
    },

    get(id) {
      if (typeof id !== 'string' || !FILE_ID_RE.test(id)) return null;
      return toRecord(db.prepare('SELECT * FROM files WHERE id = ?').get(id)) || null;
    },

    /** A public row for this blob, if any (what `/files/<sha>.<ext>` may serve). */
    publicBlob(sha, ext) {
      return toRecord(db.prepare("SELECT * FROM files WHERE sha256 = ? AND ext = ? AND visibility = 'public' LIMIT 1").get(sha, ext)) || null;
    },

    /**
     * The file, if the caller (or, with `brandId`, the brand) owns it and its kind is
     * allowed. Otherwise a 400, so products can't reference someone else's upload.
     */
    assertUsable(fileId, { userId, brandId = null, kinds = KINDS } = {}) {
      const file = svc.get(fileId);
      const owned = file && (brandId ? file.brandId === brandId : !!userId && file.ownerUserId === userId);
      if (!owned) throw new HttpError(400, 'That file can’t be used here.', { fileId: String(fileId ?? '') });
      if (!kinds.includes(file.kind)) throw new HttpError(400, `That file is a ${file.kind}; this needs ${kinds.join(' or ')}.`, { fileId: file.id });
      return file;
    },

    canRead: read.canRead,
    addReadPolicy: read.addReadPolicy,

    grant(fileId, userId) {
      db.prepare('INSERT OR IGNORE INTO file_grants (file_id, user_id, created_at) VALUES (?, ?, ?)').run(fileId, userId, now());
    },

    /** Reference files always stay private. */
    setVisibility(fileId, visibility) {
      if (visibility !== 'public' && visibility !== 'private') throw new Error('visibility must be public or private');
      db.prepare("UPDATE files SET visibility = ? WHERE id = ? AND kind <> 'reference'").run(visibility, fileId);
    },

    /** `/files/<sha>.<ext>` for public files, `/api/files/<id>/content[?share=…]` for private ones. */
    url(file, { shareToken } = {}) {
      if (!file) return null;
      if (file.visibility === 'public') return `/files/${file.sha256}.${file.ext}`;
      return `/api/files/${file.id}/content${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''}`;
    },

    /** FileWire: the record plus its URL. */
    toWire(file, opts) {
      return file ? { ...file, url: svc.url(file, opts) } : null;
    },
  };
  return svc;
}
