// Admin > Companies > Quick setup and the prospect trial (server/tenancy/quickSetup.mjs;
// docs/handoff/tenancy.md §5 "Admin"; docs/ONBOARDING_A_COMPANY.md "The quick path"). Admin only,
// so sales-site only; every change audited.
//
//   GET  /api/admin/quick-setup/slug?slug=&name=   { slug, available, problem: invalid|reserved|taken|null, suggestion }
//   POST /api/admin/quick-setup                     { name, slug?, logo?: base64 | { data }, branding?: { primaryColor?, accentColor? },
//                                                     contact?: { website?, serviceArea?, phone?, email? },
//                                                     catalog: 'demo'|'empty', purpose: 'trial'|'customer' }
//                                                   -> 201 { tenant: AdminTenant, products, trialEndsAt }
//   POST /api/admin/tenants/:id/trial/extend        { days?: 1..30 (7) } -> { tenant }
//   POST /api/admin/tenants/:id/trial/end           -> { tenant } (lapses now; nothing deleted)
//   POST /api/admin/tenants/:id/trial/convert       -> { tenant } (live, everything kept); 409 not_paid_up
//                                                      { missing: ['license'|'monthly'] } until both are in place

import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { quickSetup, slugCheck } from '../tenancy/quickSetup.mjs';

const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services } = ctx;
  const { tenants } = services;
  const from = (rc) => requestOrigin(rc.req, config);
  const mustGet = (id) => {
    const t = tenants.get(id);
    if (!t) throw new HttpError(404, 'That showroom does not exist.');
    return t;
  };
  const log = (rc, action, t, detail = {}) => audit(db, { admin: rc.user, action, detail: { tenantId: t.id, slug: t.slug, ...detail }, at: ctx.now() });
  const view = (rc, t) => ({ tenant: tenants.adminWire(t, from(rc)) });

  return [
    {
      method: 'GET',
      path: '/api/admin/quick-setup/slug',
      auth: 'admin',
      rateLimit: { name: 'admin-slug-check', max: 600, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => slugCheck(tenants, { slug: String(rc.query.get('slug') ?? '').slice(0, 60), name: String(rc.query.get('name') ?? '').slice(0, 100) }),
    },
    {
      method: 'POST',
      path: '/api/admin/quick-setup',
      auth: 'admin',
      // A logo of up to 2 MB, as base64.
      maxBytes: 3_000_000,
      rateLimit: { name: 'admin-tenant-create', max: 60, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const out = ctx.tx(() => {
          const r = quickSetup(ctx, rc.body ?? {}, { by: rc.user.id });
          log(rc, 'tenant_quick_setup', r.tenant, {
            name: r.tenant.name,
            purpose: rc.body?.purpose ?? 'trial',
            catalog: rc.body?.catalog ?? 'demo',
            products: r.products,
            ...(r.trialEndsAt ? { endsAt: r.trialEndsAt } : {}),
            ...(r.creditsCents ? { creditsCents: r.creditsCents } : {}),
          });
          return r;
        });
        rc.send(201, { ...view(rc, out.tenant), products: out.products, trialEndsAt: out.trialEndsAt });
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/trial/extend',
      auth: 'admin',
      params: { id: ID_PARAM },
      maxBytes: 1_024,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const days = rc.body?.days ?? 7;
        const next = ctx.tx(() => {
          const u = tenants.extendTrial(t.id, days);
          log(rc, 'tenant_trial_extend', t, { days, endsAt: u.trialEndsAt });
          return u;
        });
        return view(rc, next);
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/trial/end',
      auth: 'admin',
      params: { id: ID_PARAM },
      body: 'none',
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const next = ctx.tx(() => {
          const u = tenants.endTrial(t.id);
          log(rc, 'tenant_trial_end', t, { to: u.status });
          return u;
        });
        return view(rc, next);
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/trial/convert',
      auth: 'admin',
      params: { id: ID_PARAM },
      body: 'none',
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const next = ctx.tx(() => {
          const u = tenants.convertTrial(t.id);
          log(rc, 'tenant_trial_convert', t, { from: t.status, to: u.status });
          return u;
        });
        return view(rc, next);
      },
    },
  ];
}
