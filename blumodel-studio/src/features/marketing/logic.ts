/*
 * The sales site's pure logic, kept apart from the React and CSS so the unit tests can load it
 * (src/features/marketing/__tests__/logic.test.ts).
 */

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const IP = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

/**
 * The live demo showroom, `demo.<base domain>`: https://demo.blumodel.studio in production and
 * http://demo.localhost:<port> in dev and QA. The base domain comes from the server's
 * `/api/config` (BASE_DOMAIN); until it answers, from the page's own host (without `www.`). A page
 * opened by IP address on a server that doesn't say falls back to the public demo.
 */
export function demoShowroomUrl(baseDomain: string | null, loc: { protocol: string; hostname: string; port: string }): string {
  const port = loc.port ? `:${loc.port}` : '';
  const scheme = loc.protocol === 'http:' ? 'http:' : 'https:';
  const base = baseDomain && HOST.test(baseDomain) ? baseDomain.toLowerCase() : null;
  if (base) {
    // Same machine (dev and QA, `localhost`) or the same domain: keep the page's scheme and port.
    const here = base === 'localhost' || loc.hostname === base || loc.hostname.endsWith(`.${base}`);
    return here ? `${scheme}//demo.${base}${port}` : `https://demo.${base}`;
  }
  const host = loc.hostname.toLowerCase().replace(/^www\./, '');
  if (!host || IP.test(host) || !HOST.test(host)) return 'https://demo.blumodel.studio';
  return `${scheme}//demo.${host}${port}`;
}

export type SalesLeadField = 'company' | 'name' | 'phone' | 'email' | 'city' | 'message';
export type SalesLeadValues = Record<SalesLeadField, string>;

const EMAIL = /^[^\s@<>()[\]\,;:"]+@[^\s@<>()[\]\,;:"]+\.[A-Za-z]{2,}$/;
const PHONE = /^[0-9+().\-\s x]{7,40}$/i;

/** Book a call: the same checks POST /api/sales-leads makes, so most mistakes are caught before sending. */
export function checkSalesLead(v: SalesLeadValues): Partial<Record<SalesLeadField, string>> {
  const e: Partial<Record<SalesLeadField, string>> = {};
  if (!v.company.trim()) e.company = 'Tell us your company’s name.';
  if (!v.name.trim()) e.name = 'Tell us your name.';
  if (!EMAIL.test(v.email.trim())) e.email = 'That email address doesn’t look right.';
  if (v.phone.trim() && !PHONE.test(v.phone.trim())) e.phone = 'That phone number doesn’t look right.';
  return e;
}
