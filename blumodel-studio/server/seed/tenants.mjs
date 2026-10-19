// The demo showroom for local development, QA and the demo server (docs/SHOWROOM_PIVOT.md §9):
// "Northline Kitchen & Bath (Demo)" at demo.<BASE_DOMAIN>, with its products, branding, a
// complimentary license and monthly plan, credits, and (here, not in production) its people:
// demo-owner@ / demo-staff@ / demo-visitor@blumodel.test on the showroom (SEED_PASSWORD, or a
// generated one in seed-credentials.txt), two sample designs and three leads.
//
// In production the showroom (without people) is made by `node server/scripts/seed-demo-tenant.mjs`.
// Idempotent, like every seed.

import { DEMO_SLUG, seedDemoTenant } from '../tenancy/demo.mjs';

/** @param {{ db: any, config: any, services: any, now?: () => number }} ctx */
export async function seed(ctx) {
  const out = await seedDemoTenant(ctx, { people: true });
  const leads = ctx.db.prepare('SELECT COUNT(*) AS n FROM showroom_leads WHERE tenant_id = ?').get(out.tenantId).n;
  return { summary: `demo showroom ${DEMO_SLUG}.${ctx.config.BASE_DOMAIN}: ${out.products.total} products (${out.products.made} new), 3 people, ${leads} leads` };
}
