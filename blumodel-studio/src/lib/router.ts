import { useEffect, useMemo, useState } from 'react';

/**
 * Hash routing with query strings inside the hash (`#/p/range-30?finish=black-steel`).
 * `location.search` is only read through `pageQuery()` (Stripe's `?session_id=` return).
 */
export type AdminTab = 'overview' | 'moderation' | 'brands' | 'studio' | 'revenue' | 'billing' | 'users';
export const ADMIN_TABS: AdminTab[] = ['overview', 'moderation', 'brands', 'studio', 'revenue', 'billing', 'users'];

export type Route =
  | { name: 'signin' }
  | { name: 'signup' }
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'local' }
  | { name: 'kitchen'; id: string; add?: string } // #/k/:uuid?add=
  | { name: 'welcome' }
  | { name: 'pricing' } // #/welcome, #/pricing
  | { name: 'generate'; q?: string; from?: string } // #/generate?q=&from=
  | { name: 'product'; id: string; finish?: string } // #/p/:id?finish=
  | { name: 'brandPage'; slug: string } // #/b/:slug
  | { name: 'brand'; rest: string } // #/brand, #/brand/<rest…>
  | { name: 'orders'; rest: string } // #/orders, #/orders/<rest…>
  | { name: 'payDemo'; orderId: string } // #/pay/demo/:orderId
  | { name: 'share'; token: string } // #/s/:token
  | { name: 'admin'; tab: AdminTab } // #/admin/:tab
  | { name: 'billing' } // #/account/billing
  | { name: 'pro'; rest: string } // #/pro, #/pro/<rest…> (the Contractor workspace)
  | { name: 'payDemoPlan'; ref: string }; // #/pay/demo-plan/:ref

const UUID = /^[0-9a-f-]{36}$/;
/** Product ids, slugs, order ids and share tokens: the server's `:param` alphabet. */
const PARAM = /^[A-Za-z0-9_-]{1,80}$/;
/** Free sub-paths for the brand portal and orders: a few `/`-separated params. */
const REST = /^[A-Za-z0-9_-]{1,80}(\/[A-Za-z0-9_-]{1,80}){0,5}$/;

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Splits `#/path?query` into its path (no leading `#/` or trailing `/`) and query. */
export function splitHash(hash: string): { path: string; query: URLSearchParams } {
  const h = hash.replace(/^#\/?/, '');
  const q = h.indexOf('?');
  const path = (q < 0 ? h : h.slice(0, q)).replace(/\/+$/, '');
  return { path, query: new URLSearchParams(q < 0 ? '' : h.slice(q + 1)) };
}

const opt = (v: string | null) => (v ? v : undefined);

export function parseRoute(hash: string): Route {
  const { path, query } = splitHash(hash);
  const parts = path.split('/').map((p) => decode(p));
  if (parts.some((p) => p === null)) return { name: 'home' };
  const seg = parts as string[];
  const [a, b, c] = seg;

  switch (a) {
    case '':
      return { name: 'home' };
    case 'signin':
    case 'signup':
    case 'new':
    case 'local':
    case 'welcome':
    case 'pricing':
      return seg.length === 1 ? { name: a } : { name: 'home' };
    case 'generate': {
      if (seg.length !== 1) break;
      const q = opt(query.get('q'));
      const from = opt(query.get('from'));
      return { name: 'generate', ...(q ? { q } : {}), ...(from ? { from } : {}) };
    }
    case 'k':
      if (seg.length === 2 && UUID.test(b)) {
        const add = query.get('add');
        return add && PARAM.test(add) ? { name: 'kitchen', id: b, add } : { name: 'kitchen', id: b };
      }
      break;
    case 'p':
      if (seg.length === 2 && PARAM.test(b)) {
        const finish = query.get('finish');
        return finish ? { name: 'product', id: b, finish } : { name: 'product', id: b };
      }
      break;
    case 'b':
      if (seg.length === 2 && PARAM.test(b)) return { name: 'brandPage', slug: b };
      break;
    case 'brand':
    case 'orders':
    case 'pro': {
      const rest = seg.slice(1).join('/');
      if (!rest || REST.test(rest)) return { name: a, rest };
      break;
    }
    case 'account':
      if (seg.length === 2 && b === 'billing') return { name: 'billing' };
      break;
    case 'pay':
      if (seg.length === 3 && b === 'demo' && PARAM.test(c)) return { name: 'payDemo', orderId: c };
      if (seg.length === 3 && b === 'demo-plan' && PARAM.test(c)) return { name: 'payDemoPlan', ref: c };
      break;
    case 's':
      if (seg.length === 2 && PARAM.test(b)) return { name: 'share', token: b };
      break;
    case 'admin': {
      if (seg.length === 1) return { name: 'admin', tab: 'overview' };
      if (seg.length === 2 && (ADMIN_TABS as string[]).includes(b)) return { name: 'admin', tab: b as AdminTab };
      break;
    }
  }
  return { name: 'home' };
}

function withQuery(path: string, q: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

const enc = encodeURIComponent;

export function hrefFor(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'kitchen':
      return withQuery(`#/k/${r.id}`, { add: r.add });
    case 'generate':
      return withQuery('#/generate', { q: r.q, from: r.from });
    case 'product':
      return withQuery(`#/p/${enc(r.id)}`, { finish: r.finish });
    case 'brandPage':
      return `#/b/${enc(r.slug)}`;
    case 'brand':
    case 'orders':
    case 'pro':
      return r.rest ? `#/${r.name}/${r.rest}` : `#/${r.name}`;
    case 'billing':
      return '#/account/billing';
    case 'payDemo':
      return `#/pay/demo/${enc(r.orderId)}`;
    case 'payDemoPlan':
      return `#/pay/demo-plan/${enc(r.ref)}`;
    case 'share':
      return `#/s/${enc(r.token)}`;
    case 'admin':
      return `#/admin/${r.tab}`;
    default:
      return `#/${r.name}`;
  }
}

/** Navigates to a raw hash (`#/…`), e.g. a route plus extra query parameters a package owns. */
export function navigateHash(href: string, replace = false) {
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function navigate(r: Route, replace = false) {
  navigateHash(hrefFor(r), replace);
}

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  return hash;
}

export function useRoute(): Route {
  const hash = useHash();
  // Parsed once per hash, so an unrelated re-render keeps the same route object.
  return useMemo(() => parseRoute(hash), [hash]);
}

/** The query string inside the hash (`#/orders/new?ref=…`), live as the hash changes. */
export function useHashQuery(): URLSearchParams {
  const hash = useHash();
  return useMemo(() => splitHash(hash).query, [hash]);
}

/** Where to go after signing in: the `next` hash the sign-in page was sent with, if it is one of ours. */
export function safeNext(query: URLSearchParams): string {
  const next = query.get('next');
  if (!next || !next.startsWith('#/')) return '#/';
  const r = parseRoute(next);
  return r.name === 'signin' || r.name === 'signup' ? '#/' : next;
}

/** The sign-in page, remembering the current hash so the user comes back to it. */
export function signinHref(from: string = location.hash): string {
  const r = parseRoute(from);
  if (r.name === 'home' || r.name === 'signin' || r.name === 'signup') return '#/signin';
  return `#/signin?next=${encodeURIComponent(from)}`;
}

/** The page's real query string (`?session_id=…` from a Stripe return), not the hash's. */
export function pageQuery(): URLSearchParams {
  return new URLSearchParams(location.search);
}
