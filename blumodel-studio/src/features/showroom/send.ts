/**
 * "Send this design to <Company>" (docs/SHOWROOM_PIVOT.md §5): the visitor's details, checked the
 * way the server checks them (server/tenancy/leads.mjs, POST /api/leads), so a mistake shows on
 * the field before anything is sent. Pure, so it is tested without a page.
 */

import { normalizePhone } from '../../lib/phone';

export interface LeadDraft {
  name: string;
  email: string;
  phone: string;
  postalCode: string;
  budget: string;
  timeline: string;
  notes: string;
  consent: boolean;
}

export type LeadField = keyof LeadDraft;
export type LeadErrors = Partial<Record<LeadField, string>>;

export const EMPTY_LEAD: LeadDraft = { name: '', email: '', phone: '', postalCode: '', budget: '', timeline: '', notes: '', consent: false };

/** Optional answers; the server keeps each as written (60 characters at most). */
export const BUDGETS = ['Under $15,000', '$15,000 - $25,000', '$25,000 - $40,000', '$40,000 - $60,000', 'Over $60,000', 'Not sure yet'] as const;
export const TIMELINES = ['As soon as possible', '1-3 months', '3-6 months', '6-12 months', 'Just looking'] as const;

/** The same address check as the server's EMAIL_RE (server/auth/userWire.mjs), plus its no-separators rule. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL = /^[A-Z0-9][A-Z0-9 -]{2,10}$/;

const one = (v: string, max: number) => v.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The words next to the consent box. The server stores its own copy of the same sentence with the
 * lead (consentText in server/tenancy/leads.mjs); a test keeps the two identical.
 */
export const consentText = (company: string) => `I agree that ${company} may contact me about this design, and that BluModel Studio stores my details for them.`;

/** Field errors, worded like the server's; empty when the draft can be sent. */
export function checkLead(d: LeadDraft, company: string): LeadErrors {
  const e: LeadErrors = {};
  const email = one(d.email, 254).toLowerCase();
  const phone = normalizePhone(d.phone);
  const postal = one(d.postalCode, 12).toUpperCase();
  if (!one(d.name, 100)) e.name = 'Tell us your name.';
  if (email && (!EMAIL.test(email) || /[\r\n,;<>]/.test(email))) e.email = 'That email address doesn’t look right.';
  if (!phone.ok) e.phone = phone.reason;
  // Email or phone, at least one (the same rule as "Before you start").
  if (!email && phone.ok && !phone.value) e.email = `Give an email or a phone number so ${company} can reach you.`;
  if (postal && !POSTAL.test(postal)) e.postalCode = 'That postal code doesn’t look right.';
  if (!d.consent) e.consent = `Tick the box so ${company} can contact you.`;
  return e;
}

/** What POST /api/leads takes, trimmed like the server trims it. `website` is the honeypot, always empty from a person. */
export function leadBody(d: LeadDraft, design: { projectId: string } | { shareToken: string } | null) {
  return {
    name: one(d.name, 100),
    email: one(d.email, 254).toLowerCase(),
    phone: one(d.phone, 40),
    postalCode: one(d.postalCode, 12).toUpperCase(),
    budget: one(d.budget, 60),
    timeline: one(d.timeline, 60),
    notes: d.notes.replace(/\r\n?/g, '\n').trim().slice(0, 2000),
    consent: true as const,
    ...(design ?? {}),
    website: '',
  };
}

/** The server's field errors (`{ errors: [{ field, message }] }` on a 400) as a map, for the fields this form has. */
export function serverErrors(body: unknown): LeadErrors {
  const list = (body as { errors?: { field?: unknown; message?: unknown }[] } | null)?.errors;
  const out: LeadErrors = {};
  if (!Array.isArray(list)) return out;
  for (const x of list) {
    if (typeof x?.field === 'string' && typeof x.message === 'string' && x.field in EMPTY_LEAD) out[x.field as LeadField] = x.message;
  }
  return out;
}

/** A download's success toast in the editor ("Floor plan saved as PNG.", "Product list saved…"): when the Send card appears under it. */
export function isDownloadToast(text: string, tone: string): boolean {
  return tone === 'ok' && /\b(saved as (PNG|CSV)|Studio render saved|Product list saved)\b/i.test(text);
}

// ── remembered on this device: which designs were already sent ─────────────

const SENT = 'blumodel.sentDesigns';

/** When this design was last sent to the company from this browser (ms), or null. */
export function sentAt(key: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(SENT) ?? '{}') as Record<string, number>;
    return typeof all[key] === 'number' ? all[key] : null;
  } catch {
    return null;
  }
}

export function rememberSent(key: string, at = Date.now()) {
  try {
    const all = JSON.parse(localStorage.getItem(SENT) ?? '{}') as Record<string, number>;
    all[key] = at;
    // Keep the 50 most recent.
    const kept = Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 50));
    localStorage.setItem(SENT, JSON.stringify(kept));
  } catch {
    // Storage blocked: the card just won't say it was sent.
  }
}
