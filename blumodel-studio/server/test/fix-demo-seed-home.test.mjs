// Fix (2026-10-17): seed-demo-tenant.mjs run on the live server saved the demo's address as
// demo.localhost. It found the deployed home's database but loaded the development defaults
// (BASE_DOMAIN localhost) because nothing passed --prod. Run from a deployed home it now uses
// production's defaults, so the demo is demo.blumodel.studio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..');
const ROOT = path.resolve(SERVER, '..');

/** process.env without anything that would point the script at a database, settings file or domain. */
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(DB_PATH|UPLOAD_DIR|BACKUP_DIR|BLUMODEL_|MISE_|PORT$|HOST$|BASE_DOMAIN$|PUBLIC_URL$|NODE_ENV$|STRIPE_|RESEND_|POSTMARK_)/.test(k)) delete env[k];
  return env;
};

test('seed-demo-tenant run from a deployed home without BASE_DOMAIN makes demo.blumodel.studio', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-demo-home-'));
  try {
    // A deployed app as deploy-local lays it out: app\server, app\src\data\*.json, app\package.json.
    const app = path.join(home, 'app');
    fs.cpSync(SERVER, path.join(app, 'server'), { recursive: true, filter: (src) => !/[\\/]server[\\/](data|test)([\\/]|$)/.test(src) });
    fs.mkdirSync(path.join(app, 'src', 'data'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'src', 'data'))) if (f.endsWith('.json')) fs.copyFileSync(path.join(ROOT, 'src', 'data', f), path.join(app, 'src', 'data', f));
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(app, 'package.json'));
    const homeDb = path.join(home, 'data', 'blumodel.db');
    fs.mkdirSync(path.dirname(homeDb), { recursive: true });
    const db = openDb(homeDb);
    migrate(db);
    db.close();

    const script = path.join(app, 'server', 'scripts', 'seed-demo-tenant.mjs');
    const out = execFileSync(process.execPath, ['--no-warnings', script], { cwd: app, env: cleanEnv(), encoding: 'utf8' });
    assert.ok(out.includes(`Database: ${homeDb}`), out);
    // The scheme and port come from PUBLIC_URL, which the real server sets; the host is what matters.
    assert.match(out, /Address: https?:\/\/demo\.blumodel\.studio\b/, out);

    const check = openDb(homeDb);
    try {
      const hosts = check.prepare("SELECT hostname FROM tenant_hostnames WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo')").all().map((r) => r.hostname);
      assert.deepEqual(hosts, ['demo.blumodel.studio']);
    } finally {
      check.close();
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
