import fs from 'node:fs';
import path from 'node:path';
import { requestOrigin } from '../tenancy/hosts.mjs';
import { serveFile } from '../http/static.mjs';
import { HttpError } from '../http/respond.mjs';
import { MARKETING_NAMES, marketingDir } from '../lib/marketing.mjs';

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
        /** The sales site's kitchen designer (#/new, the editor, My kitchens): off in production. */
        salesDesigner: config.SALES_DESIGNER,
      }),
    },
    // The sales page's slideshow: which photoreal versions exist (server/scripts/render-marketing.mjs),
    // with a version in the address so a new one replaces the cached one. Public; nothing else listed.
    {
      method: 'GET',
      path: '/api/marketing/photoreal',
      auth: 'none',
      handler: (rc) => {
        const dir = marketingDir(config.DB_PATH);
        const images = {};
        for (const name of MARKETING_NAMES) {
          try {
            const st = fs.statSync(path.join(dir, `${name}.png`));
            images[name] = `/api/marketing/photoreal/${name}?v=${Math.round(st.mtimeMs)}`;
          } catch {
            /* not made yet: the page shows the 3D picture */
          }
        }
        rc.res.setHeader('Cache-Control', 'public, max-age=300');
        return { images };
      },
    },
    {
      method: 'GET',
      path: '/api/marketing/photoreal/:name',
      auth: 'none',
      params: { name: /^kitchen-[1-9]$/ },
      handler: (rc) => {
        const dir = marketingDir(config.DB_PATH);
        const file = dir && MARKETING_NAMES.includes(rc.params.name) ? path.join(dir, `${rc.params.name}.png`) : null;
        if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Not found.');
        rc.sent = true;
        serveFile(rc.req, rc.res, file, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      },
    },
  ];
}
