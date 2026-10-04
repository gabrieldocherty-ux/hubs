// Migrations: fresh DBs, DBs made by the old single-file server, and a temp copy of a
// real mise.db all reach the latest step; a second run is a no-op.
//
// The real-database case copies (never opens) the file named by MISE_UPGRADE_DB, and
// server/data/mise.db when it exists, plus their -wal/-shm files, into a temp folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db/index.mjs';
import { migrate, listSteps } from '../db/migrate.mjs';
import { hashPassword } from '../auth/passwords.mjs';
import { startTestServer, sampleDoc } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALL_IDS = listSteps().map((s) => s.id);

const OLD_DDL = `
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
`;

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mise-migrate-'));
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);

test('a fresh database gets every step; a second run is a no-op', () => {
  const db = openDb(':memory:');
  assert.deepEqual(migrate(db), ALL_IDS);
  assert.deepEqual(migrate(db), []);
  const t = tables(db);
  for (const name of ['users', 'sessions', 'projects', 'schema_migrations', 'files', 'file_grants', 'brands', 'brand_members', 'products', 'product_events']) assert.ok(t.includes(name), name);
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(cols.includes('role'));
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
  assert.ok(idx.includes('sessions_user'));
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  db.close();
});

test('a database made by the old server upgrades with users and projects intact, and old users can log in', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(OLD_DDL);
    old.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run('u-old', 'old@test.mise', 'Old Timer', await hashPassword('old password 1'), 1700000000000);
    old.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      '11111111-1111-4111-8111-111111111111',
      'u-old',
      'Old Kitchen',
      'Client',
      JSON.stringify(sampleDoc({ name: 'Old Kitchen' })),
      7,
      1700000000000,
      1700000000000,
    );
    old.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run('h', 'u-old', Date.now() + 1e9);
    assert.equal(old.prepare('PRAGMA user_version').get().user_version, 0);
    old.close();

    const db = openDb(file);
    assert.deepEqual(migrate(db), ALL_IDS);
    assert.deepEqual(migrate(db), []);
    const u = db.prepare('SELECT * FROM users').get();
    assert.equal(u.email, 'old@test.mise');
    assert.equal(u.role, 'customer');
    const p = db.prepare('SELECT * FROM projects').get();
    assert.equal(p.revision, 7);
    assert.equal(JSON.parse(p.doc).name, 'Old Kitchen');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    db.close();

    const t = await startTestServer({ dbPath: file });
    try {
      const a = t.agent();
      const login = await a.post('/api/auth/login', { email: 'old@test.mise', password: 'old password 1' });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.role, 'customer');
      const list = await a.get('/api/projects');
      assert.equal(list.body.projects.length, 1);
      assert.equal(list.body.projects[0].revision, 7);
      const save = await a.put(`/api/projects/${list.body.projects[0].id}`, { revision: 7, doc: list.body.projects[0].doc });
      assert.equal(save.status, 200, 'an old saved kitchen passes the strict validator');
    } finally {
      await t.close();
    }
  } finally {
    rm(dir);
  }
});

const realCandidates = [process.env.MISE_UPGRADE_DB, path.join(HERE, '..', 'data', 'mise.db')].filter((p, i, a) => p && fs.existsSync(p) && a.indexOf(p) === i);

test('temp copies of real mise.db files upgrade cleanly', { skip: realCandidates.length ? false : 'no real mise.db to copy (set MISE_UPGRADE_DB)' }, async () => {
  for (const src of realCandidates) {
    const dir = tempDir();
    try {
      const dest = path.join(dir, 'mise.db');
      // Copy the database and its WAL/SHM side files; the original is never opened.
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, dest + suffix);
      const db = openDb(dest);
      const has = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      const before = {
        users: has('users') ? db.prepare('SELECT COUNT(*) AS n FROM users').get().n : 0,
        projects: has('projects') ? db.prepare('SELECT COUNT(*) AS n FROM projects').get().n : 0,
        ids: has('projects') ? db.prepare('SELECT id, revision FROM projects ORDER BY id').all().map((r) => `${r.id}@${r.revision}`) : [],
      };
      const appliedBefore = has('schema_migrations') ? db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id) : [];
      const ran = migrate(db);
      assert.deepEqual(ran, ALL_IDS.filter((id) => !appliedBefore.includes(id)), src);
      assert.deepEqual(migrate(db), [], 'second run is a no-op');
      const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
      for (const id of ALL_IDS) assert.ok(applied.includes(id), `${id} recorded`);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, before.users, 'users intact');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, before.projects, 'projects intact');
      assert.deepEqual(db.prepare('SELECT id, revision FROM projects ORDER BY id').all().map((r) => `${r.id}@${r.revision}`), before.ids);
      for (const r of db.prepare('SELECT doc FROM projects').all()) assert.doesNotThrow(() => JSON.parse(r.doc));
      assert.ok(db.prepare('SELECT role FROM users').all().every((r) => ['customer', 'studio', 'admin'].includes(r.role)));
      db.close();
    } finally {
      rm(dir);
    }
  }
});

test('step ids are validated, and a failing step rolls back and is not recorded', () => {
  assert.throws(() => listSteps([{ steps: [{ id: 'oops-001-x', up() {} }] }], ['core']), /prefixed/);
  assert.throws(() => listSteps([{ steps: [{ id: 'core-1-x', up() {} }] }], ['core']), /must look like/);
  assert.throws(
    () =>
      listSteps(
        [{ steps: [{ id: 'a-001-x', up() {} }] }, { steps: [{ id: 'a-001-x', up() {} }] }],
        ['a', 'a'],
      ),
    /Duplicate/,
  );
  const db = openDb(':memory:');
  migrate(db);
  const bad = {
    steps: [
      {
        id: 'zz-001-bad',
        up(d) {
          d.exec('CREATE TABLE zz_half (id INTEGER)');
          throw new Error('boom');
        },
      },
    ],
  };
  assert.throws(() => migrate(db, { modules: [bad], keys: ['zz'] }), /boom/);
  assert.ok(!tables(db).includes('zz_half'), 'rolled back');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 'zz-001-bad'").get().n, 0);
  db.close();
});
