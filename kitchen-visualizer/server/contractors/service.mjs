// The Contractor program's data (PLANS_AND_CONTRACTORS §4): the company profile, which
// brands they carry, and their price book. Costs live here and only ever leave through the
// contractor's own /api/pro routes; everything a client can see goes through the
// sell-price functions at the bottom.

import { HttpError } from '../http/respond.mjs';
import { PRODUCT_ID_RE } from '../lib/ids.mjs';

export const PRODUCT_LIMIT = 500;
const BRAND_ID_RE = /^b_[a-z0-9]{6,40}$/;
const LINE_KEY_RE = /^line:.{1,60}$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (n) => Math.round(n * 100) / 100;
const parse = (s) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/** A brand-settings key: 'builtin', 'own', a brand id, or 'line:<name>' (stored lower-case). */
export function brandKey(raw) {
  if (typeof raw !== 'string') return null;
  const k = raw.trim();
  if (k === 'builtin' || k === 'own' || BRAND_ID_RE.test(k)) return k;
  if (LINE_KEY_RE.test(k)) return `line:${k.slice(5).trim().toLowerCase()}`;
  return null;
}

export function createContractorService({ db, now, services }) {
  const profileRow = (userId) => (userId ? db.prepare('SELECT * FROM contractor_profiles WHERE user_id = ?').get(userId) ?? null : null);

  const logoUrl = (fileId) => {
    const f = fileId ? services.files.get(fileId) : null;
    return f ? services.files.url(f) : null;
  };

  const svc = {
    PRODUCT_LIMIT,
    profileRow,

    profileWire(r) {
      if (!r) return null;
      return {
        company: r.company,
        logoFileId: r.logo_file_id ?? null,
        logoUrl: logoUrl(r.logo_file_id),
        phone: r.phone,
        email: r.email,
        website: r.website,
        serviceArea: r.service_area,
        defaultMarkupPct: r.default_markup_pct,
        taxPct: r.tax_pct,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },

    /** Who may do what: GET needs the plan or a profile (lapsed = read-only); writes need the plan. */
    access(userId) {
      const plan = services.billing.planOf(userId);
      const profile = profileRow(userId);
      const active = plan.id === 'contractor';
      return { plan, profile, active, allowed: active || !!profile, readOnly: !active };
    },

    brandSettings(userId) {
      const out = {};
      for (const r of db.prepare('SELECT * FROM carried_brands WHERE user_id = ?').all(userId)) {
        out[r.brand_key] = { enabled: !!r.enabled, pctOffList: r.pct_off_list ?? null, markupPct: r.markup_pct ?? null };
      }
      return out;
    },

    setBrandSetting(userId, key, patch) {
      const cur = svc.brandSettings(userId)[key] ?? { enabled: true, pctOffList: null, markupPct: null };
      const next = { ...cur, ...patch };
      db.prepare(
        `INSERT INTO carried_brands (user_id, brand_key, enabled, pct_off_list, markup_pct) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, brand_key) DO UPDATE SET enabled = excluded.enabled, pct_off_list = excluded.pct_off_list, markup_pct = excluded.markup_pct`,
      ).run(userId, key, next.enabled ? 1 : 0, next.pctOffList, next.markupPct);
      return next;
    },

    priceRows(userId) {
      const out = {};
      for (const r of db.prepare('SELECT * FROM price_book WHERE user_id = ?').all(userId)) {
        out[r.product_id] = { costCents: r.cost_cents ?? null, costByWidth: parse(r.cost_by_width), markupPct: r.markup_pct ?? null };
      }
      return out;
    },

    /** Upserts one product's costs and markup; `undefined` fields keep their value, `null` clears. */
    setPriceRow(userId, productId, patch) {
      const cur = svc.priceRows(userId)[productId] ?? { costCents: null, costByWidth: null, markupPct: null };
      const next = { ...cur };
      for (const k of ['costCents', 'costByWidth', 'markupPct']) if (patch[k] !== undefined) next[k] = patch[k];
      if (next.costByWidth && !Object.keys(next.costByWidth).length) next.costByWidth = null;
      if (next.costCents === null && next.costByWidth === null && next.markupPct === null) {
        db.prepare('DELETE FROM price_book WHERE user_id = ? AND product_id = ?').run(userId, productId);
        return next;
      }
      db.prepare(
        `INSERT INTO price_book (user_id, product_id, cost_cents, cost_by_width, markup_pct, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, product_id) DO UPDATE SET cost_cents = excluded.cost_cents, cost_by_width = excluded.cost_by_width,
           markup_pct = excluded.markup_pct, updated_at = excluded.updated_at`,
      ).run(userId, productId, next.costCents, next.costByWidth ? JSON.stringify(next.costByWidth) : null, next.markupPct, now());
      return next;
    },

    /** Everything needed to price this contractor's kitchens (PriceBookData), or null if not a contractor. */
    priceBookFor(userId) {
      const p = profileRow(userId);
      if (!p) return null;
      return { defaultMarkupPct: p.default_markup_pct, taxPct: p.tax_pct, brands: svc.brandSettings(userId), rows: svc.priceRows(userId) };
    },

    /** The contractor's own products (not archived unless asked), as product rows. */
    ownRows(userId, { archived = false } = {}) {
      return db
        .prepare(`SELECT id FROM products WHERE source = 'contractor' AND owner_user_id = ? ${archived ? '' : "AND status <> 'archived'"} ORDER BY created_at`)
        .all(userId)
        .map((r) => services.products.get(r.id))
        .filter(Boolean);
    },

    ownCount(userId) {
      return db.prepare("SELECT COUNT(*) AS n FROM products WHERE source = 'contractor' AND owner_user_id = ? AND status <> 'archived'").get(userId).n;
    },

    /** A product id the contractor may price: theirs, a built-in, or a public product they can see. */
    assertPriceable(user, productId, builtinIds) {
      if (builtinIds.has(productId)) return;
      if (PRODUCT_ID_RE.test(productId)) {
        const row = services.products.get(productId);
        if (row && ((row.source === 'contractor' && row.ownerUserId === user.id) || services.products.inCatalog(row, user))) return;
      }
      throw new HttpError(404, 'That product isn’t in your catalog.');
    },

    branding(userId) {
      const p = profileRow(userId);
      if (!p) return null;
      const out = { company: p.company };
      const logo = logoUrl(p.logo_file_id);
      if (logo) out.logoUrl = logo;
      for (const [k, col] of [
        ['phone', 'phone'],
        ['email', 'email'],
        ['website', 'website'],
      ]) {
        if (p[col]) out[k] = p[col];
      }
      return out;
    },
  };
  return svc;
}

// ── validation of contractor input ───────────────────────────────────────

export function readCents(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isNum(v) || v < 0 || v > 100_000_000) throw new HttpError(400, 'Costs must be between $0 and $1,000,000.', { field });
  return Math.round(v);
}

export function readPct(v, field, max = 1000) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isNum(v) || v < 0 || v > max) throw new HttpError(400, `Use a percentage between 0 and ${max}.`, { field });
  return round2(v);
}

export function readCostByWidth(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Costs per width must be a list of widths.', { field: 'costByWidth' });
  const entries = Object.entries(v);
  if (entries.length > 16) throw new HttpError(400, 'At most 16 widths.', { field: 'costByWidth' });
  const out = {};
  for (const [w, cents] of entries) {
    const n = Number(w);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(w) || n < 1 || n > 240) throw new HttpError(400, `“${w}” isn’t a width in inches.`, { field: 'costByWidth' });
    if (cents === null || cents === '') continue;
    out[String(n)] = readCents(cents, 'costByWidth');
  }
  return out;
}
