// Makes the photoreal versions of the sales page's slideshow (src/features/marketing/art.tsx): each
// 3D picture in the built app's marketing/kitchen-<n>.webp (made by scripts/make-showroom-images.mjs)
// goes through the render service this server uses (MyArchitectAI, with the key from blumodel.env
// or Admin > System > Render service), and the result is kept in <data folder>/marketing/, where
// GET /api/marketing/photoreal finds it. The sales page shows a photoreal picture where there is
// one and the 3D picture otherwise, so running this is optional and safe to repeat.
//
//   node server/scripts/render-marketing.mjs             the ones not made yet
//   node server/scripts/render-marketing.mjs --force     all of them again (each costs one render)
//   node server/scripts/render-marketing.mjs --only kitchen-2
//
// The key: blumodel.env (read like the server reads it), or one saved in Admin > System. Which
// database and data folder: the same way seed-demo-tenant.mjs finds them. Prints no key.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.mjs';
import { loadEnvFile, scriptDbPath } from '../lib/envFile.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { createRenderSettings } from '../renders/settings.mjs';
import { imageKind } from '../renders/providers.mjs';
import { MARKETING_PROMPTS, marketingDir } from '../lib/marketing.mjs';

const args = process.argv.slice(2);
const flag = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node server/scripts/render-marketing.mjs [--force] [--only kitchen-<n>] [--db <file>]');
  process.exit(0);
}

const env = { ...process.env };
// The settings file the server reads (blumodel.env: ARCHITECT_AI_KEY among them), the same way.
try {
  loadEnvFile(env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { dbPath, source } = scriptDbPath({ env, dbFlag: flag('--db') });
if (dbPath) env.DB_PATH = dbPath;
const argv = source === 'home' && !process.argv.includes('--prod') ? [...process.argv, '--prod'] : process.argv;
const config = loadConfig(env, argv);
if (config.DB_PATH === ':memory:' || !fs.existsSync(config.DB_PATH)) {
  console.error(`There is no database at ${config.DB_PATH}. Run this on the server, or name it with --db <file>.`);
  process.exit(1);
}
const db = openDb(config.DB_PATH);
migrate(db, { now: Date.now });
const provider = createRenderSettings({ db, config, now: Date.now, fetch: globalThis.fetch, log: console }).current();
if (provider?.id !== 'architect') {
  console.error('The render service isn’t set up here (Admin > System > Render service, or ARCHITECT_AI_KEY). Nothing was made.');
  process.exit(1);
}

const out = marketingDir(config.DB_PATH);
fs.mkdirSync(out, { recursive: true });
const only = flag('--only');
let made = 0;
let failed = 0;
for (const [name, prompt] of Object.entries(MARKETING_PROMPTS)) {
  if (only && only !== name) continue;
  const src = path.join(config.DIST_DIR, 'marketing', `${name}.webp`);
  const dest = path.join(out, `${name}.png`);
  if (!fs.existsSync(src)) {
    console.warn(`  ${name}: no 3D picture at ${src} (build the app first); skipped`);
    continue;
  }
  if (fs.existsSync(dest) && !args.includes('--force')) {
    console.log(`  ${name}: already made (--force to make it again)`);
    continue;
  }
  const t0 = Date.now();
  try {
    const { image } = await provider.render({ image: fs.readFileSync(src), mime: 'image/webp', scene: {}, prompt, requestId: `marketing-${name}` });
    if (!imageKind(image)) throw new Error('not an image');
    // Written beside, then renamed: the sales page never sees half a file.
    fs.writeFileSync(`${dest}.tmp`, image);
    fs.renameSync(`${dest}.tmp`, dest);
    made++;
    console.log(`  ${name}: made in ${((Date.now() - t0) / 1000).toFixed(1)} s (${Math.round(image.length / 1024)} KB)`);
  } catch (err) {
    failed++;
    console.error(`  ${name}: failed: ${String(err?.message ?? err).replace(/\s*Your credits were returned\.?/, '')}`);
  }
}
db.close();
console.log(`${made} made, ${failed} failed. Kept in ${out}.`);
process.exit(failed ? 1 : 0);
