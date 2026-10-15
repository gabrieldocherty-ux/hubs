// The dynamic catalog: published brand products and the caller's private custom ones.
// Built-in products stay compiled into the client and are not served from here.
//
// The real-retailer catalog (src/data/retail.json, server/catalog/retail.mjs) adds: brand lists per
// category for the new-kitchen wizard, each store's link settings (affiliate parameter, sponsored),
// an anonymous link-out counter, and Admin > Retailers. The store links themselves are plain
// navigations from the browser; the server never calls a retailer.

import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';
import { utcDay } from '../catalog/events.mjs';
import { brandsInCategory, cleanAffiliate, isListing, loadRetail } from '../catalog/retail.mjs';
import kinds from '../../src/data/kinds.json' with { type: 'json' };

const CATEGORY_IDS = new Set(kinds.categories.map((c) => c.id));
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** @param {any} ctx */
export default function routes(ctx) {
  const { products, brands, auth } = ctx.services;
  const { db } = ctx;

  /** The admin's settings for every store the catalog lists (defaults where none are saved). */
  const retailerRows = () => {
    const retail = loadRetail();
    const saved = new Map(db.prepare('SELECT * FROM retailers').all().map((r) => [r.slug, r]));
    return retail.stores.map((s) => {
      const r = saved.get(s.slug);
      return { slug: s.slug, name: s.name, domain: s.domain, sponsored: !!r?.sponsored, affiliate: r?.affiliate ?? '', updatedAt: r?.updated_at ?? null };
    });
  };
  const publicRetailer = ({ slug, name, sponsored, affiliate }) => ({ slug, name, sponsored, affiliate });

  return [
    {
      method: 'GET',
      path: '/api/catalog',
      auth: 'optional',
      handler: (rc) => {
        const list = products.listCatalog(rc.user);
        const brandList = brands.listActive().map(brands.toWire);
        return { products: list, brands: brandList, version: products.catalogVersion(list, brandList) };
      },
    },
    {
      // `?category=cabinets` (or `all`) adds the real-retailer brands with products in that category:
      // product counts and the stores that carry them, for the new-kitchen wizard's brand step.
      method: 'GET',
      path: '/api/catalog/brands',
      auth: 'none',
      handler: (rc) => {
        const out = { brands: brands.listActive().map(brands.toWire) };
        const category = rc.query.get('category');
        if (category === null) return out;
        if (category !== 'all' && !CATEGORY_IDS.has(category)) throw new HttpError(400, `Unknown category. Use all or one of: ${[...CATEGORY_IDS].join(', ')}.`);
        const retail = loadRetail();
        return { ...out, category, checkedAt: retail.data.checkedAt ?? null, retailBrands: brandsInCategory(retail, category) };
      },
    },
    {
      method: 'GET',
      path: '/api/catalog/products/:id',
      auth: 'optional',
      handler: (rc) => {
        const row = products.get(rc.params.id);
        const notFound = () => new HttpError(404, 'That product does not exist.');
        if (!row) throw notFound();
        const user = rc.user;
        // The working copy: brand members, the owner of a custom product, studio and admin.
        if (rc.query.get('working') === '1' && user) {
          const entitled =
            user.role === 'admin' || user.role === 'studio' || (row.ownerUserId && row.ownerUserId === user.id) || (row.brandId && auth.isBrandMember(user.id, row.brandId));
          if (entitled) return { product: products.toWire(row, { which: 'working', viewer: user }) };
        }
        if (!products.inCatalog(row, user)) throw notFound();
        return { product: products.toWire(row, { which: 'live', viewer: user }) };
      },
    },

    // ── real retailers ──────────────────────────────────────────────────────
    {
      // Public: what "Where to buy" needs to build a link (the parameter is in every link anyway).
      method: 'GET',
      path: '/api/catalog/retailers',
      auth: 'none',
      handler: () => ({ retailers: retailerRows().map(publicRetailer) }),
    },
    {
      // One "Where to buy" link followed. Counted per store, product and day; nothing about the person.
      method: 'POST',
      path: '/api/catalog/retail/clicks',
      auth: 'optional',
      maxBytes: 1_024,
      rateLimit: { name: 'retail-clicks', max: 300, windowMs: HOUR, by: 'ip' },
      handler: (rc) => {
        const { productId, store } = rc.body ?? {};
        if (!isListing(loadRetail(), productId, store)) throw new HttpError(400, 'That product isn’t listed at that store.');
        db.prepare(
          'INSERT INTO retail_clicks (store, product_id, day, clicks) VALUES (?, ?, ?, 1) ON CONFLICT(store, product_id, day) DO UPDATE SET clicks = clicks + 1',
        ).run(store, productId, utcDay(ctx.now()));
        rc.send(204);
      },
    },
    {
      method: 'GET',
      path: '/api/admin/retailers',
      auth: 'admin',
      handler: () => {
        const retail = loadRetail();
        const since = utcDay(ctx.now() - 29 * DAY);
        const totals = new Map(db.prepare('SELECT store, SUM(clicks) AS n FROM retail_clicks GROUP BY store').all().map((r) => [r.store, r.n]));
        const recent = new Map(db.prepare('SELECT store, SUM(clicks) AS n FROM retail_clicks WHERE day >= ? GROUP BY store').all(since).map((r) => [r.store, r.n]));
        const top = db
          .prepare('SELECT store, product_id, SUM(clicks) AS n FROM retail_clicks WHERE day >= ? GROUP BY store, product_id ORDER BY n DESC, product_id LIMIT 200')
          .all(since);
        const listed = new Map();
        for (const p of retail.products) for (const s of new Set(p.retail.stores.map((l) => l.store))) listed.set(s, (listed.get(s) ?? 0) + 1);
        return {
          checkedAt: retail.data.checkedAt ?? null,
          products: retail.products.length,
          researched: retail.data.researched ?? 0,
          leftOut: retail.data.leftOut ?? { count: 0, byReason: {} },
          since,
          retailers: retailerRows().map((r) => ({
            ...r,
            products: listed.get(r.slug) ?? 0,
            clicks: { total: totals.get(r.slug) ?? 0, last30: recent.get(r.slug) ?? 0 },
            top: top
              .filter((t) => t.store === r.slug)
              .slice(0, 5)
              .map((t) => {
                const p = retail.byId.get(t.product_id);
                return { productId: t.product_id, name: p?.name ?? t.product_id, brand: p?.brand ?? '', clicks: t.n };
              }),
          })),
        };
      },
    },
    {
      method: 'PATCH',
      path: '/api/admin/retailers/:slug',
      auth: 'admin',
      maxBytes: 2_048,
      handler: (rc) => {
        const store = loadRetail().storeBySlug.get(rc.params.slug);
        if (!store) throw new HttpError(404, 'The catalog lists no store with that id.');
        const body = rc.body ?? {};
        const cur = retailerRows().find((r) => r.slug === store.slug);
        let affiliate = cur.affiliate;
        let sponsored = cur.sponsored;
        if (body.affiliate !== undefined) {
          affiliate = cleanAffiliate(body.affiliate);
          if (affiliate === null) throw new HttpError(400, 'The tracking parameter is a short query string like aff=blumodel (letters, digits and - _ . ~, up to five pairs joined by &).');
        }
        if (body.sponsored !== undefined) {
          if (typeof body.sponsored !== 'boolean') throw new HttpError(400, 'Sponsored is on or off.');
          sponsored = body.sponsored;
        }
        if (affiliate === cur.affiliate && sponsored === cur.sponsored) return { retailer: cur };
        const at = ctx.now();
        ctx.tx(() => {
          db.prepare(
            `INSERT INTO retailers (slug, affiliate, sponsored, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(slug) DO UPDATE SET affiliate = excluded.affiliate, sponsored = excluded.sponsored, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          ).run(store.slug, affiliate, sponsored ? 1 : 0, at, rc.user.id);
          audit(db, {
            admin: rc.user,
            action: 'retailer_update',
            detail: { store: store.slug, before: { affiliate: cur.affiliate, sponsored: cur.sponsored }, after: { affiliate, sponsored } },
            at,
          });
        });
        return { retailer: retailerRows().find((r) => r.slug === store.slug) };
      },
    },
  ];
}
