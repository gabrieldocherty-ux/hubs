import { cleanHex } from './palette';

/**
 * Which site this page is (docs/handoff/tenancy.md §2): our sales site, or a company's showroom.
 * The server says so in `GET /api/config` (`site`, `tenant`, `baseDomain`), from the request's
 * Host header; the client never decides it from the address itself, except to show a neutral
 * "loading" rather than our own brand while that answer is on its way (`looksLikeShowroomHost`).
 */

export type SiteKind = 'sales' | 'showroom';
export type TenantStatus = 'setup' | 'live' | 'lapsed' | 'suspended';

export interface TenantBranding {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  welcomeTitle: string;
  welcomeText: string;
  featuredLines: string[];
}

export interface TenantContact {
  phone: string;
  email: string;
  website: string;
  address: string;
  serviceArea: string;
  hours: string;
}

export interface PublicTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  isDemo: boolean;
  url: string;
  branding: TenantBranding;
  contact: TenantContact;
  features: { fillGaps: boolean; bathrooms: boolean; visitorRenders: boolean };
}

const STATUSES: readonly TenantStatus[] = ['setup', 'live', 'lapsed', 'suspended'];
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A logo address we may put in an <img>: our own files (a path on this origin) or an https URL. */
export function safeImageUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^\/(?!\/)[^\s"'<>\\]*$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(s)) return s;
  return null;
}

/** A website a visitor may open: http(s) only. */
export function safeWebsite(v: unknown): string {
  const s = str(v, 300);
  return /^https?:\/\/[^\s"'<>\\]+$/i.test(s) ? s : '';
}

/** The server's PublicTenant, checked field by field: a value we can't use is treated as not set. */
export function normalizeTenant(raw: unknown): PublicTenant | null {
  const t = (raw ?? null) as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') return null;
  const id = str(t.id, 80);
  const slug = str(t.slug, 80);
  const name = str(t.name, 120);
  if (!id || !slug || !name) return null;
  const b = (t.branding ?? {}) as Record<string, unknown>;
  const c = (t.contact ?? {}) as Record<string, unknown>;
  const f = (t.features ?? {}) as Record<string, unknown>;
  const email = str(c.email, 200);
  const url = typeof t.url === 'string' && /^https?:\/\/[^\s"'<>\\]+$/.test(t.url) ? t.url.replace(/\/+$/, '') : '';
  return {
    id,
    slug,
    name,
    status: STATUSES.includes(t.status as TenantStatus) ? (t.status as TenantStatus) : 'live',
    isDemo: t.isDemo === true,
    url,
    branding: {
      logoUrl: safeImageUrl(b.logoUrl),
      primaryColor: cleanHex(b.primaryColor),
      accentColor: cleanHex(b.accentColor),
      welcomeTitle: str(b.welcomeTitle, 160),
      welcomeText: typeof b.welcomeText === 'string' ? b.welcomeText.trim().slice(0, 1200) : '',
      featuredLines: Array.isArray(b.featuredLines) ? b.featuredLines.map((x) => str(x, 80)).filter(Boolean).slice(0, 8) : [],
    },
    contact: {
      phone: str(c.phone, 40),
      email: EMAIL.test(email) ? email : '',
      website: safeWebsite(c.website),
      address: str(c.address, 200),
      serviceArea: str(c.serviceArea, 200),
      hours: str(c.hours, 120),
    },
    features: { fillGaps: f.fillGaps === true, bathrooms: f.bathrooms === true, visitorRenders: f.visitorRenders === true },
  };
}

/**
 * True when the address is `<slug>.<base>` (base: the server's BASE_DOMAIN, `blumodel.studio` or
 * `localhost`) or any other name that isn't ours: what a showroom looks like before the config
 * has answered. Only used to avoid flashing our own brand; never to decide anything.
 */
export function looksLikeShowroomHost(hostname: string, baseDomain = 'blumodel.studio'): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h === 'localhost' || h === baseDomain || h === `www.${baseDomain}` || /^[\d.]+$/.test(h) || h.includes(':')) return false;
  if (h.endsWith('.localhost')) return true;
  return h !== 'blumodel.studio' && h !== 'www.blumodel.studio';
}

/** "Northline Kitchen & Bath" from "Northline Kitchen & Bath (Demo)": the name a visitor reads in sentences. */
export function shortName(t: Pick<PublicTenant, 'name'>): string {
  return t.name.replace(/\s*\((demo|sample)\)\s*$/i, '').trim() || t.name;
}

/** `tel:` digits for a phone number as typed ("(519) 555-0142" → "+15195550142" stays as typed digits). */
export function telHref(phone: string): string | null {
  const d = phone.replace(/[^\d+]/g, '');
  return d.replace(/\D/g, '').length >= 7 ? `tel:${d}` : null;
}
