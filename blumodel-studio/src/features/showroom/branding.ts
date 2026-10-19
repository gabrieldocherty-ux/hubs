import { useConfig } from '../../lib/config';
import { brandCss, brandTokens } from './palette';
import { shortName, type PublicTenant } from './site';

/**
 * Puts a company's identity on the page once the config says this is its showroom: its colours
 * as theme tokens (palette.ts), the tab title, the description and share-card metas, and its logo
 * as the tab icon. On the sales site it does nothing, so the page keeps index.html's own.
 */

const STYLE_ID = 'showroom-brand';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setIcon(href: string) {
  for (const el of document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')) el.remove();
  for (const rel of ['icon', 'apple-touch-icon']) {
    const l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    document.head.appendChild(l);
  }
}

/** The page's base title on this site: the company's name on a showroom. */
export function siteName(): string {
  const t = useConfig.getState().config?.tenant;
  return t ? shortName(t) : 'BluModel Studio';
}

/** "Product · Northline Kitchen & Bath" on a showroom, "Product · BluModel Studio" elsewhere. */
export function pageTitle(part?: string): string {
  return part ? `${part} · ${siteName()}` : siteName();
}

/** One sentence for the description and share cards. */
export function showroomDescription(t: PublicTenant): string {
  const name = shortName(t);
  const base = `Design your kitchen${t.features.bathrooms ? ' or bathroom' : ''} in 3D with ${name}'s own products, then send it to ${name} for a quote.`;
  return t.contact.serviceArea ? `${base} Serving ${t.contact.serviceArea}.` : base;
}

let applied: string | null = null;

/** Applies (or re-applies, when it changed) the showroom's branding. Safe to call on every config change. */
export function applyShowroomBranding(t: PublicTenant | null) {
  if (typeof document === 'undefined' || !t) return;
  const key = JSON.stringify([t.id, t.name, t.branding.primaryColor, t.branding.accentColor, t.branding.logoUrl, t.features.bathrooms, t.contact.serviceArea]);
  if (applied === key) return;
  applied = key;
  const root = document.documentElement;
  root.setAttribute('data-site', 'showroom');

  const tokens = brandTokens(t.branding.primaryColor, t.branding.accentColor);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (tokens) {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = brandCss(tokens);
  } else style?.remove();

  const name = shortName(t);
  const title = `${name} · Design your ${t.features.bathrooms ? 'kitchen or bathroom' : 'kitchen'} in 3D`;
  const description = showroomDescription(t);
  document.title = title;
  setMeta('name', 'description', description);
  setMeta('name', 'application-name', name);
  setMeta('name', 'apple-mobile-web-app-title', name.slice(0, 30));
  setMeta('property', 'og:site_name', name);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  if (t.url) {
    setMeta('property', 'og:url', `${t.url}/`);
    document.head.querySelector('link[rel="canonical"]')?.setAttribute('href', `${t.url}/`);
  }
  // Our own hero picture is not the company's: no share image rather than the wrong one.
  for (const k of ['og:image', 'og:image:alt']) document.head.querySelector(`meta[property="${k}"]`)?.remove();
  document.head.querySelector('meta[name="twitter:image"]')?.remove();
  document.head.querySelector('link[rel="manifest"]')?.remove();
  if (t.branding.logoUrl) setIcon(t.branding.logoUrl);
}
