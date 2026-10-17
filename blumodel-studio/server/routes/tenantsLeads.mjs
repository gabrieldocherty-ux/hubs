// Leads (docs/SHOWROOM_PIVOT.md §5, §6; services.leads is server/tenancy/leads.mjs).
//
// Showroom, public:
//   POST  /api/leads                        { name, email, phone?, postalCode?, budget?, timeline?, notes?,
//                                             consent: true, projectId? | shareToken?, website: '' (honeypot) }
//                                           -> 201 { ok: true, id }. Rate-limited per address; CSRF header.
//                                           projectId: the signed-in visitor's own kitchen here (a view-only
//                                           link is made for the staff); shareToken: a link they already have.
// Showroom, the team (auth 'staff'):
//   GET   /api/workspace/leads              ?status=&q=&before=<createdAt>&limit= -> { leads, counts }
//   GET   /api/workspace/leads/export       -> { filename, contentType: 'text/csv', content }
//   GET   /api/workspace/leads/:id          -> { lead } (marks it read)
//   PATCH /api/workspace/leads/:id          { status?, staffNotes? } -> { lead }
// Sales site, public:
//   POST  /api/sales-leads                  { company, name, phone?, email, city?, message?, website: '' (honeypot) }
//                                           -> 201 { ok: true }. Rate-limited; emailed to SUPPORT_EMAIL when email is on.
// Sales site, admin:
//   GET   /api/admin/sales-leads            ?status= -> { leads, counts }
//   PATCH /api/admin/sales-leads/:id        { status?, adminNotes? } -> { lead } (audited)

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';
import { EMAIL_RE } from '../auth/userWire.mjs';
import { createMailer } from '../email/index.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { leadNoticeEmail, salesLeadEmail } from '../tenancy/emails.mjs';

const LEAD_PARAM = /^ld_[A-Za-z0-9_-]{8,40}$/;
const SALES_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const HOUR = 3_600_000;
const SALES_STATUSES = ['new', 'contacted', 'demo', 'won', 'lost'];
const one = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

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
        if (honeypot(rc.body)) return rc.send(201, { ok: true, id: `ld_${crypto.randomBytes(12).toString('base64url')}` });
        const lead = ctx.tx(() => leads.create(rc.tenant, rc.body, { userId: rc.user?.id ?? null, designUrlOf: designUrlOf(rc) }));
        if (mailer.enabled) {
          const msg = leadNoticeEmail({ showroom: rc.tenant.name, inboxUrl: `${originOf(rc)}/#/studio/leads` });
          for (const to of noticeTo(rc.tenant)) void mailer.send({ to, ...msg });
        }
        rc.send(201, { ok: true, id: lead.id });
      },
    },

    // ── showroom: the team's inbox ──────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/leads',
      auth: 'staff',
      handler: (rc) => {
        const before = Number(rc.query.get('before'));
        return leads.list(rc.tenant.id, {
          status: rc.query.get('status') || undefined,
          q: rc.query.get('q') || undefined,
          before: Number.isInteger(before) ? before : undefined,
          limit: Number(rc.query.get('limit')) || undefined,
          designUrlOf: designUrlOf(rc),
        });
      },
    },
    {
      method: 'GET',
      path: '/api/workspace/leads/export',
      auth: 'staff',
      handler: (rc) => ({
        filename: `${rc.tenant.slug}-leads-${new Date(ctx.now()).toISOString().slice(0, 10)}.csv`,
        contentType: 'text/csv',
        content: leads.csv(rc.tenant.id, { designUrlOf: designUrlOf(rc) }),
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
      handler: (rc) => ({ lead: leads.update(rc.tenant.id, rc.params.id, rc.body ?? {}, { designUrlOf: designUrlOf(rc) }) }),
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
  ];
}
