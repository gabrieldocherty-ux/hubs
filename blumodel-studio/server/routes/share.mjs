// Package E (share): view-only share links to a saved kitchen (BUILD_PLAN §9 E-T2, §13.3 E;
// PRODUCT_SPEC §5.7; PLANS_AND_CONTRACTORS §4.6).
//
//   POST   /api/projects/:id/shares            owner: create { label?, showPrices?, expiresInDays?: 7|30|90|null }
//   GET    /api/projects/:id/shares            owner: every link, newest first, with view counts
//   DELETE /api/projects/:id/shares/:shareId   owner: revoke (the link then shows "no longer available")
//   GET    /api/share/:token                   anyone with the token: the kitchen, read-only
//   POST   /api/share/:token/duplicate         signed in: copy the shared kitchen into my kitchens
//
// What a share never carries: the project's `client`, any email or user id of the owner, and
// (for a contractor's kitchen) any cost or margin. Prices go through services.pricing, so a
// contractor's clients see sell prices; branding comes from services.contractors.
//
// It also registers a file read policy: a private file (e.g. a customer's custom 3D model) is
// readable with `?share=<token>` while the link is live, when the file belongs to a product
// placed in that kitchen and owned by the kitchen's owner.
//
// No `services.share` is registered: the brand page's lead form makes its link through
// POST …/shares in the browser, and package B2's route treats a registered service as a cue to
// mint links server-side, which its tests don't expect (docs/handoff/share.md, "Not done").

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { normalizeDoc } from '../lib/doc.mjs';
import { randomId, PRODUCT_ID_RE } from '../lib/ids.mjs';
import { MAX_DOC } from './projects.mjs';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Active (not revoked, not expired) links one kitchen may have at once. */
export const MAX_ACTIVE_LINKS = 20;
export const EXPIRY_DAYS = Object.freeze([7, 30, 90]);
/** 24 random bytes as base64url: 32 characters, 192 bits. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
/** A view from the same address counts once per link per this long. */
const VIEW_DEDUPE_MS = 30 * 60_000;
const VIEW_DEDUPE_CAP = 5_000;

const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** The states a token can be in, for the shared page's friendly messages. */
const GONE = {
  missing: 'This link doesn’t exist. Check that you copied all of it.',
  revoked: 'This link is no longer available. Whoever shared it has turned it off.',
  expired: 'This link has expired. Ask whoever shared it for a new one.',
};

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services } = ctx;
  const { files, products, pricing, contractors } = services;

  const linkWire = (r) => ({
    id: r.id,
    projectId: r.project_id,
    token: r.token,
    label: r.label,
    showPrices: !!r.show_prices,
    expiresAt: r.expires_at ?? null,
    revokedAt: r.revoked_at ?? null,
    viewCount: r.view_count,
    lastViewedAt: r.last_viewed_at ?? null,
    createdAt: r.created_at,
  });

  /** The caller's kitchen, or a 404 (another user's kitchen looks exactly like a missing one). */
  const ownedProject = (userId, id) => {
    const row = db.prepare('SELECT id, user_id FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) throw new HttpError(404, 'That kitchen does not exist.');
    return row;
  };

  /** `{ link }` for a live token, or `{ reason }` ('missing' | 'revoked' | 'expired'). */
  const resolveToken = (token) => {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return { reason: 'missing' };
    const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
    if (!link) return { reason: 'missing' };
    if (link.revoked_at != null) return { reason: 'revoked' };
    if (link.expires_at != null && link.expires_at <= ctx.now()) return { reason: 'expired' };
    return { link };
  };

  const liveLinkOr404 = (token) => {
    const r = resolveToken(token);
    if (!r.link) throw new HttpError(404, GONE[r.reason], { reason: r.reason });
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(r.link.project_id);
    if (!project) throw new HttpError(404, GONE.missing, { reason: 'missing' });
    return { link: r.link, project };
  };

  /** Server product ids placed in a doc (built-ins are compiled into the app). */
  const serverProductIds = (doc) => [...new Set((Array.isArray(doc?.items) ? doc.items : []).map((i) => i?.productId).filter((id) => typeof id === 'string' && PRODUCT_ID_RE.test(id)))];

  const parseDoc = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  /**
   * Makes a link to the user's own kitchen.
   * Throws an HttpError for bad input, someone else's kitchen, or a kitchen at the link cap.
   */
  const createLink = (userId, projectId, body) => {
    const b = body && typeof body === 'object' ? body : {};
    const project = ownedProject(userId, projectId);
    const label = str(b.label, 80);
    if (b.showPrices !== undefined && typeof b.showPrices !== 'boolean') throw new HttpError(400, 'Show prices is on or off.', { field: 'showPrices' });
    const showPrices = b.showPrices !== false;
    const days = b.expiresInDays ?? null;
    if (days !== null && !EXPIRY_DAYS.includes(days)) throw new HttpError(400, 'A link can expire after 7, 30 or 90 days, or never.', { field: 'expiresInDays' });
    const t = ctx.now();
    const active = db
      .prepare('SELECT COUNT(*) AS n FROM share_links WHERE project_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)')
      .get(project.id, t).n;
    if (active >= MAX_ACTIVE_LINKS) throw new HttpError(409, `This kitchen already has ${MAX_ACTIVE_LINKS} active links. Turn one off before making another.`);
    const id = randomId('sh_', 16);
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(
      `INSERT INTO share_links (id, project_id, token, created_by, label, show_prices, expires_at, revoked_at, view_count, last_viewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?)`,
    ).run(id, project.id, token, userId, label, showPrices ? 1 : 0, days === null ? null : t + days * DAY, t);
    return linkWire(db.prepare('SELECT * FROM share_links WHERE id = ?').get(id));
  };

  // ── private files behind a live share token ─────────────────────────────
  files.addReadPolicy((_user, file, rc) => {
    const token = rc?.query?.get?.('share');
    if (!token) return false;
    const { link } = resolveToken(token);
    if (!link) return false;
    const project = db.prepare('SELECT user_id, doc FROM projects WHERE id = ?').get(link.project_id);
    if (!project) return false;
    for (const id of serverProductIds(parseDoc(project.doc))) {
      const row = products.get(id);
      if (!row || row.ownerUserId !== project.user_id || !row.liveSpec || row.status === 'archived') continue;
      if (products.fileIdsOf(row.liveSpec).includes(file.id)) return true;
    }
    return false;
  });

  // ── view counting: once per address per link per half hour, never the owner ─
  /** @type {Map<string, number>} */
  const recentViews = new Map();
  const countView = (link, ip) => {
    const key = `${ip}|${link.id}`;
    const t = ctx.now();
    const last = recentViews.get(key);
    if (last !== undefined && t - last < VIEW_DEDUPE_MS) return;
    recentViews.delete(key);
    recentViews.set(key, t);
    while (recentViews.size > VIEW_DEDUPE_CAP) recentViews.delete(recentViews.keys().next().value);
    db.prepare('UPDATE share_links SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?').run(t, link.id);
  };

  /** A product as a share viewer gets it: hidden prices are zeroed (the page hides them anyway). */
  const withoutPrice = (p) => {
    if (!p || typeof p !== 'object') return p;
    const { priceByWidth, ...rest } = p;
    void priceByWidth;
    return { ...rest, price: 0 };
  };

  return [
    {
      method: 'POST',
      path: '/api/projects/:id/shares',
      rateLimit: { name: 'share-create', max: 60, windowMs: HOUR, by: 'user' },
      handler: (rc) => {
        rc.send(201, { share: createLink(rc.user.id, rc.params.id, rc.body) });
      },
    },
    {
      method: 'GET',
      path: '/api/projects/:id/shares',
      handler: (rc) => {
        const project = ownedProject(rc.user.id, rc.params.id);
        const rows = db.prepare('SELECT * FROM share_links WHERE project_id = ? ORDER BY created_at DESC, id').all(project.id);
        return { shares: rows.map(linkWire), now: ctx.now() };
      },
    },
    {
      method: 'DELETE',
      path: '/api/projects/:id/shares/:shareId',
      handler: (rc) => {
        const project = ownedProject(rc.user.id, rc.params.id);
        const row = db.prepare('SELECT * FROM share_links WHERE id = ? AND project_id = ?').get(rc.params.shareId, project.id);
        if (!row) throw new HttpError(404, 'That link does not exist.');
        if (row.revoked_at == null) db.prepare('UPDATE share_links SET revoked_at = ? WHERE id = ?').run(ctx.now(), row.id);
        return { share: linkWire(db.prepare('SELECT * FROM share_links WHERE id = ?').get(row.id)) };
      },
    },
    {
      method: 'GET',
      path: '/api/share/:token',
      // 'optional' only so the owner's own visits aren't counted as views; nothing else depends on it.
      auth: 'optional',
      rateLimit: { name: 'share-read', max: 600, windowMs: HOUR, by: 'ip' },
      handler: (rc) => {
        const { link, project } = liveLinkOr404(rc.params.token);
        const ownerId = project.user_id;
        const showPrices = !!link.show_prices;
        const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(ownerId);
        const firstName = str(owner?.name ?? '', 120).split(' ')[0] || 'Someone';

        const raw = parseDoc(project.doc) ?? {};
        // Live server products placed in the kitchen: public ones, plus the owner's own private
        // ones (their file URLs carry ?share= so the read policy above lets viewers load them).
        const asOwner = { id: ownerId };
        let list = serverProductIds(raw)
          .map((id) => products.get(id))
          .filter((row) => row && products.inCatalog(row, asOwner))
          .map((row) => products.toWire(row, { which: 'live', shareToken: link.token }))
          .filter(Boolean);
        list = pricing.applyForViewer(ownerId, list, { viewer: null });

        let doc = pricing.stripDoc({ ...raw, name: project.name }, { viewer: null, ownerUserId: ownerId });
        let prices = null;
        if (showPrices) prices = pricing.sellPricesFor(ownerId, doc);
        else {
          list = list.map(withoutPrice);
          if (doc.products && typeof doc.products === 'object') doc = { ...doc, products: Object.fromEntries(Object.entries(doc.products).map(([k, p]) => [k, withoutPrice(p)])) };
        }
        const preparedBy = contractors.brandingFor(ownerId);

        if (rc.user?.id !== ownerId) countView(link, rc.ip);
        return {
          kitchen: { name: project.name, doc, updatedAt: project.updated_at, sharedBy: firstName },
          products: list,
          showPrices,
          ...(preparedBy ? { preparedBy, hideDuplicate: true } : {}),
          ...(prices ? { prices } : {}),
          expiresAt: link.expires_at ?? null,
        };
      },
    },
    {
      method: 'POST',
      path: '/api/share/:token/duplicate',
      body: 'none',
      rateLimit: { name: 'share-duplicate', max: 30, windowMs: HOUR, by: 'user' },
      handler: (rc) => {
        const { project } = liveLinkOr404(rc.params.token);
        const ownerId = project.user_id;
        // A contractor's clients stay with the contractor (PLANS_AND_CONTRACTORS §4.6).
        if (ownerId !== rc.user.id && contractors.brandingFor(ownerId)) throw new HttpError(403, 'This kitchen was prepared for you by a contractor. Ask them for changes.');
        const raw = parseDoc(project.doc) ?? {};
        const name = `${project.name} (copy)`.slice(0, 120);
        const clean = pricing.stripDoc({ ...raw, name }, { viewer: rc.user, ownerUserId: ownerId });
        const v = normalizeDoc(clean);
        if (!v.ok) throw new HttpError(409, 'This kitchen can’t be copied right now.');
        const json = JSON.stringify({ ...v.doc, name });
        if (json.length > MAX_DOC) throw new HttpError(413, 'That design is too large to copy.');
        const id = crypto.randomUUID();
        const t = ctx.now();
        db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(id, rc.user.id, name, '', json, t, t);
        const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
        rc.send(201, {
          project: { id: row.id, name: row.name, client: row.client, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, doc: JSON.parse(row.doc) },
        });
      },
    },
  ];
}
