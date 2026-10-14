// What the client needs to know about this server's setup. Public.

/** @param {any} ctx */
export default function routes(ctx) {
  const { config } = ctx;
  return [
    {
      method: 'GET',
      path: '/api/config',
      auth: 'none',
      handler: () => ({
        payments: config.paymentsProvider,
        demoPayments: config.paymentsProvider === 'demo' && config.demoPaymentsAllowed,
        llm: config.llmEnabled,
        limits: { glbMb: config.MAX_GLB_MB, imageMb: config.MAX_IMAGE_MB, brandProducts: config.BRAND_PRODUCT_LIMIT },
        version: config.version,
      }),
    },
  ];
}
