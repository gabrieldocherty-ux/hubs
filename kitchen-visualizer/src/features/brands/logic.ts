/**
 * Pure helpers for the brand page (no React, no DOM): redirects from the old portal, price labels,
 * status words, grouping by line, the lead e-mail link and the chart scale. Unit-tested in
 * `__tests__/logic.test.ts`.
 */
import { money } from '../../lib/format';
import type { PageStatus, PriceDisplay, LeadStatus } from './api';

/**
 * The old brand portal (`#/brand`, `#/brand/<rest>`) lives inside the Contractor workspace now.
 * Returns the `#/pro/<rest>` sub-path to send people to; the workspace shows the Contractor plan
 * pitch to anyone who isn't a contractor (BRAND_PAGE §2).
 */
export function portalRedirect(rest: string): string {
  const [head] = rest.split('/');
  switch (head) {
    case 'products':
      return 'brand/products';
    case 'leads':
      return 'brand/leads';
    case 'profile':
    case 'settings':
    case 'members':
    case 'join':
      return 'brand/settings';
    default:
      return 'brand';
  }
}

/** A "Demo" tag only where the name doesn't already say so ("Alder & Pine Cabinetry (Demo)"). */
export const needsDemoTag = (b: { name: string; isDemo?: boolean }): boolean => !!b.isDemo && !/\(demo\)/i.test(b.name);

/** The Brand page tab's sub-pages (`#/pro/brand/<sub>`). */
export type BrandSub = 'overview' | 'products' | 'leads' | 'settings';
export const BRAND_SUBS: [BrandSub, string][] = [
  ['overview', 'Overview'],
  ['products', 'Products'],
  ['leads', 'Leads'],
  ['settings', 'Settings'],
];

export function brandSubOf(rest: string): BrandSub {
  const sub = rest.split('/')[1] ?? '';
  return (BRAND_SUBS.map(([k]) => k) as string[]).includes(sub) ? (sub as BrandSub) : 'overview';
}

export const subHref = (sub: BrandSub) => (sub === 'overview' ? '#/pro/brand' : `#/pro/brand/${sub}`);

/** The word for a page's state, as the contractor and admins see it. */
export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  none: 'Not set up',
  draft: 'Not submitted',
  in_review: 'In review',
  live: 'Live',
  rejected: 'Changes requested',
  hidden: 'Hidden: plan lapsed',
  suspended: 'Suspended',
};

export const PAGE_STATUS_TONE: Record<PageStatus, '' | 'ok' | 'warn' | 'bad'> = {
  none: '',
  draft: '',
  in_review: 'warn',
  live: 'ok',
  rejected: 'bad',
  hidden: 'warn',
  suspended: 'bad',
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' };
export const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'won', 'lost'];

export const PRICE_DISPLAY_LABEL: Record<PriceDisplay, string> = {
  from: 'From $X',
  show: 'Show prices',
  on_request: 'Price on request',
};

/** What a public product card says about price. Cost and margin never reach the client at all. */
export function priceLabel(p: { price: number; priceByWidth?: Record<string, number>; priceDisplay?: PriceDisplay }): string {
  const display = p.priceDisplay ?? 'show';
  if (display === 'on_request' || !(p.price > 0)) return 'Price on request';
  if (display === 'from') return `From ${money(p.price)}`;
  const all = [p.price, ...Object.values(p.priceByWidth ?? {})].filter((n) => n > 0);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
}

/** Groups items by product line, in first-seen order; items without a line come last. */
export function groupByLine<T extends { line?: string | null }>(items: T[], noLine = 'Other products'): { line: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = (it.line ?? '').trim();
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  const out = [...map].map(([line, list]) => ({ line, label: line || noLine, items: list }));
  return [...out.filter((g) => g.line), ...out.filter((g) => !g.line)];
}

/** The lead's one-tap e-mail: a subject naming the product (or the page). */
export function leadMailto(lead: { email: string; productName: string; name: string }, company: string): string {
  const about = lead.productName ? `your request about ${lead.productName}` : 'your request';
  const subject = `${company}: ${about}`;
  const body = `Hi ${lead.name.split(/\s+/)[0] || 'there'},\n\nThanks for getting in touch through Mise.\n\n`;
  return `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** `tel:` keeps only what a dialler understands. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

/** A "nice" axis maximum for a bar chart: 1, 2, 5 × 10^n, at least 4. */
export function niceMax(n: number): number {
  if (!(n > 4)) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/** "2026-10-07" → "Oct 7" (UTC, like the server's days). */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The public page address a slug gives. */
export const pageHash = (slug: string) => `#/b/${slug}`;

/** Same rule as the server: 2–60 lowercase letters, digits and dashes, no dash at either end. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])$/;
export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'brand'
  );
}

/** Where one product stands on the page, in words, with a tag tone. */
export function listingStatus(
  listing: { status: string; hasLive: boolean; live: boolean } | null,
  pageStatus: PageStatus,
): { label: string; tone: '' | 'ok' | 'warn' | 'bad'; on: boolean } {
  if (!listing || listing.status === 'archived' || listing.status === 'draft') return { label: 'Not on your page', tone: '', on: false };
  const pageLive = pageStatus === 'live';
  if (listing.status === 'submitted') return listing.hasLive ? { label: pageLive ? 'Live · edit in review' : 'Edit in review', tone: 'warn', on: true } : { label: 'In review', tone: 'warn', on: true };
  if (listing.status === 'rejected') return listing.hasLive ? { label: 'Live · edit rejected', tone: 'bad', on: true } : { label: 'Changes requested', tone: 'bad', on: false };
  if (listing.status === 'published') {
    if (listing.live) return { label: 'Live', tone: 'ok', on: true };
    return { label: pageStatus === 'hidden' ? 'Approved · hidden while lapsed' : 'Approved · shows when your page is live', tone: 'warn', on: true };
  }
  return { label: listing.status, tone: '', on: false };
}
