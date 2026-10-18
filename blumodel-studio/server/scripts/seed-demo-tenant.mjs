// Makes (or brings up to date) the demo showroom on a real server: "Northline Kitchen & Bath
// (Demo)" at demo.<BASE_DOMAIN>, live on a complimentary license and monthly plan, with its
// products, branding and $25 of credits (docs/SHOWROOM_PIVOT.md §9), its showroom pictures and the
// gallery's sample kitchens (server/tenancy/demo-images/, made by scripts/make-showroom-images.mjs).
// Run again after an update to bring an existing demo up to date (new products and lines, changed
// ones, new pictures). The only account it makes is "Northline design team", which owns the gallery
// kitchens and can't sign in (nobody knows its password). To use the workspace, add yourself to its
// team from Admin > Companies > Northline > Team, which gives you a sign-in link.
//
//   node server/scripts/seed-demo-tenant.mjs
//   node server/scripts/seed-demo-tenant.mjs --db <file>
//
// Which database, the same way make-admin.mjs finds it: --db, else DB_PATH, else, run from a
// deployed home, the home's data/blumodel.db, else the checkout's. It prints the one it used and
// never creates one. Safe to run again: nothing is duplicated. Prints no password, key or link.

import fs from 'node:fs';
import { loadConfig } from '../config.mjs';
import { scriptDbPath } from '../lib/envFile.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { createApp } from '../app.mjs';
import { DEMO_NAME, seedDemoTenant } from '../tenancy/demo.mjs';

const args = process.argv.slice(2);
const dbAt = args.indexOf('--db');
const dbFlag = dbAt >= 0 ? args[dbAt + 1] : undefined;
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node server/scripts/seed-demo-tenant.mjs [--db <file>]');
  process.exit(0);
}

const env = { ...process.env };
const { dbPath, source } = scriptDbPath({ env, dbFlag });
if (dbPath) env.DB_PATH = dbPath;
// The deployed home's database is the live server's, so its defaults are production's
// (BASE_DOMAIN blumodel.studio). Without this the demo's address was saved as demo.localhost on the
// live server (2026-10-17).
const argv = source === 'home' && !process.argv.includes('--prod') ? [...process.argv, '--prod'] : process.argv;
const config = loadConfig(env, argv);
const why = { '--db': 'from --db', DB_PATH: 'from DB_PATH', home: 'the deployed home’s database', default: 'the checkout’s database' }[source];
console.log(`Database: ${config.DB_PATH} (${why})`);
if (config.DB_PATH !== ':memory:' && !fs.existsSync(config.DB_PATH)) {
  console.error(`There is no database at ${config.DB_PATH}. Run this on the server, or name it with --db <file> or DB_PATH.`);
  process.exit(1);
}
const db = openDb(config.DB_PATH);
try {
  const applied = migrate(db);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
  const quiet = { info() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
  const { ctx } = createApp({ config, db, log: quiet });
  const out = await seedDemoTenant({ db, services: ctx.services, config, now: Date.now }, { people: false });
  const t = ctx.services.tenants.get(out.tenantId);
  console.log(`${DEMO_NAME}: ${out.created ? 'created' : 'already there'}, status ${t.status}, ${out.products.total} products (${out.products.made} new, ${out.products.updated} updated), ${out.pictures} new showroom pictures.`);
  console.log(`Address: ${ctx.services.tenants.originOf(t)}`);
  console.log('To use its workspace, add yourself to its team in Admin > Tenants.');
} finally {
  db.close();
}
