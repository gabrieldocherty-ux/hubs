// Moving the site's data to another machine (docs/MOVING_DATA.md), Windows or Linux either way:
//
//   exportData()  writes a bundle: a consistent copy of the database (VACUUM INTO from a read-only
//                 connection, so it is safe while the server runs), every upload, and manifest.json
//                 (format, schema, row counts per table, the size and sha256 of every file, when it
//                 was made, the app's version and commit). The private settings file and the tunnel
//                 credentials stay out unless includeSecrets. It refuses to write inside a git
//                 checkout (the repo is public) and checks what it wrote before saying so.
//   importData()  checks a bundle (manifest, every size and sha256, PRAGMA integrity_check, the row
//                 counts, that this app knows every migration in it), then puts it where the server
//                 looks: into an empty data folder, or, with replace, over the current data, which is
//                 kept beside it as *.before-import-<time> (never deleted). Then the app's
//                 migrations run and the counts are printed. It never installs a secret.
//
// A bundle is a .tar (POSIX ustar, written and read here with no other tool; `tar -tf` / `tar -xf`
// open it on Windows 10+ and on Linux) or the same tree as a plain folder:
//
//   blumodel-data-<time>/manifest.json
//   blumodel-data-<time>/db/blumodel.db
//   blumodel-data-<time>/uploads/<aa>/<sha256>.<ext>
//   blumodel-data-<time>/secrets/blumodel.env             only with includeSecrets
//   blumodel-data-<time>/secrets/cloudflared/<id>.json    only with includeSecrets
//
// Every path inside is relative, with '/' separators, and nothing in a bundle names the machine it
// came from: no absolute path, user name or drive letter (the database holds none either: uploads
// are found by sha256 and extension under UPLOAD_DIR). On Linux every file it writes is 0600 and
// every folder 0700; run as root, import gives what it puts in place to the account that owns the
// home (the 'blumodel' service account), as the server must be able to write it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { SERVER_DIR } from '../config.mjs';
import { openDb, checkpoint } from '../db/index.mjs';
import { listSteps, migrate } from '../db/migrate.mjs';
import { resolveEnvFile } from '../lib/envFile.mjs';
import { integrityCheck, privateDir, privateFile } from './backup.mjs';

export const BUNDLE_FORMAT = 'blumodel-data';
export const BUNDLE_VERSION = 1;
export const MANIFEST = 'manifest.json';
export const DB_ENTRY = 'db/blumodel.db';
const POSIX = process.platform !== 'win32';
const BLOCK = 512;
const CHUNK = 1024 * 1024;
const TUNNEL_CREDENTIALS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

/** 2026-10-16T04-05-06Z: sortable, and a legal file name on every OS. */
export const stampOf = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

/** A bundle-relative path: '/' separators, no '..', no drive or absolute part, no backslash. */
export function safeRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > 1024) return false;
  if (p.startsWith('/') || /[\\:\0]/.test(p)) return false;
  // eslint-disable-next-line no-control-regex
  return p.split('/').every((s) => s && s !== '.' && s !== '..' && !/[<>"|?*\u0000-\u001f]/.test(s) && !/[. ]$/.test(s));
}

const toOs = (root, rel) => path.join(root, ...rel.split('/'));
const sha256File = (file) => {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let n;
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
};

/** Every file under `root` as '/'-relative paths, sorted; `skipTop` top-level folders left out. Symlinks are refused. */
export function listFiles(root, { skipTop = [] } = {}) {
  const out = [];
  const go = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && skipTop.includes(e.name)) continue;
      if (e.isSymbolicLink()) throw new Error(`${path.join(dir, e.name)} is a symbolic link; a data folder holds only plain files.`);
      if (e.isDirectory()) go(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  go(root, '');
  return out.sort();
}

/** The nearest folder at or above `p` that is a git checkout (has .git), or null. */
export function gitCheckoutAt(p) {
  let dir = path.resolve(p);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** True when `child` is `parent` or inside it. */
export const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The deployed app's commit (app/DEPLOYED.txt), else the checkout's (git rev-parse), else 'unknown'. */
export function appCommit(serverDir = SERVER_DIR) {
  const appDir = path.resolve(serverDir, '..');
  try {
    const m = /^commit\s+([0-9a-f]{7,40})\b/m.exec(fs.readFileSync(path.join(appDir, 'DEPLOYED.txt'), 'utf8'));
    if (m) return m[1];
  } catch {
    /* not a deployed app */
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function appVersion(serverDir = SERVER_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(serverDir, '..', 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** `{ table: rows }` for every table of `db`, by name. */
export function tableCounts(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return Object.fromEntries(names.map((n) => [n, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${n.replace(/"/g, '""')}"`).get().n)]));
}

/** The migration ids recorded in `db`, in the order they ran. */
function appliedMigrations(db) {
  try {
    return db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  } catch {
    return [];
  }
}

/** The uploads the database refers to, as '<aa>/<sha>.<ext>' paths under UPLOAD_DIR. */
function referencedUploads(db) {
  try {
    return [...new Set(db.prepare('SELECT sha256, ext FROM files').all().map((r) => `${r.sha256.slice(0, 2)}/${r.sha256}.${r.ext}`))].sort();
  } catch {
    return [];
  }
}

// ── tar (POSIX ustar), with no other tool ───────────────────────────────────

const octal = (n, width) => {
  const s = Math.floor(n).toString(8);
  if (s.length > width - 1) throw new Error(`A value (${n}) is too large for a tar header.`);
  return `${s.padStart(width - 1, '0')}\0`;
};

/** One 512-byte ustar header. Names are ASCII (bundle paths always are). */
export function tarHeader({ name, size = 0, type = '0', mode = 0o600, mtime = Date.now() }) {
  if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`Not a plain ASCII path for a tar entry: ${JSON.stringify(name)}`);
  let base = name;
  let prefix = '';
  if (name.length > 100) {
    let i = name.indexOf('/');
    while (i > 0 && !(i <= 155 && name.length - i - 1 <= 100)) i = name.indexOf('/', i + 1);
    if (i <= 0) throw new Error(`Path too long for a tar entry: ${name}`);
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
  }
  const h = Buffer.alloc(BLOCK, 0);
  h.write(base, 0, 100, 'ascii');
  h.write(octal(mode, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(mtime / 1000, 12), 136, 'ascii');
  h.fill(0x20, 148, 156);
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return h;
}

/** Writes a bundle as a .tar. Paths given are bundle-relative; `top/` is put in front. */
class TarWriter {
  constructor(file, top, mtime) {
    this.fd = fs.openSync(file, 'wx', 0o600);
    this.top = top;
    this.mtime = mtime;
    this.dirs = new Set();
    this.dir('');
  }
  put(buf) {
    fs.writeSync(this.fd, buf);
  }
  dir(rel) {
    const name = rel ? `${this.top}/${rel}/` : `${this.top}/`;
    if (this.dirs.has(name)) return;
    this.dirs.add(name);
    this.put(tarHeader({ name, type: '5', mode: 0o700, mtime: this.mtime }));
  }
  parents(rel) {
    const segs = rel.split('/').slice(0, -1);
    for (let i = 1; i <= segs.length; i++) this.dir(segs.slice(0, i).join('/'));
  }
  pad(size) {
    const rest = size % BLOCK;
    if (rest) this.put(Buffer.alloc(BLOCK - rest, 0));
  }
  file(rel, src) {
    this.parents(rel);
    const size = fs.statSync(src).size;
    this.put(tarHeader({ name: `${this.top}/${rel}`, size, mtime: this.mtime }));
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(src, 'r');
    try {
      const buf = Buffer.allocUnsafe(CHUNK);
      let left = size;
      while (left > 0) {
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, left), null);
        if (n <= 0) throw new Error(`${src} got shorter while it was being copied.`);
        h.update(buf.subarray(0, n));
        this.put(buf.subarray(0, n));
        left -= n;
      }
    } finally {
      fs.closeSync(fd);
    }
    this.pad(size);
    return { size, sha256: h.digest('hex') };
  }
  buffer(rel, buf) {
    this.parents(rel);
    this.put(tarHeader({ name: `${this.top}/${rel}`, size: buf.length, mtime: this.mtime }));
    this.put(buf);
    this.pad(buf.length);
    return { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  close() {
    this.put(Buffer.alloc(BLOCK * 2, 0));
    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
  }
}

/** Writes a bundle as a plain folder: the same tree as the tar. */
class FolderWriter {
  constructor(dir, top) {
    this.root = path.join(dir, top);
    privateDir(this.root);
  }
  file(rel, src) {
    const dest = toOs(this.root, rel);
    privateDir(path.dirname(dest));
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    privateFile(dest);
    return { size: fs.statSync(dest).size, sha256: sha256File(dest) };
  }
  buffer(rel, buf) {
    const dest = toOs(this.root, rel);
    privateDir(path.dirname(dest));
    fs.writeFileSync(dest, buf, { flag: 'wx', mode: 0o600 });
    return { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  close() {}
}

const cstr = (buf, start, len) => {
  const s = buf.subarray(start, start + len);
  const z = s.indexOf(0);
  return s.subarray(0, z < 0 ? len : z).toString('utf8');
};
const parseOctal = (buf, start, len) => {
  if (buf[start] & 0x80) throw new Error('The tar file uses a size encoding this reader does not take (an entry over 8 GB?).');
  const s = cstr(buf, start, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error('The tar file has a damaged header (not a tar file, or cut short).');
  return s ? parseInt(s, 8) : 0;
};
function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp < 0) break;
    const len = Number(buf.subarray(i, sp).toString('ascii'));
    if (!Number.isInteger(len) || len <= 0) break;
    const rec = buf.subarray(sp + 1, i + len - 1).toString('utf8');
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * The entries of a tar file: `[{ name, type: 'file' | 'dir', size, at }]` (`at` = where the data
 * starts). Understands ustar, pax and GNU long names (a bundle re-packed with another tar still
 * reads); refuses links, devices and damaged headers.
 */
export function tarEntries(file) {
  const fd = fs.openSync(file, 'r');
  const out = [];
  try {
    const total = fs.fstatSync(fd).size;
    const h = Buffer.alloc(BLOCK);
    let pos = 0;
    let longName = null;
    let pax = {};
    const read = (at, size) => {
      const b = Buffer.alloc(size);
      fs.readSync(fd, b, 0, size, at);
      return b;
    };
    for (;;) {
      if (pos + BLOCK > total) throw new Error('The tar file ends in the middle of an entry: it was copied only partly. Copy it again.');
      fs.readSync(fd, h, 0, BLOCK, pos);
      if (h.every((b) => b === 0)) break;
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
      if (parseOctal(h, 148, 8) !== sum) throw new Error('The tar file has a damaged header (its checksum is wrong).');
      const size = parseOctal(h, 124, 12);
      const flag = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
      const at = pos + BLOCK;
      pos = at + Math.ceil(size / BLOCK) * BLOCK;
      if (pos > total) throw new Error('The tar file ends in the middle of an entry: it was copied only partly. Copy it again.');
      if (flag === 'x') {
        pax = parsePax(read(at, size));
        continue;
      }
      if (flag === 'g') continue;
      if (flag === 'L') {
        longName = read(at, size).toString('utf8').replace(/\0[\s\S]*$/, '');
        continue;
      }
      const magic = cstr(h, 257, 6);
      const prefix = magic.startsWith('ustar') ? cstr(h, 345, 155) : '';
      const short = cstr(h, 0, 100);
      const name = pax.path ?? longName ?? (prefix ? `${prefix}/${short}` : short);
      const realSize = pax.size !== undefined ? Number(pax.size) : size;
      longName = null;
      pax = {};
      if (flag === '0' || flag === '7') out.push({ name, type: 'file', size: realSize, at });
      else if (flag === '5') out.push({ name, type: 'dir', size: 0, at });
      else throw new Error(`The tar file has an entry that is not a plain file or folder (${name}, type ${flag}): not a data bundle.`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

// ── reading a bundle ────────────────────────────────────────────────────────

/**
 * Where a bundle's files are: `{ kind, top, files: [{ rel, size, read(sink) }] , manifestText }`.
 * `read(dest)` streams the file (to `dest` when given, 0600) and returns its sha256.
 */
export function openBundle(bundle) {
  const abs = path.resolve(bundle);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new Error(`No bundle at ${abs}.`);
  }
  const copyHash = (readChunk, size, dest) => {
    const h = crypto.createHash('sha256');
    const out = dest ? fs.openSync(dest, 'wx', 0o600) : null;
    try {
      const buf = Buffer.allocUnsafe(CHUNK);
      let done = 0;
      while (done < size) {
        const n = readChunk(buf, Math.min(CHUNK, size - done), done);
        if (n <= 0) throw new Error('A file in the bundle is shorter than it says.');
        h.update(buf.subarray(0, n));
        if (out !== null) fs.writeSync(out, buf, 0, n);
        done += n;
      }
    } finally {
      if (out !== null) fs.closeSync(out);
    }
    return h.digest('hex');
  };

  if (st.isDirectory()) {
    let root = abs;
    if (!fs.existsSync(path.join(root, MANIFEST))) {
      const inner = fs
        .readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(abs, e.name, MANIFEST)))
        .map((e) => path.join(abs, e.name));
      if (inner.length !== 1) throw new Error(`${abs} is not a data bundle (no ${MANIFEST} in it${inner.length > 1 ? ', or more than one bundle' : ''}).`);
      root = inner[0];
    }
    const files = listFiles(root)
      .filter((rel) => rel !== MANIFEST)
      .map((rel) => {
        const file = toOs(root, rel);
        const size = fs.statSync(file).size;
        return {
          rel,
          size,
          read: (dest) => {
            const fd = fs.openSync(file, 'r');
            try {
              return copyHash((buf, n, at) => fs.readSync(fd, buf, 0, n, at), size, dest);
            } finally {
              fs.closeSync(fd);
            }
          },
        };
      });
    return { kind: 'folder', path: abs, top: path.basename(root), manifestText: fs.readFileSync(path.join(root, MANIFEST), 'utf8'), files };
  }

  const entries = tarEntries(abs);
  let top = null;
  let manifestText = null;
  const files = [];
  const seen = new Set();
  for (const e of entries) {
    const name = e.name.replace(/^\.\//, '').replace(/\/+$/, '');
    const [first, ...restSegs] = name.split('/');
    if (!first || !safeRelPath(first)) throw new Error(`The bundle has an entry with an unsafe path (${JSON.stringify(e.name)}): not importing it.`);
    if (top === null) top = first;
    if (first !== top) throw new Error(`The bundle has more than one top folder (${top}, ${first}): not a data bundle.`);
    const rel = restSegs.join('/');
    if (e.type === 'dir') {
      if (rel && !safeRelPath(rel)) throw new Error(`The bundle has an entry with an unsafe path (${JSON.stringify(e.name)}): not importing it.`);
      continue;
    }
    if (!safeRelPath(rel)) throw new Error(`The bundle has an entry with an unsafe path (${JSON.stringify(e.name)}): not importing it.`);
    if (seen.has(rel)) throw new Error(`The bundle has ${rel} twice: not a data bundle.`);
    seen.add(rel);
    const readAt = (buf, n, off) => {
      const fd = fs.openSync(abs, 'r');
      try {
        return fs.readSync(fd, buf, 0, n, e.at + off);
      } finally {
        fs.closeSync(fd);
      }
    };
    if (rel === MANIFEST) {
      if (e.size > 64 * 1024 * 1024) throw new Error('The bundle’s manifest is far too large: not a data bundle.');
      const b = Buffer.alloc(e.size);
      if (e.size) readAt(b, e.size, 0);
      manifestText = b.toString('utf8');
      continue;
    }
    files.push({ rel, size: e.size, read: (dest) => copyHash(readAt, e.size, dest) });
  }
  if (manifestText === null) throw new Error(`${abs} is not a data bundle (no ${MANIFEST} in it).`);
  return { kind: 'tar', path: abs, top, manifestText, files };
}

/** Parses and checks a manifest's shape. Throws with what's wrong. */
export function parseManifest(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    throw new Error('The bundle’s manifest.json is not valid JSON (damaged?).');
  }
  if (m?.format !== BUNDLE_FORMAT) throw new Error('This is not a BluModel Studio data bundle (manifest format).');
  if (m.formatVersion !== BUNDLE_VERSION) throw new Error(`This bundle is format version ${m.formatVersion}; this install reads version ${BUNDLE_VERSION}. Update this install first.`);
  if (!Array.isArray(m.files) || !m.files.length) throw new Error('The bundle’s manifest lists no files.');
  const seen = new Set();
  for (const f of m.files) {
    if (!f || !safeRelPath(f.path) || !Number.isInteger(f.size) || f.size < 0 || !/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) throw new Error(`The bundle’s manifest has a bad entry (${JSON.stringify(f?.path ?? f)}).`);
    if (seen.has(f.path)) throw new Error(`The bundle’s manifest lists ${f.path} twice.`);
    seen.add(f.path);
  }
  if (!seen.has(DB_ENTRY)) throw new Error(`The bundle has no database (${DB_ENTRY}).`);
  if (!m.tables || typeof m.tables !== 'object') throw new Error('The bundle’s manifest has no table counts.');
  return m;
}

/**
 * Reads every file of an opened bundle, checking its size and sha256 against the manifest.
 * `dest(rel)` names where to keep a file (or null: check only). Returns `{ manifest, problems }`.
 */
export function verifyBundle(opened, { dest = () => null } = {}) {
  const manifest = parseManifest(opened.manifestText);
  const want = new Map(manifest.files.map((f) => [f.path, f]));
  const problems = [];
  const got = new Set();
  for (const f of opened.files) {
    const w = want.get(f.rel);
    if (!w) {
      problems.push(`${f.rel} is in the bundle but not in its manifest`);
      continue;
    }
    got.add(f.rel);
    if (w.size !== f.size) {
      problems.push(`${f.rel} is ${f.size} bytes; the manifest says ${w.size}`);
      continue;
    }
    const target = dest(f.rel);
    if (target) privateDir(path.dirname(target));
    const sha = f.read(target);
    if (sha !== w.sha256) problems.push(`${f.rel} does not match its checksum (damaged in the copy?)`);
  }
  for (const rel of want.keys()) if (!got.has(rel)) problems.push(`${rel} is missing from the bundle`);
  return { manifest, problems };
}

/**
 * Checks a database file: integrity, its tables' row counts against `tables`, and that every
 * migration it has run is one this app knows. Returns `{ problems, counts, migrations }`.
 */
export function checkDatabase(file, { tables = null, known = listSteps().map((s) => s.id) } = {}) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = integrityCheck(db);
    if (!integrity.ok) return { problems: [`the database failed PRAGMA integrity_check: ${integrity.problems.join('; ')}`], counts: {}, migrations: [] };
    const counts = tableCounts(db);
    const migrations = appliedMigrations(db);
    const problems = [];
    if (tables) {
      for (const [t, n] of Object.entries(tables)) if (counts[t] !== n) problems.push(`table ${t} has ${counts[t] ?? 'no'} rows; the manifest says ${n}`);
    }
    const knownSet = new Set(known);
    const unknown = migrations.filter((id) => !knownSet.has(id));
    if (unknown.length) problems.push(`it was made by a newer version of the app (migrations this install doesn't have: ${unknown.join(', ')}). Update this install first, then import`);
    return { problems, counts, migrations };
  } finally {
    db.close();
  }
}

// ── export ──────────────────────────────────────────────────────────────────

/**
 * Writes a data bundle. Safe while the server runs.
 * @param {{
 *   config: { DB_PATH: string, UPLOAD_DIR: string, BACKUP_DIR: string },
 *   out?: string,              a folder (the bundle goes inside it) or a .tar path; default <BACKUP_DIR>/exports
 *   folder?: boolean,          a plain folder instead of a .tar
 *   includeSecrets?: boolean,  also the settings file and the tunnel credentials
 *   settingsFile?: string, tunnelDir?: string, home?: string | null,
 *   env?: Record<string, string | undefined>, now?: () => number, serverDir?: string,
 * }} o
 * @returns {{ bundle: string, manifest: any, warnings: string[] }}
 */
export function exportData({ config, out, folder = false, includeSecrets = false, settingsFile, tunnelDir, home = null, env = process.env, now = Date.now, serverDir = SERVER_DIR }) {
  if (!config.DB_PATH || config.DB_PATH === ':memory:' || !fs.existsSync(config.DB_PATH)) throw new Error(`No database at ${config.DB_PATH}. Name it with --home <dir> or --db <file>.`);
  const t0 = now();
  const top = `blumodel-data-${stampOf(t0)}`;
  const target = path.resolve(out ?? path.join(config.BACKUP_DIR, 'exports'));
  const asTar = !folder;
  let outDir;
  let finalPath;
  if (asTar && /\.tar$/i.test(target)) {
    outDir = path.dirname(target);
    finalPath = target;
  } else {
    outDir = target;
    finalPath = path.join(outDir, asTar ? `${top}.tar` : top);
  }
  const repo = gitCheckoutAt(outDir);
  if (repo) throw new Error(`Not writing the bundle inside the git checkout ${repo}: it holds every account's data, and the repo is public. Pass --out <a folder outside it> (a USB stick, your home folder).`);
  if (isInside(outDir, config.UPLOAD_DIR)) throw new Error(`Not writing the bundle inside the uploads folder ${config.UPLOAD_DIR}. Pass --out <another folder>.`);
  if (fs.existsSync(finalPath)) throw new Error(`${finalPath} already exists.`);
  privateDir(outDir);

  const warnings = [];
  const work = fs.mkdtempSync(path.join(outDir, `.${top}.work-`));
  const partial = `${finalPath}.part`;
  fs.rmSync(partial, { recursive: true, force: true });
  let writer = null;
  try {
    writer = asTar ? new TarWriter(partial, top, t0) : new FolderWriter(path.dirname(partial), path.basename(partial));
    const files = [];
    const add = (rel, src) => files.push({ path: rel, ...writer.file(rel, src) });

    // 1. The uploads there now (content-addressed: a blob never changes once written).
    const before = new Set(listFiles(config.UPLOAD_DIR, { skipTop: ['tmp'] }));
    for (const rel of before) add(`uploads/${rel}`, toOs(config.UPLOAD_DIR, rel));

    // 2. One consistent copy of the database, from a read-only connection.
    const snap = path.join(work, 'blumodel.db');
    withReadOnlyDb(config.DB_PATH, (live) => live.prepare('VACUUM INTO ?').run(snap));
    privateFile(snap);
    const db = new DatabaseSync(snap, { readOnly: true });
    let tables;
    let migrations;
    let referenced;
    try {
      const integrity = integrityCheck(db);
      if (!integrity.ok) throw new Error(`The copy of the database failed its integrity check (${integrity.problems.join('; ')}). Restore a good backup first (docs/OPERATIONS.md).`);
      tables = tableCounts(db);
      migrations = appliedMigrations(db);
      referenced = referencedUploads(db);
    } finally {
      db.close();
    }

    // 3. Uploads made between steps 1 and 2 (the copy refers to them), then the database.
    const missing = [];
    for (const rel of referenced) {
      if (before.has(rel)) continue;
      const src = toOs(config.UPLOAD_DIR, rel);
      if (fs.existsSync(src)) add(`uploads/${rel}`, src);
      else missing.push(rel);
    }
    if (missing.length) warnings.push(`${missing.length} upload(s) the database refers to are not in ${config.UPLOAD_DIR} (already missing there; listed in the manifest).`);
    add(DB_ENTRY, snap);

    // 4. Secrets, only when asked for.
    const secrets = [];
    if (includeSecrets) {
      const settings = settingsFile ? path.resolve(settingsFile) : (resolveEnvFile(env, { serverDir })?.file ?? (home ? path.join(home, 'blumodel.env') : null));
      if (settings && fs.existsSync(settings)) {
        add('secrets/blumodel.env', settings);
        secrets.push('secrets/blumodel.env');
      } else warnings.push(`No settings file found${settings ? ` at ${settings}` : ''} (name it with --settings <file>).`);
      const tunnel = tunnelDir ? path.resolve(tunnelDir) : home && fs.existsSync(path.join(home, '.cloudflared')) ? path.join(home, '.cloudflared') : path.join(os.homedir(), '.cloudflared');
      let creds = [];
      try {
        creds = fs.readdirSync(tunnel).filter((n) => TUNNEL_CREDENTIALS.test(n));
      } catch {
        creds = [];
      }
      for (const n of creds.sort()) {
        add(`secrets/cloudflared/${n}`, path.join(tunnel, n));
        secrets.push(`secrets/cloudflared/${n}`);
      }
      if (!creds.length) warnings.push(`No tunnel credentials (<tunnel id>.json) in ${tunnel} (name the folder with --tunnel-dir <dir>).`);
    }

    const uploadFiles = files.filter((f) => f.path.startsWith('uploads/'));
    const manifest = {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_VERSION,
      createdAt: new Date(t0).toISOString(),
      app: { name: 'blumodel-studio', version: appVersion(serverDir), commit: appCommit(serverDir) },
      source: { os: process.platform, node: process.version },
      schema: { migrations: migrations.length, latest: migrations[migrations.length - 1] ?? null, ids: migrations },
      tables,
      uploads: {
        files: uploadFiles.length,
        bytes: uploadFiles.reduce((s, f) => s + f.size, 0),
        referenced: referenced.length,
        missing,
      },
      secrets,
      files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };
    writer.buffer(MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 1)}\n`));
    writer.close();
    writer = null;

    // 5. Read back what was written before calling it done (a full disk or a bad stick shows here).
    const check = verifyBundle(openBundle(asTar ? partial : path.join(partial)));
    if (check.problems.length) throw new Error(`The bundle didn't read back correctly: ${check.problems.slice(0, 5).join('; ')}`);
    fs.renameSync(partial, finalPath);
    privateFile(finalPath);
    return { bundle: finalPath, manifest, warnings };
  } catch (err) {
    if (writer && asTar) {
      try {
        fs.closeSync(writer.fd);
      } catch {
        /* closed */
      }
    }
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Runs `fn(db)` on a read-only connection to `file`. Such a connection to a WAL database leaves an
 * empty -wal/-shm behind when none existed; run as root on Linux those would belong to root, and
 * the server's own account could no longer open its database. They are given to the database
 * file's owner afterwards.
 */
function withReadOnlyDb(file, fn) {
  const created = ['-wal', '-shm'].filter((x) => !fs.existsSync(file + x));
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 10000');
    return fn(db);
  } finally {
    db.close();
    if (POSIX && process.getuid?.() === 0) {
      try {
        const { uid, gid } = fs.statSync(file);
        for (const x of created) if (fs.existsSync(file + x)) fs.chownSync(file + x, uid, gid);
      } catch {
        /* the database went away meanwhile */
      }
    }
  }
}

// ── import ──────────────────────────────────────────────────────────────────

/** The account that should own what import puts in place: the owner of the nearest existing folder at or above `dir`. */
function ownerAbove(dir) {
  let d = path.resolve(dir);
  for (;;) {
    try {
      const st = fs.statSync(d);
      return { uid: st.uid, gid: st.gid };
    } catch {
      const up = path.dirname(d);
      if (up === d) return null;
      d = up;
    }
  }
}

/** chown -R, never following a link. */
function chownTree(p, { uid, gid }) {
  let st;
  try {
    st = fs.lstatSync(p);
    fs.lchownSync(p, uid, gid);
  } catch {
    return;
  }
  if (st.isDirectory()) for (const n of fs.readdirSync(p)) chownTree(path.join(p, n), { uid, gid });
}

/** Moves a file, copying when the destination is on another disk. */
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    fs.rmSync(src, { force: true });
  }
}

/**
 * What an import would replace: `{ db, rows, uploads }`: whether there is a database, how many rows
 * it holds outside schema_migrations (a server that started once on a new machine has made an
 * empty, migrated database: 0), and how many uploads there are. A database that can't be read
 * counts as full.
 * @param {{ DB_PATH: string, UPLOAD_DIR: string }} config
 */
export function existingData(config) {
  let db = false;
  let rows = 0;
  if (fs.existsSync(config.DB_PATH)) {
    db = true;
    try {
      rows = withReadOnlyDb(config.DB_PATH, (d) =>
        Object.entries(tableCounts(d))
          .filter(([t]) => t !== 'schema_migrations')
          .reduce((s, [, n]) => s + n, 0),
      );
    } catch {
      rows = Infinity;
    }
  } else if (fs.existsSync(`${config.DB_PATH}-wal`)) {
    db = true;
    rows = Infinity;
  }
  return { db, rows, uploads: listFiles(config.UPLOAD_DIR, { skipTop: ['tmp'] }).length };
}

/** The blob path of a files row under UPLOAD_DIR. */
const blobOf = (uploadDir, r) => toOs(uploadDir, `${r.sha256.slice(0, 2)}/${r.sha256}.${r.ext}`);

/**
 * Checks a bundle and, unless checkOnly, puts it in place. The caller makes sure the server is
 * stopped first (assertServerStopped). Returns a summary for the log.
 *
 *   - Refuses (changing nothing) when the data folder has data, unless `replace`. An empty,
 *     migrated database (a server that started once) doesn't count.
 *   - Verifies every file against the manifest, and the database (integrity, counts, migrations
 *     this app knows), before anything is moved.
 *   - Keeps whatever was there as <db>.before-import-<time> (with -wal/-shm) and
 *     <uploads>.before-import-<time>; if anything fails after that, puts it back.
 *   - Runs the app's migrations, and counts again.
 * @param {{
 *   config: { DB_PATH: string, UPLOAD_DIR: string },
 *   bundle: string, replace?: boolean, checkOnly?: boolean, now?: () => number,
 *   known?: string[],
 * }} o
 */
export function importData({ config, bundle, replace = false, checkOnly = false, now = Date.now, known }) {
  if (!config.DB_PATH || config.DB_PATH === ':memory:') throw new Error('Name the database to import into (--home <dir> or --db <file>).');
  const opened = openBundle(bundle);
  const dataDir = path.dirname(config.DB_PATH);
  const there = checkOnly ? null : existingData(config);
  if (there && (there.rows > 0 || there.uploads > 0) && !replace) {
    const what = [there.rows > 0 && (Number.isFinite(there.rows) ? `a database with ${there.rows} row(s)` : 'a database'), there.uploads > 0 && `${there.uploads} upload(s)`]
      .filter(Boolean)
      .join(' and ');
    throw new Error(`${dataDir} already has data (${what}). Nothing was changed.\nRun again with --replace to keep the current data beside it as *.before-import-<time> and import over it.`);
  }
  // Root on Linux: what goes in place belongs to the home's owner (the service account).
  const owner = !checkOnly && POSIX && process.getuid?.() === 0 ? ownerAbove(dataDir) : null;
  const staging = fs.mkdtempSync(path.join(checkOnly ? os.tmpdir() : privateDir(dataDir), checkOnly ? 'blumodel-check-' : '.import-'));
  const stamp = stampOf(now());
  const kept = { db: /** @type {string | null} */ (null), uploads: /** @type {string | null} */ (null) };
  let swapped = false;
  try {
    // 1. Every file against the manifest. A check keeps only the database (to open it); an import
    //    keeps everything, beside the data folder, so the move into place is a rename.
    const { manifest, problems } = verifyBundle(opened, {
      dest: (rel) => (rel === DB_ENTRY || (!checkOnly && rel.startsWith('uploads/')) ? toOs(staging, rel) : null),
    });
    if (problems.length) {
      const more = problems.length > 20 ? `\n  …and ${problems.length - 20} more` : '';
      throw new Error(`The bundle did not verify; nothing was changed:\n  ${problems.slice(0, 20).join('\n  ')}${more}`);
    }
    const stagedDb = toOs(staging, DB_ENTRY);
    const dbCheck = checkDatabase(stagedDb, { tables: manifest.tables, known });
    if (dbCheck.problems.length) throw new Error(`The bundle's database did not check out; nothing was changed:\n  ${dbCheck.problems.join('\n  ')}`);
    const summary = {
      bundle: opened.path,
      kind: opened.kind,
      top: opened.top,
      manifest,
      counts: dbCheck.counts,
      uploads: manifest.uploads?.files ?? 0,
      secrets: manifest.secrets ?? [],
      applied: /** @type {string[]} */ ([]),
      kept,
      missingBlobs: 0,
      owner: /** @type {null | { uid: number, gid: number }} */ (null),
    };
    if (checkOnly) return summary;

    // 2. Keep what is there (moved, never deleted: put it back by renaming it).
    if (there?.db) {
      kept.db = `${config.DB_PATH}.before-import-${stamp}`;
      for (const x of ['', '-wal', '-shm']) if (fs.existsSync(config.DB_PATH + x)) fs.renameSync(config.DB_PATH + x, kept.db + x);
    } else for (const x of ['-wal', '-shm']) fs.rmSync(config.DB_PATH + x, { force: true });
    if (fs.existsSync(config.UPLOAD_DIR)) {
      kept.uploads = `${config.UPLOAD_DIR}.before-import-${stamp}`;
      fs.renameSync(config.UPLOAD_DIR, kept.uploads);
    }
    swapped = true;

    // 3. Into place.
    fs.renameSync(stagedDb, config.DB_PATH);
    privateFile(config.DB_PATH);
    privateDir(config.UPLOAD_DIR);
    const staged = path.join(staging, 'uploads');
    for (const rel of listFiles(staged)) {
      const dest = toOs(config.UPLOAD_DIR, rel);
      privateDir(path.dirname(dest));
      moveFile(toOs(staged, rel), dest);
    }

    // 4. This app's migrations, then what is there now.
    const db = openDb(config.DB_PATH);
    try {
      summary.applied = migrate(db);
      summary.counts = tableCounts(db);
      const rows = db.prepare('SELECT sha256, ext FROM files').all();
      summary.missingBlobs = rows.filter((r) => !fs.existsSync(blobOf(config.UPLOAD_DIR, r))).length;
      checkpoint(db);
    } finally {
      db.close();
    }
    if (owner && owner.uid !== 0) {
      for (const x of ['', '-wal', '-shm']) if (fs.existsSync(config.DB_PATH + x)) chownTree(config.DB_PATH + x, owner);
      chownTree(config.UPLOAD_DIR, owner);
      try {
        fs.chownSync(dataDir, owner.uid, owner.gid);
      } catch {
        /* left as is */
      }
      summary.owner = owner;
    }
    return summary;
  } catch (err) {
    if (swapped) {
      // Put back what was there, and keep what was imported aside to look at.
      const failed = `.failed-import-${stamp}`;
      try {
        for (const x of ['', '-wal', '-shm']) if (fs.existsSync(config.DB_PATH + x)) fs.renameSync(config.DB_PATH + x, `${config.DB_PATH}${failed}${x}`);
        if (kept.db) for (const x of ['', '-wal', '-shm']) if (fs.existsSync(kept.db + x)) fs.renameSync(kept.db + x, config.DB_PATH + x);
        if (fs.existsSync(config.UPLOAD_DIR)) fs.renameSync(config.UPLOAD_DIR, `${config.UPLOAD_DIR}${failed}`);
        if (kept.uploads) fs.renameSync(kept.uploads, config.UPLOAD_DIR);
        err.message += `\nWhat was there before is back in place; what was imported is kept as *${failed}.`;
      } catch (undoErr) {
        err.message += `\nPutting the previous data back failed too (${undoErr.message}); it is kept as ${kept.db ?? '(no database)'} and ${kept.uploads ?? '(no uploads)'}.`;
      }
    }
    throw err;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
