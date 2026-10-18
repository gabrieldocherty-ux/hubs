// Which site a request is for (docs/SHOWROOM_PIVOT.md §4). The request's host picks it:
//
//   <BASE_DOMAIN>, www.<BASE_DOMAIN>     the sales site (kind 'sales')
//   localhost, an IP address, no Host    the sales site too (the machine itself, the LAN, tests)
//   <slug>.<BASE_DOMAIN>                 that tenant's showroom (kind 'showroom')
//   a hostname in tenant_hostnames       that tenant's showroom (custom domains once verified)
//   anything else                        kind 'unknown': 404
//
// The host is the Host header, and only that. X-Forwarded-Host is never believed, not even with
// TRUST_PROXY: cloudflared passes the visitor's Host through unchanged, and Cloudflare forwards a
// client's own X-Forwarded-Host untouched, so trusting it would let anyone pick a site by sending a
// header (and the launch contract pins that no Host or X-Forwarded-Host reaches a link). Links name
// a showroom by the hostnames stored for it (services.tenants.originOf), never by the request's.

import net from 'node:net';
import { isHttps } from '../auth/sessions.mjs';

/**
 * The request's hostname, lowercased, without port, brackets or trailing dot ('' when missing).
 * @param {import('node:http').IncomingMessage} req
 * @param {any} [_config]
 */
export function requestHostname(req, _config) {
  return hostnameOf(String(req.headers.host ?? ''));
}

/** 'Demo.Localhost:8900' -> 'demo.localhost'; '[::1]:80' -> '::1'. */
export function hostnameOf(hostHeader) {
  let h = String(hostHeader ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined);
  if ((h.match(/:/g) ?? []).length > 1) return h; // a bare IPv6 address
  h = h.replace(/:\d*$/, '').replace(/\.+$/, '');
  return h;
}

/**
 * The scheme and port this request came in on, as an origin ('http://127.0.0.1:8900'). Only ever
 * passed to services.tenants.originOf(tenant, from), which takes the scheme and port from it and
 * the hostname from the database, so a dev or QA link keeps its port.
 */
export function requestOrigin(req, config) {
  const raw = String(req.headers.host ?? '');
  const port = /:(\d{1,5})$/.exec(raw)?.[1];
  return `${isHttps(req, config) ? 'https' : 'http'}://localhost${port ? `:${port}` : ''}`;
}

/**
 * @typedef {{ kind: 'sales' | 'showroom' | 'unknown', hostname: string,
 *   tenant: any | null, tenantId: string | null, available: boolean }} Site
 *   `tenant` is the TenantRecord (services.tenants) for a showroom, with its status freshly computed.
 *   `available` is false for a lapsed or suspended showroom (and an unknown host).
 */

/**
 * @param {{ tenants: any, config: any }} deps
 * @returns {{ resolve: (req: any) => Site, classify: (hostname: string) => Site }}
 */
export function createSiteResolver({ tenants, config }) {
  const base = config.BASE_DOMAIN;
  let publicHost = '';
  try {
    publicHost = new URL(config.PUBLIC_URL).hostname.toLowerCase();
  } catch {
    publicHost = '';
  }
  const sales = (hostname) => ({ kind: 'sales', hostname, tenant: null, tenantId: null, available: true });
  const unknown = (hostname) => ({ kind: 'unknown', hostname, tenant: null, tenantId: null, available: false });
  const showroom = (hostname, t) => {
    const fresh = t.status === 'live' || t.status === 'lapsed' || t.status === 'trial' ? (tenants.refresh(t.id) ?? t) : t;
    return { kind: 'showroom', hostname, tenant: fresh, tenantId: fresh.id, available: tenants.isAvailable(fresh) };
  };

  const classify = (hostname) => {
    const h = hostnameOf(hostname);
    if (!h || h === base || h === `www.${base}` || h === 'localhost' || h === publicHost || net.isIP(h)) return sales(h);
    const exact = tenants.byHostname(h);
    if (exact) return showroom(h, exact);
    if (h.endsWith(`.${base}`)) {
      const label = h.slice(0, -(base.length + 1));
      if (!label.includes('.')) {
        const t = tenants.bySlug(label);
        if (t) return showroom(h, t);
      }
    }
    return unknown(h);
  };

  return {
    classify,
    resolve: (req) => classify(requestHostname(req, config)),
  };
}
