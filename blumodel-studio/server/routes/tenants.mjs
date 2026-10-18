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
//   POST  /api/workspace/team                 owner: { email, name?, role } -> { member, pending, invite? }
//                                             pending: an existing account joins once it accepts the
//                                             link emailed to it, with its own password (no link back;
//                                             409 email_required without an email provider)
//   PATCH /api/workspace/team/:userId         owner: { role } -> { member }
//   DELETE /api/workspace/team/:userId        owner -> { members }
//   GET   /api/workspace/products             { products: [Product (working copy, any status)] }
//   POST  /api/workspace/products             { spec: ProductSpec, publish?: boolean } -> 201 { product }
//   PATCH /api/workspace/products/:id         { spec?: partial ProductSpec, revision, publish? } -> { product }
//   POST  /api/workspace/products/:id/hide    -> { product } (status archived: off the showroom)
//   POST  /api/workspace/products/:id/show    -> { product } (published again)
//   A product's files (images, model, swatches) must be this showroom's uploads (PUT /api/files on
//   the showroom). Products the studio models for the company arrive here the same way.
//
// Showroom pictures (server/tenancy/images.mjs, docs/handoff/showroom-images.md; showroom hosts):
//   GET    /api/showroom-images/access         staff, or X-Showroom-Ticket from Admin > Companies
//                                              -> { ok: true, via: 'staff'|'ticket' } (else 403)
//   PUT    /api/showroom-images                raw PNG/JPEG/WebP body; query slot=hero|heroTall|line|gallery,
//                                              line=<name>, index=1..3, title=, source=render|photo
//                                              -> { images, imageSources }. A ticket uploads renders only;
//                                              photos (hero, line) are the team's.
//   DELETE /api/showroom-images                staff; the same query -> { images, imageSources }
//   POST   /api/showroom-images/done           staff or ticket: { made, failed } -> { ok: true }; the
//                                              generator finished (an admin's Quick setup waits for it)

import { HttpError } from '../http/respond.mjs';
import { READ_LIMITS } from '../http/readLimits.mjs';
import { EMAIL_RE } from '../auth/userWire.mjs';
import { inviteToTeam } from '../tenancy/accounts.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { MEMBER_ROLES } from '../tenancy/service.mjs';
import { createMailer } from '../email/index.mjs';
import { inviteAcceptEmail, inviteEmail } from '../tenancy/emails.mjs';
import { checkImage, cleanTarget, withImage, withoutImage } from '../tenancy/images.mjs';

const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const PRODUCT_PARAM = /^p_[A-Za-z0-9_-]{1,60}$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { tenants } = services;
  const mailer = createMailer({ config, fetch: (...a) => ctx.fetch(...a), log });

  const { products, files } = services;

  /** This showroom's product, or a 404 (another showroom's looks missing). */
  const ownProduct = (rc, id) => {
    const row = products.get(id);
    if (!row || row.tenantId !== rc.tenant.id) throw new HttpError(404, 'That product does not exist.');
    return row;
  };
  /** Every file a spec names must be this showroom's own upload. */
  const checkFiles = (rc, spec) => {
    for (const fid of products.fileIdsOf(spec)) {
      const f = files.get(fid);
      if (!f || f.tenantId !== rc.tenant.id) throw new HttpError(400, 'That file can’t be used here.', { fileId: String(fid) });
    }
  };
  const working = (row, rc) => products.toWire(row, { which: 'working', viewer: rc.user }) ?? null;

  const ticketOf = (rc) => {
    const ticket = rc.req.headers['x-showroom-ticket'];
    return Array.isArray(ticket) ? ticket[0] : ticket;
  };
  /** 'staff' for the team, 'ticket' for a valid generator ticket for this showroom, else a 403. */
  const imageAccess = (rc) => {
    if (rc.memberRole) return 'staff';
    if (rc.tenant && ctx.services.imageTickets.tenantOf(ticketOf(rc)) === rc.tenant.id) return 'ticket';
    throw new HttpError(403, 'Only the showroom’s team can change its pictures. Ask an admin for a new link if yours has expired.', { code: 'not_staff' });
  };
  const targetOf = (rc) => cleanTarget(Object.fromEntries(['slot', 'line', 'index', 'title', 'source'].map((k) => [k, rc.query.get(k) ?? undefined])));
  const imagesWire = (t, rc) => {
    const w = tenants.staffWire(t, requestOrigin(rc.req, config));
    return { images: w.images, imageSources: w.imageSources };
  };

  return [
    {
      method: 'GET',
      path: '/api/showroom',
      auth: 'none',
      hosts: 'any',
      rateLimit: READ_LIMITS.showroom,
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

    // ── the showroom's pictures ─────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/showroom-images/access',
      auth: 'optional',
      hosts: 'showroom',
      handler: (rc) => {
        const via = imageAccess(rc);
        if (via === 'ticket') ctx.services.imageTickets.noteOpened(ticketOf(rc));
        return { ok: true, via };
      },
    },
    {
      method: 'POST',
      path: '/api/showroom-images/done',
      auth: 'optional',
      hosts: 'showroom',
      maxBytes: 1_024,
      handler: (rc) => {
        const via = imageAccess(rc);
        if (via === 'ticket') ctx.services.imageTickets.finish(ticketOf(rc), { made: rc.body?.made, failed: rc.body?.failed });
        return { ok: true };
      },
    },
    {
      method: 'PUT',
      path: '/api/showroom-images',
      auth: 'optional',
      hosts: 'showroom',
      body: 'raw',
      maxBytes: config.MAX_IMAGE_MB * 1_048_576,
      rateLimit: { name: 'showroom-images', max: 120, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const via = imageAccess(rc);
        const target = targetOf(rc);
        if (via === 'ticket' && target.source !== 'render') throw new HttpError(403, 'Photos are uploaded by the showroom’s team.', { code: 'not_staff' });
        const info = checkImage(rc.body, { maxBytes: config.MAX_IMAGE_MB * 1_048_576 });
        const name = `${target.source}-${target.slot}${target.line ? `-${target.line}` : ''}${target.index ? `-${target.index}` : ''}.${info.ext}`.replace(/[^A-Za-z0-9._-]+/g, '-');
        const next = ctx.tx(() => {
          const file = files.saveBuffer(rc.body, { kind: 'image', visibility: 'public', tenantId: rc.tenant.id, ownerUserId: rc.user?.id ?? null, originalName: name });
          const cur = tenants.get(rc.tenant.id);
          return tenants.setImages(rc.tenant.id, withImage(cur.branding.images, target, { fileId: file.id, w: info.width, h: info.height, at: ctx.now() }));
        });
        if (via === 'ticket') ctx.services.imageTickets.noteUpload(ticketOf(rc));
        return imagesWire(next, rc);
      },
    },
    {
      method: 'DELETE',
      path: '/api/showroom-images',
      auth: 'staff',
      body: 'none',
      handler: (rc) => {
        const target = targetOf(rc);
        const next = ctx.tx(() => tenants.setImages(rc.tenant.id, withoutImage(tenants.get(rc.tenant.id).branding.images, target)));
        return imagesWire(next, rc);
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
        const origin = tenants.originOf(rc.tenant, requestOrigin(rc.req, config));
        const added = await inviteToTeam(db, tenants, { tenant: rc.tenant, email, name: b.name, role, by: rc.user.id, origin, canEmail: mailer.enabled, now: ctx.now });
        const { member, invite } = added;
        if (invite && mailer.enabled) void mailer.send({ to: email, ...inviteEmail({ showroom: rc.tenant.name, url: invite.url }) });
        // `pending`: the address already had an account here. Its accept link goes to the address
        // only, never back to the owner, and it needs that account's own password.
        if (added.pending) void mailer.send({ to: email, ...inviteAcceptEmail({ showroom: rc.tenant.name, url: added.acceptUrl, role }) });
        // A new account's set-your-password link is shown once to the owner (no email provider) and never logged.
        rc.send(added.created ? 201 : 200, { member, pending: added.pending, ...(added.pending ? { emailed: true } : {}), ...(invite ? { invite: { ...invite, emailed: mailer.enabled } } : {}) });
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

    // ── workspace: products ─────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/products',
      auth: 'staff',
      handler: (rc) => ({
        products: db
          .prepare('SELECT id FROM products WHERE tenant_id = ? ORDER BY category, name COLLATE NOCASE, id')
          .all(rc.tenant.id)
          .map((r) => working(products.get(r.id), rc))
          .filter(Boolean),
      }),
    },
    {
      method: 'POST',
      path: '/api/workspace/products',
      auth: 'staff',
      maxBytes: 64_000,
      rateLimit: { name: 'workspace-product-create', max: 300, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const v = products.validateSpec(rc.body?.spec);
        if (!v.ok) throw new HttpError(400, 'Some product details need fixing.', { errors: v.errors });
        checkFiles(rc, v.spec);
        const row = ctx.tx(() => {
          const r = products.create({ source: 'tenant', tenantId: rc.tenant.id, ownerUserId: rc.user.id, visibility: 'public', spec: v.spec });
          return rc.body?.publish === false ? r : products.publish(r.id);
        });
        rc.send(201, { product: working(row, rc) });
      },
    },
    {
      method: 'PATCH',
      path: '/api/workspace/products/:id',
      auth: 'staff',
      params: { id: PRODUCT_PARAM },
      maxBytes: 64_000,
      handler: (rc) => {
        const row = ownProduct(rc, rc.params.id);
        const b = rc.body ?? {};
        const out = ctx.tx(() => {
          let r = row;
          if (b.spec !== undefined) {
            r = products.update(row.id, b.spec, { expectRevision: b.revision });
            checkFiles(rc, r.spec);
          }
          if (b.publish !== false && r.status !== 'archived') r = products.publish(r.id);
          return r;
        });
        return { product: working(out, rc) };
      },
    },
    {
      method: 'POST',
      path: '/api/workspace/products/:id/hide',
      auth: 'staff',
      body: 'none',
      params: { id: PRODUCT_PARAM },
      handler: (rc) => ({ product: working(products.archive(ownProduct(rc, rc.params.id).id), rc) }),
    },
    {
      method: 'POST',
      path: '/api/workspace/products/:id/show',
      auth: 'staff',
      body: 'none',
      params: { id: PRODUCT_PARAM },
      handler: (rc) => ({ product: working(products.publish(ownProduct(rc, rc.params.id).id), rc) }),
    },
  ];
}
