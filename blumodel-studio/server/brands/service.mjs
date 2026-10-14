// The brand page inside the Contractor account (BRAND_PAGE.md). A contractor's company IS the
// brand: one `brands` row of kind 'contractor' per contractor, owned by them. Partner brands
// (kind 'partner') are curated catalog content created by admins.
//
// Publishing a My-catalog product never makes the private product public. It creates (or
// refreshes) a *public copy*: an ordinary 'brand' product row that the foundation catalog
// already knows how to serve, moderate and track. The copy holds only public fields, and its
// price follows the page's price display (from the contractor's *sell* prices; never cost or
// markup). The private product keeps working exactly as package H built it.
//
//   copy.spec       what the contractor's product looks like now (re-projected on every sync)
//   copy.live_spec  what the public sees: written on approval; price fields follow the price
//                   book and the price display without another review
//
// Plan lapse hides the page (status 'suspended', hidden_reason 'lapsed'), which takes its
// copies out of the catalog through the foundation's rule; renewal restores it, no re-review.

import { HttpError } from '../http/respond.mjs';
import { randomId } from '../lib/ids.mjs';
import { kitIfLoaded, loadKit } from '../lib/kit.mjs';

export const PRICE_DISPLAYS = ['from', 'show', 'on_request'];
export const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'];
export const BRAND_EVENT_TYPES = ['brand_view', 'quote_click', 'lead'];
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** Price fields of a public copy: they follow the price book without another review. */
const PRICE_KEYS = ['price', 'priceByWidth'];
const DAY = 86_400_000;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** JSON with sorted keys, so two specs compare equal whatever order their keys were written in. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

const withoutPrice = (spec) => {
  if (!spec) return null;
  const out = { ...spec };
  for (const k of PRICE_KEYS) delete out[k];
  return out;
};
/** True when two specs differ in anything other than price. */
export const contentDiffers = (a, b) => stableJson(withoutPrice(a)) !== stableJson(withoutPrice(b));

/** The public page states (BRAND_PAGE §2): what the contractor and admins see. */
export function pageStatusOf(row) {
  if (!row) return 'none';
  if (row.status === 'active') return 'live';
  if (row.status === 'rejected') return 'rejected';
  if (row.status === 'suspended') return row.hiddenReason === 'lapsed' ? 'hidden' : 'suspended';
  return row.submittedAt ? 'in_review' : 'draft';
}

/** Field-level differences between two specs (admin moderation). */
export function specDiff(before, after) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const out = [];
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (stableJson(a) !== stableJson(b)) out.push({ field: k, before: a ?? null, after: b ?? null });
  }
  return out;
}

/**
 * @param {{ db: any, now: () => number, services: any, config: any, log?: any }} deps
 */
export function createBrandPageService({ db, now, services, config, log = console }) {
  const { products, files, billing } = services;

  const toRow = (r) =>
    r && {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tagline: r.tagline,
      about: r.description,
      website: r.website,
      logoFileId: r.logo_file_id ?? null,
      coverFileId: r.cover_file_id ?? null,
      status: r.status,
      statusNote: r.status_note,
      verifiedAt: r.verified_at ?? null,
      isDemo: !!r.is_demo,
      kind: r.kind,
      ownerUserId: r.owner_user_id ?? null,
      priceDisplay: r.price_display,
      leadForm: !!r.lead_form,
      showPhone: !!r.show_phone,
      showEmail: !!r.show_email,
      submittedAt: r.submitted_at ?? null,
      liveAt: r.live_at ?? null,
      hiddenReason: r.hidden_reason ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  const fileUrl = (id) => {
    const f = id ? files.get(id) : null;
    return f ? files.url(f) : null;
  };

  const svc = {
    toRow,

    get(id) {
      if (typeof id !== 'string' || !id) return null;
      return toRow(db.prepare('SELECT * FROM brands WHERE id = ?').get(id)) || null;
    },
    bySlug(slug) {
      if (typeof slug !== 'string' || !slug) return null;
      return toRow(db.prepare('SELECT * FROM brands WHERE slug = ?').get(slug)) || null;
    },
    /** The contractor's own brand (one per contractor), or null. */
    ofOwner(userId) {
      if (!userId) return null;
      return toRow(db.prepare("SELECT * FROM brands WHERE kind = 'contractor' AND owner_user_id = ?").get(userId)) || null;
    },

    /** The company profile (package H's table, read-only here), or null. */
    profileOf(userId) {
      if (!userId) return null;
      return db.prepare('SELECT * FROM contractor_profiles WHERE user_id = ?').get(userId) ?? null;
    },

    planActive: (userId) => !!userId && billing.planOf(userId).id === 'contractor',

    /** Who may do what on /api/pro/brand: like the rest of the workspace, lapsed = read-only. */
    access(userId) {
      const profile = svc.profileOf(userId);
      const active = svc.planActive(userId);
      return { active, profile, allowed: active || !!profile, readOnly: !active };
    },

    log(action, { brandId = null, productId = null, by = null, note = '' } = {}) {
      db.prepare('INSERT INTO brand_moderation_log (brand_id, product_id, action, by_user_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        brandId,
        productId,
        action,
        by,
        String(note ?? '').slice(0, 2000),
        now(),
      );
    },

    recordEvent(brandId, type, { productId = null, userId = null } = {}) {
      if (!BRAND_EVENT_TYPES.includes(type)) throw new Error(`brand event: bad type ${type}`);
      const t = now();
      db.prepare('INSERT INTO brand_events (brand_id, product_id, type, user_id, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(brandId, productId, type, userId, utcDay(t), t);
    },

    // ── visibility: plan lapse and renewal ───────────────────────────────

    /**
     * Hides a contractor's page while their plan has lapsed and restores it on renewal (no
     * re-review: it was approved before). Returns the (possibly updated) row.
     */
    syncVisibility(row) {
      if (!row || row.kind !== 'contractor' || !row.ownerUserId) return row;
      const active = svc.planActive(row.ownerUserId);
      const t = now();
      if (!active && row.status === 'active') {
        db.prepare("UPDATE brands SET status = 'suspended', hidden_reason = 'lapsed', updated_at = ? WHERE id = ?").run(t, row.id);
        svc.log('lapse', { brandId: row.id, note: 'Contractor plan lapsed: page and products hidden.' });
        return svc.get(row.id);
      }
      if (active && row.hiddenReason === 'lapsed') {
        db.prepare("UPDATE brands SET status = 'active', hidden_reason = NULL, updated_at = ? WHERE id = ?").run(t, row.id);
        svc.log('renew', { brandId: row.id, note: 'Contractor plan renewed: page restored.' });
        return svc.get(row.id);
      }
      return row;
    },

    /** Every contractor page that is live or hidden for a lapse, re-checked against its plan. */
    syncAllVisibility() {
      const rows = db.prepare("SELECT * FROM brands WHERE kind = 'contractor' AND owner_user_id IS NOT NULL AND (status = 'active' OR hidden_reason = 'lapsed')").all();
      for (const r of rows) svc.syncVisibility(toRow(r));
    },

    /**
     * The catalog calls this before it reads (see routes/brands.mjs): cheap, and it re-runs
     * only when the clock has moved 5 s or a subscription row changed since the last run.
     */
    syncVisibilityDue: (() => {
      let lastAt = -Infinity;
      let lastSubs = null;
      return () => {
        let subs = null;
        try {
          subs = db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM subscriptions').get();
          subs = `${subs.n}:${subs.m}`;
        } catch {
          subs = null;
        }
        const t = now();
        if (subs === lastSubs && Math.abs(t - lastAt) < 5_000) return;
        lastAt = t;
        lastSubs = subs;
        try {
          svc.syncAllVisibility();
        } catch (err) {
          log.warn?.('brand visibility sync failed', err);
        }
      };
    })(),

    /** Keeps the brand row's logo and website in step with the company profile (catalog chips use them). */
    syncProfile(row) {
      if (!row || row.kind !== 'contractor') return row;
      const p = svc.profileOf(row.ownerUserId);
      if (!p) return row;
      const logo = p.logo_file_id ?? null;
      const website = p.website ?? '';
      if (logo === row.logoFileId && website === row.website) return row;
      db.prepare('UPDATE brands SET logo_file_id = ?, website = ?, updated_at = ? WHERE id = ?').run(logo, website, now(), row.id);
      return svc.get(row.id);
    },

    // ── the public copy of a product ─────────────────────────────────────

    /** The contractor's price book (sell prices need it), or null. Holds costs: server-internal. */
    bookOf(userId) {
      try {
        return services.pricing.priceBookFor(userId);
      } catch {
        return null;
      }
    },

    /**
     * The contractor's sell prices for a product: `{ price, priceByWidth? }`. Uses the export
     * kit's price math (the editor's), so the page shows what their quotes show.
     */
    sellPrices(sourceRow, book, kit = kitIfLoaded()) {
      const wire = products.toWire(sourceRow, { which: sourceRow.liveSpec ? 'live' : 'working' });
      if (!wire) return { price: 0 };
      if (!book || !kit) return { price: wire.price, ...(wire.priceByWidth ? { priceByWidth: wire.priceByWidth } : {}) };
      const sold = kit.applySellPrices([wire], book)[0];
      return { price: sold.price, ...(sold.priceByWidth ? { priceByWidth: sold.priceByWidth } : {}) };
    },

    /**
     * What may be public about a My-catalog product: no cost, no markup, no buy link; the price
     * as the page's price display allows. Returns a validated ProductSpec.
     */
    publicSpec(sourceRow, brand, book, kit = kitIfLoaded()) {
      const s = sourceRow.liveSpec ?? sourceRow.spec;
      const sell = svc.sellPrices(sourceRow, book, kit);
      const all = [sell.price, ...Object.values(sell.priceByWidth ?? {})].filter((n) => typeof n === 'number' && n > 0);
      let price = 0;
      let priceByWidth;
      if (brand.priceDisplay === 'show') {
        price = sell.price;
        if (sell.priceByWidth && Object.keys(sell.priceByWidth).length) priceByWidth = sell.priceByWidth;
      } else if (brand.priceDisplay === 'from') {
        price = all.length ? Math.min(...all) : 0;
      }
      const spec = {
        kind: s.kind,
        ...(s.variant ? { variant: s.variant } : {}),
        category: s.category,
        name: s.name,
        blurb: s.blurb ?? '',
        sku: s.sku ?? '',
        ...(s.skuByWidth ? { skuByWidth: s.skuByWidth } : {}),
        widthIn: s.widthIn,
        depthIn: s.depthIn,
        heightIn: s.heightIn,
        elevationIn: s.elevationIn ?? 0,
        ...(s.widthOptions?.length ? { widthOptions: s.widthOptions } : {}),
        price: Math.round(Math.max(0, Math.min(1_000_000, price)) * 100) / 100,
        ...(priceByWidth ? { priceByWidth } : {}),
        finishes: s.finishes,
        imageFileIds: [...(s.imageFileIds ?? [])],
        ...(s.modelFileId ? { modelFileId: s.modelFileId } : {}),
        ...(s.specSheetUrl ? { specSheetUrl: s.specSheetUrl } : {}),
        ...(s.flags && Object.keys(s.flags).length ? { flags: s.flags } : {}),
        ...(s.line ? { line: s.line } : {}),
        ...(s.doorStyle ? { doorStyle: s.doorStyle } : {}),
      };
      const v = products.validateSpec(spec);
      if (!v.ok) throw new HttpError(400, 'This product can’t be published yet.', { errors: v.errors });
      return v.spec;
    },

    /** BRAND_PAGE §4: what must be true before a product can be published. */
    readiness(sourceRow, brand, book, kit = kitIfLoaded()) {
      const s = sourceRow.liveSpec ?? sourceRow.spec ?? {};
      const sell = svc.sellPrices(sourceRow, book, kit);
      const priced = [sell.price, ...Object.values(sell.priceByWidth ?? {})].some((n) => n > 0);
      const onRequest = brand?.priceDisplay === 'on_request';
      const checks = [
        { id: 'media', label: 'A photo or a 3D model', ok: (s.imageFileIds?.length ?? 0) > 0 || !!s.modelFileId },
        { id: 'basics', label: 'A name and dimensions', ok: !!s.name && s.widthIn > 0 && s.depthIn > 0 && s.heightIn > 0 },
        { id: 'finish', label: 'At least one finish', ok: s.finishes === 'cabinet' || (Array.isArray(s.finishes) && s.finishes.length > 0) },
        { id: 'price', label: onRequest ? 'A price (your page shows Price on request)' : 'A price in your price book, or Price on request', ok: onRequest || priced },
      ];
      return { ready: checks.every((c) => c.ok), checks };
    },

    listingOf(sourceProductId) {
      return db.prepare('SELECT * FROM brand_listings WHERE source_product_id = ?').get(sourceProductId) ?? null;
    },
    listingByCopy(copyId) {
      return db.prepare('SELECT * FROM brand_listings WHERE product_id = ?').get(copyId) ?? null;
    },
    listingsOf(brandId) {
      return db.prepare('SELECT * FROM brand_listings WHERE brand_id = ? ORDER BY created_at').all(brandId);
    },

    /** Replaces a copy's working spec (validated) without touching its live copy. */
    writeSpec(copyId, spec) {
      const t = now();
      db.prepare('UPDATE products SET spec = ?, kind = ?, category = ?, name = ?, price_cents = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(
        JSON.stringify(spec),
        spec.kind,
        spec.category,
        spec.name,
        Math.round(spec.price * 100),
        t,
        copyId,
      );
    },

    /** Moves the price book's current prices into the live copy (no review needed for a price). */
    writeLivePrice(copy, spec) {
      if (!copy.liveSpec) return false;
      const live = { ...copy.liveSpec };
      for (const k of PRICE_KEYS) delete live[k];
      for (const k of PRICE_KEYS) if (spec[k] !== undefined) live[k] = spec[k];
      if (stableJson(live) === stableJson(copy.liveSpec)) return false;
      db.prepare('UPDATE products SET live_spec = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(live), now(), copy.id);
      return true;
    },

    /** Copies (submitted, live or rejected-with-a-live-version) counted against BRAND_PRODUCT_LIMIT. */
    liveCount(brandId) {
      return db
        .prepare(
          `SELECT COUNT(*) AS n FROM brand_listings l JOIN products p ON p.id = l.product_id
            WHERE l.brand_id = ? AND (p.status IN ('submitted','published') OR (p.status = 'rejected' AND p.live_spec IS NOT NULL))`,
        )
        .get(brandId).n;
    },

    /**
     * Re-projects every copy of a brand from its My-catalog product: content edits to a live
     * product go back to review (the live version stays public), price changes go straight to
     * the live copy, and an archived My-catalog product takes its copy off the page.
     */
    syncListings(brand, kit = kitIfLoaded()) {
      if (!brand || brand.kind !== 'contractor' || !kit) return;
      const book = svc.bookOf(brand.ownerUserId);
      for (const l of svc.listingsOf(brand.id)) {
        const source = products.get(l.source_product_id);
        const copy = products.get(l.product_id);
        if (!copy) continue;
        if (!source || source.status === 'archived' || source.ownerUserId !== brand.ownerUserId) {
          if (copy.status !== 'archived') {
            products.setStatus(copy.id, 'archived');
            svc.log('unpublish', { brandId: brand.id, productId: copy.id, note: 'Archived in My catalog.' });
          }
          continue;
        }
        let spec;
        try {
          spec = svc.publicSpec(source, brand, book, kit);
        } catch {
          continue; // e.g. a field a later edit made invalid; the live version stays as it was
        }
        const changed = contentDiffers(spec, copy.spec);
        const priceChanged = PRICE_KEYS.some((k) => stableJson(spec[k]) !== stableJson(copy.spec?.[k]));
        if (changed || priceChanged) svc.writeSpec(copy.id, spec);
        if (changed && copy.status === 'published') {
          products.setStatus(copy.id, 'submitted', { note: '' });
          svc.log('submit', { brandId: brand.id, productId: copy.id, note: 'Edited in My catalog.' });
        }
        svc.writeLivePrice(products.get(copy.id), spec);
      }
    },

    /** Everything a read of the brand needs to be current: plan, profile, copies. */
    async syncBrand(row) {
      if (!row) return row;
      let kit = null;
      try {
        kit = await loadKit();
      } catch {
        kit = null;
      }
      let r = svc.syncVisibility(row);
      r = svc.syncProfile(r);
      svc.syncListings(r, kit);
      return svc.get(r.id);
    },

    async syncAll() {
      for (const r of db.prepare("SELECT * FROM brands WHERE kind = 'contractor'").all()) await svc.syncBrand(toRow(r));
    },

    /**
     * Publishes a My-catalog product on the brand page: creates or refreshes its public copy and
     * sends it to review, or puts it straight back when the approved version is unchanged.
     * Returns `{ copy, status }`.
     */
    publish(brand, source, { by } = {}) {
      const kit = kitIfLoaded();
      const book = svc.bookOf(brand.ownerUserId);
      const ready = svc.readiness(source, brand, book, kit);
      if (!ready.ready) throw new HttpError(400, 'This product isn’t ready to publish yet.', { readiness: ready });
      const spec = svc.publicSpec(source, brand, book, kit);
      let listing = svc.listingOf(source.id);
      let copy = listing ? products.get(listing.product_id) : null;
      const counted = copy && (copy.status === 'submitted' || copy.status === 'published' || (copy.status === 'rejected' && copy.liveSpec));
      if (!counted && svc.liveCount(brand.id) >= config.BRAND_PRODUCT_LIMIT)
        throw new HttpError(400, `Your brand page can show ${config.BRAND_PRODUCT_LIMIT} products. Unpublish one first.`, { limit: config.BRAND_PRODUCT_LIMIT });
      const t = now();
      if (!copy) {
        copy = products.create({ source: 'brand', brandId: brand.id, ownerUserId: null, visibility: 'public', spec, status: 'draft' });
        if (listing) db.prepare('UPDATE brand_listings SET product_id = ?, updated_at = ? WHERE source_product_id = ?').run(copy.id, t, source.id);
        else db.prepare('INSERT INTO brand_listings (source_product_id, brand_id, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(source.id, brand.id, copy.id, t, t);
        listing = svc.listingOf(source.id);
      } else if (stableJson(spec) !== stableJson(copy.spec)) svc.writeSpec(copy.id, spec);
      copy = products.get(copy.id);
      if (copy.status === 'published' || copy.status === 'submitted') return { copy, status: copy.status };
      // The approved version is unchanged (e.g. unpublished, then published again): no review.
      if (copy.liveSpec && !contentDiffers(spec, copy.liveSpec)) {
        db.prepare("UPDATE products SET status = 'published', review_note = '', updated_at = ? WHERE id = ?").run(t, copy.id);
        svc.writeLivePrice(products.get(copy.id), spec);
        svc.log('restore', { brandId: brand.id, productId: copy.id, by });
        return { copy: products.get(copy.id), status: 'published' };
      }
      products.setStatus(copy.id, 'submitted', { note: '' });
      svc.log('submit', { brandId: brand.id, productId: copy.id, by });
      return { copy: products.get(copy.id), status: 'submitted' };
    },

    /** Takes a product off the page at once (its copy is archived; kitchens keep snapshots). */
    unpublish(brand, source, { by } = {}) {
      const listing = svc.listingOf(source.id);
      const copy = listing ? products.get(listing.product_id) : null;
      if (!copy || copy.status === 'archived') return copy;
      products.setStatus(copy.id, 'archived');
      svc.log('unpublish', { brandId: brand.id, productId: copy.id, by });
      return products.get(copy.id);
    },

    /** Admin approval: the copy's working spec goes live and its files become public. */
    approveProduct(copy, { by } = {}) {
      const live = products.publish(copy.id);
      db.prepare("UPDATE products SET review_note = '' WHERE id = ?").run(copy.id);
      for (const fid of products.fileIdsOf(live.liveSpec)) files.setVisibility(fid, 'public');
      svc.log('approve', { brandId: copy.brandId, productId: copy.id, by });
      return products.get(copy.id);
    },

    rejectProduct(copy, note, { by } = {}) {
      const r = products.setStatus(copy.id, 'rejected', { note });
      svc.log('reject', { brandId: copy.brandId, productId: copy.id, by, note });
      return r;
    },

    // ── wire shapes ──────────────────────────────────────────────────────

    /** What anyone may know about a brand (its public page header). */
    publicWire(row) {
      const out = {
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        name: row.name,
        tagline: row.tagline,
        about: row.about,
        logoUrl: fileUrl(row.logoFileId),
        coverUrl: fileUrl(row.coverFileId),
        website: row.website || '',
        verified: row.verifiedAt != null,
        isDemo: row.isDemo,
        priceDisplay: row.priceDisplay,
        leadForm: row.kind === 'contractor' && row.leadForm,
        serviceArea: '',
      };
      if (row.kind === 'contractor') {
        const p = svc.profileOf(row.ownerUserId);
        if (p) {
          out.serviceArea = p.service_area || '';
          if (p.website) out.website = p.website;
          if (row.showPhone && p.phone) out.phone = p.phone;
          if (row.showEmail && p.email) out.email = p.email;
          if (!out.logoUrl && p.logo_file_id) out.logoUrl = fileUrl(p.logo_file_id);
        }
      }
      return out;
    },

    /** The page as its owner (and admins) manage it. */
    ownerWire(row) {
      return {
        ...svc.publicWire(row),
        phone: undefined,
        email: undefined,
        status: row.status,
        pageStatus: pageStatusOf(row),
        statusNote: row.statusNote,
        coverFileId: row.coverFileId,
        showPhone: row.showPhone,
        showEmail: row.showEmail,
        leadForm: row.leadForm,
        submittedAt: row.submittedAt,
        liveAt: row.liveAt,
        verifiedAt: row.verifiedAt,
        hiddenReason: row.hiddenReason,
        slugLocked: row.liveAt != null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    /** Live products on a page, as catalog wires with the page's price display. */
    liveProducts(row, user = null) {
      return products
        .catalogRows(user)
        .filter((r) => r.brandId === row.id)
        .map((r) => products.toWire(r, { which: 'live' }))
        .filter(Boolean)
        .map((p) => ({ ...p, priceDisplay: row.priceDisplay }));
    },

    /** What the page will look like once approved: settings as saved, every submitted or live product. */
    previewProducts(row) {
      const out = [];
      for (const l of svc.listingsOf(row.id)) {
        const copy = products.get(l.product_id);
        if (!copy || (copy.status !== 'submitted' && copy.status !== 'published' && !(copy.status === 'rejected' && copy.liveSpec))) continue;
        const which = copy.status === 'rejected' ? 'live' : 'working';
        const w = products.toWire(copy, { which });
        if (w) out.push({ ...w, priceDisplay: row.priceDisplay });
      }
      return out;
    },

    // ── leads ────────────────────────────────────────────────────────────

    leadWire(r) {
      return {
        id: r.id,
        productId: r.product_id ?? null,
        productName: r.product_name,
        projectName: r.project_name,
        shareToken: r.share_token ?? null,
        kitchenAttached: !!(r.project_id || r.project_name),
        name: r.name,
        email: r.email,
        phone: r.phone,
        location: r.location,
        message: r.message,
        status: r.status,
        notes: r.notes,
        unread: r.read_at == null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },

    leadCounts(brandId) {
      const by = Object.fromEntries(db.prepare('SELECT status AS k, COUNT(*) AS n FROM leads WHERE brand_id = ? GROUP BY status').all(brandId).map((r) => [r.k, r.n]));
      const unread = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE brand_id = ? AND read_at IS NULL').get(brandId).n;
      return { total: Object.values(by).reduce((a, b) => a + b, 0), byStatus: by, unread };
    },

    createLead(brand, f) {
      const id = randomId('ld_');
      const t = now();
      db.prepare(
        `INSERT INTO leads (id, brand_id, product_id, product_name, project_id, project_name, share_token, name, email, phone, location, message, status, notes, read_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', NULL, ?, ?)`,
      ).run(id, brand.id, f.productId ?? null, f.productName ?? '', f.projectId ?? null, f.projectName ?? '', f.shareToken ?? null, f.name, f.email, f.phone ?? '', f.location ?? '', f.message ?? '', t, t);
      svc.recordEvent(brand.id, 'lead', { productId: f.productId ?? null, userId: f.userId ?? null });
      return id;
    },

    // ── analytics ────────────────────────────────────────────────────────

    /** BRAND_PAGE §7: page views, product views, adds, quote clicks and leads, by day and product. */
    analytics(brandId, days) {
      const t = now();
      const since = utcDay(t - (days - 1) * DAY);
      const dayList = [];
      for (let i = days - 1; i >= 0; i--) dayList.push(utcDay(t - i * DAY));
      const blank = () => ({ brandViews: 0, productViews: 0, adds: 0, quoteClicks: 0, leads: 0 });
      const byDay = new Map(dayList.map((d) => [d, { day: d, ...blank() }]));
      const totals = blank();
      const add = (day, key, n) => {
        const d = byDay.get(day);
        if (d) d[key] += n;
        totals[key] += n;
      };
      const PE = { view: 'productViews', add: 'adds' };
      for (const r of db.prepare('SELECT day, type, COUNT(*) AS n FROM product_events WHERE brand_id = ? AND day >= ? GROUP BY day, type').all(brandId, since)) {
        if (PE[r.type]) add(r.day, PE[r.type], r.n);
      }
      const BE = { brand_view: 'brandViews', quote_click: 'quoteClicks', lead: 'leads' };
      for (const r of db.prepare('SELECT day, type, COUNT(*) AS n FROM brand_events WHERE brand_id = ? AND day >= ? GROUP BY day, type').all(brandId, since)) {
        if (BE[r.type]) add(r.day, BE[r.type], r.n);
      }
      const top = new Map();
      const bump = (id, key, n) => {
        if (!id) return;
        const cur = top.get(id) ?? { id, views: 0, adds: 0, quoteClicks: 0, leads: 0 };
        cur[key] += n;
        top.set(id, cur);
      };
      for (const r of db.prepare("SELECT product_id AS id, type, COUNT(*) AS n FROM product_events WHERE brand_id = ? AND day >= ? AND type IN ('view','add') GROUP BY product_id, type").all(brandId, since))
        bump(r.id, r.type === 'view' ? 'views' : 'adds', r.n);
      for (const r of db.prepare("SELECT product_id AS id, type, COUNT(*) AS n FROM brand_events WHERE brand_id = ? AND day >= ? AND product_id IS NOT NULL AND type IN ('quote_click','lead') GROUP BY product_id, type").all(brandId, since))
        bump(r.id, r.type === 'lead' ? 'leads' : 'quoteClicks', r.n);
      const topProducts = [...top.values()]
        .map((x) => ({ ...x, name: products.get(x.id)?.name ?? 'Removed product', sourceId: svc.listingByCopy(x.id)?.source_product_id ?? null }))
        .sort((a, b) => b.views + b.adds * 3 + b.leads * 10 - (a.views + a.adds * 3 + a.leads * 10))
        .slice(0, 8);
      return { days, since, totals, byDay: [...byDay.values()], topProducts };
    },

    /** The dashboard card and the nav badge: status, this month's page views and leads, unread leads. */
    summary(row) {
      if (!row) return { pageStatus: 'none' };
      const t = now();
      const month = utcDay(t).slice(0, 8) + '01';
      const n = (type) => db.prepare('SELECT COUNT(*) AS n FROM brand_events WHERE brand_id = ? AND type = ? AND day >= ?').get(row.id, type, month).n;
      return {
        brandId: row.id,
        slug: row.slug,
        name: row.name,
        pageStatus: pageStatusOf(row),
        statusNote: row.statusNote,
        monthViews: n('brand_view'),
        monthLeads: n('lead'),
        unread: svc.leadCounts(row.id).unread,
        liveProducts: svc.liveCount(row.id),
        isDemo: row.isDemo,
      };
    },
  };
  return svc;
}
