// Brand and custom products (ctx.services.products): spec validation, the working copy
// vs the live copy the catalog serves, and the client wire shape. See BUILD_PLAN §3.3–3.4.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { randomId, FILE_ID_RE, PRODUCT_ID_RE } from '../lib/ids.mjs';
import { KIND_SET, CATEGORY_SET, MATERIAL_SET, VARIANTS } from './kinds.mjs';

export const STATUSES = ['draft', 'submitted', 'published', 'rejected', 'archived'];
const SKU_RE = /^[A-Za-z0-9._\-/ ]{0,40}$/;
const FINISH_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VARIANT_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const WIDTH_KEY_RE = /^\d{1,3}(\.\d{1,2})?$/;

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function httpsUrl(v) {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Validates a ProductSpec (or, with `partial`, a patch of one). Unknown keys are
 * dropped. In a partial patch, `null` (or '' for optional strings) removes an optional
 * field. Returns `{ ok: true, spec }` or `{ ok: false, errors: [{ field, message }] }`.
 */
export function validateSpec(input, { partial = false } = {}) {
  if (!isObj(input)) return { ok: false, errors: [{ field: '', message: 'Expected a product.' }] };
  const errors = [];
  const out = {};
  const err = (field, message) => errors.push({ field, message });
  const has = (k) => input[k] !== undefined;
  const need = (k) => !partial || has(k);
  const cleared = (k) => input[k] === null || input[k] === '';

  if (need('kind')) {
    if (!KIND_SET.has(input.kind)) err('kind', 'Choose a product type.');
    else out.kind = input.kind;
  }
  if (has('variant')) {
    if (cleared('variant')) {
      if (partial) out.variant = null;
    } else if (typeof input.variant !== 'string' || !VARIANT_RE.test(input.variant)) err('variant', 'That variant isn’t valid.');
    else if (out.kind && !VARIANTS[out.kind]?.includes(input.variant)) err('variant', `“${input.variant}” isn’t a ${out.kind} variant.`);
    else out.variant = input.variant;
  }
  if (need('category')) {
    if (!CATEGORY_SET.has(input.category)) err('category', 'Choose a category.');
    else out.category = input.category;
  }
  if (need('name')) {
    const s = typeof input.name === 'string' ? input.name.trim() : '';
    if (!s) err('name', 'Give the product a name.');
    else if (s.length > 80) err('name', 'Keep the name to 80 characters or fewer.');
    else out.name = s;
  }
  if (has('blurb')) {
    if (input.blurb === null) out.blurb = '';
    else if (typeof input.blurb !== 'string') err('blurb', 'The description must be text.');
    else if (input.blurb.trim().length > 600) err('blurb', 'Keep the description to 600 characters or fewer.');
    else out.blurb = input.blurb.trim();
  } else if (!partial) out.blurb = '';
  if (has('sku')) {
    const s = input.sku === null ? '' : typeof input.sku === 'string' ? input.sku.trim() : null;
    if (s === null || !SKU_RE.test(s)) err('sku', 'Use up to 40 letters, digits, spaces and . _ - /');
    else out.sku = s;
  } else if (!partial) out.sku = '';

  const widthMap = (field, check, message) => {
    if (!has(field)) return;
    if (input[field] === null) {
      if (partial) out[field] = null;
      return;
    }
    if (!isObj(input[field])) return err(field, message);
    const entries = Object.entries(input[field]);
    if (entries.length > 16) return err(field, 'At most 16 widths.');
    const m = {};
    for (const [k, v] of entries) {
      if (!WIDTH_KEY_RE.test(k) || Number(k) < 1 || Number(k) > 240) return err(field, `“${k}” isn’t a width in inches.`);
      const c = check(v);
      if (c === undefined) return err(field, message);
      m[String(Number(k))] = c;
    }
    out[field] = m;
  };
  widthMap('skuByWidth', (v) => (typeof v === 'string' && v.trim() && SKU_RE.test(v.trim()) ? v.trim() : undefined), 'Each width needs a valid SKU.');

  const dims = [
    ['widthIn', 1, 240, 'Width'],
    ['depthIn', 1, 120, 'Depth'],
    ['heightIn', 0.25, 144, 'Height'],
    ['elevationIn', 0, 120, 'Height off the floor'],
  ];
  for (const [k, lo, hi, label] of dims) {
    if (!has(k)) {
      if (!partial) {
        if (k === 'elevationIn') out[k] = 0;
        else err(k, `${label} is required.`);
      }
      continue;
    }
    if (!isNum(input[k]) || input[k] < lo || input[k] > hi) err(k, `${label} must be between ${lo} and ${hi} inches.`);
    else out[k] = round2(input[k]);
  }
  if (has('widthOptions')) {
    const v = input.widthOptions;
    if (v === null) {
      if (partial) out.widthOptions = null;
    } else if (!Array.isArray(v) || v.length > 16 || !v.every((w) => isNum(w) && w >= 1 && w <= 240)) err('widthOptions', 'Up to 16 widths, each 1–240 inches.');
    else out.widthOptions = [...new Set(v.map(round2))].sort((a, b) => a - b);
  }
  if (need('price')) {
    if (!isNum(input.price) || input.price < 0 || input.price > 1_000_000) err('price', 'Price must be between $0 and $1,000,000.');
    else out.price = round2(input.price);
  }
  widthMap('priceByWidth', (v) => (isNum(v) && v >= 0 && v <= 1_000_000 ? round2(v) : undefined), 'Each width needs a price between $0 and $1,000,000.');

  if (need('finishes')) {
    const f = input.finishes;
    if (f === 'cabinet') out.finishes = 'cabinet';
    else if (!Array.isArray(f) || f.length < 1 || f.length > 24) err('finishes', 'Add between 1 and 24 finishes.');
    else {
      const list = [];
      const ids = new Set();
      f.forEach((x, i) => {
        const at = `finishes[${i}]`;
        if (!isObj(x)) return err(at, 'Each finish needs a name, colour and material.');
        const id = typeof x.id === 'string' ? x.id.trim() : '';
        const name = typeof x.name === 'string' ? x.name.trim() : '';
        if (!FINISH_ID_RE.test(id)) return err(`${at}.id`, 'Finish ids use lowercase letters, digits and dashes.');
        if (ids.has(id)) return err(`${at}.id`, 'Two finishes share this id.');
        if (!name || name.length > 40) return err(`${at}.name`, 'Name each finish (40 characters or fewer).');
        if (typeof x.hex !== 'string' || !HEX_RE.test(x.hex)) return err(`${at}.hex`, 'Use a colour like #c9a57a.');
        if (!MATERIAL_SET.has(x.material)) return err(`${at}.material`, 'Choose a material.');
        if (x.swatchFileId != null && x.swatchFileId !== '' && (typeof x.swatchFileId !== 'string' || !FILE_ID_RE.test(x.swatchFileId))) return err(`${at}.swatchFileId`, 'That swatch image isn’t valid.');
        ids.add(id);
        list.push({ id, name, hex: x.hex.toLowerCase(), material: x.material, ...(x.swatchFileId ? { swatchFileId: x.swatchFileId } : {}) });
      });
      out.finishes = list;
    }
  }
  if (has('imageFileIds') || !partial) {
    const v = input.imageFileIds ?? [];
    if (!Array.isArray(v) || v.length > 12 || !v.every((id) => typeof id === 'string' && FILE_ID_RE.test(id))) err('imageFileIds', 'Up to 12 uploaded images.');
    else out.imageFileIds = [...new Set(v)];
  }
  if (has('modelFileId')) {
    if (cleared('modelFileId')) {
      if (partial) out.modelFileId = null;
    } else if (typeof input.modelFileId !== 'string' || !FILE_ID_RE.test(input.modelFileId)) err('modelFileId', 'That model file isn’t valid.');
    else out.modelFileId = input.modelFileId;
  }
  for (const k of ['buyUrl', 'specSheetUrl']) {
    if (!has(k)) continue;
    if (cleared(k)) {
      if (partial) out[k] = null;
      continue;
    }
    const u = httpsUrl(input[k]);
    if (!u) err(k, 'Use a full https:// link (500 characters or fewer).');
    else out[k] = u;
  }
  if (has('flags')) {
    const f = input.flags;
    if (f === null) {
      if (partial) out.flags = null;
    } else if (!isObj(f)) err('flags', 'Flags must be an object.');
    else {
      const flags = {};
      if (f.trim !== undefined && f.trim !== null) {
        if (f.trim !== 'brass' && f.trim !== 'steel') err('flags.trim', 'Trim is brass or steel.');
        else flags.trim = f.trim;
      }
      if (f.backguard !== undefined && f.backguard !== null) {
        if (typeof f.backguard !== 'boolean') err('flags.backguard', 'Backguard is true or false.');
        else flags.backguard = f.backguard;
      }
      out.flags = flags;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, spec: out };
}

/** Every file a spec references: images, the model and finish swatches. */
export function fileIdsOf(spec) {
  if (!spec) return [];
  const ids = [...(spec.imageFileIds || [])];
  if (spec.modelFileId) ids.push(spec.modelFileId);
  if (Array.isArray(spec.finishes)) for (const f of spec.finishes) if (f.swatchFileId) ids.push(f.swatchFileId);
  return [...new Set(ids)];
}

const invalid = (errors) => new HttpError(400, 'Some product details need fixing.', { errors });

export function createProductService({ db, now = Date.now, files, brands }) {
  const parse = (s) => {
    if (s == null) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const toRow = (r) =>
    r && {
      id: r.id,
      source: r.source,
      brandId: r.brand_id ?? null,
      ownerUserId: r.owner_user_id ?? null,
      status: r.status,
      visibility: r.visibility,
      spec: parse(r.spec),
      liveSpec: parse(r.live_spec),
      kind: r.kind,
      category: r.category,
      name: r.name,
      priceCents: r.price_cents,
      revision: r.revision,
      reviewNote: r.review_note,
      submittedAt: r.submitted_at ?? null,
      publishedAt: r.published_at ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  const fullSpec = (spec) => {
    const v = validateSpec(spec);
    if (!v.ok) throw invalid(v.errors);
    return v.spec;
  };

  const mustGet = (id) => {
    const row = svc.get(id);
    if (!row) throw new HttpError(404, 'That product does not exist.');
    return row;
  };

  const svc = {
    validateSpec,
    fileIdsOf,

    /**
     * Creates a product (draft unless `status` says otherwise). The caller has already
     * checked access and file ownership. Returns the ProductRow.
     */
    create({ source, brandId = null, ownerUserId = null, visibility = 'public', spec, status = 'draft' }) {
      if (source !== 'brand' && source !== 'custom') throw new Error('products.create: source must be brand or custom');
      if (source === 'brand' && !brandId) throw new Error('products.create: a brand product needs brandId');
      if (!STATUSES.includes(status)) throw new Error(`products.create: bad status ${status}`);
      if (visibility !== 'public' && visibility !== 'private') throw new Error('products.create: bad visibility');
      const s = fullSpec(spec);
      const id = randomId('p_');
      const t = now();
      db.prepare(
        `INSERT INTO products (id, source, brand_id, owner_user_id, status, visibility, spec, live_spec, kind, category, name, price_cents,
                               revision, review_note, submitted_at, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, '', ?, NULL, ?, ?)`,
      ).run(id, source, brandId, ownerUserId, status, visibility, JSON.stringify(s), s.kind, s.category, s.name, Math.round(s.price * 100), status === 'submitted' ? t : null, t, t);
      return svc.get(id);
    },

    get(id) {
      if (typeof id !== 'string' || !PRODUCT_ID_RE.test(id)) return null;
      return toRow(db.prepare('SELECT * FROM products WHERE id = ?').get(id)) || null;
    },

    /**
     * Applies a spec patch to the working copy with optimistic concurrency: 409 when
     * `expectRevision` doesn't match (pass `force: true` to skip the check). The live
     * copy is untouched until publish().
     */
    update(id, specPatch, { expectRevision, force = false } = {}) {
      const row = mustGet(id);
      if (!force && typeof expectRevision !== 'number') throw new HttpError(400, 'Reload this product to get the latest version, then try again.');
      const p = validateSpec(specPatch, { partial: true });
      if (!p.ok) throw invalid(p.errors);
      const merged = { ...row.spec, ...p.spec };
      for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
      const s = fullSpec(merged);
      const sql = `UPDATE products SET spec = ?, kind = ?, category = ?, name = ?, price_cents = ?, revision = revision + 1, updated_at = ?
                   WHERE id = ?${force ? '' : ' AND revision = ?'}`;
      const args = [JSON.stringify(s), s.kind, s.category, s.name, Math.round(s.price * 100), now(), id];
      if (!force) args.push(expectRevision);
      const res = db.prepare(sql).run(...args);
      if (!res.changes) throw new HttpError(409, 'This product was changed somewhere else.', { revision: svc.get(id)?.revision });
      return svc.get(id);
    },

    setStatus(id, status, { note } = {}) {
      mustGet(id);
      if (!STATUSES.includes(status)) throw new Error(`products.setStatus: bad status ${status}`);
      const t = now();
      db.prepare(
        `UPDATE products SET status = ?, review_note = COALESCE(?, review_note),
                submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END, updated_at = ?
          WHERE id = ?`,
      ).run(status, typeof note === 'string' ? note.slice(0, 2000) : null, status, t, t, id);
      return svc.get(id);
    },

    /** Copies the working spec to the live spec and marks the product published. */
    publish(id) {
      const row = mustGet(id);
      fullSpec(row.spec);
      const t = now();
      db.prepare("UPDATE products SET live_spec = spec, status = 'published', published_at = ?, updated_at = ? WHERE id = ?").run(t, t, id);
      return svc.get(id);
    },

    archive(id) {
      return svc.setStatus(id, 'archived');
    },

    /**
     * The client `Product` for a row: the live copy (default) or the working copy.
     * File ids become URLs; private files carry `?share=` when a share token is given.
     * Returns null when the requested copy doesn't exist (e.g. never published).
     */
    toWire(row, { which = 'live', viewer = null, shareToken } = {}) {
      void viewer;
      if (!row) return null;
      const spec = which === 'working' ? row.spec : row.liveSpec;
      if (!spec) return null;
      const brand = row.brandId ? brands.get(row.brandId) : null;
      const fileUrl = (fid) => {
        const f = fid ? files.get(fid) : null;
        return f ? { file: f, url: files.url(f, { shareToken }) } : null;
      };
      const images = (spec.imageFileIds || [])
        .map(fileUrl)
        .filter(Boolean)
        .map((x) => ({ url: x.url, alt: spec.name }));
      const m = fileUrl(spec.modelFileId);
      const finishes =
        spec.finishes === 'cabinet'
          ? 'cabinet'
          : (spec.finishes || []).map((f) => {
              const sw = fileUrl(f.swatchFileId);
              return { id: f.id, name: f.name, hex: f.hex, material: f.material, ...(sw ? { swatchUrl: sw.url } : {}) };
            });
      /** @type {Record<string, unknown>} */
      const p = {
        id: row.id,
        kind: spec.kind,
        ...(spec.variant ? { variant: spec.variant } : {}),
        category: spec.category,
        brand: brand ? brand.name : row.source === 'custom' ? 'Your model' : 'Unknown brand',
        name: spec.name,
        code: spec.sku || '',
        widthIn: spec.widthIn,
        depthIn: spec.depthIn,
        heightIn: spec.heightIn,
        elevationIn: spec.elevationIn,
        ...(spec.widthOptions?.length ? { widthOptions: spec.widthOptions } : {}),
        price: spec.price,
        finishes,
        blurb: spec.blurb || '',
        source: row.source,
        ...(brand ? { brandId: brand.id, brandSlug: brand.slug, isDemo: brand.isDemo } : {}),
        sku: spec.sku || '',
        ...(spec.skuByWidth ? { skuByWidth: spec.skuByWidth } : {}),
        ...(spec.priceByWidth ? { priceByWidth: spec.priceByWidth } : {}),
        images,
        ...(images.length ? { thumbnailUrl: images[0].url } : {}),
        ...(spec.buyUrl ? { buyUrl: spec.buyUrl } : {}),
        ...(spec.specSheetUrl ? { specSheetUrl: spec.specSheetUrl } : {}),
        ...(m
          ? {
              model: {
                url: m.url,
                fileId: m.file.id,
                ...(m.file.meta?.bboxIn ? { bboxIn: m.file.meta.bboxIn } : {}),
                ...(typeof m.file.meta?.triangles === 'number' ? { triangles: m.file.meta.triangles } : {}),
                slots: m.file.meta?.slots || [],
              },
            }
          : {}),
        ...(spec.flags && Object.keys(spec.flags).length ? { flags: spec.flags } : {}),
        status: row.status,
        visibility: row.visibility,
        revision: row.revision,
        updatedAt: row.updatedAt,
      };
      return p;
    },

    /**
     * Rows the catalog serves to `user`: live, not archived, brand active (or no brand),
     * public or owned by the caller.
     */
    catalogRows(user) {
      return db
        .prepare(
          `SELECT p.* FROM products p LEFT JOIN brands b ON b.id = p.brand_id
            WHERE p.live_spec IS NOT NULL AND p.status <> 'archived'
              AND (p.brand_id IS NULL OR b.status = 'active')
              AND (p.visibility = 'public' OR p.owner_user_id = ?)
            ORDER BY COALESCE(b.name, '') COLLATE NOCASE, p.name COLLATE NOCASE, p.id`,
        )
        .all(user?.id ?? null)
        .map(toRow);
    },

    /** True when `row` is in the catalog for `user` (the same rule as catalogRows). */
    inCatalog(row, user) {
      if (!row || !row.liveSpec || row.status === 'archived') return false;
      if (row.brandId && brands.get(row.brandId)?.status !== 'active') return false;
      return row.visibility === 'public' || (!!user && row.ownerUserId === user.id);
    },

    /** The live catalog for `user`, as wire Products. */
    listCatalog(user) {
      return svc
        .catalogRows(user)
        .map((r) => svc.toWire(r, { which: 'live', viewer: user }))
        .filter(Boolean);
    },

    /** A short hash that changes whenever the catalog a user sees changes. */
    catalogVersion(products, brandList) {
      const h = crypto.createHash('sha1');
      for (const p of products) h.update(`${p.id}:${p.revision}:${p.updatedAt}:${p.status};`);
      for (const b of brandList) h.update(`${b.id}:${b.slug}:${b.name}:${b.verified}:${b.logoUrl};`);
      return h.digest('hex').slice(0, 12);
    },
  };
  return svc;
}
