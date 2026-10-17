// Photoreal AI renders (docs/SHOWROOM_PIVOT.md §5, §7; docs/handoff/renders.md). The service is
// server/renders/service.mjs, on ctx.services.renders. Every showroom route says hosts: 'showroom'
// itself (this module is not in SHOWROOM_MODULES), and is scoped to the showroom of the request.
//
// Showroom:
//   GET    /api/renders/status           optional  { configured, provider, demo, costCents, role, canRender,
//                                                    reason: null | not_configured | sign_in | visitor_off |
//                                                    daily_cap | no_credits | unavailable, balanceCents (team),
//                                                    visitor: { enabled, left, dailyCap?, usedToday? }, maxImageMb }
//   POST   /api/renders                  user      { projectId? | shareToken? (team), image: <base64 PNG/JPEG/WebP>,
//                                                    scene: Scene } -> 202 { render } (pending)
//                                                    503 renders_not_configured (nothing charged), 402
//                                                    insufficient_credits, 403 visitor_renders_off, 429
//                                                    daily_cap_reached, 409 render_in_progress, 413 too_large
//   GET    /api/renders                  user      ?projectId= | shareToken= (team)&before=<createdAt>&limit= -> { renders, more }
//   GET    /api/renders/:id              user      { render } (with its scene)
//   GET    /api/renders/:id/image        user      the result (PNG/JPEG/WebP), private, no-store
//   GET    /api/renders/:id/input        user      the captured 3D view
//   DELETE /api/renders/:id              user      takes it out of the gallery -> { ok: true }
//   GET    /api/workspace/renders        staff     ?before=&limit= -> { renders, more, usage, costCents, configured, provider }
// Sales site, admin (audited):
//   POST   /api/admin/tenants/:id/renders/:renderId/refund   { note? } -> { render }
// A visitor sees only their own renders; the team sees every render of its showroom.

import { HttpError } from '../http/respond.mjs';
import { serveFile } from '../http/static.mjs';
import { mimeFor } from '../files/meta.mjs';
import { audit } from '../lib/audit.mjs';
import { pickProvider } from '../renders/providers.mjs';
import { RENDER_ID, createRenderService } from '../renders/service.mjs';

const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const PROJECT = /^[A-Za-z0-9_-]{1,64}$/;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const provider = pickProvider({ config, fetch: (...a) => ctx.fetch(...a), log });
  const renders = createRenderService({ db, config, now: ctx.now, tx: ctx.tx, credits: services.credits, files: services.files, provider, log });
  services.renders = renders;
  log.info?.(`renders: ${provider ? `provider ${provider.id}, ${config.RENDER_CREDIT_CENTS} cents of credits each` : 'not set up (ARCHITECT_AI_URL / ARCHITECT_AI_KEY): the button says so and nothing is charged'}`);

  services.tenants.addAdminExtra((t) => ({ renders: renders.usage(t.id) }));

  const blob = (which) => (rc) => {
    const b = renders.blob(rc, rc.params.id, which);
    if (!b) throw new HttpError(404, 'Not found.');
    rc.sent = true;
    serveFile(rc.req, rc.res, b.path, {
      'Content-Type': mimeFor(b.ext),
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
  };

  const before = (rc) => {
    const n = Number(rc.query.get('before'));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  return [
    {
      method: 'GET',
      path: '/api/renders/status',
      auth: 'optional',
      hosts: 'showroom',
      handler: (rc) => renders.status(rc),
    },
    {
      method: 'POST',
      path: '/api/renders',
      auth: 'user',
      hosts: 'showroom',
      // The captured view, base64 (RENDER_MAX_IMAGE_MB decoded), plus the scene.
      maxBytes: Math.ceil((config.RENDER_MAX_IMAGE_MB * 1024 * 1024 * 4) / 3) + 256 * 1024,
      rateLimit: [
        { name: 'render', max: 30, windowMs: 3_600_000, by: 'user' },
        { name: 'render-ip', max: 60, windowMs: 3_600_000, by: 'ip' },
      ],
      handler: (rc) => rc.send(202, { render: renders.start(rc, rc.body) }),
    },
    {
      method: 'GET',
      path: '/api/renders',
      auth: 'user',
      hosts: 'showroom',
      handler: (rc) => {
        const projectId = rc.query.get('projectId') || undefined;
        if (projectId && !PROJECT.test(projectId)) throw new HttpError(400, 'That design id isn’t valid.', { field: 'projectId' });
        const shareToken = rc.query.get('shareToken') || undefined;
        if (shareToken && !/^[A-Za-z0-9_-]{8,128}$/.test(shareToken)) throw new HttpError(400, 'That link isn’t valid.', { field: 'shareToken' });
        return renders.list(rc, { projectId, shareToken, before: before(rc), limit: Number(rc.query.get('limit')) || undefined });
      },
    },
    {
      method: 'GET',
      path: '/api/renders/:id',
      auth: 'user',
      hosts: 'showroom',
      params: { id: RENDER_ID },
      handler: (rc) => ({ render: renders.get(rc, rc.params.id) }),
    },
    {
      method: 'GET',
      path: '/api/renders/:id/image',
      auth: 'user',
      hosts: 'showroom',
      params: { id: RENDER_ID },
      handler: blob('image'),
    },
    {
      method: 'GET',
      path: '/api/renders/:id/input',
      auth: 'user',
      hosts: 'showroom',
      params: { id: RENDER_ID },
      handler: blob('input'),
    },
    {
      method: 'DELETE',
      path: '/api/renders/:id',
      auth: 'user',
      hosts: 'showroom',
      params: { id: RENDER_ID },
      handler: (rc) => renders.hide(rc, rc.params.id),
    },
    {
      method: 'GET',
      path: '/api/workspace/renders',
      auth: 'staff',
      handler: (rc) => ({
        ...renders.list(rc, { before: before(rc), limit: Number(rc.query.get('limit')) || 24 }),
        usage: renders.usage(rc.tenant.id),
        costCents: renders.costCents(),
        configured: !!renders.providerId,
        provider: renders.providerId,
      }),
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/renders/:renderId/refund',
      auth: 'admin',
      // renderId takes any id shape here so a malformed id still meets the admin check first (401/403
      // like every admin route); the service answers 404 for anything that isn't one of this showroom's renders.
      params: { id: ID_PARAM, renderId: ID_PARAM },
      maxBytes: 2_048,
      handler: (rc) => {
        const t = services.tenants.get(rc.params.id);
        if (!t) throw new HttpError(404, 'That showroom doesn’t exist.');
        const note = typeof rc.body?.note === 'string' ? rc.body.note.trim().slice(0, 500) : '';
        return ctx.tx(() => {
          const render = renders.refund(t.id, rc.params.renderId, { note, by: rc.user.id });
          audit(db, { admin: rc.user, action: 'tenant_render_refund', detail: { tenantId: t.id, slug: t.slug, renderId: render.id, cents: render.costCents, note }, at: ctx.now() });
          return { render };
        });
      },
    },
  ];
}
