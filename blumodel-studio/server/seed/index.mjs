// Demo data for local development, QA and the demo server (BUILD_PLAN §3.7, F-T9).
//
//   DB_PATH=<db> npm run seed                       seeds that database (migrating it first)
//   DB_PATH=<db> npm run seed -- --only core        just the core seed
//   DB_PATH=<db> npm run seed -- --prod --force-demo   production refuses without --force-demo
//
// Runs core.mjs first, then every other server/seed/*.mjs in name order. Each module
// exports `async function seed(ctx)` with ctx = { db, config, services, now, log, demo, forceDemo },
// where `demo` is what the core seed made ({ users: { customer, brand, studio, admin }, brandId,
// productIds }). Every seed must be idempotent: running twice leaves the same state.
//
// DB_PATH is required on the command line, so a bare `npm run seed` can never write demo
// accounts into the default server/data/blumodel.db by accident.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../config.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { createApp } from '../app.mjs';
import * as core from './core.mjs';

const SEED_DIR = path.dirname(fileURLToPath(import.meta.url));
const quietLog = { info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };

/** Every seed module after core, by file name. */
export function seedFiles(dir = SEED_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && f !== 'index.mjs' && f !== 'core.mjs')
    .sort();
}

/**
 * Runs the seeds against an open, migrated database.
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, now?: () => number, log?: any,
 *   services?: any, forceDemo?: boolean, only?: string[] | null }} opts
 * @returns {Promise<{ ran: { name: string, ms: number, summary?: string }[], core: any }>}
 */
export async function runSeeds({ db, config, now = Date.now, log = quietLog, services, forceDemo = false, only = null }) {
  if (config.PROD && !forceDemo) throw new Error('Refusing to seed demo data in production. Pass --force-demo if you really mean it.');
  // The services come from the real app (not listening), so feature packages' route modules
  // have registered their implementations (billing, pricing…) exactly as in the server.
  const svc = services ?? createApp({ config, db, now, log }).ctx.services;
  const want = (name) => !only || only.includes(name);
  const ran = [];

  // Core always runs (the others build on its users and brand); `only` just skips the rest.
  let t0 = Date.now();
  const coreResult = await core.seed({ db, config, services: svc, now, log });
  ran.push({ name: 'core', ms: Date.now() - t0, summary: coreResult.summary });
  const demo = Object.freeze({ users: coreResult.users, brandId: coreResult.brandId, productIds: coreResult.productIds });

  for (const file of seedFiles()) {
    const name = file.replace(/\.mjs$/, '');
    if (!want(name)) continue;
    const mod = await import(pathToFileURL(path.join(SEED_DIR, file)).href);
    if (typeof mod.seed !== 'function') throw new Error(`server/seed/${file} must export "async function seed(ctx)".`);
    t0 = Date.now();
    const out = await mod.seed({ db, config, services: svc, now, log, demo, forceDemo });
    ran.push({ name, ms: Date.now() - t0, ...(typeof out?.summary === 'string' ? { summary: out.summary } : {}) });
  }
  return { ran, core: coreResult };
}

async function main(argv = process.argv, env = process.env) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: DB_PATH=<file> node server/seed/index.mjs [--only core,brands] [--prod --force-demo]');
    return 0;
  }
  if (!env.DB_PATH) {
    console.error('Set DB_PATH to the database to seed (e.g. DB_PATH=./tmp/blumodel.db npm run seed).');
    return 2;
  }
  const config = loadConfig(env, argv);
  const forceDemo = args.includes('--force-demo');
  if (config.PROD && !forceDemo) {
    console.error('Refusing to seed demo data in production. Pass --force-demo if you really mean it.');
    return 2;
  }
  const at = args.indexOf('--only');
  const only = at >= 0 && args[at + 1] ? args[at + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

  const db = openDb(config.DB_PATH);
  try {
    const applied = migrate(db);
    if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
    const { ran, core: c } = await runSeeds({ db, config, forceDemo, only });
    for (const r of ran) console.log(`seed ${r.name}: ${r.summary ?? 'done'} (${r.ms} ms)`);
    // The password itself is never printed.
    const where =
      c.passwordSource === 'env' ? 'the SEED_PASSWORD you set' : c.credentialsFile ? `the password in ${c.credentialsFile}` : 'a generated password (in-memory database: not saved)';
    console.log(`Demo accounts (${core.DEMO_USERS.map((u) => u.email).join(', ')}) use ${where}.`);
    return 0;
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`Seeding failed: ${err?.stack || err}`);
      process.exit(1);
    },
  );
}
