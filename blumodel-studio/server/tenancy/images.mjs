// A showroom's pictures (docs/handoff/showroom-images.md): the landing page's hero, one picture per
// product line and a small gallery of finished kitchens. Two sources per slot:
//
//   render  made by the app's own 3D renderer from the company's products (the generator page,
//           `#/showroom-images` on the showroom, run by its team or by an admin with a ticket; or,
//           for the demo, committed files the seed installs, server/tenancy/demo-images/)
//   photo   uploaded by the company in its workspace (hero and lines). A photo always wins.
//
// Stored on the tenant (tenants.branding.images, kept by cleanBranding like any other key):
//   { render: Set, photo: Set, renderedAt }
//   Set = { hero?: Img, heroTall?: Img, lines?: { [lineKey]: Img & { line } }, gallery?: (Img & { title })[] }
//   Img = { fileId, w, h, at }
// The bytes are ordinary tenant files (kind image, public), so a showroom serves only its own.
// Images are made at their final size in the browser (WebP); the server only checks them.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { sniffImage } from '../lib/validators.mjs';

export const IMAGE_SLOTS = Object.freeze(['hero', 'heroTall', 'line', 'gallery', 'dream', 'promo']);
export const IMAGE_SOURCES = Object.freeze(['render', 'photo']);
/** Slots a company may upload its own photo for. */
export const PHOTO_SLOTS = Object.freeze(['hero', 'line']);
export const GALLERY_MAX = 3;
/** Dream kitchens: the showroom's advert, each one a design a visitor can start from. */
export const DREAM_MAX = 2;
/** Promo pictures: the generator's extra angles for BluModel's own sales page (never shown on a showroom). */
export const PROMO_MAX = 4;
const MIN_SIDE = 320;
const MAX_SIDE = 4096;
const TICKET_TTL_MS = 2 * 3_600_000;

/** "Lakeshore Shaker (Demo)" -> "lakeshore shaker": the client's brandKey (src/lib/generate/brands.ts). */
export function lineKey(name) {
  return String(name ?? '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const bad = (field, message) => new HttpError(400, message, { errors: [{ field, message }] });

/** Checks where an image goes: { slot, line?, index?, source, title? }. */
export function cleanTarget(input = {}) {
  const slot = String(input.slot ?? '');
  if (!IMAGE_SLOTS.includes(slot)) throw bad('slot', `Choose where the picture goes: ${IMAGE_SLOTS.join(', ')}.`);
  const source = String(input.source ?? 'render');
  if (!IMAGE_SOURCES.includes(source)) throw bad('source', 'A picture is a render or a photo.');
  if (source === 'photo' && !PHOTO_SLOTS.includes(slot)) throw bad('slot', 'Photos can be uploaded for the main picture and for product lines.');
  const out = { slot, source };
  if (slot === 'line') {
    const line = String(input.line ?? '').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 60) throw bad('line', 'Name the product line (60 characters at most).');
    out.line = line;
  }
  if (slot === 'gallery') {
    const i = Number(input.index);
    if (!Number.isInteger(i) || i < 1 || i > GALLERY_MAX) throw bad('index', `Gallery pictures are numbered 1 to ${GALLERY_MAX}.`);
    out.index = i;
    out.title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  if (slot === 'promo') {
    const i = Number(input.index);
    if (!Number.isInteger(i) || i < 1 || i > PROMO_MAX) throw bad('index', `Promo pictures are numbered 1 to ${PROMO_MAX}.`);
    out.index = i;
    out.title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  if (slot === 'dream') {
    const i = Number(input.index);
    if (!Number.isInteger(i) || i < 1 || i > DREAM_MAX) throw bad('index', `Dream kitchens are numbered 1 to ${DREAM_MAX}.`);
    out.index = i;
    out.title = String(input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return out;
}

/** The image's type and size from its bytes; a 400 unless it is a PNG, JPEG or WebP of a sensible size. */
export function checkImage(buf, { maxBytes }) {
  if (!buf?.length) throw bad('file', 'Choose a picture to upload.');
  if (buf.length > maxBytes) throw new HttpError(413, `Pictures can be at most ${Math.round(maxBytes / 1048576)} MB.`);
  const info = sniffImage(buf);
  if (!info) throw bad('file', 'Upload a PNG, JPEG or WebP picture.');
  if (info.width < MIN_SIDE || info.height < MIN_SIDE * 0.5) throw bad('file', `That picture is too small: use one at least ${MIN_SIDE} pixels wide.`);
  if (info.width > MAX_SIDE || info.height > MAX_SIDE) throw bad('file', `That picture is too large: ${MAX_SIDE} pixels on the longest side at most.`);
  return info;
}

/** `images` with `img` put where `target` says (a new object; the input is not changed). */
export function withImage(images, target, img) {
  const out = structuredClone(images && typeof images === 'object' ? images : {});
  const set = (out[target.source] ??= {});
  if (target.slot === 'hero' || target.slot === 'heroTall') set[target.slot] = img;
  else if (target.slot === 'line') set.lines = { ...(set.lines ?? {}), [lineKey(target.line)]: { ...img, line: target.line } };
  else if (target.slot === 'gallery') {
    const g = Array.isArray(set.gallery) ? set.gallery.slice(0, GALLERY_MAX) : [];
    while (g.length < target.index - 1) g.push(null);
    g[target.index - 1] = { ...img, title: target.title ?? '' };
    set.gallery = g;
  } else if (target.slot === 'promo') {
    const g = Array.isArray(set.promos) ? set.promos.slice(0, PROMO_MAX) : [];
    while (g.length < target.index - 1) g.push(null);
    g[target.index - 1] = { ...img, title: target.title ?? '' };
    set.promos = g;
  } else if (target.slot === 'dream') {
    const g = Array.isArray(set.dreams) ? set.dreams.slice(0, DREAM_MAX) : [];
    while (g.length < target.index - 1) g.push(null);
    g[target.index - 1] = { ...img, title: target.title ?? '' };
    set.dreams = g;
  }
  if (target.source === 'render') out.renderedAt = img.at;
  return out;
}

/** `images` without what `target` names. */
export function withoutImage(images, target) {
  const out = structuredClone(images && typeof images === 'object' ? images : {});
  const set = out[target.source];
  if (!set) return out;
  if (target.slot === 'hero' || target.slot === 'heroTall') delete set[target.slot];
  else if (target.slot === 'line' && set.lines) delete set.lines[lineKey(target.line)];
  else if (target.slot === 'gallery' && Array.isArray(set.gallery)) set.gallery[target.index - 1] = null;
  else if (target.slot === 'dream' && Array.isArray(set.dreams)) set.dreams[target.index - 1] = null;
  else if (target.slot === 'promo' && Array.isArray(set.promos)) set.promos[target.index - 1] = null;
  return out;
}

/** Every file id the images use (for tests and clean-up). */
export function imageFileIds(images) {
  const ids = [];
  for (const src of IMAGE_SOURCES) {
    const s = images?.[src];
    if (!s) continue;
    for (const k of ['hero', 'heroTall']) if (s[k]?.fileId) ids.push(s[k].fileId);
    for (const v of Object.values(s.lines ?? {})) if (v?.fileId) ids.push(v.fileId);
    for (const v of s.gallery ?? []) if (v?.fileId) ids.push(v.fileId);
    for (const v of s.dreams ?? []) if (v?.fileId) ids.push(v.fileId);
    for (const v of s.promos ?? []) if (v?.fileId) ids.push(v.fileId);
  }
  return ids;
}

/**
 * What visitors' pages get (PublicTenant.images): a photo wins over a render. A hero photo also
 * replaces the tall (phone) render, so a phone never shows a different kitchen from a laptop.
 *   { hero: Pic|null, heroTall: Pic|null, lines: { [lineKey]: Pic & { line } }, gallery: (Pic & { title, design: shareToken|null })[] }
 *   Pic = { url, w, h, source: 'render'|'photo' }
 * @param {any} images  tenants.branding.images
 * @param {{ url: (fileId: string) => string|null }} files
 */
export function publicImages(images, files) {
  const r = images?.render ?? {};
  const p = images?.photo ?? {};
  const pic = (img, source) => {
    if (!img?.fileId) return null;
    const url = files.url(img.fileId);
    return url ? { url, w: img.w, h: img.h, source } : null;
  };
  const hero = pic(p.hero, 'photo') ?? pic(r.hero, 'render');
  const heroTall = p.hero ? null : pic(r.heroTall, 'render');
  const lines = {};
  for (const [k, v] of Object.entries(r.lines ?? {})) {
    const x = pic(v, 'render');
    if (x) lines[k] = { ...x, line: v.line };
  }
  for (const [k, v] of Object.entries(p.lines ?? {})) {
    const x = pic(v, 'photo');
    if (x) lines[k] = { ...x, line: v.line };
  }
  // A gallery kitchen may come with a view-only link to open it in 3D (the demo's, from its seed).
  const gallery = (r.gallery ?? []).map((g) => (g ? { ...pic(g, 'render'), title: g.title ?? '', design: typeof g.shareToken === 'string' ? g.shareToken : null } : null)).filter((g) => g?.url);
  // The dream kitchens: the advert, each with a link to look around it and to start from it.
  const dreams = (r.dreams ?? []).map((g) => (g ? { ...pic(g, 'render'), title: g.title ?? '', design: typeof g.shareToken === 'string' ? g.shareToken : null } : null)).filter((g) => g?.url);
  return { hero, heroTall, lines, gallery, dreams, renderedAt: images?.renderedAt ?? null };
}

/**
 * The generator's tickets: an admin opens a showroom's generator page from Admin > Companies
 * without being on its team. A ticket is 32 random bytes, kept hashed in memory for two hours,
 * good for one showroom and only for uploading renders. A restart forgets them (make another).
 *
 * Each ticket is also a run the admin's page can follow (Quick setup waits for the pictures): a
 * `run` id that is not secret and grants nothing, the pictures uploaded with the ticket so far, and
 * what the generator said when it finished.
 */
export function createImageTickets({ now = Date.now } = {}) {
  const tickets = new Map();
  const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  const sweep = () => {
    const t = now();
    for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
  };
  const entry = (ticket) => {
    if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 100) return null;
    const v = tickets.get(hash(ticket));
    return v && v.expiresAt > now() ? v : null;
  };
  return {
    issue(tenantId) {
      sweep();
      const ticket = crypto.randomBytes(32).toString('base64url');
      const expiresAt = now() + TICKET_TTL_MS;
      const run = `ir_${crypto.randomBytes(12).toString('base64url')}`;
      tickets.set(hash(ticket), { tenantId, expiresAt, run, uploads: 0, started: false, done: null });
      return { ticket, expiresAt, run };
    },
    /** The tenant a ticket is good for, or null. */
    tenantOf(ticket) {
      return entry(ticket)?.tenantId ?? null;
    },
    /** The generator opened with this ticket (GET /api/showroom-images/access). */
    noteOpened(ticket) {
      const v = entry(ticket);
      if (v) v.started = true;
    },
    /** A picture went up with this ticket. */
    noteUpload(ticket) {
      const v = entry(ticket);
      if (v) v.uploads++;
    },
    /** The generator finished: how many pictures it made and how many scenes failed. */
    finish(ticket, { made, failed }) {
      const v = entry(ticket);
      if (!v) return false;
      const n = (x) => (Number.isInteger(x) && x >= 0 && x <= 1000 ? x : 0);
      v.done = { made: n(made), failed: n(failed), at: now() };
      return true;
    },
    /**
     * A run's progress for the admin who started it, by tenant and run id:
     * { state: 'waiting' | 'running' | 'done', uploads, made, failed, finishedAt, expiresAt } or null.
     */
    runStatus(tenantId, run) {
      for (const v of tickets.values()) {
        if (v.run !== run || v.tenantId !== tenantId || v.expiresAt <= now()) continue;
        const state = v.done ? 'done' : v.started || v.uploads ? 'running' : 'waiting';
        return { state, uploads: v.uploads, made: v.done?.made ?? v.uploads, failed: v.done?.failed ?? 0, finishedAt: v.done?.at ?? null, expiresAt: v.expiresAt };
      }
      return null;
    },
  };
}
