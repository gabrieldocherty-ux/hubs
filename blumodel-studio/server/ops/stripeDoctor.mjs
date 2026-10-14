// The Stripe doctor: is this server's Stripe setup ready to take real money? `npm run stripe:check`
// (scripts/stripe-check.mjs) runs it against the settings file; the tests run it with a mocked
// fetch. It only ever READS from Stripe:
//
//   GET /v1/account                          the key works; live or test; business name; charges enabled
//   GET /v1/webhook_endpoints                an endpoint for PUBLIC_URL + /api/webhooks/stripe that is
//                                            enabled and sends every event the server handles
//   GET /v1/billing_portal/configurations    a saved, active Customer portal setup
//
// and checks the settings the server needs around Stripe (webhook secret, PUBLIC_URL, legal names,
// ADMIN_EMAILS, TRUST_PROXY, DEMO_PAYMENTS).
//
// What it may print: 'live' / 'test' (from the key's prefix), PASS / FIX / NOTE lines, PUBLIC_URL and
// webhook URLs (public), the Stripe account's public business name and statement descriptor,
// Stripe's error type/code words and a missing permission's rak_ name. Never a key, a webhook
// secret, any part of either, a header, a response body or Stripe's free-text messages.

import { paymentsPosture, stripeKeyMode } from '../config.mjs';
import { createStripeRequest } from '../payments/stripeApi.mjs';
import { STRIPE_KEY_PERMISSIONS, STRIPE_WEBHOOK_EVENTS, STRIPE_WEBHOOK_PATH } from '../payments/webhookEvents.mjs';

const quietLog = { info() {}, warn() {}, error() {} };

/** What to add to a restricted key, by the endpoint that was refused. */
const PERMISSION_FOR = {
  '/account': 'read access to the account (Stripe names the exact permission below when it says so)',
  '/webhook_endpoints': 'Webhook Endpoints: Read',
  '/billing_portal/configurations': 'Customer portal: Read',
};

/** A value safe to print for the Stripe account's public name or descriptor (no control characters, bounded). */
const printable = (v) =>
  typeof v === 'string' && v.trim()
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 80)
    : null;

/**
 * @param {{ env: Record<string, string | undefined>, fetch: typeof fetch, timeoutMs?: number }} opts
 *   `env` holds the server's settings (the settings file loaded over the environment).
 * @returns {Promise<{ lines: { status: 'PASS' | 'FIX' | 'NOTE', text: string }[], fixes: number, mode: string }>}
 */
export async function runStripeCheck({ env, fetch, timeoutMs = 15_000 }) {
  /** @type {{ status: 'PASS' | 'FIX' | 'NOTE', text: string }[]} */
  const lines = [];
  const pass = (text) => lines.push({ status: 'PASS', text });
  const fix = (text) => lines.push({ status: 'FIX', text });
  const note = (text) => lines.push({ status: 'NOTE', text });
  const val = (k) => String(env[k] ?? '').trim();

  const key = val('STRIPE_SECRET_KEY');
  const whsec = val('STRIPE_WEBHOOK_SECRET');
  const mode = stripeKeyMode(key);
  const restricted = /^rk_/.test(key);
  const publicUrl = val('PUBLIC_URL').replace(/\/+$/, '');

  // ── the settings ──────────────────────────────────────────────────────
  if (mode === 'none') fix('STRIPE_SECRET_KEY is not set. Paste the secret (sk_live_...) or restricted (rk_live_...) key from Stripe > Developers > API keys.');
  else if (mode === 'invalid') fix(/^pk_/.test(key) ? 'STRIPE_SECRET_KEY holds a publishable key (pk_...). The server needs the secret or restricted key.' : 'STRIPE_SECRET_KEY is not a Stripe secret key (sk_live_/sk_test_) or restricted key (rk_live_/rk_test_).');
  else {
    pass(`Stripe key: ${mode}${restricted ? ' (restricted key)' : ''}`);
    if (mode === 'test') note('This is a TEST key: no real money moves. Use the live key for launch.');
  }
  if (!whsec) fix('STRIPE_WEBHOOK_SECRET is not set: copy the signing secret from the webhook endpoint (Developers > Webhooks > the endpoint > Signing secret).');
  else if (!/^whsec_/.test(whsec)) fix('STRIPE_WEBHOOK_SECRET is not a webhook signing secret (those start whsec_).');
  else pass('STRIPE_WEBHOOK_SECRET is set (a signing secret). Stripe never shows it again, so this check can’t compare it with the endpoint’s: a mismatch shows as 400s on the endpoint’s delivery log.');

  let urlOk = false;
  if (!publicUrl) fix('PUBLIC_URL is not set. Set PUBLIC_URL=https://blumodel.studio.');
  else if (!/^https:\/\/[^\s/?#]+$/i.test(publicUrl)) fix(`PUBLIC_URL is ${publicUrl}: it must be the https address customers use, with no path (https://blumodel.studio).`);
  else {
    urlOk = true;
    pass(`PUBLIC_URL is ${publicUrl}`);
  }

  const admins = val('ADMIN_EMAILS')
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (admins.length) pass(`ADMIN_EMAILS names ${admins.length} admin${admins.length === 1 ? '' : 's'}.`);
  else fix('ADMIN_EMAILS is empty: nobody becomes an admin, so nobody can refund, grant plans or approve brand pages.');
  for (const [k, what] of [
    ['LEGAL_NAME', 'the business name the terms, privacy page and receipts show'],
    ['SUPPORT_EMAIL', 'the address customers write to'],
    ['LEGAL_JURISDICTION', 'where the business is (e.g. Ontario, Canada) for the terms'],
  ]) {
    if (val(k)) pass(`${k} is set.`);
    else fix(`${k} is not set: ${what}.`);
  }
  const tp = val('TRUST_PROXY').toLowerCase();
  if (/^(1|true|yes|on)$/.test(tp)) pass('TRUST_PROXY=1: rate limits see each visitor’s own address through the tunnel.');
  else fix('TRUST_PROXY is not 1: behind the Cloudflare tunnel every visitor would share one address for rate limits.');
  const demo = /^(1|true|yes|on)$/i.test(val('DEMO_PAYMENTS'));
  if (demo) fix('DEMO_PAYMENTS=1: set DEMO_PAYMENTS=0 for the public server (with a live key it is ignored anyway).');
  else pass('DEMO_PAYMENTS is off.');

  // What the home server (always production) would decide with these settings.
  const posture = paymentsPosture({ PAYMENTS: 'auto', PROD: true, PUBLIC_URL: publicUrl, DEMO_PAYMENTS: demo, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec });
  if (posture.provider === 'stripe') pass(`The server will take payments through Stripe (${mode} mode).`);
  else fix(`The server would NOT take payments through Stripe (payments: ${posture.provider}). ${posture.notes.join(' ')}`.trim());

  // ── Stripe itself (read-only) ─────────────────────────────────────────
  if (mode !== 'live' && mode !== 'test') {
    note('Skipped the Stripe checks: there is no usable key.');
    return { lines, fixes: lines.filter((l) => l.status === 'FIX').length, mode };
  }
  const request = createStripeRequest({ config: { STRIPE_SECRET_KEY: key }, fetch, log: quietLog, timeoutMs });
  const get = (path, params) => request('GET', path, params, { quiet: true });
  /** Explains a failed read. Returns true when the key itself was refused (stop asking). */
  const explain = (err, path, what) => {
    if (err?.network != null) {
      fix(`Couldn’t reach Stripe for ${what} (${err.network}). Check this computer’s internet connection and try again.`);
      return false;
    }
    if (err?.stripeStatus === 401) {
      fix(`Stripe refused the key (HTTP 401${err.stripeCode ? `, ${err.stripeCode}` : ''}): it was rolled, expired or mistyped. Paste the current key into the settings file.`);
      return true;
    }
    if (err?.stripeStatus === 403 || err?.permission) {
      fix(`The restricted key can’t read ${what}. Add ${PERMISSION_FOR[path] ?? 'read access for it'} to the key${err.permission ? ` (Stripe calls it ${err.permission})` : ''}.`);
      return false;
    }
    fix(`Stripe answered HTTP ${err?.stripeStatus ?? '?'}${err?.stripeType ? ` (${err.stripeType}${err.stripeCode ? `, ${err.stripeCode}` : ''})` : ''} for ${what}.`);
    return false;
  };

  // The account.
  try {
    const acct = await get('/account');
    pass(`Stripe accepted the key (${mode} mode).`);
    const name = printable(acct?.settings?.dashboard?.display_name) ?? printable(acct?.business_profile?.name);
    if (name) pass(`Stripe account business name: ${name}`);
    else fix('The Stripe account has no business name: set it in Stripe > Settings > Business > Public details.');
    if (acct?.charges_enabled === true) pass('Charges are enabled on the Stripe account.');
    else fix('Charges are NOT enabled: finish activating the account (Stripe > Settings > Business, and any requirement on the home page).');
    if (acct?.payouts_enabled === false) note('Payouts are not enabled yet: Stripe holds the money until a bank account is added and verified.');
    const descriptor = printable(acct?.settings?.payments?.statement_descriptor);
    if (descriptor) pass(`Statement descriptor (what card statements show): ${descriptor}`);
    else fix('No statement descriptor: set one in Stripe > Settings > Business > Public details (e.g. BLUMODEL STUDIO).');
  } catch (err) {
    if (explain(err, '/account', 'the account details')) return { lines, fixes: lines.filter((l) => l.status === 'FIX').length, mode };
  }

  // The webhook endpoint.
  const want = urlOk ? `${publicUrl}${STRIPE_WEBHOOK_PATH}` : null;
  try {
    const endpoints = [];
    let after = null;
    for (let page = 0; page < 10; page++) {
      const r = await get('/webhook_endpoints', { limit: 100, ...(after ? { starting_after: after } : {}) });
      const data = Array.isArray(r?.data) ? r.data : [];
      endpoints.push(...data);
      if (!r?.has_more || !data.length) break;
      after = data[data.length - 1].id;
    }
    const mine = want ? endpoints.filter((e) => String(e?.url ?? '').replace(/\/+$/, '') === want) : [];
    if (!want) fix('Can’t look for the webhook endpoint until PUBLIC_URL is the https address.');
    else if (!mine.length) {
      const others = endpoints.map((e) => printable(e?.url)).filter(Boolean);
      fix(`No ${mode} webhook endpoint for ${want}. Add it in Stripe > Developers > Webhooks with the events listed below${others.length ? ` (endpoints that exist: ${others.join(', ')})` : ''}.`);
      note(`Events to send: ${STRIPE_WEBHOOK_EVENTS.join(', ')}`);
    } else {
      const enabled = mine.find((e) => e?.status === 'enabled');
      if (!enabled) fix(`The webhook endpoint for ${want} is disabled. Enable it in Stripe > Developers > Webhooks.`);
      else {
        const events = Array.isArray(enabled.enabled_events) ? enabled.enabled_events : [];
        const missing = events.includes('*') ? [] : STRIPE_WEBHOOK_EVENTS.filter((e) => !events.includes(e));
        if (missing.length) fix(`The webhook endpoint for ${want} doesn’t send: ${missing.join(', ')}. Add them to the endpoint.`);
        else pass(`Webhook endpoint ${want} is enabled and sends all ${STRIPE_WEBHOOK_EVENTS.length} events the server handles.`);
        if (mine.length > 1) note(`There are ${mine.length} endpoints for ${want}. Keep one: each has its own signing secret and the server knows only one.`);
      }
    }
  } catch (err) {
    if (explain(err, '/webhook_endpoints', 'the webhook endpoints')) return { lines, fixes: lines.filter((l) => l.status === 'FIX').length, mode };
  }

  // The Customer portal.
  try {
    const r = await get('/billing_portal/configurations', { limit: 20 });
    const configs = Array.isArray(r?.data) ? r.data : [];
    const def = configs.find((c) => c?.is_default && c?.active) ?? configs.find((c) => c?.active);
    if (!def) fix('The Customer portal isn’t set up: open Stripe > Settings > Billing > Customer portal, choose what customers may do, and Save.');
    else {
      pass('The Customer portal is set up.');
      const f = def.features ?? {};
      if (f.payment_method_update?.enabled === false) fix('The Customer portal doesn’t let customers update their card: turn on "Payment methods".');
      if (f.invoice_history?.enabled === false) fix('The Customer portal hides invoices: turn on "Invoice history".');
      if (f.subscription_cancel?.enabled === false) note('The Customer portal doesn’t offer cancelling (customers can still cancel in Account > Billing).');
      if (f.subscription_update?.enabled === true) note('The Customer portal lets customers switch plans: BluModel Studio changes plans itself, so you may turn "Switch plans" off.');
    }
  } catch (err) {
    explain(err, '/billing_portal/configurations', 'the Customer portal settings');
  }

  if (restricted) {
    const server = STRIPE_KEY_PERMISSIONS.filter((p) => p.use === 'server').map((p) => `${p.resource}: ${p.access}`);
    note(`A restricted key also needs, for the server itself (this check can’t test writes without making them): ${server.join('; ')}.`);
  }
  return { lines, fixes: lines.filter((l) => l.status === 'FIX').length, mode };
}

/** The report as text lines: "PASS  ...", "FIX   ...", "NOTE  ...". */
export function formatReport(lines) {
  return lines.map((l) => `${l.status.padEnd(4)}  ${l.text}`);
}
