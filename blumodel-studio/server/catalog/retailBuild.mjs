// Builds the real-retailer catalog the app ships: reads the research in catalog/retail/*.json,
// merges and cleans it, maps every entry onto one of the app's product types so it renders
// procedurally at its published size, and writes src/data/retail.json.
//
//   node server/catalog/retailBuild.mjs           rebuild src/data/retail.json, print what was left out
//   node server/catalog/retailBuild.mjs --check   exit 1 if src/data/retail.json is out of date
//
// src/data/ because deploy-local ships every JSON file there next to server/ (the server reads it
// for the brand lists, the click counts and Admin > Retailers) and the client imports it as a
// lazy chunk. Nothing calls a retailer at run time: the links are plain navigations.
//
// Factual fields only (the research rule): names, sizes, finishes, store links, SKUs, prices
// and the date they were checked. No photos, no marketing copy, no reviews. A size the listing
// didn't give is filled from the product type's typical size and marked as such (`typical`), so
// the product page can say which numbers came from the store.
//
// Ids are `r-` + the research key (shortened with a hash past 40 characters). A saved kitchen
// keeps the id, so NEVER change a key once it has shipped; add a new entry instead.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kinds from '../../src/data/kinds.json' with { type: 'json' };

export const RETAIL_VERSION = 1;
export const ID_PREFIX = 'r-';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RESEARCH_DIR = path.join(ROOT, 'catalog', 'retail');
export const OUT_FILE = path.join(ROOT, 'src', 'data', 'retail.json');

/** Stores a listing may link to. A link must be https on the store's own domain. */
export const STORES = [
  { slug: 'rona', name: 'RONA', domain: 'rona.ca' },
  { slug: 'home-depot', name: 'Home Depot', domain: 'homedepot.ca', aliases: ['the home depot'] },
  { slug: 'home-hardware', name: 'Home Hardware', domain: 'homehardware.ca' },
  { slug: 'ikea', name: 'IKEA', domain: 'ikea.com', pathPrefix: '/ca/' },
  { slug: 'best-buy', name: 'Best Buy', domain: 'bestbuy.ca' },
  { slug: 'homesense', name: 'HomeSense', domain: 'homesense.ca' },
  { slug: 'canadian-tire', name: 'Canadian Tire', domain: 'canadiantire.ca' },
  { slug: 'lowes', name: 'Lowe’s', domain: 'lowes.ca', aliases: ["lowe's", 'lowes'] },
  { slug: 'wayfair', name: 'Wayfair', domain: 'wayfair.ca' },
  { slug: 'costco', name: 'Costco', domain: 'costco.ca' },
  { slug: 'walmart', name: 'Walmart', domain: 'walmart.ca' },
];
const normStore = (s) => String(s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const STORE_BY_NAME = new Map(STORES.flatMap((s) => [normStore(s.name), normStore(s.slug), ...(s.aliases ?? []).map(normStore)].map((n) => [n, s])));

/**
 * The product types a retail entry can become: a copy of the rows in src/data/productTypes.ts
 * (kind, variant and typical size in inches). src/catalog/retail.test.ts checks the generated data
 * against productTypes.ts, so a drift between the two fails the tests.
 */
export const TYPES = {
  'base-cabinet': ['base', 'door-drawer', 24, 24, 36, 0],
  'drawer-base': ['base', 'drawers', 30, 24, 36, 0],
  'trash-pullout': ['base', 'trash', 18, 24, 36, 0],
  'corner-cabinet': ['corner', undefined, 36, 36, 36, 0],
  'wall-cabinet': ['wall', 'door', 30, 12, 30, 54],
  'wall-cabinet-glass': ['wall', 'glass', 30, 12, 30, 54],
  'bridge-cabinet': ['wall', 'bridge', 36, 24, 15, 72],
  pantry: ['tall', 'pantry', 24, 24, 84, 0],
  island: ['island', undefined, 84, 42, 36, 0],
  'range-gas': ['range', 'gas-4', 30, 28, 36, 0],
  'range-gas-6': ['range', 'gas-6', 36, 28, 36, 0],
  'range-griddle': ['range', 'griddle', 48, 28, 36, 0],
  'range-induction': ['range', 'induction', 30, 28, 36, 0],
  'hood-chimney': ['hood', 'chimney', 30, 20, 18, 66],
  'fridge-french': ['fridge', 'french', 36, 30, 70, 0],
  'fridge-column': ['fridge', 'column', 30, 24, 84, 0],
  'fridge-retro': ['fridge', 'retro', 24, 28, 60, 0],
  'wall-oven': ['oven-tower', undefined, 30, 24, 84, 0],
  dishwasher: ['dishwasher', undefined, 24, 24, 36, 0],
  microwave: ['microwave', undefined, 30, 16, 17, 66],
  'wine-column': ['wine', 'wine', 24, 24, 36, 0],
  'beverage-center': ['wine', 'beverage', 15, 24, 36, 0],
  'sink-undermount': ['sink', 'undermount', 33, 24, 36, 0],
  'sink-farmhouse': ['sink', 'farmhouse', 36, 24, 36, 0],
  'sink-double': ['sink', 'double', 36, 24, 36, 0],
  'sink-prep': ['sink', 'prep', 18, 24, 36, 0],
  'pendant-dome': ['pendant', 'dome', 14, 14, 10, 68],
  'pendant-globe': ['pendant', 'globe', 12, 12, 12, 66],
  'pendant-cone': ['pendant', 'cone', 10, 10, 13, 66],
  'pendant-woven': ['pendant', 'woven', 20, 20, 14, 64],
  'pendant-linear': ['pendant', 'linear', 48, 6, 5, 70],
  'stool-counter': ['stool', 'counter', 17, 17, 26, 0],
  'stool-backed': ['stool', 'backed', 19, 20, 38, 0],
};
const TYPE_ORDER = Object.keys(TYPES);

/** Research kinds the app has no shape for (yet): kept out of the placeable catalog. */
const UNPLACEABLE = {
  faucet: 'faucet (no faucet shape: the sink draws its own)',
  pull: 'cabinet hardware (set kitchen-wide in Room & finishes)',
  knob: 'cabinet hardware (set kitchen-wide in Room & finishes)',
  'cabinet-door': 'cabinet fronts only (no box to place)',
  'backsplash-tile': 'backsplash tile (a surface, set in Room & finishes)',
  countertop: 'countertop (a surface, drawn on the cabinets)',
  'floor-plank': 'flooring (a surface, set in Room & finishes)',
};

const BASE_WIDTHS = [24, 27, 30, 33, 36, 39, 42, 48];
const CONFIDENCE = { low: 0, medium: 1, high: 2 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pos = (v, lo, hi) => (isNum(v) && v >= lo && v <= hi ? Math.round(v * 1000) / 1000 : null);
export const slugify = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const hash6 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 6);
const fmtIn = (n) => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100}″`;

/** `r-` + the key, at most 40 characters (the app's product-id rule), hashed when longer. */
export function retailId(key) {
  const s = slugify(key);
  const full = ID_PREFIX + s;
  if (full.length <= 40) return full;
  return `${ID_PREFIX}${s.slice(0, 31).replace(/-+$/, '')}-${hash6(key)}`;
}

/** The model number at the end of a name, "(WDT730HAMZ)". Needs a digit, so "(no shade)" isn't one. */
function modelOf(name) {
  const m = /\(([A-Za-z0-9][A-Za-z0-9.\-/]{2,30})\)\s*$/.exec(name ?? '');
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : null;
}

/** "Eklipse (EBSU)" → brand Eklipse, line EBSU. */
function splitBrand(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s*\(([^)]+)\)$/.exec(s);
  return m ? { brand: m[1].trim(), line: m[2].trim() } : { brand: s, line: null };
}

const has = (re, ...s) => re.test(s.filter(Boolean).join(' ').toLowerCase());

/** The app product type for a research entry, or a reason it can't be placed. */
function classify(p, w, d, h) {
  const text = `${p.name} ${p.line ?? ''} ${p.notes ?? ''}`.toLowerCase();
  const name = String(p.name).toLowerCase();
  switch (p.kind) {
    case 'base-cabinet':
      if (has(/trash|waste|recycl/, name)) return 'trash-pullout';
      if (has(/\bsink\b/, name)) return 'sink-undermount';
      if (has(/\bdrawers?\b/, name) && !has(/door/, name)) return 'drawer-base';
      return 'base-cabinet';
    case 'drawer-base':
      return 'drawer-base';
    case 'sink-base':
      return has(/farmhouse|apron/, name) ? 'sink-farmhouse' : 'sink-undermount';
    case 'corner-cabinet':
      if (h !== null && h <= 42 && d !== null && d <= 16) return 'wall-cabinet';
      if (d !== null && Math.abs(w - d) <= 1) return 'corner-cabinet';
      return 'base-cabinet';
    case 'wall-cabinet':
      if (h !== null && h <= 24) return 'bridge-cabinet';
      return has(/glass/, name) ? 'wall-cabinet-glass' : 'wall-cabinet';
    case 'tall-cabinet':
    case 'pantry':
      return 'pantry';
    case 'island':
    case 'cart':
      return 'island';
    case 'range':
    case 'cooktop':
    case 'rangetop':
      if (has(/induction/, name)) return 'range-induction';
      if (has(/griddle/, name) || w >= 46) return 'range-griddle';
      if (has(/\bgas\b|dual[- ]fuel|rangetop/, name)) return w >= 35 ? 'range-gas-6' : 'range-gas';
      return 'range-induction'; // electric: a smooth top reads like induction
    case 'wall-oven':
      return 'wall-oven';
    case 'microwave':
      return 'microwave';
    case 'fridge':
    case 'refrigerator':
      if (has(/retro|50'?s/, text)) return 'fridge-retro';
      if (has(/column/, name)) return 'fridge-column';
      return 'fridge-french';
    case 'dishwasher':
      return 'dishwasher';
    case 'wine-cooler':
    case 'wine':
      return 'wine-column';
    case 'beverage-center':
      return 'beverage-center';
    case 'hood':
      return 'hood-chimney';
    case 'sink':
      if (has(/farmhouse|apron/, name)) return 'sink-farmhouse';
      if (has(/double|60\/40|50\/50|70\/30/, name)) return 'sink-double';
      return w <= 24 ? 'sink-prep' : 'sink-undermount';
    case 'pendant':
      if (has(/linear/, name)) return 'pendant-linear';
      if (has(/woven|rattan|wicker/, name)) return 'pendant-woven';
      if (has(/\bcone\b/, name)) return 'pendant-cone';
      if (has(/globe|cluster|glass/, name)) return 'pendant-globe';
      return 'pendant-dome';
    case 'stool':
      return has(/back|upholster/, name) ? 'stool-backed' : 'stool-counter';
    default:
      return null;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
function finishHex(f) {
  if (HEX.test(f?.hex ?? '')) return f.hex.toLowerCase();
  const n = String(f?.name ?? '').toLowerCase();
  if (/black/.test(n)) return '#1f1f20';
  if (/white|ivory/.test(n)) return '#f2f0ea';
  if (/stainless|steel|nickel|chrome|silver/.test(n)) return '#c4c8cb';
  if (/gr[ae]y/.test(n)) return '#8f9294';
  if (/brass|gold/.test(n)) return '#b8924a';
  if (/oak|wood|walnut|birch|maple/.test(n)) return '#b48a5e';
  return '#cfc9bf';
}
function finishMaterial(name, kind) {
  const n = String(name ?? '').toLowerCase();
  if (/glass/.test(n)) return 'glass';
  if (/stainless|steel|nickel|chrome|brass|bronze|copper|alumin|metal|iron/.test(n)) return 'metal';
  if (/fireclay|ceramic|porcelain|enamel/.test(n)) return 'ceramic';
  if (/granite|quartz|marble|stone|composite|concrete/.test(n)) return 'stone';
  if (/oak|walnut|maple|cherry|birch|\bash\b|teak|hickory|wood|veneer|bamboo|butcher/.test(n)) return 'wood';
  if (/leather/.test(n)) return 'leather';
  if (/fabric|linen|velvet|boucle|upholster/.test(n)) return 'fabric';
  if (/rattan|woven|wicker/.test(n)) return 'wood';
  if (['range', 'fridge', 'dishwasher', 'hood', 'microwave', 'oven-tower', 'wine', 'sink'].includes(kind)) return /black|white/.test(n) ? 'paint' : 'metal';
  return 'paint';
}

function cleanFinishes(list, kind) {
  const out = [];
  const ids = new Set();
  for (const f of Array.isArray(list) ? list : []) {
    const name = String(f?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) continue;
    let id = slugify(name).slice(0, 40) || `finish-${out.length + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({ id, name, hex: finishHex(f), material: finishMaterial(name, kind) });
  }
  if (!out.length) out.push({ id: 'as-listed', name: 'As listed', hex: '#cfc9bf', material: kind === 'range' || kind === 'fridge' ? 'metal' : 'paint' });
  return out;
}

/** One store listing, or null with the reason (logged). */
function cleanListing(s) {
  const store = STORE_BY_NAME.get(normStore(s?.store));
  if (!store) return { drop: `unknown store "${s?.store}"` };
  let url;
  try {
    url = new URL(String(s.url ?? ''));
  } catch {
    return { drop: `${store.name}: not a link` };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === store.domain || host.endsWith(`.${store.domain}`))) return { drop: `${store.name}: link is not on ${store.domain}` };
  if (store.pathPrefix && !url.pathname.startsWith(store.pathPrefix)) return { drop: `${store.name}: not the Canadian site` };
  url.hash = '';
  const price = isNum(s.priceCad) && s.priceCad > 0 && s.priceCad < 100_000 ? Math.round(s.priceCad * 100) / 100 : null;
  const sku = typeof s.sku === 'string' && s.sku.trim() ? s.sku.trim().slice(0, 40) : null;
  const listing = { store: store.slug, url: url.toString(), sku, priceCad: price, inStock: typeof s.inStockOnline === 'boolean' ? s.inStockOnline : null };
  if (typeof s.finish === 'string' && s.finish) listing.finishName = s.finish;
  return { listing };
}

/** The name without its model number and, when it names the finish, without ", White". */
function baseName(e) {
  let n = e.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const m = /,\s*([^,]+)$/.exec(n);
  if (m) {
    const tail = m[1].toLowerCase();
    if (e.finishes.some((f) => { const fn = String(f?.name ?? '').toLowerCase(); return fn && (fn.startsWith(tail) || tail.startsWith(fn.split(' (')[0])); })) n = n.slice(0, m.index);
  }
  return n;
}

/**
 * One product sold in several finishes is often researched as one entry per finish ("Edson 30 in
 * base cabinet, White" and "…, Grey"; two RONA model numbers for the white and grey ELITE base).
 * Same brand, same name apart from the finish, same kind and size: one product with each finish,
 * and every store listing remembers which finish it sells. Only single-finish entries merge.
 */
function mergeFinishVariants(entries, log) {
  const first = new Map();
  const out = [];
  for (const e of entries) {
    if (e.finishes.length !== 1) {
      out.push(e);
      continue;
    }
    const finish = String(e.finishes[0]?.name ?? '');
    e.stores = e.stores.map((s) => ({ ...s, finish }));
    const k = [e.brand.toLowerCase(), baseName(e).toLowerCase(), e.kind, e.widthIn, e.depthIn, e.heightIn].join('|');
    const f = first.get(k);
    if (!f) {
      first.set(k, e);
      out.push(e);
      continue;
    }
    const another = !f.finishes.some((x) => String(x?.name ?? '').toLowerCase() === finish.toLowerCase());
    if (another && !f.variants) {
      f.variants = true;
      f.name = baseName(f);
    }
    if (another) f.finishes.push(...e.finishes);
    f.stores.push(...e.stores);
    for (const key of ['upc', 'line', 'doorStyle']) if (f[key] == null && e[key] != null) f[key] = e[key];
    if ((CONFIDENCE[e.confidence] ?? 0) < (CONFIDENCE[f.confidence] ?? 0)) f.confidence = e.confidence;
    log.merged.push(`${e.key} → ${f.key} (${another ? 'another finish' : 'the same product'})`);
  }
  return out;
}

/** Merges research entries that are the same product (same brand and model number, or UPC). */
function dedupe(entries, log) {
  const byKey = new Map();
  const out = [];
  for (const e of entries) {
    const keys = [];
    if (e.model) keys.push(`${e.brand.toLowerCase()}|m:${e.model}`);
    if (e.upc) keys.push(`${e.brand.toLowerCase()}|u:${e.upc}`);
    const found = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!found) {
      out.push(e);
      for (const k of keys) byKey.set(k, e);
      continue;
    }
    log.merged.push(`${e.key} → ${found.key}`);
    found.stores.push(...e.stores);
    found.finishes.push(...e.finishes);
    found.widthOptionsIn = [...(found.widthOptionsIn ?? []), ...(e.widthOptionsIn ?? [])];
    for (const k of ['widthIn', 'depthIn', 'heightIn', 'upc', 'model', 'line', 'doorStyle']) if (found[k] == null && e[k] != null) found[k] = e[k];
    if ((CONFIDENCE[e.confidence] ?? 0) > (CONFIDENCE[found.confidence] ?? 0)) found.confidence = e.confidence;
    for (const k of keys) byKey.set(k, found);
  }
  return out;
}

function listText(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * @param {{ group?: string, checkedAt?: string, products: any[] }[]} files  the parsed research files
 * @returns {{ data: any, log: { dropped: { key: string, reason: string }[], merged: string[], links: string[] } }}
 */
export function buildRetailCatalog(files) {
  const log = { dropped: [], merged: [], links: [] };
  const entries = [];
  for (const file of files) {
    const checkedAt = /^\d{4}-\d{2}-\d{2}$/.test(file?.checkedAt ?? '') ? file.checkedAt : null;
    for (const raw of Array.isArray(file?.products) ? file.products : []) {
      if (!raw || typeof raw.key !== 'string' || !raw.key.trim() || typeof raw.name !== 'string' || !raw.name.trim()) {
        log.dropped.push({ key: String(raw?.key ?? '?'), reason: 'no key or name' });
        continue;
      }
      const { brand, line } = splitBrand(raw.brand);
      if (!brand) {
        log.dropped.push({ key: raw.key, reason: 'no brand' });
        continue;
      }
      const model = modelOf(raw.name);
      const upc = typeof raw.upc === 'string' && /^\d{12,14}$/.test(raw.upc.trim()) ? raw.upc.trim() : null;
      entries.push({
        key: raw.key.trim(),
        brand,
        line: (typeof raw.line === 'string' && raw.line.trim()) || line,
        name: raw.name.replace(/\s+/g, ' ').trim(),
        model,
        upc,
        kind: String(raw.kind ?? '').trim().toLowerCase(),
        widthIn: raw.widthIn,
        depthIn: raw.depthIn,
        heightIn: raw.heightIn,
        widthOptionsIn: Array.isArray(raw.widthOptionsIn) ? raw.widthOptionsIn : null,
        doorStyle: typeof raw.doorStyle === 'string' ? raw.doorStyle.toLowerCase() : null,
        finishes: Array.isArray(raw.finishes) ? [...raw.finishes] : [],
        stores: Array.isArray(raw.stores) ? [...raw.stores] : [],
        confidence: CONFIDENCE[raw.confidence] !== undefined ? raw.confidence : 'low',
        checkedAt: checkedAt ?? '',
      });
    }
  }

  const merged = mergeFinishVariants(dedupe(entries, log), log);
  const products = [];
  const usedIds = new Set();
  const usedStores = new Set();

  for (const e of merged) {
    const drop = (reason) => log.dropped.push({ key: e.key, reason });
    if (UNPLACEABLE[e.kind]) {
      drop(UNPLACEABLE[e.kind]);
      continue;
    }
    if (/\btop pantry\b/i.test(e.name)) {
      drop('the top half of a stacked pantry (nothing in the app to stand it on)');
      continue;
    }
    const opts = [...new Set((e.widthOptionsIn ?? []).map((v) => pos(v, 6, 96)).filter((v) => v !== null))].sort((a, b) => a - b);
    const pub = { w: pos(e.widthIn, 3, 240) ?? opts[0] ?? null, d: pos(e.depthIn, 1, 120), h: pos(e.heightIn, 0.1, 120) };
    if (pub.w === null) {
      drop('no published width');
      continue;
    }
    const typeId = classify(e, pub.w, pub.d, pub.h);
    if (!typeId) {
      drop(`no product type for "${e.kind}"`);
      continue;
    }
    const [kind, variant, , td, th, telev] = TYPES[typeId];
    if (kind === 'island' && pub.h !== null && pub.h > 42) {
      drop(`not a counter-height island (${fmtIn(pub.h)} tall)`);
      continue;
    }

    const listings = [];
    const seenUrl = new Set();
    for (const s of e.stores) {
      const r = cleanListing(s);
      if (r.drop) {
        log.links.push(`${e.key}: ${r.drop}`);
        continue;
      }
      if (seenUrl.has(r.listing.url)) continue;
      seenUrl.add(r.listing.url);
      listings.push(r.listing);
    }
    if (!listings.length) {
      drop('no store link on a known store’s Canadian site');
      continue;
    }

    // The placed size: the listing's numbers, else the type's typical ones (marked).
    let w = pub.w;
    let d = pub.d ?? td;
    let h = pub.h ?? th;
    const typical = [];
    if (pub.d === null) typical.push('depth');
    if (pub.h === null) typical.push('height');
    let elev = telev;
    let note = null;
    let flags;

    if (kind === 'range') {
      if (e.kind === 'cooktop' || e.kind === 'rangetop') note = 'A cooktop, drawn as a range of the same width (there is no separate cooktop shape yet).';
      else if (pub.h !== null && pub.h > 38) {
        flags = { backguard: true };
        note = `Drawn at its 36″ cooking height; the listed ${fmtIn(pub.h)} includes the back control panel.`;
      }
      h = 36;
      if (!typical.includes('height') && pub.h !== null && pub.h <= 38) h = pub.h;
    } else if (kind === 'oven-tower') {
      d = td;
      h = th;
      for (const t of ['depth', 'height']) if (!typical.includes(t)) typical.push(t);
      note = `A ${fmtIn(pub.w)} wall oven, drawn in an ${fmtIn(th)} oven tower cabinet.`;
    } else if (kind === 'sink' && e.kind === 'sink') {
      const farm = variant === 'farmhouse';
      const need = farm ? pub.w : pub.w + 3;
      const base = BASE_WIDTHS.find((bw) => bw >= need - 0.01);
      if (!base) {
        drop(`a ${fmtIn(pub.w)} sink is wider than any sink base`);
        continue;
      }
      w = base;
      d = td;
      h = th;
      typical.length = 0;
      typical.push('depth', 'height');
      note = `The ${fmtIn(pub.w)} sink, drawn in a ${fmtIn(base)} sink base cabinet.`;
    } else if (kind === 'pendant' && pub.d === null && variant !== 'linear') {
      d = w; // a round shade is as deep as it is wide
      typical.splice(typical.indexOf('depth'), 1);
    } else if (kind === 'wall' && variant !== 'bridge' && pub.h !== null && pub.h > 30) {
      elev = 54;
    } else if (kind === 'wall' && variant === 'bridge') {
      elev = Math.min(telev, 84 - h); // a short wall cabinet lines up with the tops of the 30″ uppers
    } else if (kind === 'hood' && has(/under[- ]cabinet|insert/, e.name)) {
      note = 'An under-cabinet hood, drawn with the chimney hood shape (there is no under-cabinet shape yet).';
    }

    const widthOptions = kind === 'base' || kind === 'wall' || kind === 'tall' || kind === 'corner' || (kind === 'sink' && e.kind !== 'sink') ? (opts.includes(w) ? opts : [...new Set([...opts, w])].sort((a, b) => a - b)) : [];
    const finishes = cleanFinishes(e.finishes, kind);
    // A listing names its finish only when the product comes in more than one.
    for (const l of listings) {
      const fname = typeof l.finishName === 'string' ? l.finishName.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      delete l.finishName;
      const f = finishes.length > 1 && fname ? finishes.find((x) => x.name === fname) : undefined;
      if (f) l.finish = f.id;
    }
    const prices = listings.map((l) => l.priceCad).filter((p) => p !== null);
    // With no model number, UPC or store SKU: a short type code like the built-ins' ("BC{w}" for a
    // base cabinet), not the research key, which ran 30 characters across the plan and the inspector.
    const typeCode = typeId.split('-').map((x) => x[0]).join('').toUpperCase() + (widthOptions.length > 1 ? '{w}' : String(w));
    const code = e.model ?? (e.upc ? `UPC ${e.upc}` : null) ?? listings.find((l) => l.sku)?.sku ?? typeCode;
    const name = (e.model ? e.name.replace(/\s*\([^)]*\)\s*$/, '') : e.name).slice(0, 120);
    let id = retailId(e.key);
    if (usedIds.has(id)) id = `${ID_PREFIX}${slugify(e.key).slice(0, 31).replace(/-+$/, '')}-${hash6(`${e.key}#${usedIds.size}`)}`;
    usedIds.add(id);
    const storeNames = [...new Set(listings.map((l) => l.store))].map((slug) => STORES.find((s) => s.slug === slug).name);
    for (const l of listings) usedStores.add(l.store);
    const doorStyle = e.doorStyle === 'shaker' || e.doorStyle === 'slab' ? e.doorStyle : undefined;
    const style = e.doorStyle && !doorStyle && ['raised', 'glass', 'beadboard'].includes(e.doorStyle) ? e.doorStyle : undefined;

    products.push({
      id,
      kind,
      ...(variant ? { variant } : {}),
      category: kinds.kindCategory[kind],
      brand: e.brand,
      name,
      code,
      widthIn: w,
      depthIn: d,
      heightIn: h,
      elevationIn: elev,
      ...(widthOptions.length > 1 ? { widthOptions } : {}),
      price: prices.length ? Math.round(Math.min(...prices)) : null,
      finishes,
      blurb: `Listed at ${listText(storeNames)}.${note ? ` ${note}` : ''}`,
      ...(e.line ? { line: e.line } : {}),
      ...(doorStyle ? { doorStyle } : {}),
      ...(flags ? { flags } : {}),
      retail: {
        key: e.key,
        type: typeId,
        upc: e.upc,
        confidence: e.confidence,
        checkedAt: e.checkedAt,
        size: pub,
        typical,
        ...(note ? { note } : {}),
        ...(style ? { style } : {}),
        stores: listings,
      },
    });
  }

  const catOrder = kinds.categories.map((c) => c.id);
  products.sort(
    (a, b) =>
      catOrder.indexOf(a.category) - catOrder.indexOf(b.category) ||
      TYPE_ORDER.indexOf(a.retail.type) - TYPE_ORDER.indexOf(b.retail.type) ||
      a.brand.localeCompare(b.brand) ||
      a.name.localeCompare(b.name),
  );

  const byReason = {};
  for (const d of log.dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  const dates = [...new Set(files.map((f) => f?.checkedAt).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')))].sort();
  return {
    data: {
      version: RETAIL_VERSION,
      checkedAt: dates[dates.length - 1] ?? null,
      researched: entries.length,
      stores: STORES.filter((s) => usedStores.has(s.slug)).map(({ slug, name, domain }) => ({ slug, name, domain })),
      products,
      leftOut: { count: log.dropped.length, byReason },
    },
    log,
  };
}

/** Every catalog/retail/*.json research file, parsed, in name order. */
export function readResearch(dir = RESEARCH_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export const serialize = (data) => `${JSON.stringify(data, null, 1)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { data, log } = buildRetailCatalog(readResearch());
  const text = serialize(data);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    if (cur !== text) {
      console.error('src/data/retail.json is out of date: run node server/catalog/retailBuild.mjs');
      process.exit(1);
    }
    console.log('src/data/retail.json is up to date.');
  } else {
    fs.writeFileSync(OUT_FILE, text);
    console.log(`${data.researched} researched → ${data.products.length} placeable products from ${data.stores.length} stores; ${log.dropped.length} left out, ${log.merged.length} merged.`);
    for (const [reason, n] of Object.entries(data.leftOut.byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${reason}`);
    for (const d of log.dropped) console.log(`  - ${d.key}: ${d.reason}`);
    for (const m of log.merged) console.log(`  merged ${m}`);
    for (const l of log.links) console.log(`  link dropped: ${l}`);
    console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB).`);
  }
}
