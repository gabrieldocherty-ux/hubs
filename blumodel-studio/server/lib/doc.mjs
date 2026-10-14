// Strict validation of a saved kitchen (DesignDoc). Normalises the document, strips
// unknown keys, and rejects junk (negative widths, non-finite positions, unknown
// product id shapes) instead of storing it. Mirrors src/types.ts.

import { BUILTIN_ID_RE, PRODUCT_ID_RE } from './ids.mjs';

export const LIMITS = Object.freeze({
  items: 400,
  products: 100,
  productBytes: 8 * 1024,
  coord: 2000,
  room: { widthIn: [72, 480], lengthIn: [72, 480], ceilingIn: [90, 144] },
  /** Extra estimate lines (installation, delivery…): count, label length, amount in USD. */
  extras: 50,
  extraLabel: 80,
  extraAmount: 10_000_000,
});

const ROTATIONS = new Set([0, 90, 180, 270]);
const DOOR_STYLES = new Set(['shaker', 'slab', 'fluted']);
const SURFACE_KEYS = ['cabinetFinishId', 'doorStyle', 'hardwareId', 'countertopId', 'backsplashId', 'flooringId', 'paintId'];

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
    };
    if (!isObj(doc.surfaces)) bad('surfaces', 'That is not a kitchen design.');
    const surfaces = {};
    for (const k of SURFACE_KEYS) {
      const v = doc.surfaces[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > 64) bad(`surfaces.${k}`, 'A room finish is not valid.');
      if (k === 'doorStyle' && !DOOR_STYLES.has(v)) bad('surfaces.doorStyle', 'The door style is not valid.');
      surfaces[k] = v;
    }
    if (!Array.isArray(doc.items)) bad('items', 'That is not a kitchen design.');
    if (doc.items.length > LIMITS.items) bad('items', `A kitchen can hold at most ${LIMITS.items} pieces.`);
    const items = doc.items.map(normalizeItem);
    const out = { name: typeof doc.name === 'string' ? doc.name.slice(0, 120) : '', room, surfaces, items };
    if (doc.version !== undefined && doc.version !== null) {
      if (doc.version !== 1 && doc.version !== 2) bad('version', 'This kitchen was saved by a newer version of Mise.');
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
    if (doc.extras !== undefined && doc.extras !== null) {
      if (!Array.isArray(doc.extras)) bad('extras', 'Extra estimate lines are not valid.');
      if (doc.extras.length > LIMITS.extras) bad('extras', `A kitchen can have at most ${LIMITS.extras} extra estimate lines.`);
      if (doc.extras.length) out.extras = doc.extras.map(normalizeExtra);
    }
    return { ok: true, doc: out };
  } catch (err) {
    if (err instanceof DocError) return { ok: false, field: err.field, message: err.message };
    throw err;
  }
}
