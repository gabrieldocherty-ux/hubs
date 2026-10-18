// Leads (docs/handoff/leads.md; services.leads is server/tenancy/leads.mjs).
//
// Showroom, public:
//   GET    /api/visitor                     -> { visitor: { name, email, phone, consentText, since } | null, required }
//                                           The browser's "Before you start" answer (its visitor cookie, or the
//                                           signed-in account's). `required`: false for the showroom's team.
//   POST   /api/visitor                     { name, email?, phone?, consent: true, website: '' (honeypot) }
//                                           -> 201 { visitor } and the visitor cookie (httpOnly, host-only, 400 days).
//                                           Email or phone, at least one. Rate-limited; CSRF header.
//   DELETE /api/visitor                     -> { ok } "Not you?": this browser forgets the visitor (the lead stays).
//   POST   /api/leads                       { name, email, phone?, postalCode?, budget?, timeline?, notes?,
//                                             consent: true, projectId? | shareToken?, website: '' (honeypot) }
//                                           -> 201 { ok: true, id }. "Send this design": joins the visitor's lead.
// Showroom, the team (auth 'staff'):
//   GET    /api/workspace/leads             ?status=&q=&sent=yes|no&before=<lastActiveAt>&limit= -> { leads, counts }
//   GET    /api/workspace/leads/summary     -> { counts }
//   GET    /api/workspace/leads/export      -> { filename, contentType: 'text/csv', content, rows }: owners, or staff when
//                                           an owner allows it (settings.staffLeadExport); every export is audited
//                                           (showroom_leads_export: who, when, how many rows); 10 a day per person
//   GET    /api/workspace/leads/exports     owner -> { exports: [{ at, by, role, rows }] } (the last 20)
//   GET    /api/workspace/leads/:id         -> { lead } (with designs, sends and timeline; marks it read)
//   PATCH  /api/workspace/leads/:id         { status?, staffNotes? } -> { lead }
//   DELETE /api/workspace/leads/:id         -> { ok, removed: { designs, unlinked, sends } } (audited)
//   POST   /api/workspace/leads/:id/merge   -> { lead }: a possible duplicate (lead.duplicateOf) joins that lead
//   POST   /api/workspace/leads/:id/keep-separate -> { lead }: not the same person; the label goes
//   GET    /api/workspace/leads/:id/designs/:designId -> { design: { id, name, doc, createdAt, updatedAt } } (view-only)
// Sales site, public:
//   POST   /api/sales-leads                 { company, name, phone?, email, city?, message?, website: '' (honeypot) }
//                                           -> 201 { ok: true }. Rate-limited; emailed to SUPPORT_EMAIL when email is on.
// Sales site, admin:
//   GET    /api/admin/sales-leads           ?status= -> { leads, counts }
//   PATCH  /api/admin/sales-leads/:id       { status?, adminNotes? } -> { lead } (audited)
//   DELETE /api/admin/sales-leads/:id       -> { ok } (re-authenticated; audited with the id and company only;
//                                           its email and phone leave the audit log). A lead not updated for
//                                           SALES_LEAD_RETENTION_MONTHS (24) is deleted by the daily sweep.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { audit, pseudonymiseAudit } from '../lib/audit.mjs';
import { EMAIL_RE } from '../auth/userWire.mjs';
import { createMailer } from '../email/index.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { leadNoticeEmail, salesLeadEmail } from '../tenancy/emails.mjs';
import { clearedVisitorCookie, requestVisitor, visitorCookie } from '../tenancy/leads.mjs';

const LEAD_PARAM = /^ld_[A-Za-z0-9_-]{8,40}$/;
const DESIGN_PARAM = /^[0-9a-f-]{36}$/;
const SALES_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const HOUR = 3_600_000;
const SALES_STATUSES = ['new', 'contacted', 'demo', 'won', 'lost'];
const one = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Adds a cookie without dropping one the session layer already set on this response. */
const addCookie = (res, cookie) => {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [...[].concat(prev), cookie] : cookie);
};

/** A bot filled the hidden field: answer as if it worked, store nothing. */
const honeypot = (b) => typeof b?.website === 'string' && b.website.trim() !== '';

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { tenants, leads } = services;
  const mailer = createMailer({ config, fetch: (...a) => ctx.fetch(...a), log });

  tenants.addAdminExtra((t) => ({ leads: leads.countFor(t.id) }));

  const originOf = (rc) => tenants.originOf(rc.tenant, requestOrigin(rc.req, config));
  const designUrlOf = (rc) => {
    const origin = originOf(rc);
    return (token) => `${origin}/#/s/${token}`;
  };

  /** Where a showroom's lead notices go: its contact address, else its owners. */
  const noticeTo = (t) => {
    if (t.contact?.email) return [t.contact.email];
    return db
      .prepare("SELECT u.email FROM tenant_members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND m.role = 'owner' ORDER BY m.created_at LIMIT 3")
      .all(t.id)
      .map((r) => r.email);
  };

  const salesWire = (r) => r && { id: r.id, company: r.company, name: r.name, phone: r.phone, email: r.email, city: r.city, message: r.message, status: r.status, adminNotes: r.admin_notes, emailed: !!r.emailed, createdAt: r.created_at, updatedAt: r.updated_at };

  return [
    // ── showroom: "Before you start" ────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/visitor',
      auth: 'optional',
      hosts: 'showroom',
      handler: (rc) => {
        const team = !!rc.memberRole;
        let v = requestVisitor(rc);
        // Signed in to a showroom account on this browser (the older path): it joins the lead.
        if (v && rc.user && !team && !v.userId) ctx.tx(() => leads.linkVisitorToUser(rc.tenant.id, v, rc.user.id));
        if (!v && rc.user && !team) v = leads.visitorForUser(rc.tenant.id, rc.user.id);
        // An account that is already a lead (it sent a design before this form existed) isn't asked
        // again: it answers with the account's own name and email.
        if (!v && rc.user && !team) {
          const leadId = leads.leadIdFor(rc.tenant.id, { userId: rc.user.id });
          const lead = leadId ? db.prepare('SELECT consent_text, created_at FROM tenant_leads WHERE id = ?').get(leadId) : null;
          if (lead) return { visitor: { name: rc.user.name, email: rc.user.email, phone: '', consentText: lead.consent_text, since: lead.created_at }, required: true };
        }
        return { visitor: leads.visitorWire(v), required: !team };
      },
    },
    {
      method: 'POST',
      path: '/api/visitor',
      auth: 'optional',
      hosts: 'showroom',
      maxBytes: 4_096,
      rateLimit: [
        { name: 'showroom-visitor', max: 10, windowMs: 10 * 60_000, by: 'ip' },
        { name: 'showroom-visitor-day', max: 60, windowMs: 24 * HOUR, by: 'ip' },
      ],
      handler: (rc) => {
        if (rc.tenant.status === 'setup') throw new HttpError(403, 'This showroom isn’t open yet.', { code: 'showroom_not_open' });
        if (rc.memberRole) throw new HttpError(409, 'You’re on this showroom’s team, so you can design without this form.', { code: 'team_member' });
        const b = rc.body ?? {};
        // A bot filled the hidden field: answer as if it worked, store nothing, set no cookie.
        if (honeypot(b)) return rc.send(201, { visitor: { name: one(b.name, 100), email: one(b.email, 254).toLowerCase(), phone: one(b.phone, 40), consentText: '', since: ctx.now() } });
        const out = ctx.tx(() => leads.capture(rc.tenant, b, { userId: rc.user?.id ?? null }));
        addCookie(rc.res, visitorCookie(rc.req, config, out.token));
        rc.send(201, { visitor: out.visitor });
      },
    },
    {
      method: 'DELETE',
      path: '/api/visitor',
      auth: 'none',
      hosts: 'showroom',
      handler: (rc) => {
        addCookie(rc.res, clearedVisitorCookie(rc.req, config));
        return { ok: true };
      },
    },

    // ── showroom: a visitor sends a design ──────────────────────────────────
    {
      method: 'POST',
      path: '/api/leads',
      auth: 'optional',
      hosts: 'showroom',
      maxBytes: 8_192,
      rateLimit: [
        { name: 'showroom-lead', max: 5, windowMs: 10 * 60_000, by: 'ip' },
        { name: 'showroom-lead-day', max: 30, windowMs: 24 * HOUR, by: 'ip' },
      ],
      handler: (rc) => {
        if (rc.tenant.status === 'setup') throw new HttpError(403, 'This showroom isn’t open yet.', { code: 'showroom_not_open' });
        if (honeypot(rc.body)) return rc.send(201, { ok: true, id: `ld_${crypto.randomBytes(12).toString('base64url')}` });
        const visitor = requestVisitor(rc);
        const lead = ctx.tx(() => leads.create(rc.tenant, rc.body, { userId: rc.user?.id ?? null, visitor, designUrlOf: designUrlOf(rc) }));
        if (mailer.enabled) {
          const msg = leadNoticeEmail({ showroom: rc.tenant.name, inboxUrl: `${originOf(rc)}/#/studio/leads/${lead.id}` });
          for (const to of noticeTo(rc.tenant)) void mailer.send({ to, ...msg });
        }
        rc.send(201, { ok: true, id: lead.id });
      },
    },

    // ── showroom: the team's leads ──────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/leads',
      auth: 'staff',
      handler: (rc) => {
        const before = Number(rc.query.get('before'));
        return leads.list(rc.tenant.id, {
          status: rc.query.get('status') || undefined,
          q: rc.query.get('q') || undefined,
          sent: rc.query.get('sent') || undefined,
          before: Number.isInteger(before) ? before : undefined,
          limit: Number(rc.query.get('limit')) || undefined,
          designUrlOf: designUrlOf(rc),
        });
      },
    },
    {
      method: 'GET',
      path: '/api/workspace/leads/summary',
      auth: 'staff',
      handler: (rc) => ({ counts: leads.counts(rc.tenant.id) }),
    },
    {
      // The whole customer list in one file (audit 2026-10: any staff member could take it silently):
      // owners only unless an owner allows staff, every export recorded, and a daily limit.
      method: 'GET',
      path: '/api/workspace/leads/export',
      auth: 'staff',
      rateLimit: { name: 'lead-export', max: 10, windowMs: 24 * HOUR, by: 'user' },
      handler: (rc) => {
        if (rc.memberRole !== 'owner' && !rc.tenant.settings?.staffLeadExport) {
          throw new HttpError(403, 'Only an owner can export the lead list. An owner can allow staff to in Workspace > Team.', { code: 'export_owner_only' });
        }
        const content = leads.csv(rc.tenant.id);
        const rows = leads.counts(rc.tenant.id).total;
        audit(db, { admin: rc.user, action: 'showroom_leads_export', detail: { tenantId: rc.tenant.id, rows, role: rc.memberRole }, at: ctx.now() });
        rc.res.setHeader('Cache-Control', 'no-store');
        return { filename: `${rc.tenant.slug}-leads-${new Date(ctx.now()).toISOString().slice(0, 10)}.csv`, contentType: 'text/csv', content, rows };
      },
    },
    {
      method: 'GET',
      path: '/api/workspace/leads/exports',
      auth: 'owner',
      handler: (rc) => ({
        exports: db
          .prepare("SELECT at, admin_email, detail FROM admin_audit WHERE action = 'showroom_leads_export' AND json_extract(detail, '$.tenantId') = ? ORDER BY id DESC LIMIT 20")
          .all(rc.tenant.id)
          .map((r) => {
            const d = JSON.parse(r.detail || '{}');
            return { at: r.at, by: r.admin_email, role: d.role ?? null, rows: Number(d.rows ?? 0) };
          }),
      }),
    },
    {
      method: 'GET',
      path: '/api/workspace/leads/:id',
      auth: 'staff',
      params: { id: LEAD_PARAM },
      handler: (rc) => {
        const lead = leads.get(rc.tenant.id, rc.params.id, { designUrlOf: designUrlOf(rc) });
        if (!lead) throw new HttpError(404, 'That lead does not exist.');
        leads.markRead(rc.tenant.id, lead.id);
        return { lead: { ...lead, read: true } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/workspace/leads/:id',
      auth: 'staff',
      params: { id: LEAD_PARAM },
      maxBytes: 8_192,
      handler: (rc) => ({ lead: ctx.tx(() => leads.update(rc.tenant.id, rc.params.id, rc.body ?? {}, { designUrlOf: designUrlOf(rc), by: rc.user.email })) }),
    },
    {
      method: 'DELETE',
      path: '/api/workspace/leads/:id',
      auth: 'staff',
      params: { id: LEAD_PARAM },
      rateLimit: { name: 'lead-delete', max: 60, windowMs: HOUR, by: 'user' },
      handler: (rc) => {
        const removed = ctx.tx(() => {
          const out = leads.remove(rc.tenant.id, rc.params.id);
          // Who deleted which lead, never the person's name or details (they were asked to be forgotten).
          audit(db, { admin: rc.user, action: 'showroom_lead_delete', detail: { tenantId: rc.tenant.id, leadId: rc.params.id, role: rc.memberRole, ...out }, at: ctx.now() });
          return out;
        });
        return { ok: true, removed };
      },
    },
    {
      method: 'POST',
      path: '/api/workspace/leads/:id/merge',
      auth: 'staff',
      body: 'none',
      params: { id: LEAD_PARAM },
      handler: (rc) => ({ lead: ctx.tx(() => leads.merge(rc.tenant.id, rc.params.id, { designUrlOf: designUrlOf(rc), by: rc.user.email })) }),
    },
    {
      method: 'POST',
      path: '/api/workspace/leads/:id/keep-separate',
      auth: 'staff',
      body: 'none',
      params: { id: LEAD_PARAM },
      handler: (rc) => ({ lead: ctx.tx(() => leads.keepSeparate(rc.tenant.id, rc.params.id, { designUrlOf: designUrlOf(rc) })) }),
    },
    {
      method: 'GET',
      path: '/api/workspace/leads/:id/designs/:designId',
      auth: 'staff',
      params: { id: LEAD_PARAM, designId: DESIGN_PARAM },
      handler: (rc) => {
        const design = leads.design(rc.tenant.id, rc.params.id, rc.params.designId);
        if (!design) throw new HttpError(404, 'That design does not exist.');
        return { design };
      },
    },

    // ── sales site: Book a call ─────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/sales-leads',
      auth: 'none',
      hosts: 'sales',
      maxBytes: 8_192,
      rateLimit: [
        { name: 'sales-lead', max: 5, windowMs: 10 * 60_000, by: 'ip' },
        { name: 'sales-lead-day', max: 20, windowMs: 24 * HOUR, by: 'ip' },
      ],
      handler: (rc) => {
        const b = rc.body ?? {};
        if (honeypot(b)) return rc.send(201, { ok: true });
        const lead = {
          company: one(b.company, 120),
          name: one(b.name, 100),
          phone: one(b.phone, 40),
          email: one(b.email, 254).toLowerCase(),
          city: one(b.city, 80),
          message: typeof b.message === 'string' ? b.message.replace(/\r\n?/g, '\n').trim().slice(0, 2000) : '',
        };
        const errors = [];
        if (!lead.company) errors.push({ field: 'company', message: 'Tell us your company’s name.' });
        if (!lead.name) errors.push({ field: 'name', message: 'Tell us your name.' });
        if (!EMAIL_RE.test(lead.email) || /[\r\n,;<>]/.test(lead.email)) errors.push({ field: 'email', message: 'That email address doesn’t look right.' });
        if (lead.phone && !/^[0-9+().\-\s x]{7,40}$/i.test(lead.phone)) errors.push({ field: 'phone', message: 'That phone number doesn’t look right.' });
        if (errors.length) throw new HttpError(400, errors[0].message, { errors });
        const id = `sl_${crypto.randomBytes(12).toString('base64url')}`;
        const t = ctx.now();
        const to = config.legal?.supportEmail;
        const emailed = !!(mailer.enabled && to);
        db.prepare(
          `INSERT INTO sales_leads (id, company, name, phone, email, city, message, status, admin_notes, emailed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?, ?)`,
        ).run(id, lead.company, lead.name, lead.phone, lead.email, lead.city, lead.message, emailed ? 1 : 0, t, t);
        if (emailed) void mailer.send({ to, ...salesLeadEmail({ lead, adminUrl: `${config.PUBLIC_URL}/#/admin` }) });
        rc.send(201, { ok: true });
      },
    },
    {
      method: 'GET',
      path: '/api/admin/sales-leads',
      auth: 'admin',
      handler: (rc) => {
        const status = rc.query.get('status');
        if (status && !SALES_STATUSES.includes(status)) throw new HttpError(400, `Status is one of ${SALES_STATUSES.join(', ')}.`);
        const rows = status
          ? db.prepare('SELECT * FROM sales_leads WHERE status = ? ORDER BY created_at DESC LIMIT 500').all(status)
          : db.prepare('SELECT * FROM sales_leads ORDER BY created_at DESC LIMIT 500').all();
        const counts = Object.fromEntries(SALES_STATUSES.map((s) => [s, 0]));
        let total = 0;
        for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM sales_leads GROUP BY status').all()) {
          counts[r.status] = r.n;
          total += r.n;
        }
        return { leads: rows.map(salesWire), counts: { ...counts, total } };
      },
    },
    {
      method: 'PATCH',
      path: '/api/admin/sales-leads/:id',
      auth: 'admin',
      params: { id: SALES_PARAM },
      maxBytes: 8_192,
      handler: (rc) => {
        const cur = db.prepare('SELECT * FROM sales_leads WHERE id = ?').get(rc.params.id);
        if (!cur) throw new HttpError(404, 'That lead does not exist.');
        const b = rc.body ?? {};
        let status = cur.status;
        if (b.status !== undefined) {
          if (!SALES_STATUSES.includes(b.status)) throw new HttpError(400, `Status is one of ${SALES_STATUSES.join(', ')}.`, { field: 'status' });
          status = b.status;
        }
        let notes = cur.admin_notes;
        if (b.adminNotes !== undefined) {
          if (typeof b.adminNotes !== 'string' || b.adminNotes.length > 4000) throw new HttpError(400, 'Keep the notes to 4000 characters.', { field: 'adminNotes' });
          notes = b.adminNotes.trim();
        }
        ctx.tx(() => {
          db.prepare('UPDATE sales_leads SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?').run(status, notes, ctx.now(), cur.id);
          audit(db, { admin: rc.user, action: 'sales_lead_update', detail: { leadId: cur.id, company: cur.company, from: cur.status, to: status }, at: ctx.now() });
        });
        return { lead: salesWire(db.prepare('SELECT * FROM sales_leads WHERE id = ?').get(cur.id)) };
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/sales-leads/:id',
      auth: 'admin',
      reauth: true,
      params: { id: SALES_PARAM },
      handler: (rc) => {
        const cur = db.prepare('SELECT * FROM sales_leads WHERE id = ?').get(rc.params.id);
        if (!cur) throw new HttpError(404, 'That lead does not exist.');
        ctx.tx(() => {
          deleteSalesLead(db, cur);
          audit(db, { admin: rc.user, action: 'sales_lead_delete', detail: { leadId: cur.id, company: cur.company }, at: ctx.now() });
        });
        return { ok: true };
      },
    },
  ];
}

/** Deletes one "Book a call" lead; its email and phone leave the audit log (pseudonymised). */
export function deleteSalesLead(db, row) {
  db.prepare('DELETE FROM sales_leads WHERE id = ?').run(row.id);
  pseudonymiseAudit(db, { emails: [row.email], phones: [row.phone] });
}

/** The retention rule: sales leads not updated for `months` (SALES_LEAD_RETENTION_MONTHS). Returns how many went. */
export function purgeSalesLeads(db, cutoff) {
  const rows = db.prepare('SELECT * FROM sales_leads WHERE updated_at < ?').all(cutoff);
  for (const r of rows) deleteSalesLead(db, r);
  return rows.length;
}
