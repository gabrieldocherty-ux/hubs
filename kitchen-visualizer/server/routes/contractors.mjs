// Package H (contractors): the Contractor workspace's API, /api/pro/… (PLANS_AND_CONTRACTORS
// §4). Every route needs the Contractor plan; when it lapses, a contractor keeps read-only
// access (GET) to everything they set up, and their clients' share links keep working.
//
// It also registers the sell-price side of services.pricing (what clients see) and
// services.contractors (branding), which the share page and the exports call.

import { HttpError } from '../http/respond.mjs';
import { PRODUCT_ID_RE } from '../lib/ids.mjs';
import { kitIfLoaded, loadKit } from '../lib/kit.mjs';
import { createContractorService, brandKey, readCents, readCostByWidth, readPct } from '../contractors/service.mjs';
import { columnsOf, csvCell, parseCsv, parseMoney, parseWidth } from '../contractors/csv.mjs';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const DISCLAIMER =
  'Mise is a visualizer. Layouts, dimensions and estimates are for planning conversations, not construction or installation drawings. Verify everything with a professional.';
const DAY = 86_400_000;

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

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services } = ctx;
  const pro = createContractorService({ db, now: ctx.now, services });
  // Warm the kit so the synchronous pricing hooks (share pages) can use it.
  void loadKit().catch(() => {});

  // ── what clients see ────────────────────────────────────────────────────
  const liveWires = (doc, owner) => {
    const out = [];
    for (const id of new Set((doc?.items ?? []).map((i) => i.productId))) {
      if (!PRODUCT_ID_RE.test(id)) continue;
      const row = services.products.get(id);
      if (row && row.liveSpec && row.status !== 'archived' && (row.visibility === 'public' || row.ownerUserId === owner)) {
        const w = services.products.toWire(row, { which: 'live' });
        if (w) out.push(w);
      }
    }
    return out;
  };

  services.pricing.register({
    applyForViewer(ownerUserId, products) {
      const book = pro.priceBookFor(ownerUserId);
      const kit = kitIfLoaded();
      if (!book || !kit) return products;
      return kit.applySellPrices(products, book);
    },
    sellPricesFor(ownerUserId, doc) {
      const book = pro.priceBookFor(ownerUserId);
      const kit = kitIfLoaded();
      if (!book || !kit) return null;
      return kit.sellPricesFor(doc, book, liveWires(doc, ownerUserId));
    },
    priceBookFor: (ownerUserId) => pro.priceBookFor(ownerUserId),
  });

  services.contractors.register({
    brandingFor: (userId) => pro.branding(userId),
    summaryFor(userId) {
      const p = pro.profileRow(userId);
      return p ? { company: p.company, active: services.billing.planOf(userId).id === 'contractor' } : null;
    },
    labelFor: (userId) => pro.profileRow(userId)?.company ?? null,
  });

  // ── access ──────────────────────────────────────────────────────────────
  /** Lapsed contractors may read; only an active plan may write. */
  const gate = (rc, { write = false, profile = true } = {}) => {
    const a = pro.access(rc.user.id);
    if (!a.allowed) throw new HttpError(403, 'This is part of the Contractor plan.', { needs: 'contractor' });
    if (write && !a.active) throw new HttpError(403, 'Your Contractor plan has lapsed. Renew to keep selling.', { needs: 'renew' });
    if (profile && !a.profile) throw new HttpError(409, 'Set up your company first.', { needs: 'profile' });
    return a;
  };

  const builtinIds = async () => {
    const kit = await loadKit();
    return { kit, ids: new Set(kit.BUILTIN_PRODUCTS.map((p) => p.id)) };
  };

  const ownProduct = (userId, id) => {
    const row = services.products.get(id);
    if (!row || row.source !== 'contractor' || row.ownerUserId !== userId) throw new HttpError(404, 'That product isn’t in your catalog.');
    return row;
  };

  const productWire = (row, user) => services.products.toWire(row, { which: 'working', viewer: user });

  /** Files a contractor product uses must be their own uploads. */
  const checkFiles = (spec, userId) => {
    for (const id of spec.imageFileIds ?? []) services.files.assertUsable(id, { userId, kinds: ['image'] });
    if (spec.modelFileId) services.files.assertUsable(spec.modelFileId, { userId, kinds: ['model'] });
    if (Array.isArray(spec.finishes)) for (const f of spec.finishes) if (f.swatchFileId) services.files.assertUsable(f.swatchFileId, { userId, kinds: ['image'] });
  };

  const readCostPatch = (b = {}) => ({
    costCents: readCents(b.costCents, 'costCents'),
    costByWidth: readCostByWidth(b.costByWidth),
    markupPct: readPct(b.markupPct, 'markupPct'),
  });

  /** Every product the contractor sells: their own, the public brands they carry, Mise's built-ins. */
  async function carried(user) {
    const { kit } = await builtinIds();
    const settings = pro.brandSettings(user.id);
    const on = (key) => settings[key]?.enabled !== false;
    const own = pro.ownRows(user.id).map((r) => productWire(r, user)).filter(Boolean);
    const publicBrand = services.products.listCatalog(user).filter((p) => p.source === 'brand' && p.brandId && on(p.brandId));
    const builtins = on('builtin') ? kit.BUILTIN_PRODUCTS : [];
    return { kit, settings, products: [...own, ...publicBrand, ...builtins] };
  }

  const keyOf = (p) => (p.brandId ? p.brandId : PRODUCT_ID_RE.test(p.id) ? 'own' : 'builtin');

  function rowsFor(kit, products, rows) {
    return products.map((p) => {
      const r = rows[p.id];
      return {
        productId: p.id,
        name: p.name,
        brand: p.brand,
        brandKey: keyOf(p),
        line: p.line ?? null,
        sku: kit.productCode(p, p.widthIn),
        category: p.category,
        source: p.source === 'contractor' ? 'contractor' : PRODUCT_ID_RE.test(p.id) ? (p.source === 'custom' ? 'custom' : 'brand') : 'builtin',
        widthIn: p.widthIn,
        widthOptions: p.widthOptions?.length ? p.widthOptions : null,
        list: kit.priceFor(p, p.widthIn),
        costCents: r?.costCents ?? null,
        costByWidth: r?.costByWidth ?? null,
        markupPct: r?.markupPct ?? null,
      };
    });
  }

  /** SKU → [{ productId, width }] over everything the contractor sells. */
  function skuIndex(kit, products) {
    const idx = new Map();
    const add = (sku, productId, width) => {
      const k = String(sku ?? '').trim().toUpperCase();
      if (!k) return;
      const list = idx.get(k) ?? [];
      if (!list.some((x) => x.productId === productId && x.width === width)) list.push({ productId, width });
      idx.set(k, list);
    };
    for (const p of products) {
      const widths = p.widthOptions?.length ? p.widthOptions : null;
      if (widths) for (const w of widths) add(kit.productCode(p, w), p.id, w);
      else add(kit.productCode(p, p.widthIn), p.id, null);
      if (p.sku && !p.sku.includes('{w}')) add(p.sku, p.id, null);
    }
    return idx;
  }

  /** Reads a supplier CSV against the price book: what would change, and what's wrong. */
  function previewImport(kit, products, rows, csvText) {
    const table = parseCsv(csvText);
    if (!table.length) throw new HttpError(400, 'That file is empty.');
    if (table.length > 5001) throw new HttpError(400, 'Import at most 5,000 rows at a time.');
    const { columns, start, header } = columnsOf(table);
    if (columns.sku < 0 || columns.cost < 0) throw new HttpError(400, 'The file needs a SKU column and a cost column.');
    const idx = skuIndex(kit, products);
    const byId = new Map(products.map((p) => [p.id, p]));
    const out = { header, updated: [], added: [], unchanged: [], unmatched: [], errors: [] };
    const seen = new Map();
    for (let i = start; i < table.length; i++) {
      const line = i + 1;
      const cells = table[i];
      const sku = String(cells[columns.sku] ?? '').trim();
      const name = columns.name >= 0 ? String(cells[columns.name] ?? '').trim().slice(0, 120) : '';
      if (!sku) {
        out.errors.push({ line, sku, error: 'No SKU.' });
        continue;
      }
      const cents = parseMoney(cells[columns.cost]);
      if (cents === null) {
        out.errors.push({ line, sku, error: `“${String(cells[columns.cost] ?? '').trim()}” isn’t a cost.` });
        continue;
      }
      const width = columns.width >= 0 ? parseWidth(cells[columns.width]) : null;
      if (Number.isNaN(width)) {
        out.errors.push({ line, sku, error: `“${String(cells[columns.width] ?? '').trim()}” isn’t a width in inches.` });
        continue;
      }
      const hits = idx.get(sku.toUpperCase()) ?? [];
      let hit = width !== null ? hits.find((h) => h.width === width) ?? hits.find((h) => h.width === null) : hits[0];
      if (hit && hits.length > 1 && width === null && new Set(hits.map((h) => h.productId)).size > 1) {
        out.errors.push({ line, sku, error: 'That SKU matches more than one product. Add a width column.' });
        continue;
      }
      if (!hit) {
        out.unmatched.push({ line, sku, name, costCents: cents });
        continue;
      }
      const p = byId.get(hit.productId);
      // A width given for a product with width options sets that width's cost.
      const w = hit.width ?? (width !== null && p?.widthOptions?.includes(width) ? width : null);
      const key = `${hit.productId}|${w ?? ''}`;
      if (seen.has(key)) {
        out.errors.push({ line, sku, error: `Same product as line ${seen.get(key)}.` });
        continue;
      }
      seen.set(key, line);
      const cur = rows[hit.productId];
      const before = w !== null ? cur?.costByWidth?.[String(w)] ?? null : cur?.costCents ?? null;
      const entry = { line, sku, name: p?.name ?? name, productId: hit.productId, width: w, costCents: cents, before };
      if (before === null) out.added.push(entry);
      else if (before === cents) out.unchanged.push(entry);
      else out.updated.push(entry);
    }
    return out;
  }

  async function quoteFor(user, project) {
    const kit = await loadKit();
    const doc = { ...JSON.parse(project.doc), name: project.name };
    const book = pro.priceBookFor(user.id);
    const est = kit.estimateFor(doc, { products: liveWires(doc, user.id), priceBook: book });
    const settings = db.prepare('SELECT * FROM contractor_quotes WHERE project_id = ? AND user_id = ?').get(project.id, user.id);
    const taxPct = book?.taxPct ?? 0;
    const subtotal = Math.round(est.total * 100) / 100;
    const tax = Math.round(subtotal * taxPct) / 100;
    const groups = [];
    for (const l of est.lines) {
      let g = groups.find((x) => x.name === l.group);
      if (!g) groups.push((g = { name: l.group, lines: [], total: 0 }));
      // Sell prices only: never unitCost or markup.
      g.lines.push({ label: l.label, sub: l.sub, sku: l.sku ?? '', qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, total: l.total });
      g.total += l.total;
    }
    return {
      projectId: project.id,
      kitchen: { name: project.name, client: project.client, room: doc.room, updatedAt: project.updated_at },
      doc,
      preparedBy: pro.branding(user.id),
      serviceArea: pro.profileRow(user.id)?.service_area ?? '',
      groups,
      subtotal,
      taxPct,
      tax,
      total: Math.round((subtotal + tax) * 100) / 100,
      validUntil: settings?.valid_until ?? ctx.now() + 30 * DAY,
      notes: settings?.notes ?? '',
      hasBuiltin: est.hasBuiltin,
      disclaimer: DISCLAIMER,
    };
  }

  return [
    {
      method: 'GET',
      path: '/api/pro/profile',
      handler: (rc) => {
        const a = gate(rc, { profile: false });
        return { profile: pro.profileWire(a.profile), active: a.active, readOnly: a.readOnly, plan: a.plan };
      },
    },
    {
      method: 'PUT',
      path: '/api/pro/profile',
      handler: (rc) => {
        const a = gate(rc, { write: true, profile: false });
        const b = rc.body;
        const company = str(b.company, 80);
        if (!company) throw new HttpError(400, 'Enter your company name.', { field: 'company' });
        const email = str(b.email, 254);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'That email address does not look right.', { field: 'email' });
        const phone = str(b.phone, 40);
        if (phone && !/^[0-9+().\-\s]{3,40}$/.test(phone)) throw new HttpError(400, 'That phone number doesn’t look right.', { field: 'phone' });
        const website = httpsOrEmpty(b.website, 'website');
        const serviceArea = str(b.serviceArea, 120);
        const markup = readPct(b.defaultMarkupPct ?? a.profile?.default_markup_pct ?? 30, 'defaultMarkupPct') ?? 0;
        const tax = readPct(b.taxPct ?? a.profile?.tax_pct ?? 0, 'taxPct', 30) ?? 0;
        let logo = a.profile?.logo_file_id ?? null;
        if (b.logoFileId !== undefined) {
          if (b.logoFileId === null || b.logoFileId === '') logo = null;
          else {
            const f = services.files.assertUsable(String(b.logoFileId), { userId: rc.user.id, kinds: ['image'] });
            // Clients see the logo on shares and quotes.
            services.files.setVisibility(f.id, 'public');
            logo = f.id;
          }
        }
        const t = ctx.now();
        db.prepare(
          `INSERT INTO contractor_profiles (user_id, company, logo_file_id, phone, email, website, service_area, default_markup_pct, tax_pct, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET company = excluded.company, logo_file_id = excluded.logo_file_id, phone = excluded.phone,
             email = excluded.email, website = excluded.website, service_area = excluded.service_area,
             default_markup_pct = excluded.default_markup_pct, tax_pct = excluded.tax_pct, updated_at = excluded.updated_at`,
        ).run(rc.user.id, company, logo, phone, email, website, serviceArea, markup, tax, t, t);
        return { profile: pro.profileWire(pro.profileRow(rc.user.id)), active: true, readOnly: false };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/dashboard',
      handler: (rc) => {
        const a = gate(rc);
        const own = pro.ownRows(rc.user.id);
        const rows = pro.priceRows(rc.user.id);
        const kitchens = db.prepare('SELECT id, name, client, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(rc.user.id);
        return {
          profile: pro.profileWire(a.profile),
          active: a.active,
          counts: {
            products: own.length,
            lines: new Set(own.map((r) => r.spec?.line).filter(Boolean)).size,
            uncosted: own.filter((r) => !rows[r.id]?.costCents && !rows[r.id]?.costByWidth).length,
            kitchens: kitchens.length,
            clients: new Set(kitchens.map((k) => k.client.trim().toLowerCase()).filter(Boolean)).size,
          },
          recent: kitchens.slice(0, 6).map((k) => ({ id: k.id, name: k.name, client: k.client, updatedAt: k.updated_at })),
        };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/products',
      handler: (rc) => {
        gate(rc);
        const archived = rc.query.get('archived') === '1';
        const rows = pro.ownRows(rc.user.id, { archived });
        return { products: rows.map((r) => productWire(r, rc.user)).filter(Boolean), limit: pro.PRODUCT_LIMIT };
      },
    },
    {
      method: 'POST',
      path: '/api/pro/products',
      rateLimit: { name: 'pro-product-create', max: 300, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        gate(rc, { write: true });
        if (pro.ownCount(rc.user.id) >= pro.PRODUCT_LIMIT) throw new HttpError(400, `Your catalog can hold ${pro.PRODUCT_LIMIT} products.`);
        const v = services.products.validateSpec(rc.body.spec);
        if (!v.ok) throw new HttpError(400, 'Some product details need fixing.', { errors: v.errors });
        checkFiles(v.spec, rc.user.id);
        const cost = readCostPatch(rc.body.cost ?? {});
        const row = ctx.tx(() => {
          const created = services.products.create({ source: 'contractor', ownerUserId: rc.user.id, visibility: 'private', spec: v.spec, status: 'draft' });
          // No moderation: a contractor's own catalog is live as soon as it's saved.
          const live = services.products.publish(created.id);
          if (cost.costCents !== undefined || cost.costByWidth !== undefined || cost.markupPct !== undefined) pro.setPriceRow(rc.user.id, live.id, cost);
          return live;
        });
        rc.send(201, { product: productWire(row, rc.user), price: pro.priceRows(rc.user.id)[row.id] ?? null });
      },
    },
    {
      method: 'PATCH',
      path: '/api/pro/products/:id',
      handler: (rc) => {
        gate(rc, { write: true });
        const row = ownProduct(rc.user.id, rc.params.id);
        if (rc.body.spec !== undefined) {
          const p = services.products.validateSpec(rc.body.spec, { partial: true });
          if (!p.ok) throw new HttpError(400, 'Some product details need fixing.', { errors: p.errors });
          checkFiles({ ...row.spec, ...p.spec }, rc.user.id);
        }
        const updated = ctx.tx(() => {
          let r = row;
          if (rc.body.spec !== undefined) r = services.products.update(row.id, rc.body.spec, { expectRevision: rc.body.revision });
          if (r.status !== 'archived') r = services.products.publish(r.id);
          if (rc.body.cost !== undefined) pro.setPriceRow(rc.user.id, r.id, readCostPatch(rc.body.cost));
          return r;
        });
        return { product: productWire(updated, rc.user), price: pro.priceRows(rc.user.id)[updated.id] ?? null };
      },
    },
    {
      method: 'POST',
      path: '/api/pro/products/:id/archive',
      handler: (rc) => {
        gate(rc, { write: true });
        const row = ownProduct(rc.user.id, rc.params.id);
        return { product: productWire(services.products.archive(row.id), rc.user) };
      },
    },
    {
      method: 'POST',
      path: '/api/pro/products/:id/restore',
      handler: (rc) => {
        gate(rc, { write: true });
        const row = ownProduct(rc.user.id, rc.params.id);
        if (row.status !== 'archived') return { product: productWire(row, rc.user) };
        if (pro.ownCount(rc.user.id) >= pro.PRODUCT_LIMIT) throw new HttpError(400, `Your catalog can hold ${pro.PRODUCT_LIMIT} products.`);
        return { product: productWire(services.products.publish(row.id), rc.user) };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/brands',
      handler: async (rc) => {
        gate(rc);
        const { kit } = await builtinIds();
        const settings = pro.brandSettings(rc.user.id);
        const catalog = services.products.listCatalog(rc.user).filter((p) => p.source === 'brand' && p.brandId);
        const counts = new Map();
        for (const p of catalog) counts.set(p.brandId, (counts.get(p.brandId) ?? 0) + 1);
        const s = (key) => settings[key] ?? { enabled: true, pctOffList: null, markupPct: null };
        const brands = [
          { key: 'builtin', name: 'Mise built-in catalog', isDemo: false, verified: false, productCount: kit.BUILTIN_PRODUCTS.length, ...s('builtin') },
          ...services.brands
            .listActive()
            .map(services.brands.toWire)
            .map((b) => ({ key: b.id, name: b.name, isDemo: b.isDemo, verified: b.verified, productCount: counts.get(b.id) ?? 0, ...s(b.id) })),
        ];
        const own = pro.ownRows(rc.user.id);
        const lines = new Map();
        for (const r of own) {
          const name = r.spec?.line;
          if (!name) continue;
          const key = `line:${name.trim().toLowerCase()}`;
          const cur = lines.get(key) ?? { key, name, count: 0, markupPct: settings[key]?.markupPct ?? null };
          cur.count++;
          lines.set(key, cur);
        }
        return { brands, lines: [...lines.values()], own: { count: own.length, markupPct: settings.own?.markupPct ?? null } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/pro/brand-settings',
      handler: (rc) => {
        gate(rc, { write: true });
        const key = brandKey(rc.body.key);
        if (!key) throw new HttpError(400, 'Choose a brand or line.');
        const patch = {};
        if (rc.body.enabled !== undefined) {
          if (typeof rc.body.enabled !== 'boolean' || key === 'own' || key.startsWith('line:')) throw new HttpError(400, 'Only brands can be switched on or off.');
          patch.enabled = rc.body.enabled;
        }
        const off = readPct(rc.body.pctOffList, 'pctOffList', 100);
        if (off !== undefined) {
          if (key === 'own' || key.startsWith('line:')) throw new HttpError(400, 'A discount off list applies to brands you buy from.');
          patch.pctOffList = off;
        }
        const markup = readPct(rc.body.markupPct, 'markupPct');
        if (markup !== undefined) patch.markupPct = markup;
        return { key, setting: pro.setBrandSetting(rc.user.id, key, patch) };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/price-book',
      handler: async (rc) => {
        gate(rc);
        const { kit, products } = await carried(rc.user);
        const data = pro.priceBookFor(rc.user.id);
        return { rows: rowsFor(kit, products, data.rows), data };
      },
    },
    {
      // The editor's prices: small, fetched once per session (usePriceBook).
      method: 'GET',
      path: '/api/pro/price-book/data',
      handler: (rc) => {
        gate(rc);
        return pro.priceBookFor(rc.user.id);
      },
    },
    {
      method: 'PATCH',
      path: '/api/pro/price-book/:productId',
      handler: async (rc) => {
        gate(rc, { write: true });
        const { ids } = await builtinIds();
        pro.assertPriceable(rc.user, rc.params.productId, ids);
        const row = pro.setPriceRow(rc.user.id, rc.params.productId, readCostPatch(rc.body));
        return { productId: rc.params.productId, row };
      },
    },
    {
      // A supplier's price list (CSV text in the body). `?dryRun=1` previews; without it the
      // whole file applies in one transaction, or nothing does when any row is bad.
      method: 'POST',
      path: '/api/pro/price-book/import',
      body: 'raw',
      maxBytes: 2_000_000,
      rateLimit: { name: 'pro-import', max: 60, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        gate(rc, { write: true });
        const { kit, products } = await carried(rc.user);
        const rows = pro.priceRows(rc.user.id);
        const preview = previewImport(kit, products, rows, rc.body.toString('utf8'));
        if (rc.query.get('dryRun') === '1') return { preview, applied: 0 };
        if (preview.errors.length) throw new HttpError(400, `Fix ${preview.errors.length} row${preview.errors.length === 1 ? '' : 's'} first; nothing was imported.`, { preview });
        const changes = [...preview.added, ...preview.updated];
        ctx.tx(() => {
          for (const c of changes) {
            const cur = pro.priceRows(rc.user.id)[c.productId];
            if (c.width !== null) pro.setPriceRow(rc.user.id, c.productId, { costByWidth: { ...(cur?.costByWidth ?? {}), [String(c.width)]: c.costCents } });
            else pro.setPriceRow(rc.user.id, c.productId, { costCents: c.costCents });
          }
        });
        return { preview, applied: changes.length };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/price-book/export',
      handler: async (rc) => {
        gate(rc);
        const { kit, products } = await carried(rc.user);
        const book = pro.priceBookFor(rc.user.id);
        const lines = [['SKU', 'Name', 'Brand', 'Line', 'Width (in)', 'List price', 'Your cost', 'Markup %', 'Sell price']];
        for (const p of products) {
          for (const w of p.widthOptions?.length ? p.widthOptions : [p.widthIn]) {
            const q = kit.quoteAt(book, p, w);
            lines.push([kit.productCode(p, w), p.name, p.brand, p.line ?? '', w, kit.priceFor(p, w), q.cost ?? '', q.markupPct ?? '', q.sell]);
          }
        }
        const company = kit.slug(pro.profileRow(rc.user.id)?.company ?? 'price-book');
        return { filename: `${company}-price-book.csv`, contentType: 'text/csv', content: lines.map((r) => r.map(csvCell).join(',')).join('\n') };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/quotes',
      handler: async (rc) => {
        gate(rc);
        const kit = await loadKit();
        const book = pro.priceBookFor(rc.user.id);
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200').all(rc.user.id);
        const settings = new Map(db.prepare('SELECT project_id, valid_until FROM contractor_quotes WHERE user_id = ?').all(rc.user.id).map((r) => [r.project_id, r.valid_until]));
        return {
          quotes: projects.map((p) => {
            const doc = { ...JSON.parse(p.doc), name: p.name };
            const est = kit.estimateFor(doc, { products: liveWires(doc, rc.user.id), priceBook: book });
            return { projectId: p.id, name: p.name, client: p.client, items: doc.items.length, total: est.total, updatedAt: p.updated_at, validUntil: settings.get(p.id) ?? null };
          }),
        };
      },
    },
    {
      method: 'GET',
      path: '/api/pro/quotes/:projectId',
      handler: async (rc) => {
        gate(rc);
        const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(rc.params.projectId, rc.user.id);
        if (!project) throw new HttpError(404, 'That kitchen does not exist.');
        return quoteFor(rc.user, project);
      },
    },
    {
      method: 'PUT',
      path: '/api/pro/quotes/:projectId',
      handler: async (rc) => {
        gate(rc, { write: true });
        const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(rc.params.projectId, rc.user.id);
        if (!project) throw new HttpError(404, 'That kitchen does not exist.');
        const validUntil = rc.body.validUntil;
        if (validUntil !== null && validUntil !== undefined && (!Number.isFinite(validUntil) || validUntil < 0 || validUntil > 4_102_444_800_000)) throw new HttpError(400, 'Choose a valid date.', { field: 'validUntil' });
        const notes = typeof rc.body.notes === 'string' ? rc.body.notes.trim().slice(0, 2000) : '';
        db.prepare(
          `INSERT INTO contractor_quotes (project_id, user_id, valid_until, notes, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET valid_until = excluded.valid_until, notes = excluded.notes, updated_at = excluded.updated_at`,
        ).run(project.id, rc.user.id, validUntil ?? null, notes, ctx.now());
        return quoteFor(rc.user, project);
      },
    },
  ];
}
