// Strict validation of a saved kitchen (DesignDoc). Normalises the document, strips
// unknown keys, and rejects junk (negative widths, non-finite positions, unknown
// product id shapes) instead of storing it. Mirrors src/types.ts.

import { BUILTIN_ID_RE, PRODUCT_ID_RE } from './ids.mjs';

export const LIMITS = Object.freeze({
  items: 400,
  products: 100,
  productBytes: 8 * 1024,
  coord: 2000,
  room: { widthIn: [72, 1200], lengthIn: [72, 1200], ceilingIn: [90, 144] },
  /** Drawn rooms: corners per outline, extra rooms per plan (src/lib/outline.ts). */
  outlinePoints: 64,
  extraRooms: 8,
  /** Extra estimate lines (installation, delivery…): count, label length, amount in USD. */
  extras: 50,
  extraLabel: 80,
  extraAmount: 10_000_000,
  /** Preferred brands from the setup wizard: names per category, name length. */
  brandsPerCategory: 20,
  brandName: 80,
});

/** The categories a kitchen can name preferred brands for (src/lib/generate/brands.ts). */
const BRAND_CATEGORIES = ['cabinets', 'appliances', 'sinks', 'lighting'];

const ROTATIONS = new Set([0, 90, 180, 270]);
const DOOR_STYLES = new Set(['shaker', 'slab', 'fluted']);
const SURFACE_KEYS = ['cabinetFinishId', 'doorStyle', 'hardwareId', 'faucetId', 'countertopId', 'backsplashId', 'flooringId', 'paintId', 'crown'];
const CROWNS = new Set(['none', 'flat', 'cove']);

/** A retail faucet, pull or knob id (src/lib/fixtures.ts FIXTURE_ID_RE). */
const FIXTURE_ID_RE = /^r-[a-z0-9][a-z0-9-]{0,38}$/;
const FIXTURE_KINDS = new Set(['faucet', 'pull', 'knob']);
const FIXTURE_STYLES = new Set(['pulldown', 'pullout', 'single', 'side-spray', 'spring', 'bar', 'arch', 'rect', 'finger', 'mushroom', 'disc']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * The snapshot of a retail faucet, pull or knob a kitchen uses (`doc.fixtures`, see `Fixture` in
 * src/types.ts; cleanFixture in src/lib/fixtures.ts keeps the same rules). Known fields only, or
 * null when it isn't one; the kitchen then draws the default hardware.
 */
function cleanFixture(f, id) {
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
  if (!isObj(f) || !FIXTURE_ID_RE.test(id) || f.id !== id || !FIXTURE_KINDS.has(f.kind) || !FIXTURE_STYLES.has(f.style)) return null;
  if (!str(f.brand, 80) || !str(f.name, 120) || typeof f.code !== 'string' || f.code.length > 60) return null;
  const fin = f.finish;
  if (!isObj(fin) || !str(fin.id, 40) || !str(fin.name, 60) || !HEX_RE.test(fin.hex ?? '')) return null;
  if (!inRange(f.roughness, 0, 1) || !inRange(f.price, 0, 100_000)) return null;
  const sizeIn = {};
  for (const k of ['length', 'cc', 'dia', 'height']) if (isObj(f.sizeIn) && inRange(f.sizeIn[k], 0.2, 40)) sizeIn[k] = f.sizeIn[k];
  const extras = {};
  if (isObj(f.extras) && f.extras.soap === true) extras.soap = true;
  if (isObj(f.extras) && f.extras.sideSpray === true) extras.sideSpray = true;
  return {
    id,
    kind: f.kind,
    style: f.style,
    brand: f.brand,
    name: f.name,
    code: f.code,
    finish: { id: fin.id, name: fin.name, hex: fin.hex.toLowerCase() },
    roughness: f.roughness,
    sizeIn,
    price: Math.round(f.price * 100) / 100,
    priceKnown: f.priceKnown === true,
    ...(Object.keys(extras).length ? { extras } : {}),
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export const isProductId = (id) => typeof id === 'string' && (BUILTIN_ID_RE.test(id) || PRODUCT_ID_RE.test(id));

class DocError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}
const bad = (field, message) => {
  throw new DocError(field, message);
};

/** Same-origin path only (no scheme, no protocol-relative `//`). */
const localPath = (v) => typeof v === 'string' && v.length <= 600 && v.startsWith('/') && !v.startsWith('//') && !/[\s\\]/.test(v);
const httpsLink = (v) => {
  if (typeof v !== 'string' || v.length > 500) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * A product snapshot embedded in the doc is the client's copy; the server keeps it
 * but drops any link a shared page could turn into script or a third-party request.
 */
function cleanSnapshot(p, key) {
  if (!isObj(p)) bad(`products.${key}`, 'A saved product is not valid.');
  const s = { ...p };
  for (const k of ['buyUrl', 'specSheetUrl']) if (s[k] !== undefined && !httpsLink(s[k])) delete s[k];
  if (s.thumbnailUrl !== undefined && !localPath(s.thumbnailUrl)) delete s.thumbnailUrl;
  if (Array.isArray(s.images)) s.images = s.images.filter((im) => isObj(im) && localPath(im.url));
  else delete s.images;
  if (s.model !== undefined && !(isObj(s.model) && localPath(s.model.url))) delete s.model;
  if (Array.isArray(s.finishes)) s.finishes = s.finishes.map((f) => (isObj(f) && f.swatchUrl !== undefined && !localPath(f.swatchUrl) ? { ...f, swatchUrl: undefined } : f));
  if (JSON.stringify(s).length > LIMITS.productBytes) bad(`products.${key}`, 'A saved product is too large.');
  return s;
}

function normalizeItem(it, i) {
  const at = `items[${i}]`;
  if (!isObj(it)) bad(at, 'A placed item is not valid.');
  if (typeof it.id !== 'string' || !it.id || it.id.length > 64) bad(`${at}.id`, 'A placed item has no id.');
  if (!isProductId(it.productId)) bad(`${at}.productId`, 'A placed item has an invalid product id.');
  if (!isNum(it.x) || !isNum(it.y) || Math.abs(it.x) > LIMITS.coord || Math.abs(it.y) > LIMITS.coord) bad(`${at}.x`, 'A placed item is outside the room.');
  if (!ROTATIONS.has(it.rotation)) bad(`${at}.rotation`, 'A placed item has an invalid rotation.');
  const finishIndex = it.finishIndex === undefined ? 0 : it.finishIndex;
  if (!Number.isInteger(finishIndex) || finishIndex < 0 || finishIndex > 1000) bad(`${at}.finishIndex`, 'A placed item has an invalid finish.');
  const out = { id: it.id, productId: it.productId, x: it.x, y: it.y, rotation: it.rotation, finishIndex };
  if (it.finishId !== undefined && it.finishId !== null) {
    if (typeof it.finishId !== 'string' || it.finishId.length > 64) bad(`${at}.finishId`, 'A placed item has an invalid finish.');
    out.finishId = it.finishId;
  }
  if (it.widthIn !== undefined && it.widthIn !== null) {
    if (!isNum(it.widthIn) || it.widthIn < 1 || it.widthIn > 240) bad(`${at}.widthIn`, 'A placed item has an invalid width.');
    out.widthIn = it.widthIn;
  }
  if (it.mirrored !== undefined && it.mirrored !== null) {
    if (typeof it.mirrored !== 'boolean') bad(`${at}.mirrored`, 'A placed item has an invalid hinge side.');
    out.mirrored = it.mirrored;
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Extra estimate lines: `{ id, label, amount, cost? }`. `amount` is what the client pays;
 * `cost` is the contractor's private number and is stripped before any share or export.
 */
function normalizeExtra(x, i) {
  const at = `extras[${i}]`;
  if (!isObj(x)) bad(at, 'An extra estimate line is not valid.');
  if (typeof x.id !== 'string' || !x.id || x.id.length > 64) bad(`${at}.id`, 'An extra estimate line has no id.');
  const label = typeof x.label === 'string' ? x.label.trim() : '';
  if (!label || label.length > LIMITS.extraLabel) bad(`${at}.label`, `Name each extra line (${LIMITS.extraLabel} characters or fewer).`);
  if (!isNum(x.amount) || x.amount < 0 || x.amount > LIMITS.extraAmount) bad(`${at}.amount`, 'An extra line’s amount must be between $0 and $10,000,000.');
  const out = { id: x.id, label, amount: round2(x.amount) };
  if (x.cost !== undefined && x.cost !== null) {
    if (!isNum(x.cost) || x.cost < 0 || x.cost > LIMITS.extraAmount) bad(`${at}.cost`, 'An extra line’s cost must be between $0 and $10,000,000.');
    out.cost = round2(x.cost);
  }
  return out;
}

/**
 * The brands chosen in the setup wizard, as `cleanBrandPrefs` (src/lib/generate/brands.ts) keeps
 * them: known categories only, trimmed names, no repeats (ignoring case), at most 20 a category.
 * Null when nothing is left. Anything but an object of string lists is refused.
 */
function normalizeBrandPrefs(raw) {
  if (!isObj(raw)) bad('brandPrefs', 'Preferred brands are not valid.');
  const out = {};
  for (const cat of BRAND_CATEGORIES) {
    const list = raw[cat];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list) || list.length > 100) bad(`brandPrefs.${cat}`, 'Preferred brands are not valid.');
    const seen = new Set();
    const names = [];
    for (const v of list) {
      if (typeof v !== 'string') bad(`brandPrefs.${cat}`, 'Preferred brands are not valid.');
      const name = v.replace(/\s+/g, ' ').trim();
      const key = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (!name || name.length > LIMITS.brandName || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length >= LIMITS.brandsPerCategory) break;
    }
    if (names.length) out[cat] = names;
  }
  return Object.keys(out).length ? out : null;
}

const EDGE_STYLES = new Set(['wall', 'half', 'bar', 'rail', 'glass', 'beam', 'open']);

/**
 * A drawn outline: 4..64 corners, every wall straight across or straight up and down (no diagonals),
 * none shorter than a foot, within the plan limits. Anything else is dropped, so the room falls back
 * to its rectangle rather than the save failing. The editor does the full crossing check; this keeps
 * junk and oversized input out of storage. `styles` (what stands along each edge) is kept only when
 * there is exactly one known value per corner.
 */
function cleanOutline(raw) {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > LIMITS.outlinePoints) return null;
  const pts = [];
  for (const q of raw) {
    if (!Array.isArray(q) || !isNum(q[0]) || !isNum(q[1]) || Math.abs(q[0]) > 2400 || Math.abs(q[1]) > 2400) return null;
    pts.push([Math.round(q[0] * 4) / 4, Math.round(q[1] * 4) / 4]);
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a[0] !== b[0] && a[1] !== b[1]) return null;
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 12) return null;
  }
  return pts;
}

function cleanStyles(raw, n, fallback) {
  if (!Array.isArray(raw) || raw.length !== n || !raw.every((v) => typeof v === 'string' && EDGE_STYLES.has(v))) return null;
  return raw.some((v) => v !== fallback) ? raw : null;
}

function cleanShape(r) {
  const out = {};
  const main = cleanOutline(r.outline);
  if (main) out.outline = main;
  const mainStyles = cleanStyles(r.styles, main ? main.length : 4, 'wall');
  if (mainStyles && (main || !r.outline)) out.styles = mainStyles;
  if (Array.isArray(r.extra)) {
    const extra = [];
    for (const e of r.extra) {
      if (extra.length >= LIMITS.extraRooms) break;
      const outline = isObj(e) ? cleanOutline(e.outline) : null;
      if (!outline) continue;
      const zone = e.kind === 'zone';
      const styles = cleanStyles(e.styles, outline.length, zone ? 'open' : 'wall');
      extra.push({
        id: typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(e.id) ? e.id : `r${extra.length + 1}`,
        name: typeof e.name === 'string' ? e.name.slice(0, 40) : 'Room',
        outline,
        ...(zone ? { kind: 'zone' } : {}),
        ...(styles ? { styles } : {}),
        ...(isNum(e.ceilingIn) ? { ceilingIn: clamp(e.ceilingIn, LIMITS.room.ceilingIn) } : {}),
        // An added room's own floor (a flooring id; the app falls back to the kitchen's for one it doesn't know).
        ...(!zone && typeof e.flooringId === 'string' && /^[a-z0-9-]{1,40}$/.test(e.flooringId) ? { flooringId: e.flooringId } : {}),
      });
    }
    if (extra.length) out.extra = extra;
  }
  return out;
}

/**
 * Validates and normalises a DesignDoc. Returns `{ ok: true, doc }` or
 * `{ ok: false, field, message }`. `name` is set by the caller.
 */
export function normalizeDoc(doc) {
  try {
    if (!isObj(doc)) bad('doc', 'That is not a kitchen design.');
    const r = doc.room;
    if (!isObj(r) || !isNum(r.widthIn) || !isNum(r.lengthIn) || !isNum(r.ceilingIn)) bad('room', 'That is not a kitchen design.');
    const room = {
      widthIn: clamp(r.widthIn, LIMITS.room.widthIn),
      lengthIn: clamp(r.lengthIn, LIMITS.room.lengthIn),
      ceilingIn: clamp(r.ceilingIn, LIMITS.room.ceilingIn),
      ...cleanShape(r),
    };
    if (!isObj(doc.surfaces)) bad('surfaces', 'That is not a kitchen design.');
    const surfaces = {};
    for (const k of SURFACE_KEYS) {
      const v = doc.surfaces[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > 64) bad(`surfaces.${k}`, 'A room finish is not valid.');
      if (k === 'doorStyle' && !DOOR_STYLES.has(v)) bad('surfaces.doorStyle', 'The door style is not valid.');
      if (k === 'crown' && !CROWNS.has(v)) bad('surfaces.crown', 'The crown moulding is not valid.');
      if (k === 'faucetId' && !FIXTURE_ID_RE.test(v)) bad('surfaces.faucetId', 'The faucet is not valid.');
      surfaces[k] = v;
    }
    if (!Array.isArray(doc.items)) bad('items', 'That is not a kitchen design.');
    if (doc.items.length > LIMITS.items) bad('items', `A kitchen can hold at most ${LIMITS.items} pieces.`);
    const items = doc.items.map(normalizeItem);
    const out = { name: typeof doc.name === 'string' ? doc.name.slice(0, 120) : '', room, surfaces, items };
    if (doc.version !== undefined && doc.version !== null) {
      if (doc.version !== 1 && doc.version !== 2) bad('version', 'This kitchen was saved by a newer version of BluModel Studio.');
      out.version = doc.version;
    }
    if (doc.products !== undefined && doc.products !== null) {
      if (!isObj(doc.products)) bad('products', 'Saved products are not valid.');
      const entries = Object.entries(doc.products);
      if (entries.length > LIMITS.products) bad('products', `A kitchen can carry at most ${LIMITS.products} saved products.`);
      const products = {};
      for (const [key, p] of entries) {
        if (!isProductId(key)) bad(`products.${key}`, 'A saved product has an invalid id.');
        products[key] = cleanSnapshot(p, key);
      }
      out.products = products;
    }
    if (doc.fixtures !== undefined && doc.fixtures !== null) {
      if (!isObj(doc.fixtures)) bad('fixtures', 'Saved faucets and hardware are not valid.');
      // Only the ones the surfaces name are kept: a kitchen has one faucet and one hardware.
      const fixtures = {};
      for (const id of [surfaces.hardwareId, surfaces.faucetId]) {
        if (!id || !Object.hasOwn(doc.fixtures, id)) continue;
        const f = cleanFixture(doc.fixtures[id], id);
        if (f) fixtures[id] = f;
      }
      if (Object.keys(fixtures).length) out.fixtures = fixtures;
    }
    if (doc.extras !== undefined && doc.extras !== null) {
      if (!Array.isArray(doc.extras)) bad('extras', 'Extra estimate lines are not valid.');
      if (doc.extras.length > LIMITS.extras) bad('extras', `A kitchen can have at most ${LIMITS.extras} extra estimate lines.`);
      if (doc.extras.length) out.extras = doc.extras.map(normalizeExtra);
    }
    if (doc.brandPrefs !== undefined && doc.brandPrefs !== null) {
      const brandPrefs = normalizeBrandPrefs(doc.brandPrefs);
      if (brandPrefs) out.brandPrefs = brandPrefs;
    }
    return { ok: true, doc: out };
  } catch (err) {
    if (err instanceof DocError) return { ok: false, field: err.field, message: err.message };
    throw err;
  }
}
