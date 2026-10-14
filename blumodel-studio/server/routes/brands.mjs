// Package B2: the brand page inside the Contractor account (BRAND_PAGE.md, BUILD_PLAN §16).
//
//   /api/pro/brand/…          the contractor's Brand page tab: settings, products, leads,
//                             analytics. Contractor plan only; lapsed = read-only (GET).
//   /api/brands/by-slug/…     the public page, its lead form and its beacons.
//   /api/admin/…              moderation of pages and products, and every brand (counts only
//                             for leads: their contents stay with the contractor).
//
// The heavy lifting (public copies, lapse, analytics) is in server/brands/service.mjs.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { PRODUCT_ID_RE, randomId } from '../lib/ids.mjs';
import { loadKit } from '../lib/kit.mjs';
import { createBrandPageService, LEAD_STATUSES, PRICE_DISPLAYS, SLUG_RE, pageStatusOf, specDiff } from '../brands/service.mjs';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+().\-\s]{3,40}$/;
const LEAD_ID_RE = /^ld_[a-z0-9]{24}$/;
const PROJECT_ID_RE = /^[0-9a-f-]{36}$/;
/** Package E's share-link token (24 random bytes, base64url). */
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
/** The lead form's hidden trap field: people never see it, form-filling bots do. */
export const HONEYPOT = 'website_url';

function httpsOrEmpty(v, field) {
  const s = str(v, 300);
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
    return u.toString();
  } catch {
    throw new HttpError(400, 'That website doesn’t look right.', { field });
  }
}

/**
 * A small in-memory window counter keyed by a hash (never a raw IP), LRU-capped. Used for the
 * per-page lead limit and to count a page view once per visitor per half hour.
 */
function createMemo({ max = 5_000 } = {}) {
  const map = new Map();
  return {
    hit(key, limit, windowMs, t) {
      const e = map.get(key);
      const cur = e && t - e.start < windowMs ? e : { count: 0, start: t };
      cur.count += 1;
      map.delete(key);
      map.set(key, cur);
      while (map.size > max) map.delete(map.keys().next().value);
      return cur.count <= limit;
    },
  };
}
const hashKey = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
const newBrandId = () => randomId('b_');

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services, config } = ctx;

  /**
   * A share-link token (package E's share_links table, read-only here) if it is live and was made
   * by this user for this kitchen; null otherwise, including before package E's table exists.
   */
  let shareTable = false;
  const liveShareToken = (token, projectId, userId) => {
    shareTable ||= !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'share_links'").get();
    if (!shareTable) return null;
    const row = db
      .prepare('SELECT token FROM share_links WHERE token = ? AND project_id = ? AND created_by = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)')
      .get(token, projectId, userId, ctx.now());
    return row?.token ?? null;
  };
  const { products, files } = services;
  const pages = createBrandPageService({ db, now: ctx.now, services, config, log: ctx.log });
  const leadMemo = createMemo();
  const viewMemo = createMemo();
  const limitsOn = config.RATE_LIMITS !== 'off';

  // A lapsed contractor's products must leave the catalog at the moment the plan lapses, not when
  // someone next opens the brand page. A plan lapses with time, so there is no event to hang this
  // on: the products service runs this guard before every catalog read instead.
  products.addCatalogGuard(() => pages.syncVisibilityDue());
  const maintenance = ctx.maintenance;
  ctx.maintenance = () => {
    maintenance?.();
    pages.syncAll().catch((err) => ctx.log?.warn?.('brand sync failed', err));
  };
  // For other packages: the contractor's brand page at a glance (no lead contents).
  services.brandPages = {
    ofOwner: (userId) => pages.ofOwner(userId),
    summaryFor: (userId) => pages.summary(pages.ofOwner(userId)),
    syncVisibilityDue: () => pages.syncVisibilityDue(),
    /**
     * Re-projects a contractor's live products after a My-catalog or price-book write: new prices
     * go straight to the page, content edits go back to review (the live version stays public).
     * Package H can call it after its writes; until then it runs when the Brand page tab or the
     * moderation queue is opened, and every 10 minutes from ctx.maintenance.
     */
    syncOwner: async (userId) => {
      const b = pages.ofOwner(userId);
      if (b) await pages.syncBrand(b);
    },
  };
  void loadKit().catch(() => {});

  // ── access ──────────────────────────────────────────────────────────────
  /** Contractor plan, or a lapsed contractor (read-only). Everyone else: 403, like /api/pro. */
  const gate = (rc, { write = false } = {}) => {
    const a = pages.access(rc.user.id);
    if (!a.allowed) throw new HttpError(403, 'Brand pages are part of the Contractor plan.', { needs: 'contractor' });
    if (write && !a.active) throw new HttpError(403, 'Your Contractor plan has lapsed. Renew to keep selling.', { needs: 'renew' });
    if (!a.profile) throw new HttpError(409, 'Set up your company first.', { needs: 'profile' });
    return a;
  };

  const myBrand = (rc) => pages.ofOwner(rc.user.id);
  const needBrand = (rc) => {
    const b = myBrand(rc);
    if (!b) throw new HttpError(409, 'Set up your brand page first.', { needs: 'brand' });
    return b;
  };

  /** A My-catalog product of the caller's (not archived). */
  const ownSource = (rc, id) => {
    const row = PRODUCT_ID_RE.test(id) ? products.get(id) : null;
    if (!row || row.source !== 'contractor' || row.ownerUserId !== rc.user.id) throw new HttpError(404, 'That product isn’t in your catalog.');
    if (row.status === 'archived') throw new HttpError(400, 'Restore this product in My catalog first.');
    return row;
  };

  const sourceRows = (userId) =>
    db
      .prepare("SELECT id FROM products WHERE source = 'contractor' AND owner_user_id = ? AND status <> 'archived' ORDER BY created_at")
      .all(userId)
      .map((r) => products.get(r.id))
      .filter(Boolean);

  /** The submit checklist for the page itself. */
  const pageChecks = (brand, profile) => [
    { id: 'name', label: 'A public name', ok: !!brand?.name },
    { id: 'tagline', label: 'A tagline', ok: !!brand?.tagline },
    { id: 'contact', label: 'A phone number or website in Company (Mise checks the business is real)', ok: !!(profile?.phone || profile?.website) },
  ];

  const defaultsFrom = (profile) => {
    const f = profile?.logo_file_id ? files.get(profile.logo_file_id) : null;
    return {
      name: profile?.company ?? '',
      slug: profile?.company ? services.brands.uniqueSlug(profile.company) : '',
      website: profile?.website ?? '',
      phone: profile?.phone ?? '',
      email: profile?.email ?? '',
      serviceArea: profile?.service_area ?? '',
      logoUrl: f ? files.url(f) : null,
    };
  };

  const notesFor = (brandId) =>
    db
      .prepare("SELECT action, note, created_at FROM brand_moderation_log WHERE brand_id = ? AND product_id IS NULL AND note <> '' ORDER BY id DESC LIMIT 5")
      .all(brandId)
      .map((r) => ({ action: r.action, note: r.note, at: r.created_at }));

  async function brandState(rc, a) {
    let brand = myBrand(rc);
    if (brand) brand = await pages.syncBrand(brand);
    return {
      brand: brand ? pages.ownerWire(brand) : null,
      defaults: defaultsFrom(a.profile),
      checks: pageChecks(brand, a.profile),
      readOnly: a.readOnly,
      limit: config.BRAND_PRODUCT_LIMIT,
      liveCount: brand ? pages.liveCount(brand.id) : 0,
      leads: brand ? pages.leadCounts(brand.id) : { total: 0, byStatus: {}, unread: 0 },
      history: brand ? notesFor(brand.id) : [],
    };
  }

  /** A contractor product as the Brand page → Products list shows it. */
  function productEntry(source, brand, book, kit) {
    const wire = products.toWire(source, { which: 'working' });
    const listing = pages.listingOf(source.id);
    const copy = listing ? products.get(listing.product_id) : null;
    const readiness = pages.readiness(source, brand ?? { priceDisplay: 'from' }, book, kit);
    let publicPrice = null;
    try {
      publicPrice = brand ? pages.publicSpec(source, brand, book, kit).price : null;
    } catch {
      publicPrice = null;
    }
    return {
      id: source.id,
      name: wire.name,
      line: wire.line ?? null,
      sku: wire.sku ?? '',
      kind: wire.kind,
      category: wire.category,
      widthIn: wire.widthIn,
      depthIn: wire.depthIn,
      heightIn: wire.heightIn,
      widthOptions: wire.widthOptions ?? null,
      thumbnailUrl: wire.thumbnailUrl ?? null,
      hasModel: !!wire.model,
      product: wire,
      readiness,
      publicPrice,
      listing: copy
        ? {
            copyId: copy.id,
            status: copy.status,
            hasLive: !!copy.liveSpec,
            live: !!copy.liveSpec && copy.status !== 'archived' && brand?.status === 'active',
            pendingEdit: copy.status === 'submitted' && !!copy.liveSpec,
            reviewNote: copy.reviewNote,
            submittedAt: copy.submittedAt,
            publishedAt: copy.publishedAt,
          }
        : null,
    };
  }

  // ── admin helpers ───────────────────────────────────────────────────────
  const userBrief = (id) => {
    if (!id) return null;
    const u = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id);
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  };

  const adminBrandWire = (row) => {
    const live = db.prepare("SELECT COUNT(*) AS n FROM products WHERE brand_id = ? AND live_spec IS NOT NULL AND status <> 'archived'").get(row.id).n;
    const p = row.kind === 'contractor' ? pages.profileOf(row.ownerUserId) : null;
    return {
      ...pages.ownerWire(row),
      owner: userBrief(row.ownerUserId),
      company: p ? { company: p.company, phone: p.phone, email: p.email, website: p.website, serviceArea: p.service_area } : null,
      planActive: row.kind === 'contractor' ? pages.planActive(row.ownerUserId) : null,
      liveProducts: live,
      // Counts only: what a lead says stays between the homeowner and the contractor.
      leadCount: db.prepare('SELECT COUNT(*) AS n FROM leads WHERE brand_id = ?').get(row.id).n,
    };
  };

  function glbReport(spec) {
    const f = spec?.modelFileId ? files.get(spec.modelFileId) : null;
    if (!f) return null;
    const m = f.meta ?? {};
    const declared = { w: spec.widthIn, h: spec.heightIn, d: spec.depthIn };
    const mismatches = [];
    if (m.bboxIn) {
      for (const k of ['w', 'h', 'd']) {
        const a = m.bboxIn[k];
        const b = declared[k];
        if (b > 0 && Math.abs(a - b) / b > 0.05) mismatches.push({ axis: k, model: Math.round(a * 10) / 10, declared: b });
      }
    }
    return { sizeBytes: f.sizeBytes, triangles: m.triangles ?? null, slots: m.slots ?? [], materials: m.materials ?? [], bboxIn: m.bboxIn ?? null, declared, mismatches, warnings: m.warnings ?? [] };
  }

  const reviewWire = (copy) => {
    const brand = pages.get(copy.brandId);
    const listing = pages.listingByCopy(copy.id);
    return {
      id: copy.id,
      brand: brand ? { id: brand.id, name: brand.name, slug: brand.slug, kind: brand.kind, pageStatus: pageStatusOf(brand) } : null,
      sourceId: listing?.source_product_id ?? null,
      status: copy.status,
      submittedAt: copy.submittedAt,
      working: products.toWire(copy, { which: 'working' }),
      live: copy.liveSpec ? products.toWire(copy, { which: 'live' }) : null,
      diff: copy.liveSpec ? specDiff(copy.liveSpec, copy.spec) : [],
      glb: glbReport(copy.spec),
      history: db
        .prepare('SELECT action, note, created_at FROM brand_moderation_log WHERE product_id = ? ORDER BY id DESC LIMIT 6')
        .all(copy.id)
        .map((r) => ({ action: r.action, note: r.note, at: r.created_at })),
    };
  };

  const adminBrand = (id) => {
    const b = pages.get(id);
    if (!b) throw new HttpError(404, 'That brand does not exist.');
    return b;
  };

  const touchBrand = (id, sets, args) => db.prepare(`UPDATE brands SET ${sets}, updated_at = ? WHERE id = ?`).run(...args, ctx.now(), id);

  // ── public helpers ──────────────────────────────────────────────────────
  /** A live page, or the same 404 for unknown, pending, lapsed and suspended ones. */
  const livePage = (slug) => {
    pages.syncVisibilityDue();
    let b = pages.bySlug(slug);
    if (b) b = pages.syncVisibility(b);
    if (!b || b.status !== 'active') throw new HttpError(404, 'This page is unavailable.');
    return b;
  };

  return [
    // ═══ the contractor's Brand page tab ════════════════════════════════════
    {
      method: 'GET',
      path: '/api/pro/brand',
      handler: async (rc) => brandState(rc, gate(rc)),
    },
    {
      method: 'PUT',
      path: '/api/pro/brand',
      rateLimit: { name: 'pro-brand-save', max: 300, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        const a = gate(rc, { write: true });
        const b = rc.body;
        let brand = myBrand(rc);
        const t = ctx.now();
        const name = b.name === undefined ? brand?.name ?? a.profile.company : str(b.name, 80);
        if (!name) throw new HttpError(400, 'Give your page a public name.', { field: 'name' });
        if (brand?.liveAt && name !== brand.name) throw new HttpError(400, 'Your public name is set once your page has been live. Ask Mise to change it.', { field: 'name' });
        let slug = brand?.slug;
        if (b.slug !== undefined || !brand) {
          const wanted = b.slug === undefined ? services.brands.uniqueSlug(name) : str(b.slug, 60).toLowerCase();
          if (wanted !== brand?.slug) {
            if (brand?.liveAt) throw new HttpError(400, 'The page address can’t change once the page has been live.', { field: 'slug' });
            if (!SLUG_RE.test(wanted) || wanted.length < 2) throw new HttpError(400, 'Use 2–60 lowercase letters, digits and dashes.', { field: 'slug' });
            const taken = db.prepare('SELECT id FROM brands WHERE slug = ?').get(wanted);
            if (taken && taken.id !== brand?.id) throw new HttpError(409, 'That page address is taken. Try another.', { field: 'slug' });
            slug = wanted;
          }
        }
        const tagline = b.tagline === undefined ? brand?.tagline ?? '' : str(b.tagline, 200);
        if (tagline.length > 80) throw new HttpError(400, 'Keep the tagline to 80 characters.', { field: 'tagline' });
        const about = b.about === undefined ? brand?.about ?? '' : str(b.about, 2000);
        if (about.length > 600) throw new HttpError(400, 'Keep “About” to 600 characters.', { field: 'about' });
        const priceDisplay = b.priceDisplay === undefined ? brand?.priceDisplay ?? 'from' : b.priceDisplay;
        if (!PRICE_DISPLAYS.includes(priceDisplay)) throw new HttpError(400, 'Choose how prices show: from, show or on request.', { field: 'priceDisplay' });
        const flag = (k, def) => {
          if (b[k] === undefined) return brand ? (brand[k] ? 1 : 0) : def;
          if (typeof b[k] !== 'boolean') throw new HttpError(400, `${k} is true or false.`, { field: k });
          return b[k] ? 1 : 0;
        };
        const leadForm = flag('leadForm', 1);
        const showPhone = flag('showPhone', 0);
        const showEmail = flag('showEmail', 0);
        let cover = brand?.coverFileId ?? null;
        if (b.coverFileId !== undefined) {
          if (b.coverFileId === null || b.coverFileId === '') cover = null;
          else cover = files.assertUsable(String(b.coverFileId), { userId: rc.user.id, kinds: ['image'] }).id;
        }
        ctx.tx(() => {
          if (!brand) {
            const id = newBrandId();
            db.prepare(
              `INSERT INTO brands (id, slug, name, tagline, description, website, logo_file_id, status, status_note, verified_at, is_demo, created_by, created_at, updated_at,
                                   kind, owner_user_id, cover_file_id, price_display, lead_form, show_phone, show_email)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', NULL, 0, ?, ?, ?, 'contractor', ?, ?, ?, ?, ?, ?)`,
            ).run(id, slug, name, tagline, about, a.profile.website ?? '', a.profile.logo_file_id ?? null, rc.user.id, t, t, rc.user.id, cover, priceDisplay, leadForm, showPhone, showEmail);
            db.prepare("INSERT OR IGNORE INTO brand_members (brand_id, user_id, member_role, created_at) VALUES (?, ?, 'owner', ?)").run(id, rc.user.id, t);
            pages.log('create', { brandId: id, by: rc.user.id });
          } else {
            touchBrand(brand.id, 'slug = ?, name = ?, tagline = ?, description = ?, cover_file_id = ?, price_display = ?, lead_form = ?, show_phone = ?, show_email = ?', [
              slug,
              name,
              tagline,
              about,
              cover,
              priceDisplay,
              leadForm,
              showPhone,
              showEmail,
            ]);
          }
        });
        brand = myBrand(rc);
        // A live page's new cover is public straight away (the business is already verified).
        if (cover && brand.status === 'active') files.setVisibility(cover, 'public');
        return brandState(rc, a);
      },
    },
    {
      method: 'POST',
      path: '/api/pro/brand/submit',
      handler: async (rc) => {
        const a = gate(rc, { write: true });
        const brand = needBrand(rc);
        const st = pageStatusOf(brand);
        if (st === 'in_review') return brandState(rc, a);
        if (st !== 'draft' && st !== 'rejected') throw new HttpError(409, 'Your page has already been reviewed.');
        const checks = pageChecks(brand, a.profile);
        const missing = checks.filter((c) => !c.ok);
        if (missing.length) throw new HttpError(400, `Before you submit: ${missing.map((c) => c.label.toLowerCase()).join('; ')}.`, { checks });
        touchBrand(brand.id, "status = 'pending', status_note = '', submitted_at = ?", [ctx.now()]);
        pages.log('submit', { brandId: brand.id, by: rc.user.id });
        return brandState(rc, a);
      },
    },
    {
      method: 'GET',
      path: '/api/pro/brand/preview',
      handler: async (rc) => {
        gate(rc);
        const brand = await pages.syncBrand(needBrand(rc));
        return { brand: pages.publicWire(brand), products: pages.previewProducts(brand), preview: true, pageStatus: pageStatusOf(brand) };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/brand/summary',
      handler: (rc) => {
        gate(rc);
        let brand = myBrand(rc);
        if (brand) brand = pages.syncVisibility(brand);
        return { summary: pages.summary(brand) };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/brand/products',
      handler: async (rc) => {
        const a = gate(rc);
        let brand = myBrand(rc);
        if (brand) brand = await pages.syncBrand(brand);
        const kit = await loadKit().catch(() => null);
        const book = pages.bookOf(rc.user.id);
        return {
          brand: brand ? pages.ownerWire(brand) : null,
          readOnly: a.readOnly,
          limit: config.BRAND_PRODUCT_LIMIT,
          liveCount: brand ? pages.liveCount(brand.id) : 0,
          products: sourceRows(rc.user.id).map((s) => productEntry(s, brand, book, kit)),
        };
      },
    },
    {
      method: 'POST',
      path: '/api/pro/brand/products/:productId/publish',
      handler: async (rc) => {
        gate(rc, { write: true });
        const brand = needBrand(rc);
        const kit = await loadKit().catch(() => null);
        const source = ownSource(rc, rc.params.productId);
        const out = ctx.tx(() => pages.publish(brand, source, { by: rc.user.id }));
        return { status: out.status, product: productEntry(products.get(source.id), pages.get(brand.id), pages.bookOf(rc.user.id), kit), liveCount: pages.liveCount(brand.id) };
      },
    },
    {
      method: 'POST',
      path: '/api/pro/brand/products/:productId/unpublish',
      handler: async (rc) => {
        gate(rc, { write: true });
        const brand = needBrand(rc);
        const row = PRODUCT_ID_RE.test(rc.params.productId) ? products.get(rc.params.productId) : null;
        if (!row || row.source !== 'contractor' || row.ownerUserId !== rc.user.id) throw new HttpError(404, 'That product isn’t in your catalog.');
        pages.unpublish(brand, row, { by: rc.user.id });
        const kit = await loadKit().catch(() => null);
        return { product: productEntry(row, brand, pages.bookOf(rc.user.id), kit), liveCount: pages.liveCount(brand.id) };
      },
    },
    {
      // Publish whole line: every product of the line that's ready; the rest say why not.
      method: 'POST',
      path: '/api/pro/brand/lines/publish',
      handler: async (rc) => {
        gate(rc, { write: true });
        const brand = needBrand(rc);
        await loadKit().catch(() => null);
        const line = str(rc.body.line, 60).toLowerCase();
        const rows = sourceRows(rc.user.id).filter((r) => (r.spec?.line ?? '').trim().toLowerCase() === line);
        if (!rows.length) throw new HttpError(404, 'No products in that line.');
        const published = [];
        const skipped = [];
        for (const r of rows) {
          try {
            const out = ctx.tx(() => pages.publish(brand, r, { by: rc.user.id }));
            published.push({ id: r.id, name: r.name, status: out.status });
          } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            skipped.push({ id: r.id, name: r.name, reason: err.message, readiness: err.extra?.readiness ?? null });
          }
        }
        return { published, skipped, liveCount: pages.liveCount(brand.id) };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/brand/leads',
      handler: (rc) => {
        gate(rc);
        const brand = myBrand(rc);
        if (!brand) return { leads: [], counts: { total: 0, byStatus: {}, unread: 0 } };
        const status = rc.query.get('status');
        const rows =
          status && LEAD_STATUSES.includes(status)
            ? db.prepare('SELECT * FROM leads WHERE brand_id = ? AND status = ? ORDER BY created_at DESC, id LIMIT 500').all(brand.id, status)
            : db.prepare('SELECT * FROM leads WHERE brand_id = ? ORDER BY created_at DESC, id LIMIT 500').all(brand.id);
        return { leads: rows.map(pages.leadWire), counts: pages.leadCounts(brand.id) };
      },
    },
    {
      method: 'PATCH',
      path: '/api/pro/brand/leads/:leadId',
      handler: (rc) => {
        gate(rc, { write: true });
        const brand = needBrand(rc);
        const lead = LEAD_ID_RE.test(rc.params.leadId) ? db.prepare('SELECT * FROM leads WHERE id = ? AND brand_id = ?').get(rc.params.leadId, brand.id) : null;
        if (!lead) throw new HttpError(404, 'That lead does not exist.');
        const status = rc.body.status === undefined ? lead.status : rc.body.status;
        if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, 'Status is new, contacted, won or lost.', { field: 'status' });
        const notes = rc.body.notes === undefined ? lead.notes : str(rc.body.notes, 4000);
        const t = ctx.now();
        db.prepare('UPDATE leads SET status = ?, notes = ?, read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ?').run(status, notes, t, t, lead.id);
        return { lead: pages.leadWire(db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)), counts: pages.leadCounts(brand.id) };
      },
    },
    {
      // Marks leads read (the badge). Allowed while lapsed: it changes nothing anyone else sees.
      method: 'POST',
      path: '/api/pro/brand/leads/read',
      handler: (rc) => {
        gate(rc);
        const brand = needBrand(rc);
        const ids = Array.isArray(rc.body.ids) ? rc.body.ids.filter((x) => typeof x === 'string' && LEAD_ID_RE.test(x)).slice(0, 500) : [];
        const t = ctx.now();
        const upd = db.prepare('UPDATE leads SET read_at = ? WHERE id = ? AND brand_id = ? AND read_at IS NULL');
        ctx.tx(() => {
          for (const id of ids) upd.run(t, id, brand.id);
        });
        return { counts: pages.leadCounts(brand.id) };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/brand/analytics',
      handler: (rc) => {
        gate(rc);
        const brand = myBrand(rc);
        const days = Number(rc.query.get('days') || 30);
        if (![7, 30, 90].includes(days)) throw new HttpError(400, 'Choose 7, 30 or 90 days.');
        if (!brand) return { analytics: null };
        return { analytics: { ...pages.analytics(brand.id, days), isDemo: brand.isDemo } };
      },
    },

    // ═══ public ═════════════════════════════════════════════════════════════
    {
      method: 'GET',
      path: '/api/brands/by-slug/:slug',
      auth: 'none',
      handler: (rc) => {
        const brand = livePage(rc.params.slug);
        return { brand: pages.publicWire(brand), products: pages.liveProducts(brand, null) };
      },
    },
    {
      // What a product page needs for its "Request a quote" button.
      method: 'GET',
      path: '/api/brands/by-slug/:slug/contact',
      auth: 'none',
      handler: (rc) => {
        const brand = livePage(rc.params.slug);
        const w = pages.publicWire(brand);
        return { brand: { slug: w.slug, name: w.name, kind: w.kind, verified: w.verified, leadForm: w.leadForm, logoUrl: w.logoUrl, isDemo: w.isDemo } };
      },
    },
    {
      method: 'POST',
      path: '/api/brands/by-slug/:slug/events',
      auth: 'optional',
      maxBytes: 4_096,
      rateLimit: { name: 'brand-events', max: 600, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const type = rc.body.type;
        if (type !== 'brand_view' && type !== 'quote_click') throw new HttpError(400, 'Unknown event type.');
        let brand;
        try {
          brand = livePage(rc.params.slug);
        } catch {
          return rc.send(204);
        }
        let productId = null;
        if (typeof rc.body.productId === 'string' && PRODUCT_ID_RE.test(rc.body.productId)) {
          const p = products.get(rc.body.productId);
          if (p?.brandId === brand.id) productId = p.id;
        }
        // One page view per visitor per half hour; the key is a hash, the IP is never kept.
        if (type === 'brand_view' && !viewMemo.hit(hashKey('view', rc.ip, brand.id), 1, 30 * 60_000, ctx.now())) return rc.send(204);
        pages.recordEvent(brand.id, type, { productId, userId: rc.user?.id ?? null });
        return rc.send(204);
      },
    },
    {
      method: 'POST',
      path: '/api/brands/by-slug/:slug/leads',
      auth: 'optional',
      maxBytes: 16_384,
      rateLimit: { name: 'brand-lead', max: 5, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const brand = livePage(rc.params.slug);
        if (brand.kind !== 'contractor' || !brand.leadForm) throw new HttpError(404, 'This page isn’t taking requests right now.');
        const b = rc.body;
        // A filled trap field is a bot: say thanks, keep nothing.
        if (typeof b[HONEYPOT] === 'string' && b[HONEYPOT].trim()) return rc.send(201, { ok: true, company: brand.name });
        const name = str(b.name, 80);
        if (!name) throw new HttpError(400, 'Tell them your name.', { field: 'name' });
        const email = str(b.email, 254).toLowerCase();
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right.', { field: 'email' });
        const phone = str(b.phone, 40);
        if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'That phone number doesn’t look right.', { field: 'phone' });
        const location = str(b.location, 80);
        const message = str(b.message, 2000);
        if (b.consent !== true) throw new HttpError(400, `Tick the box to share your details with ${brand.name}.`, { field: 'consent' });
        let productId = null;
        let productName = '';
        if (b.productId != null && b.productId !== '') {
          const p = typeof b.productId === 'string' && PRODUCT_ID_RE.test(b.productId) ? products.get(b.productId) : null;
          if (!p || p.brandId !== brand.id || !products.inCatalog(p, null)) throw new HttpError(400, 'That product isn’t on this page.', { field: 'productId' });
          productId = p.id;
          productName = p.liveSpec?.name ?? p.name;
        }
        let projectId = null;
        let projectName = '';
        let shareToken = null;
        if (b.projectId != null && b.projectId !== '') {
          if (!rc.user) throw new HttpError(401, 'Sign in to attach one of your kitchens.');
          const pr = typeof b.projectId === 'string' && PROJECT_ID_RE.test(b.projectId) ? db.prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ?').get(b.projectId, rc.user.id) : null;
          if (!pr) throw new HttpError(400, 'Choose one of your kitchens.', { field: 'projectId' });
          projectId = pr.id;
          projectName = pr.name;
          // The view-only link: the form makes one through package E's share API and sends its
          // token; it's kept only if it is a live link this user made for this very kitchen.
          if (typeof b.shareToken === 'string' && SHARE_TOKEN_RE.test(b.shareToken)) shareToken = liveShareToken(b.shareToken, pr.id, rc.user.id);
          const share = services.share;
          if (!shareToken && share && typeof share.createViewLink === 'function') {
            try {
              shareToken = share.createViewLink({ projectId: pr.id, userId: rc.user.id, label: `Sent to ${brand.name}` })?.token ?? null;
            } catch {
              shareToken = null;
            }
          }
        }
        // Per page too: three requests a day from one visitor is plenty (hash key, no IP kept).
        if (limitsOn && !leadMemo.hit(hashKey('lead', rc.ip, brand.id), 3, 86_400_000, ctx.now())) {
          const err = new HttpError(429, `You’ve already sent ${brand.name} a few requests today. They’ll be in touch.`);
          err.retryAfter = 3600;
          throw err;
        }
        pages.createLead(brand, { productId, productName, projectId, projectName, shareToken, name, email, phone, location, message, userId: rc.user?.id ?? null });
        rc.send(201, { ok: true, company: brand.name });
      },
    },

    // ═══ admin ═════════════════════════════════════════════════════════════
    {
      method: 'GET',
      path: '/api/admin/moderation',
      auth: 'admin',
      handler: async () => {
        await pages.syncAll();
        const brands = db
          .prepare("SELECT * FROM brands WHERE status = 'pending' AND submitted_at IS NOT NULL ORDER BY submitted_at")
          .all()
          .map((r) => adminBrandWire(pages.toRow(r)));
        const queue = db
          .prepare("SELECT id FROM products WHERE status = 'submitted' AND brand_id IS NOT NULL ORDER BY submitted_at, id")
          .all()
          .map((r) => products.get(r.id))
          .filter(Boolean)
          .map(reviewWire);
        return { brands, products: queue };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/brand-pages/:id/preview',
      auth: 'admin',
      handler: async (rc) => {
        const brand = await pages.syncBrand(adminBrand(rc.params.id));
        return { brand: pages.publicWire(brand), products: pages.previewProducts(brand), preview: true, pageStatus: pageStatusOf(brand) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/brand-pages/:id/approve',
      auth: 'admin',
      handler: (rc) => {
        let brand = adminBrand(rc.params.id);
        if (pageStatusOf(brand) !== 'in_review') throw new HttpError(409, 'That page isn’t waiting for review.');
        const t = ctx.now();
        touchBrand(brand.id, "status = 'active', status_note = '', verified_at = COALESCE(verified_at, ?), live_at = COALESCE(live_at, ?)", [t, t]);
        if (brand.coverFileId) files.setVisibility(brand.coverFileId, 'public');
        pages.log('approve', { brandId: brand.id, by: rc.user.id });
        brand = pages.syncVisibility(pages.get(brand.id));
        return { brand: adminBrandWire(brand) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/brand-pages/:id/reject',
      auth: 'admin',
      handler: (rc) => {
        const brand = adminBrand(rc.params.id);
        const note = str(rc.body.note, 2000);
        if (!note) throw new HttpError(400, 'Say what needs fixing.', { field: 'note' });
        if (pageStatusOf(brand) !== 'in_review') throw new HttpError(409, 'That page isn’t waiting for review.');
        touchBrand(brand.id, "status = 'rejected', status_note = ?, submitted_at = NULL", [note]);
        pages.log('reject', { brandId: brand.id, by: rc.user.id, note });
        return { brand: adminBrandWire(pages.get(brand.id)) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/products/:id/approve',
      auth: 'admin',
      handler: (rc) => {
        const copy = products.get(rc.params.id);
        if (!copy || !copy.brandId) throw new HttpError(404, 'That product does not exist.');
        if (copy.status !== 'submitted') throw new HttpError(409, 'That product isn’t waiting for review.');
        const out = ctx.tx(() => pages.approveProduct(copy, { by: rc.user.id }));
        return { product: reviewWire(out) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/products/:id/reject',
      auth: 'admin',
      handler: (rc) => {
        const copy = products.get(rc.params.id);
        if (!copy || !copy.brandId) throw new HttpError(404, 'That product does not exist.');
        const note = str(rc.body.note, 2000);
        if (!note) throw new HttpError(400, 'Say what needs fixing.', { field: 'note' });
        if (copy.status !== 'submitted') throw new HttpError(409, 'That product isn’t waiting for review.');
        return { product: reviewWire(pages.rejectProduct(copy, note, { by: rc.user.id })) };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/brands',
      auth: 'admin',
      handler: (rc) => {
        pages.syncVisibilityDue();
        const kind = rc.query.get('kind');
        const rows = db
          .prepare('SELECT * FROM brands ORDER BY name COLLATE NOCASE')
          .all()
          .map(pages.toRow)
          .filter((r) => !kind || r.kind === kind);
        return { brands: rows.map(adminBrandWire) };
      },
    },
    {
      // Partner brands: curated catalog content, no login. Contractors make theirs in /pro.
      method: 'POST',
      path: '/api/admin/brands',
      auth: 'admin',
      handler: (rc) => {
        const name = str(rc.body.name, 80);
        if (!name) throw new HttpError(400, 'Name the brand.', { field: 'name' });
        const tagline = str(rc.body.tagline, 80);
        const about = str(rc.body.about, 600);
        const website = httpsOrEmpty(rc.body.website, 'website');
        const id = newBrandId();
        const t = ctx.now();
        db.prepare(
          `INSERT INTO brands (id, slug, name, tagline, description, website, status, status_note, verified_at, is_demo, created_by, created_at, updated_at, kind, live_at, lead_form)
           VALUES (?, ?, ?, ?, ?, ?, 'active', '', NULL, ?, ?, ?, ?, 'partner', ?, 0)`,
        ).run(id, services.brands.uniqueSlug(name), name, tagline, about, website, rc.body.isDemo === true ? 1 : 0, rc.user.id, t, t, t);
        pages.log('create', { brandId: id, by: rc.user.id, note: 'Partner brand.' });
        rc.send(201, { brand: adminBrandWire(pages.get(id)) });
      },
    },
    {
      method: 'PATCH',
      path: '/api/admin/brands/:id',
      auth: 'admin',
      handler: (rc) => {
        const brand = adminBrand(rc.params.id);
        if (brand.kind !== 'partner') throw new HttpError(400, 'A contractor edits their own page.');
        const name = rc.body.name === undefined ? brand.name : str(rc.body.name, 80);
        if (!name) throw new HttpError(400, 'Name the brand.', { field: 'name' });
        const tagline = rc.body.tagline === undefined ? brand.tagline : str(rc.body.tagline, 80);
        const about = rc.body.about === undefined ? brand.about : str(rc.body.about, 600);
        const website = rc.body.website === undefined ? brand.website : httpsOrEmpty(rc.body.website, 'website');
        touchBrand(brand.id, 'name = ?, tagline = ?, description = ?, website = ?', [name, tagline, about, website]);
        return { brand: adminBrandWire(pages.get(brand.id)) };
      },
    },
    ...['suspend', 'reinstate', 'verify', 'unverify'].map((action) => ({
      method: 'POST',
      path: `/api/admin/brands/:id/${action}`,
      auth: 'admin',
      handler: (rc) => {
        const brand = adminBrand(rc.params.id);
        const note = str(rc.body.note, 2000);
        if (action === 'suspend') {
          if (!note) throw new HttpError(400, 'Say why the brand is suspended.', { field: 'note' });
          touchBrand(brand.id, "status = 'suspended', hidden_reason = NULL, status_note = ?", [note]);
        } else if (action === 'reinstate') {
          if (brand.status !== 'suspended') throw new HttpError(409, 'That brand isn’t suspended.');
          touchBrand(brand.id, "status = 'active', hidden_reason = NULL, status_note = '', live_at = COALESCE(live_at, ?)", [ctx.now()]);
          pages.syncVisibility(pages.get(brand.id)); // a contractor whose plan has lapsed stays hidden
        } else if (action === 'verify') touchBrand(brand.id, 'verified_at = ?', [ctx.now()]);
        else touchBrand(brand.id, 'verified_at = NULL', []);
        pages.log(action, { brandId: brand.id, by: rc.user.id, note });
        return { brand: adminBrandWire(pages.get(brand.id)) };
      },
    })),
    {
      method: 'GET',
      path: '/api/admin/brands/:id/products',
      auth: 'admin',
      handler: (rc) => {
        const brand = adminBrand(rc.params.id);
        const rows = db.prepare('SELECT id FROM products WHERE brand_id = ? ORDER BY name COLLATE NOCASE').all(brand.id);
        return {
          products: rows
            .map((r) => products.get(r.id))
            .filter(Boolean)
            .map((p) => ({ ...products.toWire(p, { which: p.liveSpec ? 'live' : 'working' }), status: p.status, reviewNote: p.reviewNote })),
        };
      },
    },
    {
      // Admins add partner products directly (curated content: no review queue).
      method: 'POST',
      path: '/api/admin/brands/:id/products',
      auth: 'admin',
      handler: (rc) => {
        const brand = adminBrand(rc.params.id);
        if (brand.kind !== 'partner') throw new HttpError(400, 'Contractors publish their own products.');
        const v = products.validateSpec(rc.body.spec);
        if (!v.ok) throw new HttpError(400, 'Some product details need fixing.', { errors: v.errors });
        for (const fid of products.fileIdsOf(v.spec)) if (!files.get(fid)) throw new HttpError(400, 'That file can’t be used here.', { fileId: fid });
        const row = products.create({ source: 'brand', brandId: brand.id, visibility: 'public', spec: v.spec });
        const live = products.publish(row.id);
        for (const fid of products.fileIdsOf(live.liveSpec)) files.setVisibility(fid, 'public');
        pages.log('approve', { brandId: brand.id, productId: row.id, by: rc.user.id, note: 'Added by an admin.' });
        rc.send(201, { product: products.toWire(live) });
      },
    },
    ...['unpublish', 'restore'].map((action) => ({
      method: 'POST',
      path: `/api/admin/products/:id/${action}`,
      auth: 'admin',
      handler: (rc) => {
        const p = products.get(rc.params.id);
        if (!p || !p.brandId) throw new HttpError(404, 'That product does not exist.');
        if (action === 'unpublish') products.setStatus(p.id, 'archived');
        else {
          if (!p.liveSpec) throw new HttpError(409, 'That product was never approved.');
          products.setStatus(p.id, 'published');
        }
        pages.log(action, { brandId: p.brandId, productId: p.id, by: rc.user.id });
        const after = products.get(p.id);
        return { product: { ...products.toWire(after, { which: 'live' }), status: after.status } };
      },
    })),
  ];
}
