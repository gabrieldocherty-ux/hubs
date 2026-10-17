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
