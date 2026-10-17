// The demo showroom (docs/SHOWROOM_PIVOT.md §9): slug 'demo', "Northline Kitchen & Bath (Demo)", a
// fictional company. The sales site links to it and Gabe uses it on calls.
//
//   - the tenant, live: a complimentary license (a year from today, renewed when it has ended) and a
//     complimentary monthly plan, plus $25 of render credits once
//   - branding (colours, welcome, featured lines) and contact details, all fictional (555 numbers)
//   - a curated catalog modelled on BluModel Basics (two cabinet lines with their finishes, sinks,
//     a range, a hood, a fridge, a dishwasher, pendants, stools), with generated thumbnails and no
//     store or "where to buy" links; fill the gaps (BluModel Basics) and bathrooms on
//   - with `people: true` (dev, QA, the demo server; never the admin command): an owner, a staff
//     member and a visitor on the showroom, two sample designs and three leads
//
// Idempotent: products are matched by SKU, people by email, designs by name. Used by
// server/seed/tenants.mjs and `node server/scripts/seed-demo-tenant.mjs`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from '../lib/synth.mjs';
import { hashPassword, verifyPassword } from '../auth/passwords.mjs';
import { utcDate } from '../billing/showroom.mjs';

export const DEMO_SLUG = 'demo';
export const DEMO_TENANT_ID = 't_demo';
export const DEMO_NAME = 'Northline Kitchen & Bath (Demo)';
export const DEMO_PEOPLE = Object.freeze([
  { key: 'owner', email: 'demo-owner@blumodel.test', name: 'Nora Lindqvist', role: 'owner' },
  { key: 'staff', email: 'demo-staff@blumodel.test', name: 'Theo Marchetti', role: 'staff' },
  { key: 'visitor', email: 'demo-visitor@blumodel.test', name: 'Riley Okafor', role: null },
]);

const SHAKER = [
  { id: 'chalk', name: 'Chalk White', hex: '#efede6', material: 'paint' },
  { id: 'sage', name: 'Northline Sage', hex: '#9aa892', material: 'paint' },
  { id: 'harbour', name: 'Harbour Navy', hex: '#2e3d55', material: 'paint' },
  { id: 'oak', name: 'Natural White Oak', hex: '#c8a77a', material: 'wood' },
];
const SLAB = [
  { id: 'rift-oak', name: 'Rift White Oak', hex: '#c9a979', material: 'wood' },
  { id: 'walnut', name: 'Smoked Walnut', hex: '#5f4330', material: 'wood' },
  { id: 'matte-black', name: 'Matte Black', hex: '#2a2a2b', material: 'paint' },
];
const STEEL = { id: 'steel', name: 'Brushed Stainless', hex: '#c3c6ca', material: 'metal' };

/** The curated range. `color` is the thumbnail's main colour. */
export const DEMO_PRODUCTS = Object.freeze([
  // Lakeshore Shaker: painted and oak five-piece doors.
  { sku: 'NL-LS-B{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'base', variant: 'door-drawer', category: 'cabinets', name: 'Lakeshore Base Cabinet', widthIn: 24, depthIn: 24, heightIn: 34.5, widthOptions: [12, 15, 18, 21, 24, 30, 36], price: 540, finishes: SHAKER, color: [239, 237, 230], shape: 'base', blurb: 'Drawer over doors, soft-close, dovetailed maple drawer box.' },
  { sku: 'NL-LS-DB{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'base', variant: 'drawers', category: 'cabinets', name: 'Lakeshore Three-Drawer Base', widthIn: 30, depthIn: 24, heightIn: 34.5, widthOptions: [18, 24, 30, 36], price: 720, finishes: SHAKER, color: [154, 168, 146], shape: 'base', blurb: 'Three deep drawers for pots, pans and plates.' },
  { sku: 'NL-LS-W{w}30', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'door', category: 'cabinets', name: 'Lakeshore Wall Cabinet 30″', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30, 36], price: 410, finishes: SHAKER, color: [239, 237, 230], shape: 'wall', blurb: 'Hung 18″ above the counter, adjustable shelves.' },
  { sku: 'NL-LS-WG{w}30', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'glass', category: 'cabinets', name: 'Lakeshore Glass Wall Cabinet', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [18, 24, 30, 36], price: 520, finishes: SHAKER, color: [46, 61, 85], shape: 'wall', blurb: 'Seeded glass doors and a lit interior.' },
  { sku: 'NL-LS-P{w}84', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'tall', variant: 'pantry', category: 'cabinets', name: 'Lakeshore Tall Pantry', widthIn: 24, depthIn: 24, heightIn: 84, widthOptions: [18, 24, 30], price: 1420, finishes: SHAKER, color: [46, 61, 85], shape: 'tall', blurb: 'Floor-to-crown storage with roll-out shelves.' },
  { sku: 'NL-LS-I{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'island', category: 'cabinets', name: 'Lakeshore Island', widthIn: 84, depthIn: 42, heightIn: 36, widthOptions: [72, 84, 96], price: 3650, finishes: SHAKER, color: [154, 168, 146], shape: 'island', blurb: 'Storage on the work side, seating overhang on the other.' },
  // Harbourfront Slab: flat veneer and lacquer doors.
  { sku: 'NL-HS-B{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'base', variant: 'door-drawer', category: 'cabinets', name: 'Harbourfront Base Cabinet', widthIn: 24, depthIn: 24, heightIn: 34.5, widthOptions: [15, 18, 24, 30, 36], price: 495, finishes: SLAB, color: [201, 169, 121], shape: 'base', blurb: 'Rift-cut oak veneer slab doors, integrated pulls.' },
  { sku: 'NL-HS-W{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'wall', variant: 'door', category: 'cabinets', name: 'Harbourfront Wall Cabinet', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30], price: 380, finishes: SLAB, color: [201, 169, 121], shape: 'wall', blurb: 'Handleless, push-to-open.' },
  { sku: 'NL-HS-P{w}84', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'tall', variant: 'pantry', category: 'cabinets', name: 'Harbourfront Tall Pantry', widthIn: 24, depthIn: 24, heightIn: 84, widthOptions: [18, 24, 30], price: 1380, finishes: SLAB, color: [95, 67, 48], shape: 'tall', blurb: 'Full-height doors with internal drawers.' },
  // Sinks.
  { sku: 'NL-SK-FS{w}', line: 'Northline Sinks', kind: 'sink', variant: 'farmhouse', category: 'sinks', name: 'Fireclay Apron-Front Sink Base', widthIn: 36, depthIn: 24, heightIn: 34.5, widthOptions: [30, 33, 36], price: 1890, finishes: [{ id: 'fireclay', name: 'White Fireclay', hex: '#f5f3ef', material: 'ceramic' }, { id: 'stone', name: 'Grey Stone', hex: '#8f9192', material: 'ceramic' }], color: [245, 243, 239], shape: 'base', blurb: 'A deep fireclay apron sink in a matching base.' },
  { sku: 'NL-SK-UM{w}', line: 'Northline Sinks', kind: 'sink', variant: 'undermount', category: 'sinks', name: 'Undermount Steel Sink Base', widthIn: 33, depthIn: 24, heightIn: 34.5, widthOptions: [30, 33, 36], price: 1150, finishes: [{ id: 'steel', name: 'Brushed Steel', hex: '#b9bcc0', material: 'metal' }, { id: 'graphite', name: 'Graphite', hex: '#3c3f43', material: 'metal' }], color: [185, 188, 192], shape: 'base', blurb: '16-gauge single bowl with a sound-deadened base.' },
  // Appliances.
  { sku: 'NL-AP-R36', line: 'Appliances', kind: 'range', variant: 'gas-6', category: 'appliances', name: 'Dual-Fuel Range 36″', widthIn: 36, depthIn: 28, heightIn: 36, price: 6290, finishes: [STEEL, { id: 'black', name: 'Black Stainless', hex: '#3a3b3d', material: 'metal' }], flags: { backguard: true }, color: [195, 198, 202], shape: 'range', blurb: 'Six sealed burners and a convection oven.' },
  { sku: 'NL-AP-H{w}', line: 'Appliances', kind: 'hood', variant: 'chimney', category: 'appliances', name: 'Chimney Hood', widthIn: 36, depthIn: 20, heightIn: 18, elevationIn: 66, widthOptions: [30, 36, 48], price: 1190, finishes: [STEEL], color: [190, 193, 197], shape: 'hood', blurb: '600 CFM, quiet, with a duct cover to the ceiling.' },
  { sku: 'NL-AP-F36', line: 'Appliances', kind: 'fridge', variant: 'french', category: 'appliances', name: 'French-Door Refrigerator 36″', widthIn: 36, depthIn: 30, heightIn: 70, price: 3890, finishes: [STEEL, { id: 'panel', name: 'Panel-Ready', hex: '#cfc8bb', material: 'panel' }], color: [196, 199, 203], shape: 'tall', blurb: 'Counter-depth with a bottom freezer drawer.' },
  { sku: 'NL-AP-DW24', line: 'Appliances', kind: 'dishwasher', category: 'appliances', name: 'Dishwasher 24″', widthIn: 24, depthIn: 24, heightIn: 34.5, price: 1090, finishes: [STEEL, { id: 'panel', name: 'Panel-Ready', hex: '#cfc8bb', material: 'panel' }], color: [200, 203, 207], shape: 'base', blurb: '42 dB, third rack, hidden controls.' },
  // Lighting.
  { sku: 'NL-LT-D14', line: 'Lighting', kind: 'pendant', variant: 'dome', category: 'lighting', name: 'Bay Dome Pendant', widthIn: 14, depthIn: 14, heightIn: 10, elevationIn: 68, price: 310, finishes: [{ id: 'black', name: 'Matte Black', hex: '#222222', material: 'metal' }, { id: 'brass', name: 'Aged Brass', hex: '#b08d57', material: 'metal' }], color: [40, 40, 40], shape: 'pendant', blurb: 'A spun-metal dome for islands.' },
  { sku: 'NL-LT-G12', line: 'Lighting', kind: 'pendant', variant: 'globe', category: 'lighting', name: 'Opal Globe Pendant', widthIn: 12, depthIn: 12, heightIn: 12, elevationIn: 66, price: 365, finishes: [{ id: 'opal', name: 'Opal + Brass', hex: '#f4efe6', material: 'glass' }], color: [236, 230, 218], shape: 'pendant', blurb: 'Hand-blown opal glass on a brass stem.' },
  // Seating.
  { sku: 'NL-ST-26', line: 'Seating', kind: 'stool', variant: 'counter', category: 'seating', name: 'Oak Counter Stool', widthIn: 17, depthIn: 17, heightIn: 26, price: 345, finishes: [{ id: 'oak', name: 'Natural Oak', hex: '#c49a6c', material: 'wood' }, { id: 'black', name: 'Black Oak', hex: '#2c2a28', material: 'wood' }], color: [196, 154, 108], shape: 'stool', blurb: 'Solid oak, 26″ seat for a 36″ counter.' },
  { sku: 'NL-ST-26B', line: 'Seating', kind: 'stool', variant: 'backed', category: 'seating', name: 'Upholstered Counter Stool', widthIn: 19, depthIn: 20, heightIn: 38, price: 469, finishes: [{ id: 'cognac', name: 'Cognac Leather', hex: '#8a5630', material: 'leather' }, { id: 'oat', name: 'Oat Linen', hex: '#d9cfbd', material: 'fabric' }], color: [138, 86, 48], shape: 'stool', blurb: 'A low back and a stitched leather seat.' },
]);

/** A 96 px product picture: a soft background and the product's front, to scale. */
function thumb({ widthIn, heightIn, color, shape }) {
  const S = 96;
  const w = Math.max(widthIn, 6);
  const h = Math.max(heightIn, 6);
  const scale = (S * 0.76) / Math.max(w, h);
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));
  const x0 = Math.round((S - pw) / 2);
  const y0 = shape === 'pendant' || shape === 'wall' || shape === 'hood' ? Math.round(S * 0.16) : S - 10 - ph;
  const accent = color.map((c) => Math.round(c * 0.55));
  return makePng({
    w: S,
    h: S,
    rgba: (x, y) => {
      const inside = x >= x0 && x < x0 + pw && y >= y0 && y < y0 + ph;
      if (shape === 'pendant' && x === Math.round(S / 2) && y < y0) return [70, 70, 70, 255];
      if (!inside) {
        const g = 245 - Math.round((y / S) * 14);
        return y > S - 10 ? [222, 216, 206, 255] : [g, g - 2, g - 5, 255];
      }
      const ex = Math.min(x - x0, x0 + pw - 1 - x);
      const ey = Math.min(y - y0, y0 + ph - 1 - y);
      if (ex < 1 || ey < 1) return [...accent, 255];
      if (['base', 'tall', 'wall', 'island'].includes(shape) && (x === x0 + Math.round(pw / 2) || (shape === 'base' && y === y0 + Math.round(ph * 0.22)))) return [...accent, 220];
      if (shape === 'range' && y < y0 + 5) return [...accent, 255];
      const shade = 1 - (ey / ph) * 0.12;
      return [Math.round(color[0] * shade), Math.round(color[1] * shade), Math.round(color[2] * shade), 255];
    },
  });
}

function logoPng() {
  // A navy roundel with a white "N"-ish chevron: recognisable at 32 px, fictional.
  return makePng({
    w: 128,
    h: 128,
    rgba: (x, y) => {
      const d = (x - 64) ** 2 + (y - 64) ** 2;
      if (d > 3900) return [255, 255, 255, 0];
      const inN = (x > 40 && x < 50 && y > 38 && y < 90) || (x > 78 && x < 88 && y > 38 && y < 90) || (Math.abs(y - 38 - (x - 45) * 1.2) < 7 && x > 44 && x < 84);
      return inN ? [250, 248, 243, 255] : [46, 61, 85, 255];
    },
  });
}

const BRANDING = {
  primaryColor: '#2e3d55',
  accentColor: '#9aa892',
  welcomeTitle: 'Design your new kitchen with Northline',
  welcomeText:
    'Plan your kitchen or bathroom in 3D with the cabinets, sinks and fixtures we actually sell and install. Save your design and send it to us: our designers will follow up with a quote.',
  featuredLines: ['Lakeshore Shaker', 'Harbourfront Slab', 'Northline Sinks'],
};
const CONTACT = {
  phone: '(519) 555-0142',
  email: 'hello@northline-demo.test',
  website: 'https://northline-demo.test/',
  address: '120 Quarry Road, Guelph, ON (a fictional demo address)',
  serviceArea: 'Guelph, Kitchener-Waterloo and Wellington County',
  hours: 'Tue-Fri 10-6, Sat 10-4',
};

/** The seed password (SEED_PASSWORD) or a generated one kept in seed-credentials.txt (never printed). */
function passwordFor(config, email) {
  if (config.SEED_PASSWORD) return { password: config.SEED_PASSWORD, source: 'env' };
  const password = crypto.randomBytes(12).toString('base64url');
  if (config.DB_PATH && config.DB_PATH !== ':memory:') {
    try {
      fs.appendFileSync(path.join(path.dirname(config.DB_PATH), 'seed-credentials.txt'), `${email} ${password}\n`, { mode: 0o600 });
    } catch {
      /* the account exists; reset its password from Admin > Users if needed */
    }
  }
  return { password, source: 'generated' };
}

/** A design along the back wall: a run of `ids` (product, width) and an island. */
function designDoc(name, run, extras = []) {
  let x = 4;
  const items = [];
  for (const [productId, widthIn, finishIndex = 0] of run) {
    items.push({ id: `it-${items.length + 1}`, productId, x: x + widthIn / 2, y: 12, rotation: 0, finishIndex, widthIn });
    x += widthIn;
  }
  for (const e of extras) items.push({ id: `it-${items.length + 1}`, rotation: 0, finishIndex: 0, ...e });
  return {
    name,
    room: { widthIn: 216, lengthIn: 168, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
    items,
  };
}

/**
 * Makes (or brings up to date) the demo showroom. `people` adds the demo accounts, designs and
 * leads. Returns { tenantId, created, products, people: { owner, staff, visitor } | null }.
 * @param {{ db: import('node:sqlite').DatabaseSync, services: any, config: any, now?: () => number }} ctx
 */
export async function seedDemoTenant({ db, services, config, now = Date.now }, { people = false } = {}) {
  const { tenants, showroomBilling, credits, products, files, leads } = services;
  let t = tenants.bySlug(DEMO_SLUG);
  let created = false;
  if (!t) {
    t = tenants.create({ id: DEMO_TENANT_ID, name: DEMO_NAME, slug: DEMO_SLUG, isDemo: true, contact: CONTACT, settings: { fillGaps: true, bathrooms: true, visitorRenders: false, dailyRenderCap: 0 } });
    created = true;
  }
  const tenantId = t.id;

  // Branding and its logo (made once).
  if (!t.branding.logoFileId) {
    const logo = files.saveBuffer(logoPng(), { kind: 'image', visibility: 'public', tenantId, originalName: 'northline-logo.png' });
    tenants.update(tenantId, { branding: { ...BRANDING, logoFileId: logo.id }, contact: CONTACT });
  }

  // Products, by SKU.
  const ids = {};
  let made = 0;
  for (const p of DEMO_PRODUCTS) {
    const found = db.prepare("SELECT id FROM products WHERE tenant_id = ? AND json_extract(spec, '$.sku') = ?").get(tenantId, p.sku);
    if (found) {
      ids[p.sku] = found.id;
      continue;
    }
    const img = files.saveBuffer(thumb(p), { kind: 'image', visibility: 'public', tenantId, originalName: `${p.sku.replace(/[^A-Za-z0-9-]/g, '')}.png` });
    const spec = {
      kind: p.kind,
      ...(p.variant ? { variant: p.variant } : {}),
      category: p.category,
      name: p.name,
      blurb: p.blurb,
      sku: p.sku,
      line: p.line,
      ...(p.doorStyle ? { doorStyle: p.doorStyle } : {}),
      widthIn: p.widthIn,
      depthIn: p.depthIn,
      heightIn: p.heightIn,
      elevationIn: p.elevationIn ?? 0,
      ...(p.widthOptions ? { widthOptions: p.widthOptions } : {}),
      price: p.price,
      finishes: p.finishes,
      imageFileIds: [img.id],
      ...(p.flags ? { flags: p.flags } : {}),
    };
    const row = products.create({ source: 'tenant', tenantId, visibility: 'public', spec });
    products.publish(row.id);
    ids[p.sku] = row.id;
    made++;
  }

  // Live: a complimentary license (renewed once it has ended) and monthly plan; credits once.
  if (!showroomBilling.currentLicense(tenantId)) showroomBilling.recordLicense(tenantId, { paidHow: 'comp', amountCents: 0, startsOn: utcDate(now()), note: 'The demo showroom' });
  if (!showroomBilling.monthlyPaid(tenantId)) showroomBilling.setComplimentary(tenantId, true, { note: 'The demo showroom' });
  if (!db.prepare('SELECT 1 FROM tenant_credit_entries WHERE tenant_id = ? LIMIT 1').get(tenantId)) credits.adjust(tenantId, 2500, { note: 'Demo render credits' });
  if (tenants.get(tenantId).status === 'setup') tenants.setStatus(tenantId, 'live');
  else tenants.refresh(tenantId);

  let accounts = null;
  if (people) {
    accounts = {};
    for (const p of DEMO_PEOPLE) {
      let row = db.prepare('SELECT id, password_hash FROM users WHERE email = ? AND tenant_id = ?').get(p.email, tenantId);
      const { password, source } = passwordFor(config, p.email);
      if (!row) {
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, p.email, p.name, await hashPassword(password), now(), tenantId);
        row = { id };
      } else if (source === 'env' && !(await verifyPassword(password, row.password_hash))) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), row.id);
      }
      if (p.role) tenants.addMember(tenantId, row.id, p.role);
      accounts[p.key] = row.id;
    }

    // Two sample designs by the visitor, and three leads (one with a design).
    const P = (sku) => ids[sku];
    const designs = [
      designDoc('Riley’s sage shaker kitchen', [
        [P('NL-LS-P{w}84'), 24, 1],
        [P('NL-AP-F36'), 36],
        [P('NL-LS-DB{w}'), 30, 1],
        [P('NL-AP-R36'), 36],
        [P('NL-LS-B{w}'), 24, 1],
        [P('NL-SK-FS{w}'), 36],
        [P('NL-AP-DW24'), 24],
      ], [
        { productId: P('NL-AP-H{w}'), x: 4 + 24 + 36 + 30 + 18, y: 10, widthIn: 36 },
        { productId: P('NL-LS-I{w}'), x: 108, y: 96, widthIn: 84, finishIndex: 2 },
        { productId: P('NL-LT-D14'), x: 88, y: 96, finishIndex: 1 },
        { productId: P('NL-LT-D14'), x: 128, y: 96, finishIndex: 1 },
        { productId: P('NL-ST-26'), x: 90, y: 128, rotation: 180 },
        { productId: P('NL-ST-26'), x: 126, y: 128, rotation: 180 },
      ]),
      designDoc('Harbourfront condo kitchen', [
        [P('NL-HS-P{w}84'), 24],
        [P('NL-HS-B{w}'), 30],
        [P('NL-SK-UM{w}'), 33],
        [P('NL-AP-DW24'), 24],
        [P('NL-HS-B{w}'), 24],
      ]),
    ];
    const t0 = now();
    const projectIds = [];
    for (const d of designs) {
      let pr = db.prepare('SELECT id FROM projects WHERE user_id = ? AND tenant_id = ? AND name = ?').get(accounts.visitor, tenantId, d.name);
      if (!pr) {
        const pid = crypto.randomUUID();
        db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)').run(pid, accounts.visitor, d.name, '', JSON.stringify(d), t0, t0, tenantId);
        pr = { id: pid };
      }
      projectIds.push(pr.id);
    }
    if (!db.prepare('SELECT 1 FROM showroom_leads WHERE tenant_id = ? LIMIT 1').get(tenantId)) {
      const tenant = tenants.get(tenantId);
      const first = leads.create(
        tenant,
        { name: 'Riley Okafor', email: 'demo-visitor@blumodel.test', phone: '(519) 555-0188', postalCode: 'N1H 3A1', budget: '$40,000 - $60,000', timeline: 'Next spring', notes: 'We love the sage colour. Can the island have seating for four?', consent: true, projectId: projectIds[0] },
        { userId: accounts.visitor },
      );
      leads.update(tenantId, first.id, { status: 'contacted', staffNotes: 'Called back; site measure booked.' });
      leads.create(tenant, { name: 'Morgan Lee', email: 'morgan.lee@example.test', phone: '(226) 555-0107', postalCode: 'N2L 3G1', budget: '$25,000 - $40,000', timeline: '3-6 months', notes: 'Condo kitchen, flat-front doors, lots of storage.', consent: true });
      const third = leads.create(tenant, { name: 'Sam Patel', email: 'sam.patel@example.test', postalCode: 'N1E 6K2', budget: 'Not sure yet', timeline: 'Just looking', notes: '', consent: true });
      leads.update(tenantId, third.id, { status: 'quoted', staffNotes: 'Quote #1042 sent.' });
    }
  }
  return { tenantId, created, products: { total: DEMO_PRODUCTS.length, made }, people: accounts, ids: { ...ids } };
}
