// Showroom leads: "Send this design to <Company>" (docs/SHOWROOM_PIVOT.md §5). A visitor's design
// arrives in the company's inbox with a view-only link to it and their contact details. Exposed as
// ctx.services.leads. Every function takes the tenant id: a lead is never read or written across
// showrooms.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { randomId } from '../lib/ids.mjs';
import { EMAIL_RE } from '../auth/userWire.mjs';
import { csvCell } from '../contractors/csv.mjs';

export const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const one = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');

/** What the visitor agrees to by ticking the box; stored with the lead. */
export const consentText = (company) => `I agree that ${company} may contact me about this design, and that BluModel Studio stores my details for them.`;

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createLeadService({ db, now = Date.now }) {
  const wire = (r, designUrlOf) =>
    r && {
      id: r.id,
      status: r.status,
      name: r.name,
      email: r.email,
      phone: r.phone,
      postalCode: r.postal_code,
      budget: r.budget,
      timeline: r.timeline,
      notes: r.notes,
      consent: !!r.consent,
      consentText: r.consent_text,
      staffNotes: r.staff_notes,
      design: r.share_token || r.project_id ? { name: r.design_name, shareToken: r.share_token ?? null, url: r.share_token && designUrlOf ? designUrlOf(r.share_token) : null } : null,
      signedIn: !!r.user_id,
      read: !!r.read_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };

  /** A view-only link for the staff to the visitor's own kitchen on this showroom (or null). */
  const shareFor = (tenantId, userId, projectId, company) => {
    if (!userId || typeof projectId !== 'string') return null;
    const p = db.prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ? AND tenant_id = ?').get(projectId, userId, tenantId);
    if (!p) throw new HttpError(404, 'That design does not exist.', { field: 'projectId' });
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(
      `INSERT INTO share_links (id, project_id, token, created_by, label, show_prices, expires_at, revoked_at, view_count, last_viewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, 0, NULL, ?)`,
    ).run(randomId('sh_', 16), p.id, token, userId, `Sent to ${company}`.slice(0, 80), now());
    return { projectId: p.id, name: p.name, token };
  };

  /** A share token the visitor already has, if it is a live link to a kitchen on this showroom. */
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

  const svc = {
    LEAD_STATUSES,
    wire,

    /**
     * A visitor's lead. `input`: { name, email, phone?, postalCode?, budget?, timeline?, notes?,
     * consent: true, projectId? (their own kitchen here, signed in) | shareToken? }. Throws 400
     * with `errors` for bad fields. Returns the stored row's wire.
     */
    create(tenant, input, { userId = null, designUrlOf } = {}) {
      const b = input && typeof input === 'object' ? input : {};
      const errors = [];
      const name = one(b.name, 100);
      const email = one(b.email, 254).toLowerCase();
      const phone = one(b.phone, 40);
      const postalCode = one(b.postalCode, 12).toUpperCase();
      if (!name) errors.push({ field: 'name', message: 'Tell us your name.' });
      if (!EMAIL_RE.test(email) || /[\r\n,;<>]/.test(email)) errors.push({ field: 'email', message: 'That email address doesn’t look right.' });
      if (phone && !/^[0-9+().\-\s x]{7,40}$/i.test(phone)) errors.push({ field: 'phone', message: 'That phone number doesn’t look right.' });
      if (postalCode && !/^[A-Z0-9][A-Z0-9 -]{2,10}$/.test(postalCode)) errors.push({ field: 'postalCode', message: 'That postal code doesn’t look right.' });
      if (b.consent !== true) errors.push({ field: 'consent', message: `Tick the box so ${tenant.name} can contact you.` });
      if (errors.length) throw new HttpError(400, errors[0].message, { errors });
      let design = null;
      if (b.projectId !== undefined && b.projectId !== null && b.projectId !== '') design = shareFor(tenant.id, userId, b.projectId, tenant.name);
      else if (b.shareToken) design = existingShare(tenant.id, b.shareToken);
      const leadId = `ld_${crypto.randomBytes(12).toString('base64url')}`;
      const t = now();
      db.prepare(
        `INSERT INTO showroom_leads (id, tenant_id, user_id, project_id, design_name, share_token, name, email, phone, postal_code, budget, timeline, notes,
                                     consent, consent_text, status, staff_notes, read_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'new', '', NULL, ?, ?)`,
      ).run(
        leadId,
        tenant.id,
        userId,
        design?.projectId ?? null,
        design?.name ?? '',
        design?.token ?? null,
        name,
        email,
        phone,
        postalCode,
        one(b.budget, 60),
        one(b.timeline, 60),
        text(b.notes, 2000),
        consentText(tenant.name),
        t,
        t,
      );
      return svc.get(tenant.id, leadId, { designUrlOf });
    },

    get(tenantId, leadId, { designUrlOf } = {}) {
      return wire(db.prepare('SELECT * FROM showroom_leads WHERE id = ? AND tenant_id = ?').get(leadId, tenantId), designUrlOf) ?? null;
    },

    /**
     * The inbox: { leads, counts: { new, contacted, quoted, won, lost, total, unread } }, newest
     * first. Filters: status, q (name, email, phone, postal code, notes), before (created_at, for
     * paging), limit (1..200, 50).
     */
    list(tenantId, { status, q, before, limit = 50, designUrlOf } = {}) {
      const where = ['tenant_id = ?'];
      const args = [tenantId];
      if (status) {
        if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, `Status is one of ${LEAD_STATUSES.join(', ')}.`);
        where.push('status = ?');
        args.push(status);
      }
      const term = one(q, 80).toLowerCase();
      if (term) {
        where.push("(instr(lower(name), ?) > 0 OR instr(lower(email), ?) > 0 OR instr(lower(phone), ?) > 0 OR instr(lower(postal_code), ?) > 0 OR instr(lower(notes), ?) > 0 OR instr(lower(design_name), ?) > 0)");
        args.push(term, term, term, term, term, term);
      }
      if (Number.isInteger(before) && before > 0) {
        where.push('created_at < ?');
        args.push(before);
      }
      const n = Math.max(1, Math.min(200, Number(limit) || 50));
      const rows = db.prepare(`SELECT * FROM showroom_leads WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, n);
      const counts = { new: 0, contacted: 0, quoted: 0, won: 0, lost: 0, total: 0, unread: 0 };
      for (const r of db.prepare('SELECT status, COUNT(*) AS n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM showroom_leads WHERE tenant_id = ? GROUP BY status').all(tenantId)) {
        counts[r.status] = r.n;
        counts.total += r.n;
        counts.unread += r.unread;
      }
      return { leads: rows.map((r) => wire(r, designUrlOf)), counts };
    },

    markRead(tenantId, leadId) {
      db.prepare('UPDATE showroom_leads SET read_at = COALESCE(read_at, ?) WHERE id = ? AND tenant_id = ?').run(now(), leadId, tenantId);
    },

    /** Staff changes: { status?, staffNotes? }. */
    update(tenantId, leadId, patch = {}, { designUrlOf } = {}) {
      const cur = db.prepare('SELECT * FROM showroom_leads WHERE id = ? AND tenant_id = ?').get(leadId, tenantId);
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
      db.prepare('UPDATE showroom_leads SET status = ?, staff_notes = ?, read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ? AND tenant_id = ?').run(status, notes, now(), now(), leadId, tenantId);
      return svc.get(tenantId, leadId, { designUrlOf });
    },

    /** Every lead as CSV (spreadsheet-safe cells), newest first. */
    csv(tenantId, { designUrlOf } = {}) {
      const head = ['Received', 'Status', 'Name', 'Email', 'Phone', 'Postal code', 'Budget', 'Timeline', 'Notes', 'Design', 'Design link', 'Staff notes'];
      const rows = db.prepare('SELECT * FROM showroom_leads WHERE tenant_id = ? ORDER BY created_at DESC, id DESC').all(tenantId);
      const lines = [head, ...rows.map((r) => [new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' '), r.status, r.name, r.email, r.phone, r.postal_code, r.budget, r.timeline, r.notes, r.design_name, r.share_token && designUrlOf ? designUrlOf(r.share_token) : '', r.staff_notes])];
      return lines.map((l) => l.map(csvCell).join(',')).join('\n');
    },

    /** Leads per tenant (Admin > Tenants). */
    countFor(tenantId) {
      const r = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS fresh FROM showroom_leads WHERE tenant_id = ?").get(tenantId);
      return { total: Number(r.n), new: Number(r.fresh ?? 0) };
    },
  };
  return svc;
}
