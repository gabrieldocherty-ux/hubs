// The showroom itself (docs/SHOWROOM_PIVOT.md §5, docs/handoff/tenancy.md): what visitors see of the
// company, and the company workspace's showroom and team settings. Routes say `hosts` themselves.
//
// Public (any site; on the sales site `tenant` is null):
//   GET   /api/showroom                       { site: 'sales'|'showroom', tenant: PublicTenant|null }
//
// Workspace (auth 'staff' / 'owner': a member of THIS showroom's team; showroom hosts only):
//   GET   /api/workspace/showroom             { tenant: StaffTenant, role }
//   PATCH /api/workspace/showroom             { name?, branding?, contact?, settings? } -> { tenant }
//                                             settings are owner-only
//   GET   /api/workspace/team                 { members: [Member], role }
//   POST  /api/workspace/team                 owner: { email, name?, role } -> { member, invite? }
//   PATCH /api/workspace/team/:userId         owner: { role } -> { member }
//   DELETE /api/workspace/team/:userId        owner -> { members }

import { HttpError } from '../http/respond.mjs';
import { EMAIL_RE } from '../auth/userWire.mjs';
import { ensureSiteUser, inviteLink } from '../tenancy/accounts.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { MEMBER_ROLES } from '../tenancy/service.mjs';
import { createMailer } from '../email/index.mjs';
import { inviteEmail } from '../tenancy/emails.mjs';

const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { tenants } = services;
  const mailer = createMailer({ config, fetch: (...a) => ctx.fetch(...a), log });

  return [
    {
      method: 'GET',
      path: '/api/showroom',
      auth: 'none',
      hosts: 'any',
      handler: (rc) => ({ site: rc.site.kind, tenant: rc.tenant ? tenants.publicWire(rc.tenant, requestOrigin(rc.req, config)) : null }),
    },

    // ── workspace: the showroom ─────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/showroom',
      auth: 'staff',
      handler: (rc) => ({ tenant: tenants.staffWire(rc.tenant, requestOrigin(rc.req, config)), role: rc.memberRole }),
    },
    {
      method: 'PATCH',
      path: '/api/workspace/showroom',
      auth: 'staff',
      maxBytes: 16_384,
      handler: (rc) => {
        const b = rc.body ?? {};
        if (b.settings !== undefined && rc.memberRole !== 'owner') throw new HttpError(403, 'Only an owner of this showroom can change its settings.', { code: 'owner_only' });
        const next = ctx.tx(() => tenants.update(rc.tenant.id, { name: b.name, branding: b.branding, contact: b.contact, settings: b.settings }));
        return { tenant: tenants.staffWire(next, requestOrigin(rc.req, config)) };
      },
    },

    // ── workspace: the team ─────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/team',
      auth: 'staff',
      handler: (rc) => ({ members: tenants.members(rc.tenant.id), role: rc.memberRole }),
    },
    {
      method: 'POST',
      path: '/api/workspace/team',
      auth: 'owner',
      maxBytes: 4_096,
      rateLimit: { name: 'workspace-invite', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        const b = rc.body ?? {};
        const email = str(b.email, 254).toLowerCase();
        const role = b.role ?? 'staff';
        if (!EMAIL_RE.test(email) || /[\r\n,;<>]/.test(email)) throw new HttpError(400, 'Enter the person’s email address.', { errors: [{ field: 'email', message: 'Enter the person’s email address.' }] });
        if (!MEMBER_ROLES.includes(role)) throw new HttpError(400, 'Role is owner or staff.', { errors: [{ field: 'role', message: 'Role is owner or staff.' }] });
        const user = await ensureSiteUser(db, { tenantId: rc.tenant.id, email, name: b.name, now: ctx.now });
        const member = ctx.tx(() => tenants.addMember(rc.tenant.id, user.id, role, { by: rc.user.id }));
        let invite = null;
        if (user.created) {
          invite = inviteLink(db, { userId: user.id, origin: tenants.originOf(rc.tenant, requestOrigin(rc.req, config)), createdBy: rc.user.id, now: ctx.now });
          if (mailer.enabled) void mailer.send({ to: email, ...inviteEmail({ showroom: rc.tenant.name, url: invite.url }) });
        }
        // The link is shown once to the owner (no email provider) and never logged.
        rc.send(user.created ? 201 : 200, { member, ...(invite ? { invite: { ...invite, emailed: mailer.enabled } } : {}) });
      },
    },
    {
      method: 'PATCH',
      path: '/api/workspace/team/:userId',
      auth: 'owner',
      params: { userId: ID_PARAM },
      maxBytes: 1_024,
      handler: (rc) => ({ member: ctx.tx(() => tenants.setMemberRole(rc.tenant.id, rc.params.userId, rc.body?.role)) }),
    },
    {
      method: 'DELETE',
      path: '/api/workspace/team/:userId',
      auth: 'owner',
      params: { userId: ID_PARAM },
      handler: (rc) => {
        ctx.tx(() => tenants.removeMember(rc.tenant.id, rc.params.userId));
        return { members: tenants.members(rc.tenant.id) };
      },
    },
  ];
}
