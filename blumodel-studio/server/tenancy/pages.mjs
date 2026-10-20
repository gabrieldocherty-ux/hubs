// The two pages the server answers itself instead of the app (docs/SHOWROOM_PIVOT.md §4):
//   404  no showroom at this address (an unknown host)
//   503  this showroom is temporarily unavailable (lapsed or suspended; nothing is deleted)
// API requests get JSON instead: { error, code: 'unknown_host' | 'showroom_unavailable', status? }.
//
// Self-contained (no script, no external asset), so it obeys the CSP and works with no build. The
// colours are tokens on :root, redefined for dark mode.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page({ title, heading, body, accent }) {
  const a = /^#[0-9a-f]{6}$/i.test(accent ?? '') ? accent : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>${esc(title)}</title>
<style>
:root { --bg: #f6f5f2; --card: #ffffff; --ink: #1d2328; --muted: #5b6670; --line: #e2e0da; --accent: ${a ?? '#1f4f8a'}; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #14181c; --card: #1c2228; --ink: #eef1f4; --muted: #a7b0b8; --line: #2c343c; --accent: ${a ?? '#7fb0ec'}; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 34rem; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 32px 28px; }
h1 { margin: 0 0 12px; font-size: 1.5rem; line-height: 1.25; }
p { margin: 0 0 12px; color: var(--muted); }
.bar { width: 48px; height: 4px; border-radius: 2px; background: var(--accent); margin-bottom: 20px; }
</style>
</head>
<body><main><div class="bar"></div><h1>${esc(heading)}</h1>${body}</main></body>
</html>`;
}

/** 404 for a host no showroom answers to. */
export function unknownHostPage(hostname) {
  return page({
    title: 'No showroom here',
    heading: 'There’s no showroom at this address',
    body: `<p>${esc(hostname || 'This address')} isn’t connected to a showroom. Check the address, or contact the company that sent you the link.</p>`,
  });
}

/** 503 for a lapsed or suspended showroom. Says nothing about why: that is between us and the company. */
export function unavailablePage(tenant) {
  const name = tenant?.name || 'This showroom';
  const c = tenant?.contact || {};
  const reach = [c.phone && `call ${esc(c.phone)}`, c.email && `email ${esc(c.email)}`].filter(Boolean);
  return page({
    title: `${name} · temporarily unavailable`,
    heading: `${name}’s online showroom is temporarily unavailable`,
    body: `<p>Please check back soon. Your saved designs are safe.</p>${reach.length ? `<p>To reach ${esc(name)} in the meantime, ${reach.join(' or ')}.</p>` : ''}`,
    accent: tenant?.branding?.primaryColor,
  });
}

/**
 * The app's index.html as a showroom serves it: the head says the company, not our sales pitch, so
 * a link to <company>.blumodel.studio pasted into a chat or a social post previews the company
 * (link previewers don't run the app's script). Mirrors src/features/showroom/branding.ts:
 * title, description, og/twitter title and description, site name, og:url and the canonical link
 * from the tenant (escaped); our own share image and its alt text are dropped (a company's logo is
 * not a 1200x630 card) and the logo, when it has one, becomes og:image.
 * @param {string} html  the built index.html
 * @param {{ name: string, settings?: any, contact?: any }} t  the tenant
 * @param {{ origin: string, logoUrl?: string | null }} o
 */
export function showroomIndexHtml(html, t, { origin, logoUrl = null, images = null }) {
  const name = String(t.name).replace(/\s*\((demo|sample)\)\s*$/i, '').trim() || String(t.name);
  const bath = !!t.settings?.bathrooms;
  const title = `${name} · Design your ${bath ? 'kitchen or bathroom' : 'kitchen'} in 3D`;
  const area = String(t.contact?.serviceArea ?? '').trim();
  const description = `Design your kitchen${bath ? ' or bathroom' : ''} in 3D with ${name}'s own products, then send it to ${name} for a quote.${area ? ` Serving ${area}.` : ''}`;
  const url = `${origin}/`;
  const meta = (attr, key, value) => (h) => h.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`), (_m, a, b) => `${a}${esc(value)}${b}`);
  const drop = (re) => (h) => h.replace(re, '');
  const steps = [
    (h) => h.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`),
    meta('name', 'description', description),
    meta('name', 'application-name', name),
    meta('name', 'apple-mobile-web-app-title', name.slice(0, 30)),
    meta('property', 'og:site_name', name),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    (h) => h.replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => `${a}${esc(url)}${b}`),
    drop(/\s*<meta property="og:image(?::[a-z]+)?" content="[^"]*" \/>/g),
    drop(/\s*<meta name="twitter:image(?::alt)?" content="[^"]*" \/>/g),
    // Our own structured data and the sales home page's plain-HTML text are about BluModel Studio, not the company.
    drop(/\s*<!-- Who we are, for search engines[^>]*-->\s*<script type="application\/ld\+json" data-sales-only>[\s\S]*?<\/script>/),
    drop(/\s*<!-- The sales home page in plain HTML[^>]*-->/),
    (h) => h.replace(/<div id="root"><main class="prerender" data-sales-only[\s\S]*?<\/main><\/div>/, '<div id="root"></div>'),
    (h) => h.replace(/<meta name="twitter:card" content="summary_large_image" \/>/, '<meta name="twitter:card" content="summary" />'),
  ];
  let out = steps.reduce((h, f) => f(h), html);
  // The landing page's hero picture (server/tenancy/images.mjs) is the link preview's picture. It is
  // not preloaded here: every page of the showroom is this one document (the route is in the hash),
  // so a preload would fetch it for the editor and shared designs too. The landing page asks for it
  // first instead (fetchpriority high, never lazy).
  const hero = typeof images?.hero?.url === 'string' && images.hero.url.startsWith('/') ? images.hero : null;
  if (hero) {
    out = out.replace(
      /(<meta property="og:url" content="[^"]*" \/>)/,
      `$1\n    <meta property="og:image" content="${esc(origin + hero.url)}" />\n    <meta property="og:image:width" content="${Number(hero.w) || 0}" />\n    <meta property="og:image:height" content="${Number(hero.h) || 0}" />`,
    );
    out = out.replace('<meta name="twitter:card" content="summary" />', '<meta name="twitter:card" content="summary_large_image" />');
  } else if (logoUrl) {
    const abs = /^https:\/\//.test(logoUrl) ? logoUrl : logoUrl.startsWith('/') ? `${origin}${logoUrl}` : null;
    if (abs) out = out.replace(/(<meta property="og:url" content="[^"]*" \/>)/, `$1
    <meta property="og:image" content="${esc(abs)}" />`);
  }
  return out;
}
