// The DEMO payment provider (PRODUCT_SPEC §7.4): used whenever Stripe isn't fully
// configured. It moves no money and collects nothing; checkout is an in-app page
// (`#/pay/demo/:orderId`) whose buttons simulate what a payment provider would answer.
// It goes through the same markOrderPaid() as Stripe. The routes refuse it in production
// unless DEMO_PAYMENTS=1 (config.demoPaymentsAllowed).

export function createDemoProvider() {
  return {
    id: 'demo',

    /** @param {{ id: string }} order */
    async createCheckout(order) {
      return { url: `#/pay/demo/${order.id}`, ref: `demo_${order.id}` };
    },

    /** Demo payments complete through POST /api/payments/demo/:id/complete, never by polling. */
    async retrieve() {
      return { paid: false, amountCents: null, currency: null, paymentIntent: null, orderId: null, status: null };
    },

    /** @param {{ id: string }} order */
    async refund(order) {
      return { ok: true, ref: `demo_refund_${order.id}`, status: 'succeeded' };
    },
  };
}
