// What the server says about its own setup when it starts: the payments posture and why, the
// Stripe mode (from the key's prefix only), and the warnings worth fixing before customers arrive.
// Every line is safe to log: no key, secret or settings value except PUBLIC_URL, which is public.

/**
 * @param {any} config  the frozen config from loadConfig()
 * @returns {{ info: string[], warn: string[] }}
 */
export function startupReport(config) {
  const info = [];
  const warn = [];
  const p = config.paymentsProvider;
  if (p === 'stripe') info.push(`Stripe: ${config.stripeMode === 'live' ? 'LIVE' : 'TEST'} mode`);
  else if (p === 'demo') info.push('Payments: DEMO (labelled, no money moves, no card fields).');
  else info.push('Payments: none. Checkout, billing changes and order payments answer 503 payments_unavailable.');
  for (const n of config.paymentsNotes ?? []) (p === 'stripe' ? info : warn).push(n);

  if (p !== 'stripe') warn.push('No Stripe: nobody can pay on this server.');
  if (p === 'demo' && config.PROD) warn.push('DEMO payments are ON in production. Set DEMO_PAYMENTS=0 (or remove it) before real customers use this server.');
  if (p === 'stripe' && config.stripeMode === 'test' && config.PROD && config.httpsPublicUrl) warn.push('Stripe is in TEST mode on a public https server: payments are not real.');
  if (!config.ADMIN_EMAILS?.length) warn.push('ADMIN_EMAILS is empty: nobody becomes an admin by signing in.');
  const missing = [
    !config.legal?.businessName && 'LEGAL_NAME',
    !config.legal?.supportEmail && 'SUPPORT_EMAIL',
    !config.legal?.jurisdiction && 'LEGAL_JURISDICTION',
  ].filter(Boolean);
  if (missing.length) warn.push(`Legal details missing (${missing.join(', ')}): the terms, privacy and receipt pages can't name the business.`);
  if (config.PROD && !config.httpsPublicUrl) warn.push(`PUBLIC_URL is ${config.PUBLIC_URL}: links in payment pages and emails point there. Set PUBLIC_URL=https://blumodel.studio for the public server.`);
  if (config.PROD && config.httpsPublicUrl && !config.TRUST_PROXY) warn.push('TRUST_PROXY is off behind an https PUBLIC_URL: every visitor through the tunnel shares one address, so rate limits apply to all of them at once. Set TRUST_PROXY=1.');
  if (config.BACKUPS === 'off') warn.push('Daily database backups are off (BACKUPS=off or an in-memory database).');
  return { info, warn };
}
