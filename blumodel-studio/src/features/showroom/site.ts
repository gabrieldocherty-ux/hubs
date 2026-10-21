import { cleanHex } from './palette';

/**
 * Which site this page is (docs/handoff/tenancy.md §2): our sales site, or a company's showroom.
 * The server says so in `GET /api/config` (`site`, `tenant`, `baseDomain`), from the request's
 * Host header; the client never decides it from the address itself, except to show a neutral
 * "loading" rather than our own brand while that answer is on its way (`looksLikeShowroomHost`).
 */

export type SiteKind = 'sales' | 'showroom';
export type TenantStatus = 'setup' | 'trial' | 'live' | 'lapsed' | 'suspended';

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

/** One of the showroom's pictures, made at its final size (width and height so nothing shifts). */
export interface ShowroomPic {
  url: string;
  w: number;
  h: number;
  /** A render from the app's own 3D renderer, or the company's own photo (a photo wins). */
  source: 'render' | 'photo';
}

/** The showroom's pictures (server/tenancy/images.mjs `publicImages`). Every part may be missing. */
export interface ShowroomImages {
  hero: ShowroomPic | null;
  /** A portrait render for phones; null when the hero is a photo (the photo is cropped instead). */
  heroTall: ShowroomPic | null;
  /** By line key (brandKey of the line's name). */
  lines: Record<string, ShowroomPic & { line: string }>;
  /** `design`: a view-only link token to open that kitchen in 3D (#/s/token), when there is one. */
  gallery: (ShowroomPic & { title: string; design: string | null })[];
  /** Dream kitchens (the advert): a finished design to look around (#/s/token) or start from (#/new?from=token). */
  dreams: (ShowroomPic & { title: string; design: string | null })[];
  /** When the renders were last made (ms), or null. */
  renderedAt?: number | null;
}

export const NO_IMAGES: ShowroomImages = Object.freeze({ hero: null, heroTall: null, lines: {}, gallery: [], dreams: [] }) as ShowroomImages;

function pic(v: unknown): ShowroomPic | null {
  const o = (v ?? null) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const url = safeImageUrl(o.url);
  const w = Number(o.w);
  const h = Number(o.h);
  if (!url || !(w > 0 && w <= 8192 && h > 0 && h <= 8192)) return null;
  return { url, w: Math.round(w), h: Math.round(h), source: o.source === 'photo' ? 'photo' : 'render' };
}

/** The server's images, checked: an unusable picture is left out. */
export function normalizeImages(raw: unknown): ShowroomImages {
  const o = (raw ?? null) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return NO_IMAGES;
  const lines: ShowroomImages['lines'] = {};
  if (o.lines && typeof o.lines === 'object') {
    for (const [k, v] of Object.entries(o.lines as Record<string, unknown>).slice(0, 40)) {
      const p = pic(v);
      if (p) lines[k] = { ...p, line: str((v as Record<string, unknown>).line, 80) || k };
    }
  }
  const titled = (list: unknown, max: number) =>
    Array.isArray(list)
      ? list
          .slice(0, max)
          .map((g) => {
            const p = pic(g);
            const d = (g as Record<string, unknown>).design;
            return p ? { ...p, title: str((g as Record<string, unknown>).title, 100), design: typeof d === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(d) ? d : null } : null;
          })
          .filter((g): g is ShowroomPic & { title: string; design: string | null } => !!g)
      : [];
  return { hero: pic(o.hero), heroTall: pic(o.heroTall), lines, gallery: titled(o.gallery, 6), dreams: titled(o.dreams, 2), renderedAt: typeof o.renderedAt === 'number' ? o.renderedAt : null };
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
  features: { fillGaps: boolean; bathrooms: boolean; visitorRenders: boolean; visitorEstimate: boolean };
  images: ShowroomImages;
}

const STATUSES: readonly TenantStatus[] = ['setup', 'trial', 'live', 'lapsed', 'suspended'];
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
    features: { fillGaps: f.fillGaps === true, bathrooms: f.bathrooms === true, visitorRenders: f.visitorRenders === true, visitorEstimate: f.visitorEstimate === true },
    images: normalizeImages(t.images),
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
