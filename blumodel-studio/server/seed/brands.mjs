// Package B2 demo data (BRAND_PAGE.md). Idempotent: running it twice changes nothing.
// Every name here is fictional and marked "(Demo)"; no real company appears.
//
//   Partner brands (admin-curated, kind 'partner', no login):
//     Kestrel & Finch Appliances (Demo), Marlow Lighting Co. (Demo)
//     3–4 live products each, with fixture GLBs at real sizes and generated thumbnails.
//   A demo contractor, demo-brand@blumodel.test (Contractor plan, demo provider):
//     company Alder & Pine Cabinetry (Demo), a live verified brand page, My-catalog products
//     with costs in the price book, most of them live, one submitted (in the moderation
//     queue), one live with a pending edit (field diff), leads in every status, and 30 days of
//     synthetic analytics (labelled "demo data" in the UI because the brand is_demo).
//   A second demo contractor whose page is waiting for review (the brand-page queue).
//
// ctx = { db, config, services, now }.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomId } from '../lib/ids.mjs';
import { makeGlb, makePng } from '../lib/synth.mjs';
import { loadKit } from '../lib/kit.mjs';
import { hashPassword } from '../auth/passwords.mjs';
import { createBrandPageService, utcDay } from '../brands/service.mjs';

const DAY = 86_400_000;
const IN = 0.0254;

/** A small product picture: a soft background and the product's front, to scale. */
function thumb({ w, h, color, accent = [40, 40, 40], kind = 'base' }) {
  const S = 96;
  const scale = (S * 0.78) / Math.max(w, h);
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));
  const x0 = Math.round((S - pw) / 2);
  const y0 = kind === 'pendant' ? Math.round(S * 0.18) : S - 10 - ph;
  return makePng({
    w: S,
    h: S,
    rgba: (x, y) => {
      const inside = x >= x0 && x < x0 + pw && y >= y0 && y < y0 + ph;
      if (kind === 'pendant' && x === Math.round(S / 2) && y < y0) return [70, 70, 70, 255];
      if (!inside) {
        const g = 244 - Math.round((y / S) * 14);
        return y > S - 10 ? [220, 214, 204, 255] : [g, g - 2, g - 6, 255];
      }
      const ex = Math.min(x - x0, x0 + pw - 1 - x);
      const ey = Math.min(y - y0, y0 + ph - 1 - y);
      if (ex < 1 || ey < 1) return [...accent, 255];
      // A door seam down the middle and a drawer line near the top, for cabinets.
      if ((kind === 'base' || kind === 'tall' || kind === 'wall' || kind === 'island') && (x === x0 + Math.round(pw / 2) || y === y0 + Math.round(ph * 0.22))) return [...accent, 200];
      if (kind === 'range' && y < y0 + 5) return [...accent, 255];
      const shade = 1 - (ey / ph) * 0.12;
      return [Math.round(color[0] * shade), Math.round(color[1] * shade), Math.round(color[2] * shade), 255];
    },
  });
}

/** Finds a user by email or creates one. The password is SEED_PASSWORD or a generated one kept in seed-credentials.txt (never printed). */
async function ensureUser(ctx, { email, name, loginable = true }) {
  const { db, config, now } = ctx;
  const found = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (found) return found.id;
  let password = loginable ? config.SEED_PASSWORD : '';
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    if (loginable && config.DB_PATH && config.DB_PATH !== ':memory:') {
      try {
        fs.appendFileSync(path.join(path.dirname(config.DB_PATH), 'seed-credentials.txt'), `${email} ${password}\n`, { mode: 0o600 });
      } catch {
        /* the account still exists; reset its password with server/scripts if needed */
      }
    }
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, email, name, await hashPassword(password), now());
  return id;
}

/** A demo Contractor subscription a year out (the demo provider; no payment involved). */
function ensureContractorPlan(ctx, userId) {
  const { db, now } = ctx;
  const t = now();
  const row = db.prepare('SELECT id, plan, status FROM subscriptions WHERE user_id = ?').get(userId);
  if (row?.plan === 'contractor' && row.status === 'active') return;
  if (row)
    db.prepare("UPDATE subscriptions SET plan = 'contractor', status = 'active', grace_until = NULL, cancel_at_period_end = 0, current_period_end = ?, updated_at = ? WHERE id = ?").run(t + 365 * DAY, t, row.id);
  else
    db.prepare(
      `INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, cancel_at_period_end, grace_until, canceled_at, created_at, updated_at)
       VALUES (?, ?, 'contractor', 'active', 'demo', NULL, ?, ?, 0, NULL, NULL, ?, ?)`,
    ).run(randomId('sub_'), userId, `demo_seed_${userId}`, t + 365 * DAY, t, t);
}

function ensureProfile(ctx, userId, p) {
  const { db, now } = ctx;
  if (db.prepare('SELECT 1 FROM contractor_profiles WHERE user_id = ?').get(userId)) return;
  const t = now();
  db.prepare(
    `INSERT INTO contractor_profiles (user_id, company, logo_file_id, phone, email, website, service_area, default_markup_pct, tax_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, p.company, p.logoFileId ?? null, p.phone, p.email, p.website, p.serviceArea, p.markup ?? 30, p.tax ?? 0, t, t);
}

/** A product's GLB (blumodel_finish slot, real size) and thumbnail. */
function media(services, { widthIn, heightIn, depthIn, color, accent, kind, visibility, ownerUserId = null, brandId = null, name }) {
  const model = services.files.saveBuffer(makeGlb({ w: widthIn * IN, h: heightIn * IN, d: depthIn * IN, materials: ['blumodel_finish', 'body'] }), {
    kind: 'model',
    visibility,
    ownerUserId,
    brandId,
    originalName: `${name}.glb`,
  });
  const image = services.files.saveBuffer(thumb({ w: widthIn, h: heightIn, color, accent, kind }), { kind: 'image', visibility, ownerUserId, brandId, originalName: `${name}.png` });
  return { modelFileId: model.id, imageFileIds: [image.id] };
}

// ── partner brands ───────────────────────────────────────────────────────────

const STEEL = [196, 199, 203];
const PARTNERS = [
  {
    name: 'Kestrel & Finch Appliances (Demo)',
    tagline: 'Pro-style ranges and quiet dishwashers (a fictional demo brand)',
    about: 'A made-up appliance maker used to demonstrate brand products in BluModel Studio. Nothing here is for sale.',
    products: [
      { kind: 'range', variant: 'gas-6', category: 'appliances', name: 'Harrier 36″ Dual-Fuel Range', sku: 'KF-R36', widthIn: 36, depthIn: 28, heightIn: 36, price: 4899, color: STEEL, accent: [30, 30, 32], finishes: [{ id: 'steel', name: 'Brushed steel', hex: '#c4c7cb', material: 'metal' }, { id: 'slate', name: 'Slate', hex: '#3f4549', material: 'metal' }] },
      { kind: 'range', variant: 'induction', category: 'appliances', name: 'Wren 30″ Induction Range', sku: 'KF-I30', widthIn: 30, depthIn: 28, heightIn: 36, price: 2799, color: [40, 42, 46], accent: [12, 12, 14], finishes: [{ id: 'black', name: 'Black glass', hex: '#25272b', material: 'glass' }] },
      { kind: 'dishwasher', category: 'appliances', name: 'Quietwing 24″ Dishwasher', sku: 'KF-DW24', widthIn: 24, depthIn: 24, heightIn: 34.5, price: 1149, color: [200, 203, 207], accent: [80, 80, 84], finishes: [{ id: 'steel', name: 'Brushed steel', hex: '#c8cbcf', material: 'metal' }] },
      { kind: 'hood', variant: 'chimney', category: 'appliances', name: 'Kite 30″ Chimney Hood', sku: 'KF-H30', widthIn: 30, depthIn: 20, heightIn: 18, elevationIn: 66, price: 899, color: [190, 193, 197], accent: [60, 60, 64], finishes: [{ id: 'steel', name: 'Brushed steel', hex: '#bec1c5', material: 'metal' }] },
    ],
  },
  {
    name: 'Marlow Lighting Co. (Demo)',
    tagline: 'Pendants for islands and breakfast nooks (a fictional demo brand)',
    about: 'A made-up lighting studio used to demonstrate brand products in BluModel Studio. Nothing here is for sale.',
    products: [
      { kind: 'pendant', variant: 'dome', category: 'lighting', name: 'Tidewater Dome Pendant', sku: 'ML-DOME14', widthIn: 14, depthIn: 14, heightIn: 10, elevationIn: 68, price: 289, color: [52, 74, 70], accent: [30, 30, 30], finishes: [{ id: 'sea', name: 'Sea green', hex: '#344a46', material: 'metal' }, { id: 'brass', name: 'Aged brass', hex: '#b08d57', material: 'metal' }] },
      { kind: 'pendant', variant: 'globe', category: 'lighting', name: 'Harbour Glass Globe', sku: 'ML-GLB12', widthIn: 12, depthIn: 12, heightIn: 12, elevationIn: 66, price: 239, color: [214, 222, 224], accent: [150, 150, 150], finishes: [{ id: 'clear', name: 'Clear glass', hex: '#dfe6e8', material: 'glass' }] },
      { kind: 'pendant', variant: 'linear', category: 'lighting', name: 'Longshore Linear Chandelier', sku: 'ML-LIN48', widthIn: 48, depthIn: 6, heightIn: 5, elevationIn: 70, price: 649, color: [40, 40, 40], accent: [20, 20, 20], finishes: [{ id: 'black', name: 'Matte black', hex: '#2a2a2a', material: 'metal' }] },
    ],
  },
];

function seedPartners(ctx) {
  const { db, services, now } = ctx;
  for (const b of PARTNERS) {
    let row = db.prepare('SELECT id FROM brands WHERE name = ?').get(b.name);
    const t = now();
    if (!row) {
      const id = randomId('b_');
      db.prepare(
        `INSERT INTO brands (id, slug, name, tagline, description, website, status, status_note, verified_at, is_demo, created_by, created_at, updated_at, kind, live_at, lead_form)
         VALUES (?, ?, ?, ?, ?, '', 'active', '', ?, 1, NULL, ?, ?, 'partner', ?, 0)`,
      ).run(id, services.brands.uniqueSlug(b.name), b.name, b.tagline, b.about, t, t, t, t);
      row = { id };
    }
    for (const p of b.products) {
      if (db.prepare("SELECT 1 FROM products WHERE brand_id = ? AND json_extract(spec, '$.sku') = ?").get(row.id, p.sku)) continue;
      const m = media(services, { ...p, visibility: 'public', brandId: row.id, name: p.sku });
      const spec = {
        kind: p.kind,
        ...(p.variant ? { variant: p.variant } : {}),
        category: p.category,
        name: p.name,
        blurb: `${p.name}. A fictional demo product.`,
        sku: p.sku,
        widthIn: p.widthIn,
        depthIn: p.depthIn,
        heightIn: p.heightIn,
        elevationIn: p.elevationIn ?? 0,
        price: p.price,
        finishes: p.finishes,
        ...m,
      };
      const created = services.products.create({ source: 'brand', brandId: row.id, visibility: 'public', spec, status: 'draft' });
      services.products.publish(created.id);
    }
  }
}

// ── the demo contractor ──────────────────────────────────────────────────────

const PAINT = [
  { id: 'dove', name: 'Dove White', hex: '#efece4', material: 'paint' },
  { id: 'sage', name: 'Sage', hex: '#9fae98', material: 'paint' },
  { id: 'ink', name: 'Ink Blue', hex: '#2f3e52', material: 'paint' },
];
const OAK = [{ id: 'oak', name: 'Natural Oak', hex: '#c8a77a', material: 'wood' }];

const OWN = [
  { key: 'base', line: 'Alder Shaker', doorStyle: 'shaker', kind: 'base', variant: 'door-drawer', name: 'Shaker Base Cabinet', sku: 'AS-B{w}', widthIn: 24, depthIn: 24, heightIn: 34.5, widthOptions: [12, 15, 18, 21, 24, 30, 36], list: 520, costCents: 31000, finishes: PAINT, color: [239, 236, 228] },
  { key: 'drawers', line: 'Alder Shaker', doorStyle: 'shaker', kind: 'base', variant: 'drawers', name: 'Shaker Three-Drawer Base', sku: 'AS-DB{w}', widthIn: 30, depthIn: 24, heightIn: 34.5, widthOptions: [18, 24, 30, 36], list: 690, costCents: 41500, finishes: PAINT, color: [159, 174, 152] },
  { key: 'wall', line: 'Alder Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'door', name: 'Shaker Wall Cabinet 30″', sku: 'AS-W{w}30', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30, 36], list: 410, costCents: 24000, finishes: PAINT, color: [239, 236, 228] },
  { key: 'pantry', line: 'Alder Shaker', doorStyle: 'shaker', kind: 'tall', variant: 'pantry', name: 'Shaker Tall Pantry', sku: 'AS-P{w}84', widthIn: 24, depthIn: 24, heightIn: 84, widthOptions: [18, 24, 30], list: 1380, costCents: 82000, finishes: PAINT, color: [47, 62, 82] },
  { key: 'slab-base', line: 'Pine Street Slab', doorStyle: 'slab', kind: 'base', variant: 'door-drawer', name: 'Slab Base Cabinet', sku: 'PS-B{w}', widthIn: 24, depthIn: 24, heightIn: 34.5, widthOptions: [15, 18, 24, 30, 36], list: 470, costCents: 27500, finishes: OAK, color: [200, 167, 122] },
  { key: 'slab-wall', line: 'Pine Street Slab', doorStyle: 'slab', kind: 'wall', variant: 'door', name: 'Slab Wall Cabinet', sku: 'PS-W{w}', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30], list: 360, costCents: 21000, finishes: OAK, color: [200, 167, 122] },
  { key: 'island', line: 'Pine Street Slab', doorStyle: 'slab', kind: 'island', name: 'Slab Island 7 ft', sku: 'PS-I84', widthIn: 84, depthIn: 42, heightIn: 36, list: 3900, costCents: 236000, finishes: OAK, color: [200, 167, 122] },
  // Not ready yet (no photo or model, no cost): shows the readiness checklist and "Publish whole line".
  { key: 'shelf', line: 'Alder Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'door', name: 'Shaker Open Wall Shelf', sku: 'AS-OS{w}', widthIn: 30, depthIn: 12, heightIn: 15, elevationIn: 54, widthOptions: [24, 30, 36], list: 0, costCents: null, finishes: PAINT, color: [239, 236, 228], draft: true },
];

const LEADS = [
  { name: 'Priya Natarajan (Demo)', email: 'priya.demo@example.test', phone: '555-0131', location: 'Westdale, L8S', message: 'We are redoing a galley kitchen this spring. Could you quote the shaker base and wall cabinets in Sage?', product: 'base', status: 'new', daysAgo: 0 },
  { name: 'Marcus Leblanc (Demo)', email: 'marcus.demo@example.test', phone: '', location: 'Dundas', message: 'Do you install as well, or supply only? Interested in the slab wall cabinets.', product: 'slab-wall', status: 'new', daysAgo: 1 },
  { name: 'Hannah & Theo (Demo)', email: 'hannah.demo@example.test', phone: '555-0177', location: 'Burlington L7R', message: 'Island in natural oak, about 7 ft. What lead time are you seeing?', product: 'island', status: 'contacted', notes: 'Called back Tuesday. Visiting the showroom Saturday.', daysAgo: 4 },
  { name: 'Grace Okafor (Demo)', email: 'grace.demo@example.test', phone: '555-0110', location: 'Ancaster', message: 'Full kitchen, L-shape, painted Dove White.', product: null, status: 'won', notes: 'Signed. Install booked for the 14th.', daysAgo: 11 },
  { name: 'Ben Whitlock (Demo)', email: 'ben.demo@example.test', phone: '', location: 'Stoney Creek', message: 'Just pricing out options for now.', product: 'slab-base', status: 'lost', notes: 'Went with another supplier.', daysAgo: 19 },
];

/** A deterministic pseudo-random sequence so the demo analytics look the same every seed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function seedContractor(ctx, pages) {
  const { db, services, now } = ctx;
  const userId = await ensureUser(ctx, { email: 'demo-brand@blumodel.test', name: 'Demo Contractor' });
  ensureContractorPlan(ctx, userId);
  ensureProfile(ctx, userId, {
    company: 'Alder & Pine Cabinetry (Demo)',
    phone: '555-0142',
    email: 'hello@alderpine.test',
    website: 'https://alderpine.test',
    serviceArea: 'Hamilton, Dundas and Burlington',
    markup: 35,
    tax: 13,
  });

  // My catalog, with costs in the price book.
  const ids = {};
  for (const p of OWN) {
    const existing = db.prepare("SELECT id FROM products WHERE source = 'contractor' AND owner_user_id = ? AND json_extract(spec, '$.sku') = ?").get(userId, p.sku);
    if (existing) {
      ids[p.key] = existing.id;
      continue;
    }
    const m = p.draft ? {} : media(services, { ...p, visibility: 'private', ownerUserId: userId, name: p.sku.replace('{w}', '') });
    const spec = {
      kind: p.kind,
      ...(p.variant ? { variant: p.variant } : {}),
      category: 'cabinets',
      name: p.name,
      blurb: `${p.line}: built to order in our shop. ${p.doorStyle === 'shaker' ? 'Solid maple face frame, five-piece doors.' : 'Rift-cut oak veneer slab doors.'}`,
      sku: p.sku,
      widthIn: p.widthIn,
      depthIn: p.depthIn,
      heightIn: p.heightIn,
      elevationIn: p.elevationIn ?? 0,
      ...(p.widthOptions ? { widthOptions: p.widthOptions } : {}),
      price: p.list,
      finishes: p.finishes,
      line: p.line,
      doorStyle: p.doorStyle,
      ...m,
    };
    const created = services.products.create({ source: 'contractor', ownerUserId: userId, visibility: 'private', spec, status: 'draft' });
    services.products.publish(created.id);
    if (p.costCents != null)
      db.prepare(
        `INSERT INTO price_book (user_id, product_id, cost_cents, cost_by_width, markup_pct, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(user_id, product_id) DO NOTHING`,
      ).run(userId, created.id, p.costCents, now());
    ids[p.key] = created.id;
  }

  if (pages.ofOwner(userId)) return userId;

  // The brand page: live and verified since 40 days ago.
  const t = now();
  const liveAt = t - 40 * DAY;
  const id = randomId('b_');
  const profile = db.prepare('SELECT * FROM contractor_profiles WHERE user_id = ?').get(userId);
  db.prepare(
    `INSERT INTO brands (id, slug, name, tagline, description, website, logo_file_id, status, status_note, verified_at, is_demo, created_by, created_at, updated_at,
                         kind, owner_user_id, cover_file_id, price_display, lead_form, show_phone, show_email, submitted_at, live_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '', ?, 1, ?, ?, ?, 'contractor', ?, NULL, 'from', 1, 1, 0, ?, ?)`,
  ).run(
    id,
    services.brands.uniqueSlug('Alder & Pine Cabinetry'),
    profile.company,
    'Custom shaker and slab cabinetry for the Hamilton area',
    'A fictional two-person shop used to demonstrate brand pages in BluModel Studio. Everything is built to order: face-frame shaker in paint-grade maple, and rift-oak slab. We measure, build and install.',
    profile.website,
    profile.logo_file_id ?? null,
    liveAt,
    userId,
    liveAt - 2 * DAY,
    t,
    userId,
    liveAt - DAY,
    liveAt,
  );
  db.prepare("INSERT OR IGNORE INTO brand_members (brand_id, user_id, member_role, created_at) VALUES (?, ?, 'owner', ?)").run(id, userId, t);
  pages.log('create', { brandId: id, by: userId });
  pages.log('approve', { brandId: id, note: 'Demo page.' });
  const brand = pages.get(id);

  // Publish: everything but the pantry goes live; the pantry waits in the queue; the shelf isn't ready.
  for (const p of OWN) {
    if (p.draft) continue;
    const source = services.products.get(ids[p.key]);
    const { copy } = pages.publish(brand, source, { by: userId });
    if (p.key !== 'pantry') pages.approveProduct(copy, {});
  }
  // A live product with an edit waiting for review (the moderation field diff).
  const wall = services.products.get(ids.wall);
  services.products.update(wall.id, { name: 'Shaker Wall Cabinet 30″ (Glass Option)', blurb: `${wall.spec.blurb} Glass-front doors on request.` }, { force: true });
  services.products.publish(wall.id);
  pages.syncListings(pages.get(brand.id));

  // Leads, spread over the last three weeks.
  for (const l of LEADS) {
    const listing = l.product ? pages.listingOf(ids[l.product]) : null;
    const copy = listing ? services.products.get(listing.product_id) : null;
    const leadId = pages.createLead(brand, { productId: copy?.id ?? null, productName: copy?.liveSpec?.name ?? '', name: l.name, email: l.email, phone: l.phone, location: l.location, message: l.message });
    const at = t - l.daysAgo * DAY - 3_600_000 * (2 + l.daysAgo);
    db.prepare('UPDATE leads SET status = ?, notes = ?, read_at = ?, created_at = ?, updated_at = ? WHERE id = ?').run(l.status, l.notes ?? '', l.status === 'new' ? null : at, at, at, leadId);
  }
  // createLead logged today's 'lead' events; they are re-logged below on the days the leads arrived.
  db.prepare("DELETE FROM brand_events WHERE brand_id = ? AND type = 'lead'").run(id);

  // 30 days of synthetic traffic (demo data).
  const rand = rng(424242);
  const copies = pages.listingsOf(id).map((x) => x.product_id);
  const be = db.prepare('INSERT INTO brand_events (brand_id, product_id, type, user_id, day, created_at) VALUES (?, ?, ?, NULL, ?, ?)');
  const pe = db.prepare('INSERT INTO product_events (product_id, brand_id, type, user_id, day, created_at) VALUES (?, ?, ?, NULL, ?, ?)');
  for (let d = 29; d >= 0; d--) {
    const at = t - d * DAY;
    const day = utcDay(at);
    const weekend = [0, 6].includes(new Date(at).getUTCDay());
    const views = Math.round(14 + rand() * 18 + (weekend ? 10 : 0) + (29 - d) * 0.4);
    for (let i = 0; i < views; i++) be.run(id, null, 'brand_view', day, at);
    for (const pid of copies) {
      const pv = Math.floor(rand() * 7);
      for (let i = 0; i < pv; i++) pe.run(pid, id, 'view', day, at);
      if (rand() < 0.35) pe.run(pid, id, 'add', day, at);
      if (rand() < 0.12) be.run(id, pid, 'quote_click', day, at);
    }
  }
  for (const l of LEADS) {
    const at = t - l.daysAgo * DAY;
    const listing = l.product ? pages.listingOf(ids[l.product]) : null;
    be.run(id, listing?.product_id ?? null, 'lead', utcDay(at), at);
  }
  return userId;
}

/** A second demo contractor whose page waits in the brand-page review queue. */
async function seedApplicant(ctx, pages) {
  const { db, services, now } = ctx;
  const userId = await ensureUser(ctx, { email: 'demo-applicant@blumodel.test', name: 'Demo Applicant', loginable: false });
  ensureContractorPlan(ctx, userId);
  ensureProfile(ctx, userId, {
    company: 'Birchwood Kitchen Studio (Demo)',
    phone: '555-0163',
    email: 'studio@birchwood.test',
    website: 'https://birchwood.test',
    serviceArea: 'Guelph and Kitchener',
  });
  if (pages.ofOwner(userId)) return;
  const t = now();
  const id = randomId('b_');
  db.prepare(
    `INSERT INTO brands (id, slug, name, tagline, description, website, status, status_note, verified_at, is_demo, created_by, created_at, updated_at,
                         kind, owner_user_id, price_display, lead_form, show_phone, show_email, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', '', NULL, 1, ?, ?, ?, 'contractor', ?, 'from', 1, 0, 0, ?)`,
  ).run(
    id,
    services.brands.uniqueSlug('Birchwood Kitchen Studio'),
    'Birchwood Kitchen Studio (Demo)',
    'Inset cabinetry and kitchen design in Guelph',
    'A fictional studio used to demonstrate the brand-page review queue.',
    'https://birchwood.test',
    userId,
    t - 2 * DAY,
    t,
    userId,
    t - 3_600_000 * 5,
  );
  db.prepare("INSERT OR IGNORE INTO brand_members (brand_id, user_id, member_role, created_at) VALUES (?, ?, 'owner', ?)").run(id, userId, t);
  pages.log('create', { brandId: id, by: userId });
  pages.log('submit', { brandId: id, by: userId });
}

/** @param {{ db: any, config: any, services: any, now?: () => number }} ctx */
export async function seed(ctx) {
  const now = ctx.now ?? Date.now;
  const c = { ...ctx, now };
  try {
    await loadKit(); // sell prices on the demo page use the editor's price math when it's built
  } catch {
    /* list prices instead */
  }
  const pages = createBrandPageService({ db: c.db, now, services: c.services, config: c.config, log: { warn() {} } });
  seedPartners(c);
  await seedContractor(c, pages);
  await seedApplicant(c, pages);
  const n = (sql) => c.db.prepare(sql).get().n;
  return {
    summary:
      `${n("SELECT COUNT(*) AS n FROM brands WHERE kind = 'partner' AND is_demo = 1")} demo partner brands, ` +
      `${n("SELECT COUNT(*) AS n FROM brands WHERE kind = 'contractor' AND is_demo = 1")} demo contractor pages, ${n('SELECT COUNT(*) AS n FROM leads')} leads`,
  };
}
