// Makes the demo showroom's pictures and sample kitchens, committed in server/tenancy/demo-images/
// and installed by the demo seed (server/tenancy/demo.mjs) on every server, the live one included:
// a server never renders anything (a headless Linux box has no browser or GPU), it only copies files.
//
//   npx vite build --outDir .build/vis
//   node scripts/make-showroom-images.mjs --dist .build/vis [--port 8987] [--swiftshader] [--out <dir>]
//
// What it does: a throwaway server (temp database and uploads, seeded like QA, on 127.0.0.1:<port>),
// the installed Edge in the background, signed in as the demo showroom's owner on
// http://demo.localhost:<port>/#/showroom-images?auto=1 (the same generator page a company's team or
// an admin uses, src/features/showroom/images). The page builds each scene with the app's layout
// builder from Northline's own products, checks it with the editor's design checks, renders it with
// the Studio render path and uploads it. This script then copies each picture out of the temp
// uploads, with the scenes' plans (product ids written as `sku:<SKU>`), into the manifest.
// Nothing leaves the machine: every request to another host is blocked. Ports 8787/8790/8795 are refused.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAllowedPort, killTree, launchBrowser, openPage, sleep } from './qa-shot.mjs';

const { DatabaseSync } = await import('node:sqlite');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = assertAllowedPort(arg('--port', '8987'));
const dist = path.resolve(ROOT, arg('--dist', 'dist'));
const OUT = path.resolve(ROOT, arg('--out', 'server/tenancy/demo-images'));
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`No built app at ${dist}. Run: npx vite build --outDir .build/vis`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-images-'));
const env = { ...process.env };
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'POSTMARK_TOKEN', 'EMAIL_FROM', 'BLUMODEL_ENV_FILE', 'MISE_ENV_FILE', 'PUBLIC_URL', 'TRUST_PROXY', 'NODE_ENV', 'ARCHITECT_AI_URL', 'ARCHITECT_AI_KEY']) delete env[k];
Object.assign(env, {
  PORT: String(port),
  HOST: '127.0.0.1',
  DB_PATH: path.join(tmp, 'blumodel.db'),
  UPLOAD_DIR: path.join(tmp, 'uploads'),
  PAYMENTS: 'demo',
  DEMO_PAYMENTS: '1',
  BASE_DOMAIN: 'localhost',
  DIST_DIR: dist,
  SEED_PASSWORD: crypto.randomBytes(18).toString('base64url'),
  ADMIN_EMAILS: 'demo-admin@blumodel.test',
});
const log = path.join(tmp, 'server.log');
const node = (a) =>
  new Promise((res, rej) => {
    const p = spawn(process.execPath, ['--no-warnings', ...a], { cwd: ROOT, env, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')], windowsHide: true });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`node ${a.join(' ')} failed (${c}); see ${log}`))));
  });

let server = null;
let browser = null;
try {
  if (!fs.existsSync(path.join(ROOT, 'server', 'generated', 'export-kit.mjs'))) await node(['scripts/build-kit.mjs']);
  await node(['server/seed/index.mjs']);
  server = spawn(process.execPath, ['--no-warnings', 'server/index.mjs', '--prod'], { cwd: ROOT, env, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')], windowsHide: true, detached: process.platform !== 'win32' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/config`)).ok) break;
    } catch {
      /* starting */
    }
    if (i > 100) throw new Error(`The server didn't start; see ${log}`);
    await sleep(200);
  }

  // The owner's session, straight in the database (as scripts/qa.mjs does for showroom people).
  const db = new DatabaseSync(env.DB_PATH);
  const owner = db.prepare("SELECT u.id, t.id AS tid FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = 'demo-owner@blumodel.test' AND t.slug = 'demo'").get();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, id, created_at, last_seen_at, browser, os, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    crypto.createHash('sha256').update(token).digest('hex'), owner.id, now + 3_600_000, crypto.randomBytes(12).toString('hex'), now, now, 'images', 'images', owner.tid,
  );

  browser = await launchBrowser({ swiftshader: args.includes('--swiftshader') });
  const page = await openPage(browser.cdp, { viewport: { w: 1440, h: 900, dpr: 1 } });
  const origin = `http://demo.localhost:${port}`;
  await page.send('Network.setCookie', { name: 'blumodel_session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' });
  await page.goto(`${origin}/#/showroom-images?auto=1`, 30_000);
  console.log(`Rendering on ${origin} …`);
  let state = null;
  for (let i = 0; i < 900; i++) {
    state = await page.evaluate(() => ({ done: !!window.__showroomImages?.done, made: window.__showroomImages?.made ?? 0, failed: window.__showroomImages?.failed ?? 0 })).catch(() => null);
    if (state?.done) break;
    await sleep(1000);
  }
  if (!state?.done) throw new Error('The generator did not finish in 15 minutes.');
  const scenes = await page.evaluate(() => window.__showroomImages.scenes);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.sri-list li')].map((li) => `${li.querySelector('b')?.textContent}: ${li.querySelector('.sri-state')?.textContent}${li.querySelector('.sri-note') ? ` (${li.querySelector('.sri-note').textContent})` : ''}`));
  for (const r of rows) console.log(`  ${r}`);
  if (state.failed) throw new Error(`${state.failed} scene(s) failed; nothing written.`);

  // The pictures, from the tenant's record and the temp uploads.
  const t = db.prepare("SELECT branding FROM tenants WHERE slug = 'demo'").get();
  const render = JSON.parse(t.branding).images?.render ?? {};
  const skuOf = new Map(db.prepare("SELECT id, json_extract(spec, '$.sku') AS sku FROM products WHERE tenant_id = 't_demo'").all().map((r) => [r.id, r.sku]));
  const fileOf = (id) => db.prepare('SELECT sha256, ext FROM files WHERE id = ?').get(id);
  const blob = (f) => {
    // server/files/store.mjs keeps blobs content-addressed under UPLOAD_DIR.
    const hits = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === `${f.sha256}.${f.ext}`) hits.push(p);
      }
    };
    walk(env.UPLOAD_DIR);
    if (!hits.length) throw new Error(`blob ${f.sha256} not found`);
    return fs.readFileSync(hits[0]);
  };
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const images = [];
  const put = (target, img, file) => {
    const f = fileOf(img.fileId);
    const buf = blob(f);
    fs.writeFileSync(path.join(OUT, `${file}.${f.ext}`), buf);
    images.push({ ...target, file: `${file}.${f.ext}`, w: img.w, h: img.h, bytes: buf.length });
  };
  const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (render.hero) put({ slot: 'hero', source: 'render', design: 'hero' }, render.hero, 'hero');
  if (render.heroTall) put({ slot: 'heroTall', source: 'render' }, render.heroTall, 'hero-tall');
  for (const v of Object.values(render.lines ?? {})) put({ slot: 'line', source: 'render', line: v.line }, v, `line-${slug(v.line)}`);
  (render.gallery ?? []).forEach((g, i) => g && put({ slot: 'gallery', source: 'render', index: i + 1, title: g.title, design: `gallery-${i + 1}` }, g, `gallery-${i + 1}`));
  (render.dreams ?? []).forEach((g, i) => g && put({ slot: 'dream', source: 'render', index: i + 1, title: g.title, design: `dream-${i + 1}` }, g, `dream-${i + 1}`));
  // The sales page's slideshow: two angles of each dream kitchen, in public/marketing/ (not the demo's
  // manifest). The live server makes photoreal versions of them (server/scripts/render-marketing.mjs).
  const PROMO_OUT = path.join(ROOT, 'public', 'marketing');
  (render.promos ?? []).forEach((g, i) => {
    if (!g) return;
    const f = fileOf(g.fileId);
    fs.writeFileSync(path.join(PROMO_OUT, `kitchen-${i + 1}.${f.ext}`), blob(f));
  });

  // The plans behind the hero and the gallery, with SKUs instead of this database's product ids.
  const designs = scenes
    .filter((s) => s.id === 'hero' || s.id.startsWith('gallery:') || s.id.startsWith('dream:'))
    .map((s) => ({
      key: s.id === 'hero' ? 'hero' : s.id.replace(':', '-'),
      title: s.id === 'hero' ? 'Northline showroom kitchen' : s.shots[0]?.title ?? s.label,
      problems: s.problems,
      doc: { ...s.doc, items: s.doc.items.map((it) => (skuOf.has(it.productId) ? { ...it, productId: `sku:${skuOf.get(it.productId)}` } : it)) },
    }));
  for (const d of designs) if (d.problems.length) throw new Error(`${d.title} has layout problems: ${d.problems.join('; ')}`);
  for (const d of designs) delete d.problems;
  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify({ madeAt: Date.now(), by: 'scripts/make-showroom-images.mjs', images, designs }, null, 1)}\n`);
  const kb = Math.round(images.reduce((n, i) => n + i.bytes, 0) / 1024);
  console.log(`Wrote ${images.length} pictures (${kb} KB) and ${designs.length} sample kitchens to ${path.relative(ROOT, OUT)}`);
  db.close();
} finally {
  if (browser) await browser.close().catch(() => killTree(browser.pid));
  if (server) killTree(server.pid);
  await sleep(300);
  // A browser still letting go of its profile can't be removed yet; that mustn't hide the real error.
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    console.warn(`Left ${tmp} behind (${e.code}).`);
  }
}
