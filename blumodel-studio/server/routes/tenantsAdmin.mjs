// Admin > Tenants (docs/SHOWROOM_PIVOT.md §8, docs/handoff/tenancy.md). Admin only, so these exist
// only on the sales site (router: 'admin' routes are sales-only). Every change is audited.
//
//   GET    /api/admin/tenants                          { tenants: [AdminTenant] }
//   POST   /api/admin/tenants                          { name, slug?, ownerEmail?, ownerName? }
//                                                      -> 201 { tenant, invite?: { url, expiresAt } }
//   GET    /api/admin/tenants/:id                      { tenant: AdminTenant }
//   PATCH  /api/admin/tenants/:id                      { name?, branding?, contact?, settings? }
//   POST   /api/admin/tenants/:id/status               { status: setup|live|suspended, note? }
//   POST   /api/admin/tenants/:id/hostnames            { hostname, kind?, verified?, primary? }
//   PATCH  /api/admin/tenants/:id/hostnames/:hostname  { verified?, primary? }
//   DELETE /api/admin/tenants/:id/hostnames/:hostname
//   POST   /api/admin/tenants/:id/members              { email, name?, role } -> { member, invite? }
//   DELETE /api/admin/tenants/:id/members/:userId
//   POST   /api/admin/tenants/:id/export          re-authenticated -> { url, expiresAt }: a 2-minute, one-use link
//   GET    /api/admin/tenants/:id/export?ticket=  the company's whole data as a zip, streamed (audited tenant_export)
//   POST   /api/admin/tenants/:id/delete          { confirm: <slug> }, re-authenticated -> { deleted, counts }:
//                                                 everything of the showroom, billing kept anonymised (audited)
//   POST   /api/admin/tenants/:id/showroom-images     -> { url, expiresAt, run }: the showroom's picture
//                                                      generator, opened in the admin's own browser with a
//                                                      2-hour ticket (server/tenancy/images.mjs); ?auto=1
//                                                      starts it at once (Quick setup)
//   GET    /api/admin/tenants/:id/showroom-images/:run -> { state: waiting|running|done, uploads, made, failed,
//                                                      finishedAt, expiresAt }: how that generator is getting on
//
// Item 3+ (licenses, the monthly plan, credits, leads) add their own admin routes next to these.

import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';
import { EMAIL_RE } from '../auth/userWire.mjs';
import { inviteToTeam } from '../tenancy/accounts.mjs';
import { MEMBER_ROLES } from '../tenancy/service.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { createMailer } from '../email/index.mjs';
import { inviteAcceptEmail } from '../tenancy/emails.mjs';
import crypto from 'node:crypto';
import { companyCounts, deleteCompany, exportCompany } from '../tenancy/companyData.mjs';

const HOSTNAME_PARAM = /^[A-Za-z0-9._-]{1,253}$/;
const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, services } = ctx;
  const { tenants } = services;
  const mailer = createMailer({ config: ctx.config, fetch: (...a) => ctx.fetch(...a), log: ctx.log });

  /** Links for a tenant use this request's scheme and port (tenants.originOf). */
  const from = (rc) => requestOrigin(rc.req, ctx.config);
  const mustGet = (id) => {
    const t = tenants.get(id);
    if (!t) throw new HttpError(404, 'That showroom does not exist.');
    return t;
  };
  const log = (rc, action, t, detail = {}) => audit(db, { admin: rc.user, action, detail: { tenantId: t.id, slug: t.slug, ...detail }, at: ctx.now() });

  /** Adds `email` to the team (making the account on the showroom if needed) and makes an invite link. */
  async function addToTeam(rc, t, { email, name, role }) {
    const e = str(email, 254).toLowerCase();
    if (!EMAIL_RE.test(e) || /[\r\n,;<>]/.test(e)) throw new HttpError(400, 'Enter the person’s email address.', { errors: [{ field: 'email', message: 'Enter the person’s email address.' }] });
    if (!MEMBER_ROLES.includes(role)) throw new HttpError(400, 'Role is owner or staff.', { errors: [{ field: 'role', message: 'Role is owner or staff.' }] });
    const out = await inviteToTeam(db, tenants, { tenant: t, email: e, name, role, by: rc.user.id, origin: tenants.originOf(t, from(rc)), canEmail: mailer.enabled, now: ctx.now });
    // An existing account's accept link goes to its address only, never to us either.
    if (out.pending) void mailer.send({ to: e, ...inviteAcceptEmail({ showroom: t.name, url: out.acceptUrl, role }) });
    return out;
  }

  /** One-use export links: ticket -> { tenantId, adminId, expiresAt } (a browser download can't answer "confirm it's you"). */
  const exportTickets = new Map();

  return [
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/export',
      auth: 'admin',
      reauth: true,
      body: 'none',
      params: { id: ID_PARAM },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        for (const [k, v] of exportTickets) if (v.expiresAt < ctx.now()) exportTickets.delete(k);
        const ticket = crypto.randomBytes(24).toString('base64url');
        const expiresAt = ctx.now() + 2 * 60_000;
        exportTickets.set(ticket, { tenantId: t.id, adminId: rc.user.id, expiresAt });
        rc.res.setHeader('Cache-Control', 'no-store');
        return { url: `/api/admin/tenants/${encodeURIComponent(t.id)}/export?ticket=${ticket}`, expiresAt, counts: companyCounts(db, t.id) };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/tenants/:id/export',
      auth: 'admin',
      params: { id: ID_PARAM },
      handler: async (rc) => {
        const t = mustGet(rc.params.id);
        const ticket = String(rc.query.get('ticket') ?? '');
        const held = exportTickets.get(ticket);
        exportTickets.delete(ticket);
        if (!held || held.tenantId !== t.id || held.adminId !== rc.user.id || held.expiresAt < ctx.now()) {
          throw new HttpError(403, 'That export link has expired. Start the export again.', { code: 'export_ticket_invalid' });
        }
        log(rc, 'tenant_export', t, { counts: companyCounts(db, t.id) });
        const day = new Date(ctx.now()).toISOString().slice(0, 10);
        rc.res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${t.slug}-data-${day}.zip"`,
          'Cache-Control': 'no-store',
        });
        await exportCompany(ctx, t, rc.res, { origin: from(rc), now: ctx.now() });
        rc.sent = true;
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/delete',
      auth: 'admin',
      reauth: true,
      params: { id: ID_PARAM },
      maxBytes: 1_024,
      rateLimit: { name: 'tenant-delete', max: 10, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        if (t.isDemo) throw new HttpError(409, 'The demo showroom can’t be deleted.', { code: 'demo_tenant' });
        if (str(rc.body?.confirm, 100).toLowerCase() !== t.slug) throw new HttpError(400, `Type the showroom’s address, ${t.slug}, to confirm.`, { field: 'confirm' });
        const counts = deleteCompany(ctx, t);
        // Counts only: the company's people were pseudonymised in this log as it went.
        audit(db, { admin: rc.user, action: 'tenant_delete', detail: { tenantId: t.id, slug: t.slug, counts }, at: ctx.now() });
        return { deleted: true, counts };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/tenants',
      auth: 'admin',
      handler: (rc) => ({ tenants: tenants.list().map((t) => tenants.adminWire(tenants.refresh(t.id) ?? t, from(rc))) }),
    },
    {
      method: 'POST',
      path: '/api/admin/tenants',
      auth: 'admin',
      maxBytes: 16_384,
      rateLimit: { name: 'admin-tenant-create', max: 60, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        const b = rc.body ?? {};
        const t = ctx.tx(() => tenants.create({ name: b.name, slug: b.slug, branding: b.branding, contact: b.contact, settings: b.settings, createdBy: rc.user.id }));
        log(rc, 'tenant_create', t, { name: t.name });
        let invite = null;
        if (b.ownerEmail) {
          const added = await addToTeam(rc, t, { email: b.ownerEmail, name: b.ownerName, role: 'owner' });
          invite = added.invite;
          log(rc, 'tenant_member_add', t, { email: added.member.email, role: 'owner' });
        }
        rc.send(201, { tenant: tenants.adminWire(t, from(rc)), ...(invite ? { invite } : {}) });
      },
    },
    {
      method: 'GET',
      path: '/api/admin/tenants/:id',
      auth: 'admin',
      params: { id: ID_PARAM },
      handler: (rc) => ({ tenant: tenants.adminWire(tenants.refresh(mustGet(rc.params.id).id), from(rc)) }),
    },
    {
      method: 'PATCH',
      path: '/api/admin/tenants/:id',
      auth: 'admin',
      params: { id: ID_PARAM },
      maxBytes: 16_384,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const b = rc.body ?? {};
        const next = ctx.tx(() => {
          const u = tenants.update(t.id, { name: b.name, branding: b.branding, contact: b.contact, settings: b.settings });
          log(rc, 'tenant_update', t, { fields: ['name', 'branding', 'contact', 'settings'].filter((k) => b[k] !== undefined), settings: b.settings ?? undefined });
          return u;
        });
        return { tenant: tenants.adminWire(next, from(rc)) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/showroom-images',
      auth: 'admin',
      params: { id: ID_PARAM },
      body: 'none',
      rateLimit: { name: 'admin-showroom-images', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const { ticket, expiresAt, run } = ctx.services.imageTickets.issue(t.id);
        const auto = rc.query.get('auto') === '1';
        log(rc, 'tenant_images_ticket', t, { expiresAt, ...(auto ? { auto: true } : {}) });
        // The ticket rides in the hash: never sent to the server in a request line or a Referer.
        return { url: `${tenants.originOf(t, from(rc))}/#/showroom-images?ticket=${encodeURIComponent(ticket)}${auto ? '&auto=1' : ''}`, expiresAt, run };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/tenants/:id/showroom-images/:run',
      auth: 'admin',
      params: { id: ID_PARAM, run: ID_PARAM },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const s = ctx.services.imageTickets.runStatus(t.id, rc.params.run);
        if (!s) throw new HttpError(404, 'That picture run has ended. Open the generator again.');
        return s;
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/status',
      auth: 'admin',
      params: { id: ID_PARAM },
      maxBytes: 4_096,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const next = ctx.tx(() => {
          const u = tenants.setStatus(t.id, rc.body?.status, { note: typeof rc.body?.note === 'string' ? rc.body.note : undefined });
          log(rc, 'tenant_status', t, { from: t.status, asked: rc.body?.status, to: u.status, note: str(rc.body?.note, 500) });
          return u;
        });
        return { tenant: tenants.adminWire(next, from(rc)) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/hostnames',
      auth: 'admin',
      params: { id: ID_PARAM },
      maxBytes: 4_096,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const b = rc.body ?? {};
        const h = ctx.tx(() => {
          const out = tenants.addHostname(t.id, b.hostname, { kind: b.kind ?? 'custom', verified: b.verified === true, primary: b.primary === true, by: rc.user.id });
          log(rc, 'tenant_hostname_add', t, { hostname: out.hostname, kind: out.kind, verified: out.verified, primary: out.primary });
          return out;
        });
        rc.send(201, { hostname: h, tenant: tenants.adminWire(mustGet(t.id), from(rc)) });
      },
    },
    {
      method: 'PATCH',
      path: '/api/admin/tenants/:id/hostnames/:hostname',
      auth: 'admin',
      params: { id: ID_PARAM, hostname: HOSTNAME_PARAM },
      maxBytes: 2_048,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const b = rc.body ?? {};
        ctx.tx(() => {
          if (typeof b.verified === 'boolean') tenants.setHostnameVerified(t.id, rc.params.hostname, b.verified);
          if (b.primary === true) tenants.setPrimaryHostname(t.id, rc.params.hostname);
          log(rc, 'tenant_hostname_update', t, { hostname: rc.params.hostname, verified: b.verified, primary: b.primary });
        });
        return { tenant: tenants.adminWire(mustGet(t.id), from(rc)) };
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/tenants/:id/hostnames/:hostname',
      auth: 'admin',
      params: { id: ID_PARAM, hostname: HOSTNAME_PARAM },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        ctx.tx(() => {
          tenants.removeHostname(t.id, rc.params.hostname);
          log(rc, 'tenant_hostname_remove', t, { hostname: rc.params.hostname });
        });
        return { tenant: tenants.adminWire(mustGet(t.id), from(rc)) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/members',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      params: { id: ID_PARAM },
      maxBytes: 4_096,
      handler: async (rc) => {
        const t = mustGet(rc.params.id);
        const b = rc.body ?? {};
        const out = await addToTeam(rc, t, { email: b.email, name: b.name, role: b.role ?? 'staff' });
        log(rc, 'tenant_member_add', t, { email: out.member.email, role: out.member.role });
        rc.send(out.created ? 201 : 200, { member: out.member, pending: out.pending, ...(out.invite ? { invite: out.invite } : {}) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/tenants/:id/members/:userId',
      auth: 'admin',
      params: { id: ID_PARAM, userId: ID_PARAM },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        ctx.tx(() => {
          const email = db.prepare('SELECT email FROM users WHERE id = ?').get(rc.params.userId)?.email ?? '';
          tenants.removeMember(t.id, rc.params.userId);
          log(rc, 'tenant_member_remove', t, { userId: rc.params.userId, email });
        });
        return { members: tenants.members(t.id) };
      },
    },
  ];
}
