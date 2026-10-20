// Is this a usable email address? Used wherever someone gives us an address: the showroom's "Before you
// start" box, "Send this design", sales-site sign-up and Book a call, password resets.
//
//   emailSyntaxOk(s)        plain shape check (sync). Rejects x@y.z, a..b@c.com, spaces, a missing or numeric TLD.
//   emailProblem(s)         sync: a message for the person, or null. Syntax, throwaway inboxes, and common
//                           typos of the big providers ("gmial.com" -> "Did you mean ...@gmail.com?").
//   emailDomainProblem(s)   async: a message, or null. The domain must be able to receive mail (an MX record,
//                           or an A/AAAA record as the old fallback). A DNS timeout or outage lets the
//                           address through, so a network hiccup never blocks a real customer.
//
// No check can prove a mailbox exists; that takes sending a confirmation link, which needs the email
// provider set up (RESEND_API_KEY / POSTMARK_TOKEN). These catch typos, junk and dead domains.

import dns from 'node:dns/promises';

const BAD = 'That email address doesn’t look right.';

const LOCAL_CHARS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function emailSyntaxOk(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s.length < 6 || s.length > 254) return false;
  const at = s.lastIndexOf('@');
  if (at < 1 || at !== s.indexOf('@')) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length > 64 || !LOCAL_CHARS.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((l) => !LABEL.test(l))) return false;
  return /^[A-Za-z]{2,24}$/.test(labels[labels.length - 1]);
}

/** Throwaway-inbox services (a small, stable list; a real customer does not use these to hear from a kitchen company). */
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com', '10minutemail.com',
  '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'yopmail.com', 'yopmail.net', 'trashmail.com',
  'getnada.com', 'throwawaymail.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com',
  'emailondeck.com', 'moakt.com', 'tempail.com', 'burnermail.io', 'spamgourmet.com', 'mailnesia.com', 'tempinbox.com',
  'discard.email', 'trash-mail.com', 'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'inboxkitten.com', 'emailfake.com',
]);

/** Common misspellings of the big providers -> what they meant. */
const TYPOS = new Map([
  ['gmial.com', 'gmail.com'], ['gmai.com', 'gmail.com'], ['gmaill.com', 'gmail.com'], ['gamil.com', 'gmail.com'],
  ['gnail.com', 'gmail.com'], ['gmail.co', 'gmail.com'], ['gmail.con', 'gmail.com'], ['gmail.cm', 'gmail.com'],
  ['gmail.om', 'gmail.com'], ['gmail.comm', 'gmail.com'], ['gmal.com', 'gmail.com'], ['gmeil.com', 'gmail.com'],
  ['hotmial.com', 'hotmail.com'], ['hotmai.com', 'hotmail.com'], ['hotmal.com', 'hotmail.com'], ['hotmail.co', 'hotmail.com'],
  ['hotmail.con', 'hotmail.com'], ['hotnail.com', 'hotmail.com'], ['hotmil.com', 'hotmail.com'],
  ['outlok.com', 'outlook.com'], ['outlook.co', 'outlook.com'], ['outlook.con', 'outlook.com'], ['outloo.com', 'outlook.com'],
  ['yaho.com', 'yahoo.com'], ['yahooo.com', 'yahoo.com'], ['yahoo.co', 'yahoo.com'], ['yahoo.con', 'yahoo.com'],
  ['yhoo.com', 'yahoo.com'], ['yaoo.com', 'yahoo.com'],
  ['iclod.com', 'icloud.com'], ['icloud.co', 'icloud.com'], ['icoud.com', 'icloud.com'], ['iclould.com', 'icloud.com'],
  ['live.con', 'live.com'], ['live.co', 'live.com'], ['sympatico.con', 'sympatico.ca'], ['rogers.con', 'rogers.com'],
  ['shaw.cam', 'shaw.ca'], ['bell.con', 'bell.net'],
]);

/** A message for the person if the address is unusable, else null. Sync, no network. */
export function emailProblem(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!emailSyntaxOk(s) || /[\r\n,;<>\s]/.test(s)) return BAD;
  const domain = s.slice(s.lastIndexOf('@') + 1);
  const fix = TYPOS.get(domain);
  if (fix) return `Did you mean ${s.slice(0, s.lastIndexOf('@'))}@${fix}?`;
  if (DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`))) return 'Please use a real email address, not a temporary one.';
  return null;
}

// ── domain can receive mail ───────────────────────────────────────────────────
const CACHE = new Map(); // domain -> { ok, until }
const TTL_OK = 6 * 3_600_000;
const TTL_BAD = 10 * 60_000;
const TIMEOUT_MS = 3_000;

let resolver = { resolveMx: dns.resolveMx, resolve4: dns.resolve4, resolve6: dns.resolve6 };
/** Tests swap the resolver; pass null to restore the system one. */
export function setResolverForTests(r) {
  CACHE.clear();
  resolver = r ?? { resolveMx: dns.resolveMx, resolve4: dns.resolve4, resolve6: dns.resolve6 };
}

const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS).unref())]);
const NO_ANSWER = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** true: can receive mail; false: the domain does not exist or has no mail route; null: could not tell. */
async function domainReceivesMail(domain) {
  const hit = CACHE.get(domain);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = null;
  try {
    const mx = await withTimeout(resolver.resolveMx(domain));
    // A "null MX" (a single "." exchange) says the domain accepts no mail.
    ok = mx.some((r) => r.exchange && r.exchange !== '.');
    if (!ok && mx.length === 0) throw Object.assign(new Error('no mx'), { code: 'ENODATA' });
  } catch (e) {
    if (NO_ANSWER.has(e?.code)) {
      // No MX: mail can still go to the domain's own address (A/AAAA).
      try {
        const a = await withTimeout(resolver.resolve4(domain));
        ok = a.length > 0;
      } catch (e4) {
        if (NO_ANSWER.has(e4?.code)) {
          try {
            ok = (await withTimeout(resolver.resolve6(domain))).length > 0;
          } catch (e6) {
            ok = NO_ANSWER.has(e6?.code) ? false : null;
          }
        } else ok = null;
      }
    } else ok = null; // timeout, SERVFAIL, no network: do not block anyone
  }
  if (ok !== null) CACHE.set(domain, { ok, until: Date.now() + (ok ? TTL_OK : TTL_BAD) });
  return ok;
}

/** Async: a message if the address's domain cannot receive mail, else null. Switch off with BLUMODEL_EMAIL_DNS_CHECK=off. */
export async function emailDomainProblem(raw) {
  if (process.env.BLUMODEL_EMAIL_DNS_CHECK === 'off') return null;
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!emailSyntaxOk(s)) return BAD;
  const domain = s.slice(s.lastIndexOf('@') + 1);
  return (await domainReceivesMail(domain)) === false ? `We can’t find a mail server for “${domain}”. Check the spelling after the @.` : null;
}
