import { requestOrigin } from '../tenancy/hosts.mjs';

// What the client needs to know about this server's setup. Public.

/** @param {any} ctx */
export default function routes(ctx) {
  const { config } = ctx;
  return [
    {
      method: 'GET',
      path: '/api/config',
      auth: 'none',
      // Public: never a key, a secret or anything from the settings file beyond the legal names.
      handler: (rc) => ({
        /**
         * Which site this host is (docs/handoff/tenancy.md): 'sales' (blumodel.studio, our sales site)
         * or 'showroom' (a company's showroom; `tenant` says which). A lapsed or suspended showroom
         * still answers this, with tenant.status 'lapsed' | 'suspended' and every other API a 503.
         */
        site: rc.site.kind,
        tenant: rc.tenant ? ctx.services.tenants.publicWire(rc.tenant, requestOrigin(rc.req, config)) : null,
        baseDomain: config.BASE_DOMAIN,
        /** 'stripe' | 'demo' | 'none'. With 'none', billing/checkout/order-payment endpoints answer 503 payments_unavailable. */
        payments: config.paymentsProvider,
        demoPayments: config.paymentsProvider === 'demo',
        publicUrl: config.PUBLIC_URL,
        legal: { ready: config.legal.ready, businessName: config.legal.businessName, supportEmail: config.legal.supportEmail, jurisdiction: config.legal.jurisdiction },
        llm: config.llmEnabled,
        limits: { glbMb: config.MAX_GLB_MB, imageMb: config.MAX_IMAGE_MB, brandProducts: config.BRAND_PRODUCT_LIMIT },
        version: config.version,
        /** Credits one AI render costs, in cents (docs/SHOWROOM_PIVOT.md §7). */
        renderCreditCents: config.RENDER_CREDIT_CENTS,
      }),
    },
  ];
}
