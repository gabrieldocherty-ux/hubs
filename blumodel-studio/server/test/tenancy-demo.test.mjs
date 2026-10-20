// The demo showroom (docs/SHOWROOM_PIVOT.md §9): seeded idempotently, live, a curated catalog with
// no store links, branding, people, designs and leads in dev/QA; the admin command makes it on a
// real database without any account and prints nothing secret.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Agent, startTestServer } from './helpers.mjs';
import { DEMO_PEOPLE, DEMO_PRODUCTS, seedDemoTenant } from '../tenancy/demo.mjs';
import { runSeeds } from '../seed/index.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('the demo showroom: live, its own catalog (no store links), branding, people, designs and leads; seeding twice changes nothing', async () => {
  const t = await startTestServer({ env: { SEED_PASSWORD: 'demo password for tests' } });
  try {
    const ctx = { db: t.db, services: t.services, config: t.config, now: Date.now };
    const first = await seedDemoTenant(ctx, { people: true });
    const counts = () =>
      Object.fromEntries(['products', 'files', 'tenant_members', 'projects', 'showroom_leads', 'share_links', 'tenant_licenses', 'tenant_credit_lots', 'users'].map((tb) => [tb, t.db.prepare(`SELECT COUNT(*) AS n FROM ${tb}`).get().n]));
    const before = counts();
    const again = await seedDemoTenant(ctx, { people: true });
    assert.deepEqual(counts(), before, 'idempotent');
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.products.made, 0);

    const host = t.hostFor('demo');
    const visitor = new Agent(t.url, { host });
    const cfg = (await visitor.get('/api/config')).body;
    assert.equal(cfg.site, 'showroom');
    assert.equal(cfg.tenant.name, 'Northline Kitchen & Bath (Demo)');
    assert.equal(cfg.tenant.status, 'live');
    assert.equal(cfg.tenant.isDemo, true);
    assert.deepEqual(cfg.tenant.features, { fillGaps: true, bathrooms: true, visitorRenders: false, visitorEstimate: false });
    assert.deepEqual(cfg.tenant.branding.featuredLines, ['Lakeshore Shaker', 'Harbourfront Slab', 'Northline Sinks', 'Chef’s Appliance Suite', 'Bay Lighting', 'Bayview Bath']);
    // Its pictures, from the committed demo-images: a hero, a tall hero, every featured line, a gallery
    // whose kitchens open in 3D.
    const im = cfg.tenant.images;
    assert.ok(im.hero && im.heroTall, 'hero pictures');
    assert.equal((await visitor.get(im.hero.url)).status, 200);
    for (const l of cfg.tenant.branding.featuredLines) assert.ok(Object.values(im.lines).some((x) => x.line === l), `a picture of ${l}`);
    assert.ok(im.gallery.length >= 3);
    for (const g of im.gallery) assert.equal((await visitor.get(`/api/share/${g.design}`)).status, 200, `${g.title} opens`);
    assert.equal((await visitor.get(cfg.tenant.branding.logoUrl)).status, 200);

    const cat = (await visitor.get('/api/catalog')).body;
    assert.equal(cat.products.length, DEMO_PRODUCTS.length);
    for (const p of cat.products) {
      assert.equal(p.buyUrl, undefined, `${p.name} has no store link`);
      assert.equal(p.source, 'tenant');
      assert.equal(p.brand, 'Northline Kitchen & Bath (Demo)');
      assert.ok(p.thumbnailUrl, `${p.name} has a picture`);
    }
    assert.equal((await visitor.get(cat.products[0].thumbnailUrl)).status, 200);
    const cats = new Set(cat.products.map((p) => p.category));
    for (const c of ['cabinets', 'sinks', 'appliances', 'lighting', 'seating']) assert.ok(cats.has(c), c);
    const shaker = cat.products.filter((p) => p.line === 'Lakeshore Shaker');
    assert.ok(shaker.length >= 5 && shaker.every((p) => Array.isArray(p.finishes) && p.finishes.length === 4 && p.doorStyle === 'shaker'));
    // Not on the sales site's catalog.
    assert.ok(!(await t.agent().get('/api/catalog')).body.products.some((p) => p.source === 'tenant'));

    // The people, on the showroom only.
    const owner = new Agent(t.url, { host });
    const signIn = await owner.post('/api/auth/login', { email: DEMO_PEOPLE[0].email, password: 'demo password for tests' });
    assert.equal(signIn.status, 200, signIn.text);
    assert.equal(signIn.body.user.showroom.role, 'owner');
    assert.equal((await t.agent().post('/api/auth/login', { email: DEMO_PEOPLE[0].email, password: 'demo password for tests' })).status, 401);
    const inbox = (await owner.get('/api/workspace/leads')).body;
    assert.equal(inbox.counts.total, 3);
    assert.equal(inbox.counts.contacted, 1);
    assert.equal(inbox.counts.quoted, 1);
    // Every demo lead comes with its design, and each opens.
    assert.equal(inbox.leads.filter((l) => l.design).length, 3);
    for (const l of inbox.leads) assert.equal((await owner.get(`/api/share/${l.design.shareToken}`)).status, 200, `${l.name}'s design opens`);
    // Every seeded design sits inside the room: nothing pokes through a wall (the editor's
    // "pokes through a wall" check), and back-wall pieces touch the wall.
    const depth = new Map(cat.products.map((p) => [p.id, p.depthIn ?? p.spec?.depthIn]));
    assert.ok([...depth.values()].every((d) => d > 0), 'every demo product has a depth');
    for (const row of t.db.prepare("SELECT name, doc FROM projects WHERE tenant_id = 't_demo'").all()) {
      const doc = JSON.parse(row.doc);
      for (const it of doc.items) {
        const d = depth.get(it.productId);
        const w = it.widthIn;
        if (!d || !w || it.rotation) continue;
        assert.ok(it.y - d / 2 >= 0 && it.y + d / 2 <= doc.room.lengthIn, `${row.name}: ${it.productId} at y ${it.y} (depth ${d}) is through a wall`);
        assert.ok(it.x - w / 2 >= 0 && it.x + w / 2 <= doc.room.widthIn, `${row.name}: ${it.productId} at x ${it.x} is through a wall`);
      }
    }
    assert.equal((await owner.get('/api/workspace/credits')).body.balanceCents, 2500);
    const me = new Agent(t.url, { host });
    await me.post('/api/auth/login', { email: DEMO_PEOPLE[2].email, password: 'demo password for tests' });
    const projects = (await me.get('/api/projects')).body.projects;
    assert.equal(projects.length, 2);
    for (const pr of projects) assert.ok(pr.doc.items.length >= 5, pr.name);
  } finally {
    await t.close();
  }
});

test('the full seed run includes the demo showroom', async () => {
  const t = await startTestServer({ env: { SEED_PASSWORD: 'demo password for tests' } });
  try {
    const { ran } = await runSeeds({ db: t.db, config: t.config, services: t.services, only: ['tenants'] });
    const s = ran.find((r) => r.name === 'tenants');
    assert.match(s.summary, /^demo showroom demo\.localhost: \d+ products/);
  } finally {
    await t.close();
  }
});

test('node server/scripts/seed-demo-tenant.mjs: makes it on a real database, no accounts, nothing secret printed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-demo-seed-'));
  try {
    const file = path.join(dir, 'blumodel.db');
    const db = openDb(file);
    migrate(db);
    db.close();
    const env = { ...process.env, DB_PATH: file, UPLOAD_DIR: path.join(dir, 'uploads'), BASE_DOMAIN: 'blumodel.studio', PUBLIC_URL: 'https://blumodel.studio', SEED_PASSWORD: 'should never print' };
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'POSTMARK_TOKEN', 'BLUMODEL_ENV_FILE', 'MISE_ENV_FILE']) delete env[k];
    const run = () => execFileSync(process.execPath, ['--no-warnings', path.join(HERE, '..', 'scripts', 'seed-demo-tenant.mjs')], { env, encoding: 'utf8' });
    const out = run();
    assert.match(out, /Northline Kitchen & Bath \(Demo\): created, status live, \d+ products/);
    assert.match(out, /Address: https:\/\/demo\.blumodel\.studio/);
    assert.ok(!out.includes('should never print'));
    assert.ok(!/reset=|token|password/i.test(out), out);
    assert.match(out, /, [1-9]\d* new showroom pictures\./);
    assert.match(run(), /already there, status live, \d+ products \(0 new, 0 updated\), 0 new showroom pictures\./);
    const check = openDb(file);
    assert.deepEqual(check.prepare('SELECT email FROM users').all().map((r) => r.email), ['demo-gallery@blumodel.test'], 'only the account that owns the gallery kitchens');
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM tenant_members').get().n, 0, 'on no team');
    assert.equal(check.prepare("SELECT status FROM tenants WHERE slug = 'demo'").get().status, 'live');
    check.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
