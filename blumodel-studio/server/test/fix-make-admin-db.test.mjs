// Review fix: make-admin finds the home's database by itself. Run from <home>\app without DB_PATH it
// opened app\server\data\blumodel.db (the checkout default, an empty file it created) and said there
// was no such account. It now resolves the database the way restore.mjs does: --db, else DB_PATH,
// else the deployed home's data\blumodel.db, and prints the one it used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { scriptDbPath } from '../lib/envFile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..');
const ROOT = path.resolve(SERVER, '..');

/** process.env without anything that would point the script at a database or settings file. */
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(DB_PATH|UPLOAD_DIR|BACKUP_DIR|BLUMODEL_|MISE_|PORT$|HOST$)/.test(k)) delete env[k];
  return env;
};

function seedDb(file, email) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file);
  migrate(db);
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', email, 'Gabe', 'scrypt$00$00', Date.now());
  db.close();
}
const roleIn = (file) => {
  const db = openDb(file);
  try {
    return db.prepare('SELECT role FROM users WHERE id = ?').get('u1').role;
  } finally {
    db.close();
  }
};

test('scriptDbPath: --db, then DB_PATH, then the deployed home, then the server default', () => {
  const home = path.join(os.tmpdir(), 'bm-home-x');
  const serverDir = path.join(home, 'app', 'server');
  assert.deepEqual(scriptDbPath({ env: {}, serverDir }), { dbPath: path.join(home, 'data', 'blumodel.db'), source: 'home' });
  assert.deepEqual(scriptDbPath({ env: { DB_PATH: 'C:/x/y.db' }, serverDir }), { dbPath: 'C:/x/y.db', source: 'DB_PATH' });
  assert.deepEqual(scriptDbPath({ env: { DB_PATH: 'C:/x/y.db' }, dbFlag: 'z.db', serverDir }), { dbPath: path.resolve('z.db'), source: '--db' });
  assert.deepEqual(scriptDbPath({ env: {}, serverDir: path.join(home, 'blumodel-studio', 'server') }), { dbPath: null, source: 'default' });
});

test('make-admin run from a deployed home without DB_PATH promotes the account in <home>\\data\\blumodel.db', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-make-admin-home-'));
  try {
    // A deployed app as deploy-local lays it out: app\server, app\src\data\*.json, app\package.json.
    const app = path.join(home, 'app');
    fs.cpSync(SERVER, path.join(app, 'server'), { recursive: true, filter: (src) => !/[\\/]server[\\/](data|test)([\\/]|$)/.test(src) });
    fs.mkdirSync(path.join(app, 'src', 'data'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'src', 'data'))) if (f.endsWith('.json')) fs.copyFileSync(path.join(ROOT, 'src', 'data', f), path.join(app, 'src', 'data', f));
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(app, 'package.json'));
    const homeDb = path.join(home, 'data', 'blumodel.db');
    seedDb(homeDb, 'gabe@test.blumodel');

    const script = path.join(app, 'server', 'scripts', 'make-admin.mjs');
    const out = execFileSync(process.execPath, ['--no-warnings', script, 'gabe@test.blumodel'], { cwd: app, env: cleanEnv(), encoding: 'utf8' });
    assert.ok(out.includes(`Database: ${homeDb}`), out);
    assert.match(out, /is now an admin/);
    assert.equal(roleIn(homeDb), 'admin');
    assert.equal(fs.existsSync(path.join(app, 'server', 'data', 'blumodel.db')), false, 'no stray database inside app\\server');

    // DB_PATH still wins, and a path with no database is an error, not a new empty file.
    const other = path.join(home, 'other', 'blumodel.db');
    seedDb(other, 'ann@test.blumodel');
    const out2 = execFileSync(process.execPath, ['--no-warnings', script, '--role', 'studio', 'ann@test.blumodel'], { cwd: app, env: { ...cleanEnv(), DB_PATH: other }, encoding: 'utf8' });
    assert.ok(out2.includes(`Database: ${other} (from DB_PATH)`), out2);
    assert.equal(roleIn(other), 'studio');
    const missing = path.join(home, 'nowhere', 'blumodel.db');
    assert.throws(() => execFileSync(process.execPath, ['--no-warnings', script, 'gabe@test.blumodel', '--db', missing], { cwd: app, env: cleanEnv(), stdio: 'pipe' }));
    assert.equal(fs.existsSync(missing), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
