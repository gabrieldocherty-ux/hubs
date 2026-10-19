// After a deploy: does the running server answer as every kind of site (docs/SHOWROOM_PIVOT.md §4),
// and does the tunnel config send every kind of host to it? Read-only and local: requests go to
// 127.0.0.1:<port> with a chosen Host header (the server picks the site from Host alone), and
// cloudflared.yml is read as text (it holds the credentials file's PATH, never a secret). Nothing
// here opens blumodel.env, touches the tunnel or calls anything outside this machine.
// Used by scripts/deploy-local.mjs; tested in server/test/ops-sites.test.mjs.

import http from 'node:http';

/** A showroom nobody is given (the check expects a 404 for it). */
export const NO_SUCH_SHOWROOM = 'no-such-showroom-check-0';
export const DEMO_SLUG = 'demo';

/**
 * GET http://127.0.0.1:<port><path> with `Host: <host>`: `{ status, body }` (body {} when not JSON).
 * @param {number | string} port
 * @param {string} path
 * @param {string} host
 */
export const getWithHost = (port, path, host, { timeoutMs = 5000 } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: Number(port), path, agent: false, headers: { Host: host, Connection: 'close', Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });

/**
 * Asks the server, by Host, which site each address is: the base domain and www. (the sales site),
 * the demo showroom, and a showroom that can't exist (a 404). The base domain is the server's own
 * (GET /api/config on 127.0.0.1 says it), so a custom BASE_DOMAIN in blumodel.env is followed
 * without reading that file.
 * @param {{ port: number | string, get?: typeof getWithHost }} o
 * @returns {Promise<{ ok: boolean, baseDomain: string | null, lines: { ok: boolean, text: string }[] }>}
 *   `ok` is false only for a real fault (a site answering as the wrong kind); a missing demo
 *   showroom is a note, not a fault.
 */
export async function checkSites({ port, get = getWithHost }) {
  const lines = [];
  const line = (ok, text) => lines.push({ ok, text });
  let base = null;
  try {
    const me = await get(port, '/api/config', '127.0.0.1');
    base = typeof me.body?.baseDomain === 'string' && me.body.baseDomain ? me.body.baseDomain : null;
  } catch {
    base = null;
  }
  if (!base) {
    line(false, 'GET /api/config gave no baseDomain: this server predates showrooms or is not answering.');
    return { ok: false, baseDomain: null, lines };
  }
  const ask = async (host) => {
    try {
      return await get(port, '/api/config', host);
    } catch (err) {
      return { status: 0, body: {}, error: err?.message ?? String(err) };
    }
  };
  for (const host of [base, `www.${base}`]) {
    const r = await ask(host);
    line(r.status === 200 && r.body?.site === 'sales', `${host}: ${r.status === 200 ? `the ${r.body?.site} site` : `HTTP ${r.status || r.error}`}${r.body?.site === 'sales' ? '' : ' (expected the sales site)'}`);
  }
  const demo = await ask(`${DEMO_SLUG}.${base}`);
  if (demo.status === 200 && demo.body?.site === 'showroom') {
    const t = demo.body.tenant ?? {};
    line(true, `${DEMO_SLUG}.${base}: the showroom of ${t.name ?? '?'} (${t.status ?? '?'})`);
  } else if (demo.status === 404) {
    lines.push({ ok: true, note: true, text: `${DEMO_SLUG}.${base}: no demo showroom yet. The sales site links to it: node app/server/scripts/seed-demo-tenant.mjs (docs/ONBOARDING_A_COMPANY.md).` });
  } else {
    line(false, `${DEMO_SLUG}.${base}: HTTP ${demo.status || demo.error}${demo.body?.site ? `, the ${demo.body.site} site` : ''} (expected the demo showroom)`);
  }
  const none = await ask(`${NO_SUCH_SHOWROOM}.${base}`);
  line(none.status === 404, `an unknown showroom: HTTP ${none.status || none.error}${none.status === 404 ? '' : ' (expected 404)'}`);
  return { ok: lines.every((l) => l.ok), baseDomain: base, lines };
}

/**
 * What the tunnel config `file` is missing for `baseDomain`, as sentences ([] when nothing is).
 * `routes` is tunnelRoutes(<the file's text>, baseDomain) from scripts/tunnel/tunnel.mjs (read by
 * the caller, so the server's folder never imports the tunnel tooling).
 * @param {{ file: string, baseDomain: string, routes: { sales: boolean, www: boolean, showrooms: boolean }, rerun?: string }} o
 */
export function tunnelGaps({ file, baseDomain, routes: r, rerun = 'node scripts/tunnel/setup-tunnel.mjs --validate' }) {
  const missing = [];
  if (!r.sales) missing.push(baseDomain);
  if (!r.www) missing.push(`www.${baseDomain}`);
  if (!r.showrooms) missing.push(`*.${baseDomain} (every showroom)`);
  if (!missing.length) return [];
  return [
    `The tunnel config ${file} does not send ${missing.join(', ')} to this server, so showrooms are not reachable from the internet.`,
    `Rewrite it with ${rerun}, then restart the tunnel (it reads its config only when it starts). Cloudflare also needs the wildcard DNS record: docs/ONBOARDING_A_COMPANY.md, "Once: Cloudflare".`,
  ];
}
