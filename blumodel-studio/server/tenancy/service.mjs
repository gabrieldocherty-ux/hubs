// Tenants: the kitchen and bath companies whose showrooms we host (docs/SHOWROOM_PIVOT.md §4, §8;
// docs/handoff/tenancy.md). Exposed as ctx.services.tenants.
//
//   tenants           one row per company: slug, name, status, branding / contact / settings JSON
//   tenant_hostnames  every address that reaches a showroom: <slug>.<BASE_DOMAIN> (kind subdomain,
//                     made with the tenant) and custom domains an admin adds (kind custom)
//   tenant_members    the company's staff (owner | staff). A member is either a user made on that
//                     showroom (users.tenant_id = the tenant) or a sales-site account (tenant_id
//                     NULL) given access, such as a contractor whose company became a tenant.
//
// Status: 'setup' (being built; reachable so staff can set it up), 'live' / 'lapsed' (launched; which
// one is recomputed from the license and the monthly plan, see registerStanding), 'suspended' (an
// admin switched it off). A lapsed or suspended showroom answers "temporarily unavailable" and
// keeps every row.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { FILE_ID_RE } from '../lib/ids.mjs';

export const STATUSES = ['setup', 'live', 'lapsed', 'suspended'];
export const MEMBER_ROLES = ['owner', 'staff'];

/** Labels never given to a company: they are ours, or would confuse visitors. */
export const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'mail', 'email', 'smtp', 'ftp', 'ns1', 'ns2', 'static', 'assets', 'files', 'cdn',
  'blog', 'help', 'support', 'status', 'sales', 'billing', 'pay', 'payments', 'stripe', 'studio', 'blumodel', 'dashboard', 'login',
  'signin', 'signup', 'account', 'docs', 'dev', 'test', 'staging', 'qa', 'localhost', 'webhooks', 'tunnel',
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "Acme Kitchens & Bath Ltd." -> "acme-kitchens-bath-ltd" (at most 40 characters). */
export function slugify(name) {
  return (
    String(name ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'showroom'
  );
}

/** Settings every tenant has (docs/handoff/tenancy.md "settings"). */
export const DEFAULT_SETTINGS = Object.freeze({
  /** Show BluModel Basics next to the company's own products. */
  fillGaps: false,
  /** Offer "Design your bathroom" on the landing page. */
  bathrooms: false,
  /** Let signed-in visitors make AI renders (staff always can, with credits). */
  visitorRenders: false,
  /** Visitor renders a day across the showroom, when visitorRenders is on. */
  dailyRenderCap: 0,
});

const parse = (s, fallback = {}) => {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function httpsUrl(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') && s.length <= 300 ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Throws a 400 listing every field that needs fixing (`{ errors: [{ field, message }] }`). */
const invalid = (errors) => new HttpError(400, errors[0]?.message ?? 'Some details need fixing.', { errors });

/**
 * Cleans a branding patch. Unknown keys are dropped; `null` or '' clears an optional field.
 * Shape: { logoFileId, primaryColor, accentColor, welcomeTitle, welcomeText, featuredLines[] }.
 */
export function cleanBranding(input, current = {}) {
  const out = { ...current };
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: true, value: out };
  if (input.logoFileId !== undefined) {
    if (input.logoFileId === null || input.logoFileId === '') delete out.logoFileId;
    else if (typeof input.logoFileId !== 'string' || !FILE_ID_RE.test(input.logoFileId)) errors.push({ field: 'branding.logoFileId', message: 'That logo isn’t an uploaded image.' });
    else out.logoFileId = input.logoFileId;
  }
  for (const k of ['primaryColor', 'accentColor']) {
    if (input[k] === undefined) continue;
    if (input[k] === null || input[k] === '') delete out[k];
    else if (typeof input[k] !== 'string' || !HEX_RE.test(input[k])) errors.push({ field: `branding.${k}`, message: 'Use a colour like #1f4f8a.' });
    else out[k] = input[k].toLowerCase();
  }
  if (input.welcomeTitle !== undefined) out.welcomeTitle = str(input.welcomeTitle, 100);
  if (input.welcomeText !== undefined) out.welcomeText = text(input.welcomeText, 600);
  if (input.featuredLines !== undefined) {
    const v = input.featuredLines;
    if (v === null) out.featuredLines = [];
    else if (!Array.isArray(v) || v.length > 12 || !v.every((x) => typeof x === 'string' && x.trim() && x.trim().length <= 60)) {
      errors.push({ field: 'branding.featuredLines', message: 'Up to 12 product line names, 60 characters each.' });
    } else out.featuredLines = [...new Set(v.map((x) => x.trim()))];
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** Cleans a contact patch: { phone, email, website, address, serviceArea, hours }. */
export function cleanContact(input, current = {}) {
  const out = { ...current };
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: true, value: out };
  if (input.phone !== undefined) {
    const p = str(input.phone, 40);
    if (p && !/^[0-9+().\-\s x]{7,40}$/i.test(p)) errors.push({ field: 'contact.phone', message: 'That phone number doesn’t look right.' });
    else out.phone = p;
  }
  if (input.email !== undefined) {
    const e = str(input.email, 254).toLowerCase();
    if (e && !EMAIL_RE.test(e)) errors.push({ field: 'contact.email', message: 'That email address doesn’t look right.' });
    else out.email = e;
  }
  if (input.website !== undefined) {
    const w = httpsUrl(input.website);
    if (w === null) errors.push({ field: 'contact.website', message: 'Use a web address like https://acmekitchens.ca.' });
    else out.website = w;
  }
  if (input.address !== undefined) out.address = text(input.address, 300);
  if (input.serviceArea !== undefined) out.serviceArea = str(input.serviceArea, 200);
  if (input.hours !== undefined) out.hours = text(input.hours, 300);
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** Cleans a settings patch against DEFAULT_SETTINGS' keys. */
export function cleanSettings(input, current = {}) {
  const out = { ...DEFAULT_SETTINGS, ...current };
  const errors = [];
  if (!input || typeof input !== 'object') return { ok: true, value: out };
  for (const k of ['fillGaps', 'bathrooms', 'visitorRenders']) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== 'boolean') errors.push({ field: `settings.${k}`, message: `${k} is on or off.` });
    else out[k] = input[k];
  }
  if (input.dailyRenderCap !== undefined) {
    const n = input.dailyRenderCap;
    if (!Number.isInteger(n) || n < 0 || n > 1000) errors.push({ field: 'settings.dailyRenderCap', message: 'The daily cap is a whole number from 0 to 1000.' });
    else out.dailyRenderCap = n;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** A hostname as typed by an admin: lowercased, no scheme, port, path or trailing dot. */
export function cleanHostname(v) {
  let s = String(v ?? '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.+$/, '');
  return HOSTNAME_RE.test(s) ? s : null;
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, now?: () => number, files?: any, log?: any }} deps
 */
export function createTenantService({ db, config, now = Date.now, files = null, log = console }) {
  /** (tenantId) => { licenseCurrent: boolean, monthlyPaid: boolean }, from server/billing/showroom.mjs. */
  let standing = () => ({ licenseCurrent: false, monthlyPaid: false });
  /** (tenant) => object: fields other packages add to adminWire (standing, counts...). */
  const adminExtras = [];

  const toRecord = (r) =>
    r && {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      statusNote: r.status_note,
      branding: parse(r.branding),
      contact: parse(r.contact),
      settings: { ...DEFAULT_SETTINGS, ...parse(r.settings) },
      isDemo: !!r.is_demo,
      sourceUserId: r.source_user_id ?? null,
      createdBy: r.created_by ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  /** Scheme and port for links: from `from` (an origin) when given, else PUBLIC_URL. */
  const schemePort = (from) => {
    try {
      const u = new URL(from || config.PUBLIC_URL);
      return { scheme: u.protocol, port: u.port && u.port !== '0' ? `:${u.port}` : '' };
    } catch {
      return { scheme: 'https:', port: '' };
    }
  };

  const hostnameRows = (tenantId) =>
    db.prepare('SELECT * FROM tenant_hostnames WHERE tenant_id = ? ORDER BY is_primary DESC, kind DESC, created_at, hostname').all(tenantId);

  const svc = {
    /**
     * Registers how a launched tenant's standing is computed (server/billing/showroom.mjs does).
     * @param {(tenantId: string) => { licenseCurrent: boolean, monthlyPaid: boolean }} fn
     */
    registerStanding(fn) {
      if (typeof fn !== 'function') throw new Error('tenants.registerStanding(fn): fn must be a function.');
      standing = fn;
    },

    get(id) {
      if (typeof id !== 'string' || !id) return null;
      return toRecord(db.prepare('SELECT * FROM tenants WHERE id = ?').get(id)) || null;
    },

    bySlug(slug) {
      if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
      return toRecord(db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug)) || null;
    },

    /** The tenant an exact hostname belongs to (a subdomain row, or a verified custom domain). */
    byHostname(hostname) {
      if (typeof hostname !== 'string' || !hostname) return null;
      const r = db
        .prepare("SELECT t.* FROM tenant_hostnames h JOIN tenants t ON t.id = h.tenant_id WHERE h.hostname = ? AND (h.kind = 'subdomain' OR h.verified = 1)")
        .get(hostname);
      return toRecord(r) || null;
    },

    list() {
      return db.prepare('SELECT * FROM tenants ORDER BY name COLLATE NOCASE, id').all().map(toRecord);
    },

    /** A free slug from `wanted` (or the name): wanted, wanted-2, wanted-3 … */
    uniqueSlug(wanted) {
      let base = slugify(wanted);
      if (RESERVED_SLUGS.has(base)) base = `${base}-showroom`.slice(0, 40);
      let s = base;
      for (let i = 2; svc.slugInUse(s) || RESERVED_SLUGS.has(s); i++) s = `${base.slice(0, 36)}-${i}`;
      return s;
    },

    /**
     * True when `<slug>` is some tenant's slug, or `<slug>.<BASE_DOMAIN>` is already an address
     * (an admin may give a showroom an extra subdomain, which then reserves that slug).
     */
    slugInUse(slug) {
      return !!db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug) || !!db.prepare('SELECT 1 FROM tenant_hostnames WHERE hostname = ?').get(svc.subdomainFor(slug));
    },

    /** `<slug>.<BASE_DOMAIN>`: the address every tenant gets. */
    subdomainFor(slug) {
      return `${slug}.${config.BASE_DOMAIN}`;
    },

    /**
     * Creates a tenant and its subdomain. `slug` must be free and not reserved (a 409 / 400 when
     * it isn't); without one, a free slug is made from the name.
     */
    create({ name, slug, status = 'setup', branding = {}, contact = {}, settings = {}, isDemo = false, createdBy = null, sourceUserId = null, id }) {
      const n = str(name, 100);
      if (!n) throw invalid([{ field: 'name', message: 'Give the company a name.' }]);
      let s;
      if (slug !== undefined && slug !== null && slug !== '') {
        s = String(slug).trim().toLowerCase();
        if (!SLUG_RE.test(s)) throw invalid([{ field: 'slug', message: 'The web address uses lowercase letters, digits and dashes (2 to 40), like acme-kitchens.' }]);
        if (RESERVED_SLUGS.has(s)) throw invalid([{ field: 'slug', message: `“${s}” is reserved. Choose another web address.` }]);
        if (svc.slugInUse(s)) throw new HttpError(409, `${s}.${config.BASE_DOMAIN} is taken.`, { field: 'slug', code: 'slug_taken' });
      } else s = svc.uniqueSlug(n);
      if (!STATUSES.includes(status)) throw new Error(`tenants.create: bad status ${status}`);
      const b = cleanBranding(branding);
      const c = cleanContact(contact);
      const st = cleanSettings(settings);
      const errors = [...(b.ok ? [] : b.errors), ...(c.ok ? [] : c.errors), ...(st.ok ? [] : st.errors)];
      if (errors.length) throw invalid(errors);
      const tid = id ?? `t_${crypto.randomBytes(9).toString('base64url')}`;
      const t = now();
      db.prepare(
        `INSERT INTO tenants (id, slug, name, status, branding, contact, settings, is_demo, source_user_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(tid, s, n, status, JSON.stringify(b.value), JSON.stringify(c.value), JSON.stringify(st.value), isDemo ? 1 : 0, sourceUserId, createdBy, t, t);
      // A plain INSERT: if the address were somehow taken, creating the tenant fails (in the caller's
      // transaction) rather than leaving its own subdomain pointing at another showroom.
      db.prepare("INSERT INTO tenant_hostnames (hostname, tenant_id, kind, verified, is_primary, created_by, created_at) VALUES (?, ?, 'subdomain', 1, 1, ?, ?)").run(
        svc.subdomainFor(s),
        tid,
        createdBy,
        t,
      );
      return svc.get(tid);
    },

    /**
     * Applies a patch of { name, branding, contact, settings } (each optional, merged into what is
     * stored). A logo must be an image file that belongs to this tenant (or no tenant).
     */
    update(id, patch = {}) {
      const cur = svc.get(id);
      if (!cur) throw new HttpError(404, 'That showroom does not exist.');
      const errors = [];
      let name = cur.name;
      if (patch.name !== undefined) {
        name = str(patch.name, 100);
        if (!name) errors.push({ field: 'name', message: 'Give the company a name.' });
      }
      const b = cleanBranding(patch.branding, cur.branding);
      const c = cleanContact(patch.contact, cur.contact);
      const st = cleanSettings(patch.settings, cur.settings);
      for (const r of [b, c, st]) if (!r.ok) errors.push(...r.errors);
      if (b.ok && b.value.logoFileId && b.value.logoFileId !== cur.branding.logoFileId) {
        const f = files?.get(b.value.logoFileId);
        const fileTenant = f ? (db.prepare('SELECT tenant_id FROM files WHERE id = ?').get(f.id)?.tenant_id ?? null) : null;
        if (!f || f.kind !== 'image' || (fileTenant && fileTenant !== id)) errors.push({ field: 'branding.logoFileId', message: 'That logo isn’t an uploaded image.' });
      }
      if (errors.length) throw invalid(errors);
      db.prepare('UPDATE tenants SET name = ?, branding = ?, contact = ?, settings = ?, updated_at = ? WHERE id = ?').run(
        name,
        JSON.stringify(b.value),
        JSON.stringify(c.value),
        JSON.stringify(st.value),
        now(),
        id,
      );
      return svc.get(id);
    },

    /**
     * Sets the admin-controlled status: 'setup', 'suspended', or 'live' (launch / restore; it may
     * come out 'lapsed' at once when the license or the monthly plan isn't current).
     */
    setStatus(id, status, { note } = {}) {
      const cur = svc.get(id);
      if (!cur) throw new HttpError(404, 'That showroom does not exist.');
      if (!['setup', 'live', 'suspended'].includes(status)) throw invalid([{ field: 'status', message: 'Choose setup, live or suspended.' }]);
      db.prepare('UPDATE tenants SET status = ?, status_note = COALESCE(?, status_note), updated_at = ? WHERE id = ?').run(status, typeof note === 'string' ? note.slice(0, 500) : null, now(), id);
      return svc.refresh(id);
    },

    /** What standing says about a launched tenant, as an effective status. */
    computeStatus(t) {
      if (!t) return null;
      if (t.status === 'setup' || t.status === 'suspended') return t.status;
      const s = standing(t.id) || {};
      return s.licenseCurrent && s.monthlyPaid ? 'live' : 'lapsed';
    },

    /** Recomputes live / lapsed and stores it when it changed. Returns the tenant. */
    refresh(id) {
      const t = svc.get(id);
      if (!t) return null;
      const next = svc.computeStatus(t);
      if (next !== t.status) {
        db.prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?').run(next, now(), id);
        log.info?.(`tenant ${t.slug}: ${t.status} -> ${next}`);
        return svc.get(id);
      }
      return t;
    },

    /** Every launched tenant, recomputed (index.mjs's maintenance runs this). Returns how many changed. */
    refreshAll() {
      let n = 0;
      for (const r of db.prepare("SELECT id, status FROM tenants WHERE status IN ('live','lapsed')").all()) if (svc.refresh(r.id)?.status !== r.status) n++;
      return n;
    },

    /** True when visitors can use the showroom (setup counts: staff build it there). */
    isAvailable(t) {
      return !!t && (t.status === 'live' || t.status === 'setup');
    },

    // ── hostnames ─────────────────────────────────────────────────────────
    hostnames(tenantId) {
      return hostnameRows(tenantId).map((h) => ({ hostname: h.hostname, kind: h.kind, verified: !!h.verified, primary: !!h.is_primary, createdAt: h.created_at }));
    },

    /** Adds an address. A custom domain starts unverified (it reaches the showroom once verified). */
    addHostname(tenantId, hostname, { kind = 'custom', verified = false, primary = false, by = null } = {}) {
      if (!svc.get(tenantId)) throw new HttpError(404, 'That showroom does not exist.');
      const h = cleanHostname(hostname);
      if (!h) throw invalid([{ field: 'hostname', message: 'Use a domain like showroom.acmekitchens.ca.' }]);
      const base = config.BASE_DOMAIN;
      if (h === base || h === `www.${base}`) throw invalid([{ field: 'hostname', message: 'That is the sales site’s address.' }]);
      if (kind === 'subdomain') {
        const label = h.endsWith(`.${base}`) ? h.slice(0, -(base.length + 1)) : '';
        if (!label || label.includes('.') || !SLUG_RE.test(label) || RESERVED_SLUGS.has(label)) throw invalid([{ field: 'hostname', message: `A subdomain looks like name.${base}.` }]);
        const other = db.prepare('SELECT id FROM tenants WHERE slug = ? AND id <> ?').get(label, tenantId);
        if (other) throw new HttpError(409, 'That address belongs to another showroom.', { field: 'hostname', code: 'hostname_taken' });
      } else if (kind !== 'custom') throw invalid([{ field: 'kind', message: 'Kind is subdomain or custom.' }]);
      else if (h.endsWith(`.${base}`)) throw invalid([{ field: 'hostname', message: `Addresses under ${base} are subdomains.` }]);
      const existing = db.prepare('SELECT tenant_id FROM tenant_hostnames WHERE hostname = ?').get(h);
      if (existing && existing.tenant_id !== tenantId) throw new HttpError(409, 'That address belongs to another showroom.', { field: 'hostname', code: 'hostname_taken' });
      const t = now();
      if (existing) db.prepare('UPDATE tenant_hostnames SET verified = ? WHERE hostname = ?').run(verified || kind === 'subdomain' ? 1 : 0, h);
      else
        db.prepare('INSERT INTO tenant_hostnames (hostname, tenant_id, kind, verified, is_primary, created_by, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)').run(
          h,
          tenantId,
          kind,
          verified || kind === 'subdomain' ? 1 : 0,
          by,
          t,
        );
      if (primary) svc.setPrimaryHostname(tenantId, h);
      return svc.hostnames(tenantId).find((x) => x.hostname === h);
    },

    /** Marks a custom domain verified or not (an admin does once Cloudflare shows it active). */
    setHostnameVerified(tenantId, hostname, verified) {
      const r = db.prepare('UPDATE tenant_hostnames SET verified = ? WHERE hostname = ? AND tenant_id = ?').run(verified ? 1 : 0, hostname, tenantId);
      if (!r.changes) throw new HttpError(404, 'That showroom has no such address.');
      return svc.hostnames(tenantId).find((x) => x.hostname === hostname);
    },

    setPrimaryHostname(tenantId, hostname) {
      const row = db.prepare('SELECT * FROM tenant_hostnames WHERE hostname = ? AND tenant_id = ?').get(hostname, tenantId);
      if (!row) throw new HttpError(404, 'That showroom has no such address.');
      db.prepare('UPDATE tenant_hostnames SET is_primary = CASE WHEN hostname = ? THEN 1 ELSE 0 END WHERE tenant_id = ?').run(hostname, tenantId);
    },

    /** Removes an address; the tenant's own <slug> subdomain can't be removed. */
    removeHostname(tenantId, hostname) {
      const t = svc.get(tenantId);
      if (!t) throw new HttpError(404, 'That showroom does not exist.');
      if (hostname === svc.subdomainFor(t.slug)) throw new HttpError(409, 'The showroom’s own subdomain can’t be removed.', { code: 'own_subdomain' });
      const row = db.prepare('SELECT is_primary FROM tenant_hostnames WHERE hostname = ? AND tenant_id = ?').get(hostname, tenantId);
      if (!row) throw new HttpError(404, 'That showroom has no such address.');
      db.prepare('DELETE FROM tenant_hostnames WHERE hostname = ? AND tenant_id = ?').run(hostname, tenantId);
      if (row.is_primary && hostnameRows(tenantId).length) {
        const own = svc.subdomainFor(t.slug);
        svc.setPrimaryHostname(tenantId, hostnameRows(tenantId).some((h) => h.hostname === own) ? own : hostnameRows(tenantId)[0].hostname);
      }
    },

    /**
     * The showroom's address as an origin, for links made anywhere (an admin's invite link on the
     * sales site): the primary verified hostname, else <slug>.<BASE_DOMAIN>. A subdomain takes the
     * scheme and port of `from` (the origin of the request the link is made in; PUBLIC_URL when not
     * given), so dev and QA get http://<slug>.localhost:<port>; a custom domain is always https.
     */
    originOf(t, from) {
      if (!t) return config.PUBLIC_URL;
      const rows = hostnameRows(t.id).filter((h) => h.kind === 'subdomain' || h.verified);
      const host = rows.find((h) => h.is_primary)?.hostname ?? svc.subdomainFor(t.slug);
      if (!host.endsWith(`.${config.BASE_DOMAIN}`)) return `https://${host}`;
      const { scheme, port } = schemePort(from);
      return `${scheme}//${host}${port}`;
    },

    // ── members ───────────────────────────────────────────────────────────
    /** 'owner' | 'staff' | null. */
    roleOf(tenantId, userId) {
      if (!tenantId || !userId) return null;
      return db.prepare('SELECT role FROM tenant_members WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId)?.role ?? null;
    },

    members(tenantId) {
      return db
        .prepare(
          `SELECT m.user_id, m.role, m.created_at, u.email, u.name, u.tenant_id,
                  (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = m.user_id AND s.tenant_id = m.tenant_id) AS last_seen_at
             FROM tenant_members m JOIN users u ON u.id = m.user_id
            WHERE m.tenant_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name COLLATE NOCASE, u.email`,
        )
        .all(tenantId)
        .map((r) => ({ userId: r.user_id, email: r.email, name: r.name, role: r.role, addedAt: r.created_at, lastSeenAt: r.last_seen_at ?? null }))
        .concat(svc.pendingInvites(tenantId));
    },

    /**
     * Invites waiting for their link to be used (tenancy-007): the address already had an account
     * on this showroom, so it joins the team only once the invite link is used. Listed with the
     * team as `pending: true`; they grant nothing until then.
     */
    pendingInvites(tenantId) {
      return db
        .prepare(
          `SELECT i.user_id, i.role, i.created_at, u.email, u.name FROM tenant_invites i JOIN users u ON u.id = i.user_id
            WHERE i.tenant_id = ? AND NOT EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id = i.tenant_id AND m.user_id = i.user_id)
            ORDER BY u.email`,
        )
        .all(tenantId)
        .map((r) => ({ userId: r.user_id, email: r.email, name: r.name, role: r.role, addedAt: r.created_at, lastSeenAt: null, pending: true }));
    },

    /** Holds an invite for an existing account until its link is used. Returns the pending member. */
    addPendingInvite(tenantId, userId, role = 'staff', { by = null } = {}) {
      if (!MEMBER_ROLES.includes(role)) throw invalid([{ field: 'role', message: 'Role is owner or staff.' }]);
      db.prepare(
        'INSERT INTO tenant_invites (tenant_id, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by, created_at = excluded.created_at',
      ).run(tenantId, userId, role, by, now());
      return svc.pendingInvites(tenantId).find((m) => m.userId === userId);
    },

    /**
     * The invite link for `userId` was used (POST /api/auth/reset): that proves the address, so every
     * invite held for the account becomes a membership. Returns how many.
     */
    acceptInvites(userId) {
      const rows = db.prepare('SELECT tenant_id, role, invited_by FROM tenant_invites WHERE user_id = ?').all(userId);
      for (const r of rows) {
        db.prepare('INSERT INTO tenant_members (tenant_id, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET role = excluded.role').run(
          r.tenant_id,
          userId,
          r.role,
          r.invited_by,
          now(),
        );
      }
      db.prepare('DELETE FROM tenant_invites WHERE user_id = ?').run(userId);
      return rows.length;
    },

    /** Adds (or changes the role of) a member. */
    addMember(tenantId, userId, role = 'staff', { by = null } = {}) {
      if (!MEMBER_ROLES.includes(role)) throw invalid([{ field: 'role', message: 'Role is owner or staff.' }]);
      const u = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId);
      if (!u) throw new HttpError(404, 'That account does not exist.');
      if (u.tenant_id && u.tenant_id !== tenantId) throw new Error('tenants.addMember: that account belongs to another showroom');
      db.prepare(
        'INSERT INTO tenant_members (tenant_id, user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET role = excluded.role',
      ).run(tenantId, userId, role, by, now());
      return svc.members(tenantId).find((m) => m.userId === userId);
    },

    /** Removes a member (never the last owner). Their sessions on this showroom end. */
    removeMember(tenantId, userId) {
      const role = svc.roleOf(tenantId, userId);
      if (!role && db.prepare('DELETE FROM tenant_invites WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId).changes) return true;
      if (!role) throw new HttpError(404, 'That person isn’t on this showroom’s team.');
      if (role === 'owner' && db.prepare("SELECT COUNT(*) AS n FROM tenant_members WHERE tenant_id = ? AND role = 'owner'").get(tenantId).n <= 1) {
        throw new HttpError(409, 'A showroom needs at least one owner. Make someone else an owner first.', { code: 'last_owner' });
      }
      db.prepare('DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
      return true;
    },

    /** Changes a member's role, keeping at least one owner. */
    setMemberRole(tenantId, userId, role) {
      const cur = svc.roleOf(tenantId, userId);
      if (!MEMBER_ROLES.includes(role)) throw invalid([{ field: 'role', message: 'Role is owner or staff.' }]);
      if (!cur && db.prepare('UPDATE tenant_invites SET role = ? WHERE tenant_id = ? AND user_id = ?').run(role, tenantId, userId).changes) {
        return svc.pendingInvites(tenantId).find((m) => m.userId === userId);
      }
      if (!cur) throw new HttpError(404, 'That person isn’t on this showroom’s team.');
      if (cur === 'owner' && role !== 'owner' && db.prepare("SELECT COUNT(*) AS n FROM tenant_members WHERE tenant_id = ? AND role = 'owner'").get(tenantId).n <= 1) {
        throw new HttpError(409, 'A showroom needs at least one owner. Make someone else an owner first.', { code: 'last_owner' });
      }
      db.prepare('UPDATE tenant_members SET role = ? WHERE tenant_id = ? AND user_id = ?').run(role, tenantId, userId);
      return svc.members(tenantId).find((m) => m.userId === userId);
    },

    /** Every tenant `userId` is a member of: [{ tenant, role }]. */
    membershipsOf(userId) {
      if (!userId) return [];
      return db
        .prepare('SELECT t.*, m.role AS member_role FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY t.name COLLATE NOCASE')
        .all(userId)
        .map((r) => ({ tenant: toRecord(r), role: r.member_role }));
    },

    // ── wire shapes ───────────────────────────────────────────────────────
    logoUrl(t) {
      const f = t?.branding?.logoFileId && files ? files.get(t.branding.logoFileId) : null;
      return f ? files.url(f) : null;
    },

    /**
     * What anyone on the showroom may see (GET /api/config `tenant`, GET /api/showroom):
     * { id, slug, name, status, isDemo, url, branding: { logoUrl, primaryColor, accentColor,
     *   welcomeTitle, welcomeText, featuredLines }, contact: { phone, email, website, address,
     *   serviceArea, hours }, features: { fillGaps, bathrooms, visitorRenders } }
     */
    publicWire(t, from) {
      if (!t) return null;
      const b = t.branding || {};
      const c = t.contact || {};
      return {
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        isDemo: t.isDemo,
        url: svc.originOf(t, from),
        branding: {
          logoUrl: svc.logoUrl(t),
          primaryColor: b.primaryColor ?? null,
          accentColor: b.accentColor ?? null,
          welcomeTitle: b.welcomeTitle ?? '',
          welcomeText: b.welcomeText ?? '',
          featuredLines: Array.isArray(b.featuredLines) ? b.featuredLines : [],
        },
        contact: { phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '', address: c.address ?? '', serviceArea: c.serviceArea ?? '', hours: c.hours ?? '' },
        features: { fillGaps: !!t.settings.fillGaps, bathrooms: !!t.settings.bathrooms, visitorRenders: !!t.settings.visitorRenders },
      };
    },

    /** Registers `fn(tenant) => object`, merged into every adminWire (billing adds standing, leads a count). */
    addAdminExtra(fn) {
      if (typeof fn === 'function') adminExtras.push(fn);
    },

    /** Admin > Tenants: the staff wire, the team, and every registered extra. */
    adminWire(t, from) {
      const out = { ...svc.staffWire(t, from), members: svc.members(t.id) };
      for (const fn of adminExtras) {
        try {
          Object.assign(out, fn(t) ?? {});
        } catch (err) {
          log.warn?.(`tenants: admin extra failed: ${err?.message ?? err}`);
        }
      }
      return out;
    },

    /** The workspace's and the admin's view: the public wire plus raw branding, settings and addresses. */
    staffWire(t, from) {
      if (!t) return null;
      const pub = svc.publicWire(t, from);
      return {
        ...pub,
        statusNote: t.statusNote,
        branding: { ...pub.branding, logoFileId: t.branding.logoFileId ?? null },
        settings: { ...t.settings },
        hostnames: svc.hostnames(t.id),
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    },
  };
  return svc;
}
