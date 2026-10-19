// Core demo data (BUILD_PLAN F-T9): four demo accounts and one fictional demo brand with two
// published 3D products. Idempotent: run it any number of times and the end state is the same.
//
// Demo accounts (all on the reserved .test domain, so none can be a real address):
//   demo-customer@blumodel.test   a homeowner
//   demo-brand@blumodel.test      owner of the demo brand "BluModel Sample Co. (Demo)"
//   demo-studio@blumodel.test     role studio
//   demo-admin@blumodel.test      role admin
//
// Their password is SEED_PASSWORD, or one generated on the first run and written to
// <dirname DB_PATH>/seed-credentials.txt (reused on later runs). It is never printed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, verifyPassword } from '../auth/passwords.mjs';
import { makeGlb, makePng } from '../lib/synth.mjs';
import { randomId } from '../lib/ids.mjs';

export const DEMO_USERS = Object.freeze([
  { key: 'customer', email: 'demo-customer@blumodel.test', name: 'Dana Demo', role: 'customer' },
  { key: 'brand', email: 'demo-brand@blumodel.test', name: 'Sam Sample', role: 'customer' },
  { key: 'studio', email: 'demo-studio@blumodel.test', name: 'Studio Demo', role: 'studio' },
  { key: 'admin', email: 'demo-admin@blumodel.test', name: 'Admin Demo', role: 'admin' },
]);

/** A made-up brand. Seed and demo data use fictional brands only. */
export const DEMO_BRAND = Object.freeze({
  slug: 'blumodel-sample-co-demo',
  name: 'BluModel Sample Co. (Demo)',
  tagline: 'Sample products for trying BluModel Studio. Not a real company.',
  description: 'A fictional brand that ships with BluModel Studio so the catalog, product pages and 3D models can be tried without real brand data.',
});

export const CREDENTIALS_FILE = 'seed-credentials.txt';

/** Where a generated password is kept: next to the database (never for ':memory:'). */
export function credentialsPath(config) {
  return config.DB_PATH === ':memory:' ? null : path.join(path.dirname(path.resolve(config.DB_PATH)), CREDENTIALS_FILE);
}

function readSavedPassword(file) {
  try {
    const m = /^password=(.+)$/m.exec(fs.readFileSync(file, 'utf8'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * The demo password: SEED_PASSWORD, else the one saved by an earlier run, else a new one
 * (saved with owner-only permissions where the OS supports them).
 * @returns {{ password: string, source: 'env' | 'file' | 'generated', file: string | null }}
 */
export function demoPassword(config) {
  if (config.SEED_PASSWORD) return { password: config.SEED_PASSWORD, source: 'env', file: null };
  const file = credentialsPath(config);
  const saved = file && readSavedPassword(file);
  if (saved) return { password: saved, source: 'file', file };
  const password = crypto.randomBytes(18).toString('base64url');
  if (file) {
    const lines = [
      '# BluModel Studio demo accounts (server/seed/core.mjs). Local demo data only; never commit this file.',
      ...DEMO_USERS.map((u) => `# ${u.email} (${u.key === 'brand' ? 'owner of the demo brand' : u.role})`),
      `password=${password}`,
      '',
    ];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  }
  return { password, source: 'generated', file };
}

/** The two demo products: a 30″ range and a dome pendant, each with a GLB at real size. */
const DEMO_PRODUCTS = [
  {
    glb: { w: 0.762, h: 0.914, d: 0.711, materials: ['blumodel_finish', 'body'] },
    thumb: { w: 96, h: 96, rgba: (x, y) => (y < 20 ? [60, 62, 66, 255] : x % 24 < 2 || y % 24 < 2 ? [150, 152, 156, 255] : [196, 198, 202, 255]) },
    spec: {
      kind: 'range',
      variant: 'gas-4',
      category: 'appliances',
      name: 'Sample Gas Range 30″ (Demo)',
      blurb: 'A demo product from a fictional brand: a 30″ gas range with four burners, for trying the catalog and the 3D viewer.',
      sku: 'MSC-RG30-DEMO',
      widthIn: 30,
      depthIn: 28,
      heightIn: 36,
      elevationIn: 0,
      price: 1899,
      finishes: [
        { id: 'stainless', name: 'Stainless', hex: '#c3c6ca', material: 'metal' },
        { id: 'matte-black', name: 'Matte Black', hex: '#2b2b2c', material: 'metal' },
      ],
    },
  },
  {
    glb: { w: 0.356, h: 0.254, d: 0.356, materials: ['blumodel_finish'] },
    thumb: { w: 96, h: 96, rgba: (x, y) => ((x - 48) ** 2 + (y - 56) ** 2 < 900 && y > 40 ? [184, 140, 74, 255] : [243, 238, 229, 255]) },
    spec: {
      kind: 'pendant',
      variant: 'dome',
      category: 'lighting',
      name: 'Sample Dome Pendant (Demo)',
      blurb: 'A demo product from a fictional brand: a 14″ dome pendant, for trying lighting in the catalog and the 3D viewer.',
      sku: 'MSC-PD14-DEMO',
      widthIn: 14,
      depthIn: 14,
      heightIn: 10,
      elevationIn: 68,
      price: 249,
      finishes: [
        { id: 'brass', name: 'Brushed Brass', hex: '#b8924a', material: 'metal' },
        { id: 'black', name: 'Black', hex: '#232323', material: 'metal' },
      ],
    },
  },
];

/**
 * Makes sure each demo user exists with the right role. With SEED_PASSWORD set, an existing
 * demo user whose password differs is reset to it (they are demo accounts on a .test domain).
 */
async function ensureUsers({ db, now }, password, source) {
  const ids = {};
  let created = 0;
  for (const u of DEMO_USERS) {
    const row = db.prepare('SELECT id, role, password_hash FROM users WHERE email = ?').get(u.email);
    if (!row) {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)').run(
        id,
        u.email,
        u.name,
        await hashPassword(password),
        now(),
        u.role,
      );
      ids[u.key] = id;
      created++;
      continue;
    }
    ids[u.key] = row.id;
    if (row.role !== u.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(u.role, row.id);
    if (source === 'env' && !(await verifyPassword(password, row.password_hash))) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), row.id);
    }
  }
  return { ids, created };
}

/**
 * Admins must sign in with two-factor (server/auth/mfa.mjs). With SEED_TOTP_SECRET (QA sets a
 * random one per run) the demo admin has it on with that secret; without it the demo admin is asked
 * to set it up at the first sign-in, like any admin.
 */
function ensureAdminMfa({ db, now }, adminId, secret) {
  if (!secret || !adminId) return;
  db.prepare(
    'INSERT INTO user_mfa (user_id, secret, enabled_at, last_step, created_at) VALUES (?, ?, ?, -1, ?) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled_at = COALESCE(user_mfa.enabled_at, excluded.enabled_at)',
  ).run(adminId, secret, now(), now());
}

function ensureBrand({ db, now, services }, ownerId) {
  let brand = services.brands.bySlug(DEMO_BRAND.slug);
  let created = false;
  if (!brand) {
    const t = now();
    const logo = services.files.saveBuffer(
      makePng({ w: 128, h: 128, rgba: (x, y) => ((x - 64) ** 2 + (y - 64) ** 2 < 2600 ? [194, 84, 45, 255] : [251, 249, 244, 255]) }),
      { kind: 'image', visibility: 'public', ownerUserId: ownerId, originalName: 'blumodel-sample-co-logo.png' },
    );
    const id = randomId('b_');
    db.prepare(
      `INSERT INTO brands (id, slug, name, tagline, description, website, logo_file_id, status, verified_at, is_demo, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, 'active', ?, 1, ?, ?, ?)`,
    ).run(id, DEMO_BRAND.slug, DEMO_BRAND.name, DEMO_BRAND.tagline, DEMO_BRAND.description, logo.id, t, ownerId, t, t);
    db.prepare('UPDATE files SET brand_id = ? WHERE id = ?').run(id, logo.id);
    brand = services.brands.get(id);
    created = true;
  }
  // The owner membership is part of the demo, so put it back if it went missing.
  db.prepare("INSERT OR IGNORE INTO brand_members (brand_id, user_id, member_role, created_at) VALUES (?, ?, 'owner', ?)").run(brand.id, ownerId, now());
  return { brand, created };
}

function ensureProducts({ db, services }, brand, ownerId) {
  const ids = [];
  let created = 0;
  for (const p of DEMO_PRODUCTS) {
    const existing = db.prepare('SELECT id FROM products WHERE brand_id = ? AND name = ? ORDER BY created_at LIMIT 1').get(brand.id, p.spec.name);
    if (existing) {
      const row = services.products.get(existing.id);
      if (!row.liveSpec || row.status !== 'published') services.products.publish(row.id);
      ids.push(row.id);
      continue;
    }
    const owner = { ownerUserId: ownerId, brandId: brand.id, visibility: 'public' };
    const model = services.files.saveBuffer(makeGlb(p.glb), { kind: 'model', ...owner, originalName: `${p.spec.sku.toLowerCase()}.glb` });
    const thumb = services.files.saveBuffer(makePng(p.thumb), { kind: 'image', ...owner, originalName: `${p.spec.sku.toLowerCase()}.png` });
    const spec = { ...p.spec, imageFileIds: [thumb.id], modelFileId: model.id };
    const v = services.products.validateSpec(spec);
    if (!v.ok) throw new Error(`core seed: the demo product "${p.spec.name}" is invalid: ${v.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
    const row = services.products.create({ source: 'brand', brandId: brand.id, ownerUserId: ownerId, visibility: 'public', spec: v.spec });
    services.products.publish(row.id);
    ids.push(row.id);
    created++;
  }
  return { ids, created };
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, services: any, now: () => number }} ctx
 * @returns {Promise<{ users: Record<string, string>, brandId: string, productIds: string[], password: string,
 *   passwordSource: 'env' | 'file' | 'generated', credentialsFile: string | null, summary: string }>}
 */
export async function seed(ctx) {
  const { password, source, file } = demoPassword(ctx.config);
  const users = await ensureUsers(ctx, password, source);
  ensureAdminMfa(ctx, users.ids.admin, ctx.config.SEED_TOTP_SECRET);
  const { brand, created: brandCreated } = ensureBrand(ctx, users.ids.brand);
  const products = ensureProducts(ctx, brand, users.ids.brand);
  const summary =
    `${users.created} of ${DEMO_USERS.length} demo users created, demo brand ${brandCreated ? 'created' : 'already there'}, ` +
    `${products.created} of ${DEMO_PRODUCTS.length} demo products created`;
  return { users: users.ids, brandId: brand.id, productIds: products.ids, password, passwordSource: source, credentialsFile: file, summary };
}
