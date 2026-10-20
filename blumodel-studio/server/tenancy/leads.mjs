// Showroom leads (docs/handoff/leads.md): the people who used a company's showroom. Exposed as
// ctx.services.leads. Every function takes the tenant id: a lead, a visitor or a design is never
// read or written across showrooms.
//
//   a lead      tenant_leads: one person (name, email and/or phone, deduplicated by either within
//               the showroom), the consent they gave, the team's status and notes, first seen,
//               last active.
//   a visitor   tenant_lead_visitors: a browser that answered "Before you start". It carries an
//               httpOnly, host-only cookie (VISITOR_COOKIE, stored hashed) that owns the designs
//               made there (projects.visitor_id), so a visitor designs and saves without an
//               account. A second browser typing an email or phone an existing lead has does NOT
//               join it (nothing proves the address, audit 2026-10): it gets its own lead marked
//               duplicate_of that one ("possible duplicate of <name>"), which the team can merge or
//               keep separate (protect-004). Neither browser ever sees the other's designs or details.
//   a send      showroom_leads: one "Send this design to <Company>" (budget, timeline, notes and a
//               view-only link), now attached to its lead.
//   the timeline tenant_lead_events: started a design, saved, sent, came back.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { randomId } from '../lib/ids.mjs';
import { emailProblem } from '../lib/emailCheck.mjs';
import { csvCell } from '../contractors/csv.mjs';
import { normalizePhone } from '../account/phone.mjs';
import { readCookie, secureAttr, sha256 } from '../auth/sessions.mjs';
import { phoneKeyOf } from '../db/migrations/leads.mjs';
import { pseudonymiseAudit } from '../lib/audit.mjs';

export const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
export const VISITOR_COOKIE = 'blumodel_visitor';
/** The visitor cookie's life (audit 2026-10: it was 400 days). */
export const VISITOR_DAYS = 180;
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** How often a visitor's last-seen time (and the lead's last active) is written, so reads stay reads. */
const TOUCH_EVERY = 5 * 60_000;
/** A visit after this long away is "came back" on the timeline. */
const RETURN_AFTER = 6 * 3_600_000;
/** At most one "saved" on the timeline per design per this long. */
const SAVED_EVERY = 30 * 60_000;
const one = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

/** What the visitor agrees to when sending a design; stored with the send. */
export const consentText = (company) => `I agree that ${company} may contact me about this design, and that BluModel Studio stores my details for them.`;
/** The "Before you start" box (the client shows the same words, src/features/showroom/visitor.ts); stored with the lead. */
export const startConsentText = (company) => `${company} may contact me about my design.`;

/**
 * Name, email, phone and consent as typed: tidied and checked. Throws 400 with `errors` (fields
 * name, email, phone, contact, consent). Email or phone: at least one.
 */
export function checkContact(b, company, { consentField = 'consent' } = {}) {
  const errors = [];
  const name = one(b?.name, 100);
  const email = one(b?.email, 254).toLowerCase();
  const p = normalizePhone(typeof b?.phone === 'string' ? b.phone : '');
  if (!name) errors.push({ field: 'name', message: 'Tell us your name.' });
  const emailBad = email ? emailProblem(email) : null;
  if (emailBad) errors.push({ field: 'email', message: emailBad });
  if (!p.ok) errors.push({ field: 'phone', message: p.reason });
  if (!email && p.ok && !p.value) errors.push({ field: 'contact', message: `Give an email or a phone number so ${company} can reach you.` });
  if (b?.consent !== true) errors.push({ field: consentField, message: `Tick the box so ${company} can contact you.` });
  if (errors.length) throw new HttpError(400, errors[0].message, { errors });
  const phone = p.ok ? p.value : '';
  return { name, email, phone, phoneKey: phoneKeyOf(phone) };
}

/** The visitor token in a request's cookie, or null. */
export const visitorTokenOf = (req) => {
  const t = readCookie(req, VISITOR_COOKIE);
  return t && TOKEN_RE.test(t) ? t : null;
};

export const visitorCookie = (req, config, token) => `${VISITOR_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${VISITOR_DAYS * 86_400}${secureAttr(req, config)}`;
export const clearedVisitorCookie = (req, config) => `${VISITOR_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr(req, config)}`;

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createLeadService({ db, now = Date.now }) {
  const leadRow = (tenantId, leadId) => db.prepare('SELECT * FROM tenant_leads WHERE id = ? AND tenant_id = ?').get(leadId, tenantId) ?? null;
  const event = (tenantId, leadId, kind, { projectId = null, detail = {}, at = now() } = {}) =>
    db.prepare('INSERT INTO tenant_lead_events (tenant_id, lead_id, kind, project_id, detail, at) VALUES (?, ?, ?, ?, ?, ?)').run(tenantId, leadId, kind, projectId, JSON.stringify(detail), at);
  const touchLead = (leadId, t = now()) => db.prepare('UPDATE tenant_leads SET last_active_at = MAX(last_active_at, ?) WHERE id = ?').run(t, leadId);

  /** The person behind an email or a phone in this showroom (email first); never a duplicate. */
  const findLead = (tenantId, email, phoneKey) =>
    (email && db.prepare("SELECT * FROM tenant_leads WHERE tenant_id = ? AND email = ? AND email <> '' AND duplicate_of IS NULL").get(tenantId, email)) ||
    (phoneKey && db.prepare("SELECT * FROM tenant_leads WHERE tenant_id = ? AND phone_key = ? AND phone_key <> '' AND duplicate_of IS NULL").get(tenantId, phoneKey)) ||
    null;

  const insertLead = (tenant, c, { consent, source, userId, duplicateOf = null, t = now() }) => {
    const id = `ld_${crypto.randomBytes(12).toString('base64url')}`;
    db.prepare(
      `INSERT INTO tenant_leads (id, tenant_id, user_id, name, email, phone, phone_key, consent_text, consent_at, source, status, staff_notes, read_at,
                                 first_seen_at, last_active_at, created_at, updated_at, duplicate_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', NULL, ?, ?, ?, ?, ?)`,
    ).run(id, tenant.id, userId, c.name, c.email, c.phone, c.phoneKey, consent, consent ? t : null, source, t, t, t, t, duplicateOf);
    return leadRow(tenant.id, id);
  };

  /**
   * Finds or makes the lead for these details. Typed details prove nothing, so an email or phone
   * that an existing lead already has joins it only when the same showroom account is behind both
   * (`userId` is that lead's account). Otherwise the form gets its own lead marked as a possible
   * duplicate of the existing one; the existing lead is not touched at all. A joined lead keeps the
   * details it has; its blanks are filled when nobody else in the showroom has that email or phone.
   * Returns { lead, created, duplicateOf }.
   */
  const upsert = (tenant, c, { consent = '', source = 'form', userId = null } = {}) => {
    const t = now();
    const found = findLead(tenant.id, c.email, c.phoneKey);
    if (found && !(userId && found.user_id === userId)) {
      const lead = insertLead(tenant, c, { consent, source, userId: userId && !db.prepare('SELECT 1 FROM tenant_leads WHERE tenant_id = ? AND user_id = ?').get(tenant.id, userId) ? userId : null, duplicateOf: found.id, t });
      return { lead, created: true, duplicateOf: found.id };
    }
    if (found) {
      const emailFree = c.email && !found.email && !findLead(tenant.id, c.email, '');
      const phoneFree = c.phoneKey && !found.phone_key && !findLead(tenant.id, '', c.phoneKey);
      const userFree = userId && !found.user_id && !db.prepare('SELECT 1 FROM tenant_leads WHERE tenant_id = ? AND user_id = ?').get(tenant.id, userId);
      db.prepare(
        `UPDATE tenant_leads SET email = CASE WHEN ? THEN ? ELSE email END, phone = CASE WHEN ? THEN ? ELSE phone END, phone_key = CASE WHEN ? THEN ? ELSE phone_key END,
                user_id = CASE WHEN ? THEN ? ELSE user_id END, consent_text = CASE WHEN ? <> '' THEN ? ELSE consent_text END,
                consent_at = CASE WHEN ? <> '' THEN ? ELSE consent_at END, last_active_at = ?, updated_at = ? WHERE id = ?`,
      ).run(emailFree ? 1 : 0, c.email, phoneFree ? 1 : 0, c.phone, phoneFree ? 1 : 0, c.phoneKey, userFree ? 1 : 0, userId, consent, consent, consent, t, t, t, found.id);
      return { lead: leadRow(tenant.id, found.id), created: false, duplicateOf: null };
    }
    return { lead: insertLead(tenant, c, { consent, source, userId, t }), created: true, duplicateOf: null };
  };

  /** A signed-in account's designs on this showroom join its lead. */
  const linkUser = (tenantId, leadId, userId) => {
    if (!userId) return;
    db.prepare('UPDATE projects SET lead_id = ? WHERE user_id = ? AND tenant_id = ? AND lead_id IS NULL').run(leadId, userId, tenantId);
  };

  const visitorWire = (v) => v && { name: v.name, email: v.email, phone: v.phone, consentText: v.consent_text, since: v.created_at };

  /** A view-only link for the staff to the visitor's own design on this showroom (or null). */
  const shareFor = (tenantId, owner, projectId, company) => {
    if ((!owner.userId && !owner.visitorId) || typeof projectId !== 'string') return null;
    const p = db.prepare('SELECT id, name FROM projects WHERE id = ? AND tenant_id = ? AND (user_id = ? OR visitor_id = ?)').get(projectId, tenantId, owner.userId ?? null, owner.visitorId ?? null);
    if (!p) throw new HttpError(404, 'That design does not exist.', { field: 'projectId' });
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(
      `INSERT INTO share_links (id, project_id, token, created_by, label, show_prices, expires_at, revoked_at, view_count, last_viewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, 0, NULL, ?)`,
    ).run(randomId('sh_', 16), p.id, token, owner.userId ?? null, `Sent to ${company}`.slice(0, 80), now());
    return { projectId: p.id, name: p.name, token };
  };

  /** A share token the visitor already has, if it is a live link to a design on this showroom. */
  const existingShare = (tenantId, token) => {
    if (typeof token !== 'string' || !SHARE_TOKEN_RE.test(token)) throw new HttpError(400, 'That design link isn’t valid.', { field: 'shareToken' });
    const r = db
      .prepare(
        `SELECT p.id, p.name FROM share_links s JOIN projects p ON p.id = s.project_id
          WHERE s.token = ? AND p.tenant_id = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)`,
      )
      .get(token, tenantId, now());
    if (!r) throw new HttpError(404, 'That design link doesn’t work on this showroom.', { field: 'shareToken' });
    return { projectId: r.id, name: r.name, token };
  };

  // ── the team's views ──────────────────────────────────────────────────────
  const STATS = `
    (SELECT COUNT(*) FROM projects p WHERE p.lead_id = l.id AND p.tenant_id = l.tenant_id) AS designs,
    (SELECT COUNT(*) FROM showroom_leads s WHERE s.lead_id = l.id) AS sends,
    (SELECT MAX(s.created_at) FROM showroom_leads s WHERE s.lead_id = l.id) AS last_sent_at,
    (SELECT s.design_name || char(31) || COALESCE(s.share_token, '') FROM showroom_leads s WHERE s.lead_id = l.id AND (s.share_token IS NOT NULL OR s.project_id IS NOT NULL) ORDER BY s.created_at DESC LIMIT 1) AS last_design,
    (SELECT d.name FROM tenant_leads d WHERE d.id = l.duplicate_of AND d.tenant_id = l.tenant_id) AS duplicate_name`;

  const listWire = (r, designUrlOf) =>
    r && {
      id: r.id,
      status: r.status,
      name: r.name,
      email: r.email,
      phone: r.phone,
      staffNotes: r.staff_notes,
      consent: !!r.consent_at,
      consentText: r.consent_text,
      consentAt: r.consent_at ?? null,
      source: r.source,
      signedIn: !!r.user_id,
      designs: Number(r.designs ?? 0),
      sent: Number(r.sends ?? 0) > 0,
      sends: Number(r.sends ?? 0),
      lastSentAt: r.last_sent_at ?? null,
      // the newest design they sent, with the team's view-only link
      design: (() => {
        if (!r.last_design) return null;
        const [name, token] = String(r.last_design).split(String.fromCharCode(31));
        return { name, shareToken: token || null, url: token && designUrlOf ? designUrlOf(token) : null };
      })(),
      read: !!r.read_at,
      // "Possible duplicate of <name>": a form typed an address this other lead has (protect-004).
      duplicateOf: r.duplicate_of && r.duplicate_name != null && !r.duplicate_dismissed_at ? { id: r.duplicate_of, name: r.duplicate_name } : null,
      firstSeenAt: r.first_seen_at,
      lastActiveAt: r.last_active_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  const sendWire = (s, designUrlOf) => ({
    id: s.id,
    at: s.created_at,
    designName: s.design_name,
    projectId: s.project_id ?? null,
    url: s.share_token && designUrlOf ? designUrlOf(s.share_token) : null,
    postalCode: s.postal_code,
    budget: s.budget,
    timeline: s.timeline,
    notes: s.notes,
    consentText: s.consent_text,
    // what they typed on the send form, which may differ from the lead's own details
    name: s.name,
    email: s.email,
    phone: s.phone,
  });

  const svc = {
    LEAD_STATUSES,

    /** The visitor a request's cookie names on this showroom, or null. Touches last seen (throttled). */
    visitorOf(tenantId, token) {
      if (!tenantId || !token) return null;
      const v = db.prepare('SELECT * FROM tenant_lead_visitors WHERE token_hash = ? AND tenant_id = ?').get(sha256(token), tenantId);
      if (!v) return null;
      const t = now();
      if (t - v.last_seen_at > TOUCH_EVERY) {
        db.prepare('UPDATE tenant_lead_visitors SET last_seen_at = ? WHERE id = ?').run(t, v.id);
        touchLead(v.lead_id, t);
        if (t - v.last_seen_at > RETURN_AFTER) event(tenantId, v.lead_id, 'returned', { at: t });
      }
      return { id: v.id, leadId: v.lead_id, userId: v.user_id ?? null, row: v };
    },

    /** The visitor a showroom account answered the form with (the newest), or null. */
    visitorForUser(tenantId, userId) {
      if (!tenantId || !userId) return null;
      const v = db.prepare('SELECT * FROM tenant_lead_visitors WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1').get(tenantId, userId);
      return v ? { id: v.id, leadId: v.lead_id, userId, row: v } : null;
    },

    visitorWire: (v) => (v ? visitorWire(v.row) : null),

    /** The lead a design should join when it is made: the visitor's, else the account's. */
    leadIdFor(tenantId, { userId = null, visitor = null } = {}) {
      if (visitor) return visitor.leadId;
      if (!tenantId || !userId) return null;
      return db.prepare('SELECT id FROM tenant_leads WHERE tenant_id = ? AND user_id = ? ORDER BY created_at LIMIT 1').get(tenantId, userId)?.id ?? null;
    },

    /**
     * "Before you start": `input` { name, email?, phone?, consent: true }. Finds or makes the lead,
     * makes a visitor for this browser and returns { token, visitor, leadId, created }. Throws 400
     * with `errors`.
     */
    capture(tenant, input, { userId = null } = {}) {
      const c = checkContact(input, tenant.name);
      const consent = startConsentText(tenant.name);
      const { lead, created } = upsert(tenant, c, { consent, source: 'form', userId });
      const token = crypto.randomBytes(32).toString('base64url');
      const id = randomId('lv_', 20);
      const t = now();
      db.prepare(
        `INSERT INTO tenant_lead_visitors (id, tenant_id, lead_id, token_hash, user_id, name, email, phone, consent_text, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, tenant.id, lead.id, sha256(token), userId, c.name, c.email, c.phone, consent, t, t);
      event(tenant.id, lead.id, created ? 'captured' : 'returned', { detail: { form: true, name: c.name, email: c.email, phone: c.phone, consent }, at: t });
      // Typed details aren't proof: a new lead that has an address another lead has is only
      // "possibly" that person (the other lead learns nothing, and this browser sees only its own).
      if (userId) linkUser(tenant.id, lead.id, userId);
      return { token, visitor: visitorWire(db.prepare('SELECT * FROM tenant_lead_visitors WHERE id = ?').get(id)), leadId: lead.id, created };
    },

    /**
     * A visitor who then signed in to a showroom account on the same browser (the older path): the
     * account joins the lead and takes over the visitor's designs, so it has them on any device.
     */
    linkVisitorToUser(tenantId, visitor, userId) {
      if (!visitor || !userId || visitor.userId) return;
      db.prepare('UPDATE tenant_lead_visitors SET user_id = ? WHERE id = ? AND tenant_id = ?').run(userId, visitor.id, tenantId);
      db.prepare('UPDATE projects SET user_id = ? WHERE visitor_id = ? AND tenant_id = ? AND user_id IS NULL').run(userId, visitor.id, tenantId);
      const lead = leadRow(tenantId, visitor.leadId);
      if (lead && !lead.user_id && !db.prepare('SELECT 1 FROM tenant_leads WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId)) {
        db.prepare('UPDATE tenant_leads SET user_id = ?, updated_at = ? WHERE id = ?').run(userId, now(), lead.id);
        event(tenantId, lead.id, 'account');
      }
      linkUser(tenantId, visitor.leadId, userId);
    },

    /** A design was made (`started`) or saved, for the timeline and last active. */
    designActivity(tenantId, leadId, projectId, kind, name = '') {
      if (!tenantId || !leadId) return;
      const t = now();
      if (kind === 'saved') {
        const last = db.prepare("SELECT at FROM tenant_lead_events WHERE lead_id = ? AND kind IN ('saved','started') AND project_id = ? ORDER BY at DESC LIMIT 1").get(leadId, projectId);
        if (last && t - last.at < SAVED_EVERY) {
          touchLead(leadId, t);
          return;
        }
      }
      event(tenantId, leadId, kind, { projectId, detail: { design: one(name, 120) }, at: t });
      touchLead(leadId, t);
    },

    /**
     * "Send this design to <Company>". `input`: { name, email and/or phone, postalCode?, budget?,
     * timeline?, notes?, consent: true, projectId? (their own design here) | shareToken? }. The
     * send joins the visitor's lead, else the account's, else the lead its email or phone names
     * (made when there is none). Returns the lead's wire.
     */
    create(tenant, input, { userId = null, visitor = null, designUrlOf } = {}) {
      const b = input && typeof input === 'object' ? input : {};
      const errors = [];
      let c = null;
      try {
        c = checkContact({ ...b, phone: typeof b.phone === 'string' ? b.phone : '' }, tenant.name);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        errors.push(...(e.extra?.errors ?? []));
      }
      const postalCode = one(b.postalCode, 12).toUpperCase();
      if (postalCode && !/^[A-Z0-9][A-Z0-9 -]{2,10}$/.test(postalCode)) errors.push({ field: 'postalCode', message: 'That postal code doesn’t look right.' });
      // The send form shows "email or phone" under its email field.
      const list = errors.map((e) => (e.field === 'contact' ? { ...e, field: 'email' } : e));
      if (list.length) throw new HttpError(400, list[0].message, { errors: list });
      let design = null;
      if (b.projectId !== undefined && b.projectId !== null && b.projectId !== '') design = shareFor(tenant.id, { userId, visitorId: visitor?.id ?? null }, b.projectId, tenant.name);
      else if (b.shareToken) design = existingShare(tenant.id, b.shareToken);

      const consent = consentText(tenant.name);
      const ownLeadId = visitor?.leadId ?? svc.leadIdFor(tenant.id, { userId });
      const lead = ownLeadId ? leadRow(tenant.id, ownLeadId) : upsert(tenant, c, { consent, source: 'send', userId }).lead;
      const sendId = `ld_${crypto.randomBytes(12).toString('base64url')}`;
      const t = now();
      db.prepare(
        `INSERT INTO showroom_leads (id, tenant_id, user_id, project_id, design_name, share_token, name, email, phone, postal_code, budget, timeline, notes,
                                     consent, consent_text, status, staff_notes, read_at, created_at, updated_at, lead_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'new', '', NULL, ?, ?, ?)`,
      ).run(sendId, tenant.id, userId, design?.projectId ?? null, design?.name ?? '', design?.token ?? null, c.name, c.email, c.phone, postalCode, one(b.budget, 60), one(b.timeline, 60), text(b.notes, 2000), consent, t, t, lead.id);
      // A send is news for the team, even from someone they already know.
      db.prepare('UPDATE tenant_leads SET read_at = NULL, last_active_at = ?, updated_at = ? WHERE id = ?').run(t, t, lead.id);
      if (design?.projectId) db.prepare('UPDATE projects SET lead_id = ? WHERE id = ? AND lead_id IS NULL').run(lead.id, design.projectId);
      if (userId) linkUser(tenant.id, lead.id, userId);
      event(tenant.id, lead.id, 'sent', { projectId: design?.projectId ?? null, detail: { sendId, design: design?.name ?? '' }, at: t });
      return { ...svc.get(tenant.id, lead.id, { designUrlOf }), sendId };
    },

    /** One lead with its designs, sends and timeline, or null. */
    get(tenantId, leadId, { designUrlOf } = {}) {
      const r = db.prepare(`SELECT l.*, ${STATS} FROM tenant_leads l WHERE l.id = ? AND l.tenant_id = ?`).get(leadId, tenantId);
      if (!r) return null;
      const sends = db.prepare('SELECT * FROM showroom_leads WHERE lead_id = ? AND tenant_id = ? ORDER BY created_at DESC').all(r.id, tenantId);
      const sentAt = new Map();
      for (const s of sends) if (s.project_id && !sentAt.has(s.project_id)) sentAt.set(s.project_id, { at: s.created_at, url: s.share_token && designUrlOf ? designUrlOf(s.share_token) : null });
      const designs = db
        .prepare('SELECT id, name, doc, created_at, updated_at, user_id IS NOT NULL AS account FROM projects WHERE lead_id = ? AND tenant_id = ? ORDER BY updated_at DESC')
        .all(r.id, tenantId)
        .map((p) => {
          const doc = parse(p.doc);
          return {
            id: p.id,
            name: p.name,
            items: Array.isArray(doc.items) ? doc.items.length : 0,
            room: doc.room && typeof doc.room === 'object' ? { widthIn: doc.room.widthIn, lengthIn: doc.room.lengthIn } : null,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            sentAt: sentAt.get(p.id)?.at ?? null,
            sentUrl: sentAt.get(p.id)?.url ?? null,
          };
        });
      const timeline = db
        .prepare('SELECT * FROM tenant_lead_events WHERE lead_id = ? AND tenant_id = ? ORDER BY at DESC, id DESC LIMIT 200')
        .all(r.id, tenantId)
        .map((e) => {
          const d = parse(e.detail);
          return { kind: e.kind, at: e.at, projectId: e.project_id ?? null, design: typeof d.design === 'string' ? d.design : '', ...(e.kind === 'status' ? { from: d.from, to: d.to, by: d.by ?? '' } : {}), ...(d.form ? { form: true } : {}) };
        });
      return { ...listWire(r, designUrlOf), designs, sendsList: sends.map((s) => sendWire(s, designUrlOf)), timeline };
    },

    /**
     * Everyone who used the showroom: { leads, counts: { new, contacted, quoted, won, lost, total,
     * unread, sent } }, most recently active first. Filters: status, q (name, email, phone, notes),
     * sent ('yes' | 'no'), before (last_active_at, for paging), limit (1..200, 50).
     */
    list(tenantId, { status, q, sent, before, limit = 50, designUrlOf } = {}) {
      const where = ['l.tenant_id = ?'];
      const args = [tenantId];
      if (status) {
        if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, `Status is one of ${LEAD_STATUSES.join(', ')}.`);
        where.push('l.status = ?');
        args.push(status);
      }
      if (sent !== undefined && sent !== '') {
        if (sent !== 'yes' && sent !== 'no') throw new HttpError(400, 'Sent is yes or no.');
        where.push(`${sent === 'yes' ? '' : 'NOT '}EXISTS (SELECT 1 FROM showroom_leads s WHERE s.lead_id = l.id)`);
      }
      const term = one(q, 80).toLowerCase();
      if (term) {
        const digits = term.replace(/\D/g, '');
        where.push(
          `(instr(lower(l.name), ?) > 0 OR instr(lower(l.email), ?) > 0 OR instr(lower(l.phone), ?) > 0 OR instr(lower(l.staff_notes), ?) > 0${digits.length >= 3 ? ' OR instr(l.phone_key, ?) > 0' : ''}
            OR EXISTS (SELECT 1 FROM showroom_leads s WHERE s.lead_id = l.id AND (instr(lower(s.postal_code), ?) > 0 OR instr(lower(s.notes), ?) > 0 OR instr(lower(s.design_name), ?) > 0)))`,
        );
        args.push(term, term, term, term, ...(digits.length >= 3 ? [digits] : []), term, term, term);
      }
      if (Number.isInteger(before) && before > 0) {
        where.push('l.last_active_at < ?');
        args.push(before);
      }
      const n = Math.max(1, Math.min(200, Number(limit) || 50));
      const rows = db.prepare(`SELECT l.*, ${STATS} FROM tenant_leads l WHERE ${where.join(' AND ')} ORDER BY l.last_active_at DESC, l.id DESC LIMIT ?`).all(...args, n);
      return { leads: rows.map((r) => listWire(r, designUrlOf)), counts: svc.counts(tenantId) };
    },

    counts(tenantId) {
      const counts = { new: 0, contacted: 0, quoted: 0, won: 0, lost: 0, total: 0, unread: 0, sent: 0 };
      for (const r of db.prepare('SELECT status, COUNT(*) AS n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM tenant_leads WHERE tenant_id = ? GROUP BY status').all(tenantId)) {
        counts[r.status] = Number(r.n);
        counts.total += Number(r.n);
        counts.unread += Number(r.unread ?? 0);
      }
      counts.sent = Number(db.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM showroom_leads WHERE tenant_id = ? AND lead_id IS NOT NULL').get(tenantId).n);
      return counts;
    },

    markRead(tenantId, leadId) {
      db.prepare('UPDATE tenant_leads SET read_at = COALESCE(read_at, ?) WHERE id = ? AND tenant_id = ?').run(now(), leadId, tenantId);
    },

    /** Staff changes: { status?, staffNotes? }. `by`: the staff member's email, for the timeline. */
    update(tenantId, leadId, patch = {}, { designUrlOf, by = '' } = {}) {
      const cur = leadRow(tenantId, leadId);
      if (!cur) throw new HttpError(404, 'That lead does not exist.');
      let status = cur.status;
      if (patch.status !== undefined) {
        if (!LEAD_STATUSES.includes(patch.status)) throw new HttpError(400, `Status is one of ${LEAD_STATUSES.join(', ')}.`, { field: 'status' });
        status = patch.status;
      }
      let notes = cur.staff_notes;
      if (patch.staffNotes !== undefined) {
        if (typeof patch.staffNotes !== 'string' || patch.staffNotes.length > 4000) throw new HttpError(400, 'Keep the notes to 4000 characters.', { field: 'staffNotes' });
        notes = text(patch.staffNotes, 4000);
      }
      const t = now();
      db.prepare('UPDATE tenant_leads SET status = ?, staff_notes = ?, read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, notes, t, t, leadId, tenantId);
      if (status !== cur.status) event(tenantId, leadId, 'status', { detail: { from: cur.status, to: status, by }, at: t });
      return svc.get(tenantId, leadId, { designUrlOf });
    },

    /** A design of the lead's, whole, for the team's view-only 3D (null when it isn't the lead's). */
    design(tenantId, leadId, projectId) {
      const p = db.prepare('SELECT id, name, doc, revision, created_at, updated_at FROM projects WHERE id = ? AND lead_id = ? AND tenant_id = ?').get(projectId, leadId, tenantId);
      return p ? { id: p.id, name: p.name, doc: { ...parse(p.doc), name: p.name }, createdAt: p.created_at, updatedAt: p.updated_at } : null;
    },

    /**
     * Staff decide a possible duplicate is the same person: everything of `leadId` (its browsers,
     * designs, sends and timeline) moves to the lead it duplicates, which keeps its own details,
     * and `leadId` is gone. Returns the merged lead's wire.
     */
    merge(tenantId, leadId, { designUrlOf, by = '' } = {}) {
      const cur = leadRow(tenantId, leadId);
      if (!cur) throw new HttpError(404, 'That lead does not exist.');
      const into = cur.duplicate_of ? leadRow(tenantId, cur.duplicate_of) : null;
      if (!into) throw new HttpError(409, 'That lead isn’t marked as a possible duplicate.', { code: 'not_duplicate' });
      const t = now();
      db.prepare('UPDATE tenant_lead_visitors SET lead_id = ? WHERE lead_id = ? AND tenant_id = ?').run(into.id, cur.id, tenantId);
      db.prepare('UPDATE projects SET lead_id = ? WHERE lead_id = ? AND tenant_id = ?').run(into.id, cur.id, tenantId);
      db.prepare('UPDATE showroom_leads SET lead_id = ? WHERE lead_id = ? AND tenant_id = ?').run(into.id, cur.id, tenantId);
      db.prepare('UPDATE tenant_lead_events SET lead_id = ? WHERE lead_id = ? AND tenant_id = ?').run(into.id, cur.id, tenantId);
      db.prepare('UPDATE tenant_leads SET duplicate_of = ? WHERE duplicate_of = ? AND tenant_id = ?').run(into.id, cur.id, tenantId);
      const userId = !into.user_id && cur.user_id ? cur.user_id : null;
      db.prepare('DELETE FROM tenant_leads WHERE id = ? AND tenant_id = ?').run(cur.id, tenantId);
      db.prepare(
        'UPDATE tenant_leads SET first_seen_at = MIN(first_seen_at, ?), last_active_at = MAX(last_active_at, ?), user_id = COALESCE(user_id, ?), read_at = NULL, updated_at = ? WHERE id = ?',
      ).run(cur.first_seen_at, cur.last_active_at, userId, t, into.id);
      event(tenantId, into.id, 'merged', { detail: { name: cur.name, by }, at: t });
      return svc.get(tenantId, into.id, { designUrlOf });
    },

    /** Staff decide a possible duplicate is someone else: the label goes; the two stay separate. */
    keepSeparate(tenantId, leadId, { designUrlOf } = {}) {
      const cur = leadRow(tenantId, leadId);
      if (!cur) throw new HttpError(404, 'That lead does not exist.');
      if (!cur.duplicate_of) throw new HttpError(409, 'That lead isn’t marked as a possible duplicate.', { code: 'not_duplicate' });
      db.prepare('UPDATE tenant_leads SET duplicate_dismissed_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), cur.id);
      return svc.get(tenantId, cur.id, { designUrlOf });
    },

    /**
     * Deletes the lead, its visitors (their cookies stop working), its timeline, its sends and
     * every design made under it (with their view-only links). A design of a showroom account is
     * the account's: it is unlinked, not deleted. A lead marked as its possible duplicate becomes
     * the lead for that address. Returns what was removed.
     */
    remove(tenantId, leadId) {
      const cur = leadRow(tenantId, leadId);
      if (!cur) throw new HttpError(404, 'That lead does not exist.');
      // The view-only links made for the company when a design was sent stop working.
      db.prepare(
        "UPDATE share_links SET revoked_at = COALESCE(revoked_at, ?) WHERE label LIKE 'Sent to %' AND token IN (SELECT share_token FROM showroom_leads WHERE lead_id = ? AND tenant_id = ? AND share_token IS NOT NULL)",
      ).run(now(), leadId, tenantId);
      const designs = db.prepare('DELETE FROM projects WHERE lead_id = ? AND tenant_id = ? AND user_id IS NULL').run(leadId, tenantId).changes;
      const unlinked = db.prepare('UPDATE projects SET lead_id = NULL WHERE lead_id = ? AND tenant_id = ?').run(leadId, tenantId).changes;
      const sends = db.prepare('DELETE FROM showroom_leads WHERE lead_id = ? AND tenant_id = ?').run(leadId, tenantId).changes;
      // Every address this person (or a browser of theirs) typed leaves the audit log too.
      const typed = db.prepare('SELECT email, phone FROM tenant_lead_visitors WHERE lead_id = ? AND tenant_id = ?').all(leadId, tenantId);
      pseudonymiseAudit(db, { emails: [cur.email, ...typed.map((v) => v.email)], phones: [cur.phone, ...typed.map((v) => v.phone)] });
      db.prepare('DELETE FROM tenant_lead_visitors WHERE lead_id = ? AND tenant_id = ?').run(leadId, tenantId);
      db.prepare('DELETE FROM tenant_lead_events WHERE lead_id = ? AND tenant_id = ?').run(leadId, tenantId);
      // Its possible duplicates: the oldest becomes the lead for the address (once this one is gone,
      // so the unique address index never sees two), the others point at it.
      const dups = db.prepare('SELECT id FROM tenant_leads WHERE duplicate_of = ? AND tenant_id = ? ORDER BY created_at, id').all(leadId, tenantId);
      if (dups.length) db.prepare('UPDATE tenant_leads SET duplicate_of = ? WHERE duplicate_of = ? AND tenant_id = ? AND id <> ?').run(dups[0].id, leadId, tenantId, dups[0].id);
      db.prepare('DELETE FROM tenant_leads WHERE id = ? AND tenant_id = ?').run(leadId, tenantId);
      if (dups.length) db.prepare('UPDATE tenant_leads SET duplicate_of = NULL, duplicate_dismissed_at = NULL WHERE id = ?').run(dups[0].id);
      return { designs, unlinked, sends };
    },

    /**
     * The retention rule (docs/handoff/data-lifecycle.md): every lead of `tenantId` that never sent
     * a design, whose status the team never changed (still 'new', no status entry on the timeline),
     * and whose last activity is before `cutoff` is deleted the same way a staff delete does it
     * (remove). Returns { leads, designs }.
     */
    purgeStale(tenantId, cutoff) {
      const ids = db
        .prepare(
          `SELECT l.id FROM tenant_leads l WHERE l.tenant_id = ? AND l.last_active_at < ? AND l.status = 'new'
              AND NOT EXISTS (SELECT 1 FROM showroom_leads s WHERE s.lead_id = l.id)
              AND NOT EXISTS (SELECT 1 FROM tenant_lead_events e WHERE e.lead_id = l.id AND e.kind = 'status')`,
        )
        .all(tenantId, cutoff)
        .map((r) => r.id);
      let designs = 0;
      for (const id of ids) designs += svc.remove(tenantId, id).designs;
      return { leads: ids.length, designs, ids };
    },

    /** Every lead as CSV (spreadsheet-safe cells), most recently active first. */
    csv(tenantId) {
      const head = ['First seen', 'Last active', 'Status', 'Name', 'Email', 'Phone', 'Designs', 'Sent', 'Postal code', 'Budget', 'Timeline', 'Their notes', 'Staff notes', 'Consent'];
      const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
      const rows = db.prepare(`SELECT l.*, ${STATS} FROM tenant_leads l WHERE l.tenant_id = ? ORDER BY l.last_active_at DESC, l.id DESC`).all(tenantId);
      const lastSend = db.prepare('SELECT postal_code, budget, timeline, notes FROM showroom_leads WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1');
      const lines = [
        head,
        ...rows.map((r) => {
          const s = lastSend.get(r.id) ?? {};
          return [day(r.first_seen_at), day(r.last_active_at), r.status, r.name, r.email, r.phone, String(r.designs ?? 0), Number(r.sends) > 0 ? 'yes' : 'no', s.postal_code ?? '', s.budget ?? '', s.timeline ?? '', s.notes ?? '', r.staff_notes, r.consent_text];
        }),
      ];
      return lines.map((l) => l.map(csvCell).join(',')).join('\n');
    },

    /** Lead counts per tenant, for Admin > Companies: no names, no contact details. */
    countFor(tenantId) {
      const monthStart = (() => {
        const d = new Date(now());
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      })();
      const r = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS fresh, SUM(CASE WHEN first_seen_at >= ? THEN 1 ELSE 0 END) AS month FROM tenant_leads WHERE tenant_id = ?").get(monthStart, tenantId);
      const sent = db.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM showroom_leads WHERE tenant_id = ? AND lead_id IS NOT NULL').get(tenantId).n;
      return { total: Number(r.n), new: Number(r.fresh ?? 0), thisMonth: Number(r.month ?? 0), sent: Number(sent) };
    },
  };
  return svc;
}

/** The visitor on a request (showrooms only), from its cookie. */
export function requestVisitor(rc) {
  const tenantId = rc?.site?.tenantId ?? null;
  if (!tenantId) return null;
  if (rc._visitor !== undefined) return rc._visitor;
  const token = visitorTokenOf(rc.req);
  rc._visitor = token ? rc.ctx.services.leads.visitorOf(tenantId, token) : null;
  return rc._visitor;
}

