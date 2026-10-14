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
      handler: () => ({
        /** 'stripe' | 'demo' | 'none'. With 'none', billing/checkout/order-payment endpoints answer 503 payments_unavailable. */
        payments: config.paymentsProvider,
        demoPayments: config.paymentsProvider === 'demo',
        publicUrl: config.PUBLIC_URL,
        legal: { ready: config.legal.ready, businessName: config.legal.businessName, supportEmail: config.legal.supportEmail, jurisdiction: config.legal.jurisdiction },
        llm: config.llmEnabled,
        limits: { glbMb: config.MAX_GLB_MB, imageMb: config.MAX_IMAGE_MB, brandProducts: config.BRAND_PRODUCT_LIMIT },
        version: config.version,
      }),
    },
  ];
}
