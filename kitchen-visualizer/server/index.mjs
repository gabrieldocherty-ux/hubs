// Mise API: accounts, sessions and saved kitchens. Zero dependencies — Node's
// http, crypto and sqlite only — so there is nothing to install or audit.
//
//   npm run api                 # dev, pairs with `npm run dev` (Vite proxies /api)
//   npm start                   # production: also serves the built app from dist/
//
// Env: PORT (8787), HOST (all interfaces), DB_PATH (server/data/mise.db), NODE_ENV.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || undefined;
const PROD = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const DB_PATH = process.env.DB_PATH || path.join(HERE, 'data', 'mise.db');
const DIST = path.join(HERE, '..', 'dist');
const SESSION_DAYS = 30;
const MAX_BODY = 1_000_000;
const MAX_DOC = 600_000;
const COOKIE = 'mise_session';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    client TEXT NOT NULL DEFAULT '',
    doc TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at DESC);
`);

// ─── Passwords & sessions ──────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// A fixed hash to verify against when the email is unknown, so a miss costs the
// same time as a wrong password and response timing doesn't reveal accounts.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  return { token, expires };
}

// Secure follows the request, not the mode: a Secure cookie sent over plain
// http to anything but localhost is silently dropped, which would break sign-in
// on a home server. X-Forwarded-Proto is trusted only from a loopback proxy
// (e.g. `tailscale serve`), never from a remote client.
function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
function secureAttr(req) {
  const https = req.socket.encrypted
    || (isLoopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https');
  return https ? '; Secure' : '';
}

function sessionCookie(req, token, expires) {
  const maxAge = Math.max(0, Math.floor((expires - Date.now()) / 1000));
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureAttr(req)}`;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Resolves the signed-in user, sliding the session forward once it's half used. */
function currentUser(req, res) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = db
    .prepare('SELECT s.user_id, s.expires_at, u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  if (row.expires_at - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
    const expires = Date.now() + SESSION_DAYS * 86_400_000;
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expires, sha256(token));
    res.setHeader('Set-Cookie', sessionCookie(req, token, expires));
  }
  return { id: row.id, email: row.email, name: row.name };
}

// ─── Login throttling ──────────────────────────────────────────────────────

const failures = new Map();
const WINDOW = 15 * 60_000;
const MAX_FAILS = 8;

function throttled(key) {
  const f = failures.get(key);
  return !!f && f.count >= MAX_FAILS && Date.now() - f.first < WINDOW;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
setInterval(() => {
  for (const [k, f] of failures) if (Date.now() - f.first > WINDOW) failures.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 10 * 60_000).unref();

// ─── HTTP plumbing ─────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Expected JSON.'));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That request is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Malformed JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validDoc(doc) {
  return !!doc && typeof doc === 'object' && !!doc.room && typeof doc.room.widthIn === 'number' && Array.isArray(doc.items) && !!doc.surfaces;
}

function projectRow(r, withDoc = true) {
  return {
    id: r.id,
    name: r.name,
    client: r.client,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(withDoc ? { doc: JSON.parse(r.doc) } : {}),
  };
}

function ownedProject(userId, id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new HttpError(404, 'That kitchen does not exist.');
  return row;
}

// ─── Routes ────────────────────────────────────────────────────────────────

async function api(req, res, url) {
  const method = req.method;
  const p = url.pathname;

  // Writes must carry a custom header. Browsers can't add one cross-site without
  // a CORS preflight this server never approves, which blocks CSRF.
  if (method !== 'GET' && req.headers['x-mise'] !== '1') throw new HttpError(403, 'Missing request header.');

  if (p === '/api/auth/signup' && method === 'POST') {
    const body = await readJson(req);
    const name = str(body.name, 80);
    const email = str(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) throw new HttpError(400, 'Tell us your name.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right.');
    if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.');
    if (password.length > 200) throw new HttpError(400, 'That password is too long.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with that email already exists. Try signing in.');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, email, name, hashPassword(password), Date.now());
    const s = createSession(id);
    res.setHeader('Set-Cookie', sessionCookie(req, s.token, s.expires));
    return send(res, 201, { user: { id, email, name } });
  }

  if (p === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const email = str(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = req.socket.remoteAddress || '';
    const key = `${ip}|${email}`;
    if (throttled(key)) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = verifyPassword(password.slice(0, 200), user ? user.password_hash : DUMMY_HASH) && !!user;
    if (!ok) {
      recordFailure(key);
      throw new HttpError(401, 'That email and password do not match.');
    }
    failures.delete(key);
    const s = createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(req, s.token, s.expires));
    return send(res, 200, { user: { id: user.id, email: user.email, name: user.name } });
  }

  if (p === '/api/auth/logout' && method === 'POST') {
    const token = readCookie(req, COOKIE);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr(req)}`);
    return send(res, 200, { ok: true });
  }

  const user = currentUser(req, res);

  if (p === '/api/auth/me' && method === 'GET') {
    if (!user) return send(res, 200, { user: null });
    return send(res, 200, { user });
  }

  if (!user) throw new HttpError(401, 'Please sign in.');

  if (p === '/api/auth/me' && method === 'PATCH') {
    const body = await readJson(req);
    const name = str(body.name, 80);
    if (!name) throw new HttpError(400, 'Name cannot be empty.');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    return send(res, 200, { user: { ...user, name } });
  }

  if (p === '/api/auth/password' && method === 'POST') {
    const body = await readJson(req);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(current.slice(0, 200), row.password_hash)) throw new HttpError(400, 'Your current password is not right.');
    if (next.length < 8 || next.length > 200) throw new HttpError(400, 'Use at least 8 characters for your new password.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    // Sign out every other device; keep this one.
    const keep = sha256(readCookie(req, COOKIE) || '');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, keep);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/projects' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(user.id);
    return send(res, 200, { projects: rows.map((r) => projectRow(r)) });
  }

  if (p === '/api/projects' && method === 'POST') {
    const body = await readJson(req);
    const name = str(body.name, 120) || 'Untitled Kitchen';
    const client = str(body.client, 120);
    if (!validDoc(body.doc)) throw new HttpError(400, 'That is not a kitchen design.');
    const doc = JSON.stringify({ ...body.doc, name });
    if (doc.length > MAX_DOC) throw new HttpError(413, 'That design is too large to save.');
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(id, user.id, name, client, doc, now, now);
    return send(res, 201, { project: projectRow(ownedProject(user.id, id)) });
  }

  const m = p.match(/^\/api\/projects\/([0-9a-f-]{36})(\/duplicate)?$/);
  if (m) {
    const id = m[1];
    if (m[2] && method === 'POST') {
      const src = ownedProject(user.id, id);
      const nid = crypto.randomUUID();
      const now = Date.now();
      const name = `${src.name} (copy)`.slice(0, 120);
      const doc = JSON.stringify({ ...JSON.parse(src.doc), name });
      db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(nid, user.id, name, src.client, doc, now, now);
      return send(res, 201, { project: projectRow(ownedProject(user.id, nid)) });
    }
    if (m[2]) throw new HttpError(405, 'Method not allowed.');
    if (method === 'GET') return send(res, 200, { project: projectRow(ownedProject(user.id, id)) });
    if (method === 'DELETE') {
      ownedProject(user.id, id);
      db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, user.id);
      return send(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      const row = ownedProject(user.id, id);
      // Optimistic concurrency: a stale revision means another tab or device saved first.
      if (!body.force && typeof body.revision === 'number' && body.revision !== row.revision) {
        return send(res, 409, { error: 'This kitchen was changed somewhere else.', project: projectRow(row) });
      }
      const name = body.name !== undefined ? str(body.name, 120) || row.name : row.name;
      const client = body.client !== undefined ? str(body.client, 120) : row.client;
      let doc = row.doc;
      if (body.doc !== undefined) {
        if (!validDoc(body.doc)) throw new HttpError(400, 'That is not a kitchen design.');
        doc = JSON.stringify({ ...body.doc, name });
        if (doc.length > MAX_DOC) throw new HttpError(413, 'That design is too large to save.');
      } else if (name !== row.name) {
        doc = JSON.stringify({ ...JSON.parse(row.doc), name });
      }
      db.prepare('UPDATE projects SET name = ?, client = ?, doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?').run(name, client, doc, Date.now(), id, user.id);
      return send(res, 200, { project: projectRow(ownedProject(user.id, id)) });
    }
    throw new HttpError(405, 'Method not allowed.');
  }

  throw new HttpError(404, 'Not found.');
}

// ─── Static app (production) ───────────────────────────────────────────────

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveStatic(req, res, url) {
  if (!fs.existsSync(DIST)) return send(res, 404, { error: 'Run `npm run build` first, or use `npm run dev`.' });
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 400, { error: 'Bad path.' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else send(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message });
    else {
      console.error(err);
      send(res, 500, { error: 'Something went wrong on our side.' });
    }
  }
});

server.listen(PORT, HOST, () => console.log(`Mise API listening on http://${HOST || "localhost"}:${PORT}${PROD ? ' (serving dist/)' : ''}`));
