// Quick setup (Admin > Companies > Quick setup, docs/ONBOARDING_A_COMPANY.md "The quick path"): a
// company's showroom stood up in a minute, during or right after a sales call, so the prospect sees
// their OWN showroom live. The same flow is the real onboarding once they buy.
//
// One transaction makes: the tenant and its <slug>.<BASE_DOMAIN> address; its branding (logo,
// colours, a welcome) and contact details; optionally the starter catalog (the demo showroom's
// lines with neutral names, "<Company> Shaker", as the company's own products and files: nothing in
// them says Northline or Demo); and a status that makes it usable right away:
//   purpose 'trial'     status 'trial', live for TRIAL_DAYS, then it lapses to "temporarily
//                       unavailable" (nothing deleted). It never charges; TRIAL_CREDIT_CENTS of
//                       render credits once (0 by default).
//   purpose 'customer'  status 'setup', as for any new company (the license and monthly plan follow).

import { HttpError } from '../http/respond.mjs';
import { sniffImage } from '../lib/validators.mjs';
import { DEMO_PRODUCTS, specOf, thumb } from './demo.mjs';
import { RESERVED_SLUGS, SLUG_RE } from './service.mjs';

export const CATALOGS = Object.freeze(['demo', 'empty']);
export const PURPOSES = Object.freeze(['trial', 'customer']);
const LOGO_MAX_BYTES = 2 * 1_048_576;
const DAY_MS = 86_400_000;

/** The demo's line -> the word after the company's name ("Lakeshore Shaker" -> "<Company> Shaker"). */
const LINE_WORD = Object.freeze({
  'Lakeshore Shaker': 'Shaker',
  'Harbourfront Slab': 'Slab',
  'Northline Sinks': 'Sinks',
  'Chef’s Appliance Suite': 'Appliances',
  'Bay Lighting': 'Lighting',
  'Counter Seating': 'Seating',
  'Bayview Bath': 'Bath',
});
/** The lines the landing page features, in order (the demo's, seating aside). */
const FEATURED = ['Shaker', 'Slab', 'Sinks', 'Appliances', 'Lighting', 'Bath'];
/** Words in the demo's product and finish names that name the demo: replaced or dropped. */
const NAME_WORDS = [
  [/^Lakeshore\s+/, 'Shaker '],
  [/^Harbourfront\s+/, 'Slab '],
  [/^Bayview\s+/, ''],
  [/^Bay\s+/, ''],
];
const FINISH_NAMES = Object.freeze({ 'Northline Sage': 'Sage Green', 'Harbour Navy': 'Navy Blue' });

const LEGAL = /\s*(?:,?\s*(?:ltd|limited|inc|incorporated|corp|corporation|llc|co|company)\.?)$/i;
const TRADE = /\s+(?:&|and|\+)?\s*(?:kitchens?|baths?|bathrooms?|cabinets?|cabinetry|designs?|renovations?|showrooms?|interiors?|millwork|studio)$/i;

/**
 * The name a product line starts with: "Acme Kitchens & Bath Ltd." -> "Acme", "Maple Lane Kitchens"
 * -> "Maple Lane". Legal and trade words are dropped from the end; when nothing is left, the name.
 */
export function lineStem(companyName) {
  const full = String(companyName ?? '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  let s = full;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(LEGAL, '').replace(TRADE, '').replace(/[\s,&+-]+$/, '').trim();
    if (next === s) break;
    s = next;
  }
  if (s.length < 2) s = full;
  return s.slice(0, 40).trim() || 'Showroom';
}

/** "Acme Kitchens" + "acme-kitchens" -> "ACM": the starter catalog's SKU prefix. */
function skuPrefix(slug) {
  const letters = String(slug ?? '').replace(/[^a-z0-9]/g, '').toUpperCase();
  return (letters.slice(0, 3) || 'SHW').padEnd(3, 'X');
}

/**
 * The starter catalog for a company: every demo product as the company's own, renamed. Specs only
 * (no files): `{ spec, art }` where `art` is what the thumbnail is drawn from.
 */
export function starterCatalog(companyName, slug) {
  const stem = lineStem(companyName);
  const prefix = skuPrefix(slug);
  return DEMO_PRODUCTS.map((p) => {
    const spec = specOf(p);
    const word = LINE_WORD[p.line] ?? p.line;
    let name = spec.name;
    for (const [re, to] of NAME_WORDS) name = name.replace(re, to);
    return {
      spec: {
        ...spec,
        name: name.trim(),
        line: `${stem} ${word}`.slice(0, 60),
        sku: spec.sku.replace(/^NL-/, `${prefix}-`),
        finishes: spec.finishes.map((f) => ({ ...f, name: FINISH_NAMES[f.name] ?? f.name })),
      },
      art: p,
    };
  });
}

/** The lines a starter catalog's landing page features. */
export function starterFeatured(companyName) {
  const stem = lineStem(companyName);
  return FEATURED.map((w) => `${stem} ${w}`.slice(0, 60));
}

/** A logo sent as base64 (or a data: URL): PNG, JPEG or WebP, 2 MB and 4096 px at most. */
export function decodeLogo(input) {
  if (input === undefined || input === null || input === '') return null;
  const raw = typeof input === 'object' ? input.data : input;
  if (typeof raw !== 'string') throw bad('logo', 'Upload the logo as a PNG, JPEG or WebP picture.');
  const b64 = raw.replace(/^data:image\/[a-z+.-]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw bad('logo', 'Upload the logo as a PNG, JPEG or WebP picture.');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw bad('logo', 'Upload the logo as a PNG, JPEG or WebP picture.');
  if (buf.length > LOGO_MAX_BYTES) throw bad('logo', 'The logo can be at most 2 MB.');
  const info = sniffImage(buf);
  if (!info) throw bad('logo', 'Upload the logo as a PNG, JPEG or WebP picture.');
  if (info.width < 16 || info.height < 16 || info.width > 4096 || info.height > 4096) throw bad('logo', 'The logo should be between 16 and 4096 pixels on each side.');
  return { buf, ext: info.ext };
}

const bad = (field, message) => new HttpError(400, message, { errors: [{ field, message }] });

/**
 * Whether `slug` can be a new showroom's address: { slug, available, problem, suggestion }.
 * `problem` is 'invalid' | 'reserved' | 'taken' | null; `suggestion` a free address near it.
 */
export function slugCheck(tenants, { slug, name }) {
  const s = String(slug ?? '').trim().toLowerCase();
  const suggestion = tenants.uniqueSlug(s || name || 'showroom');
  if (!s) return { slug: suggestion, available: true, problem: null, suggestion };
  if (!SLUG_RE.test(s)) return { slug: s, available: false, problem: 'invalid', suggestion };
  if (RESERVED_SLUGS.has(s)) return { slug: s, available: false, problem: 'reserved', suggestion };
  if (tenants.slugInUse(s)) return { slug: s, available: false, problem: 'taken', suggestion };
  return { slug: s, available: true, problem: null, suggestion: s };
}

/**
 * Makes the whole showroom. Synchronous: the caller wraps it in ctx.tx, so a failure leaves nothing
 * (but bytes already written for a logo or a thumbnail, which nothing points at).
 * @param {{ services: any, config: any, now: () => number }} ctx
 * @param {any} input  { name, slug?, logo?, branding?: { primaryColor?, accentColor? }, contact?, catalog, purpose }
 * @param {{ by: string | null }} who
 * @returns {{ tenant: any, products: number, trialEndsAt: number | null, creditsCents: number }}
 */
export function quickSetup({ services, config, now }, input, { by = null } = {}) {
  const { tenants, products, files, credits } = services;
  const b = input && typeof input === 'object' ? input : {};
  const catalog = b.catalog ?? 'demo';
  const purpose = b.purpose ?? 'trial';
  if (!CATALOGS.includes(catalog)) throw bad('catalog', 'Choose the demo range or an empty catalog.');
  if (!PURPOSES.includes(purpose)) throw bad('purpose', 'Choose a prospect trial or a paying customer.');
  const logo = decodeLogo(b.logo);
  const brand = b.branding && typeof b.branding === 'object' ? b.branding : {};
  const contact = b.contact && typeof b.contact === 'object' ? b.contact : {};

  const trialEndsAt = purpose === 'trial' ? now() + config.TRIAL_DAYS * DAY_MS : null;
  // The name decides the stem of every line; tenants.create cleans and checks it (and the slug).
  const t = tenants.create({
    name: b.name,
    slug: b.slug,
    status: purpose === 'trial' ? 'trial' : 'setup',
    trialEndsAt,
    contact: { website: contact.website, serviceArea: contact.serviceArea, phone: contact.phone, email: contact.email },
    // Without their range yet, visitors can still finish a kitchen with BluModel Basics.
    settings: { fillGaps: true, bathrooms: catalog === 'demo' },
    createdBy: by,
  });

  const short = lineStem(t.name);
  const branding = {
    primaryColor: brand.primaryColor || undefined,
    accentColor: brand.accentColor || undefined,
    welcomeTitle: `Design your new kitchen with ${short}`,
    welcomeText: `Plan your kitchen or bathroom in 3D with the products ${t.name} sells and installs. Save your design and send it to us: we’ll follow up with ideas and a quote.`,
    ...(catalog === 'demo' ? { featuredLines: starterFeatured(t.name) } : {}),
  };
  if (logo) branding.logoFileId = files.saveBuffer(logo.buf, { kind: 'image', visibility: 'public', tenantId: t.id, originalName: `logo.${logo.ext}` }).id;
  tenants.update(t.id, { branding });

  let made = 0;
  if (catalog === 'demo') {
    for (const { spec, art } of starterCatalog(t.name, t.slug)) {
      const img = files.saveBuffer(thumb(art), { kind: 'image', visibility: 'public', tenantId: t.id, originalName: `${spec.sku.replace(/[^A-Za-z0-9-]/g, '')}.png` });
      const row = products.create({ source: 'tenant', tenantId: t.id, visibility: 'public', spec: { ...spec, imageFileIds: [img.id] } });
      products.publish(row.id);
      made++;
    }
  }

  let creditsCents = 0;
  if (purpose === 'trial' && config.TRIAL_CREDIT_CENTS > 0) {
    credits.adjust(t.id, config.TRIAL_CREDIT_CENTS, { note: 'Trial render credits', by });
    creditsCents = config.TRIAL_CREDIT_CENTS;
  }
  return { tenant: tenants.refresh(t.id), products: made, trialEndsAt, creditsCents };
}
