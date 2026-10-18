// The server face: a tiny control page for the machine the server runs on (the Wyse), served by the
// SAME process on its own loopback-only listener, 127.0.0.1:8799 by default (SERVER_FACE_PORT;
// 0 turns it off). docs/HOSTING.md, "Turning the sites off and on".
//
//   GET  /         the page: one big ON / OFF switch for every site (a confirm before OFF), every
//                  site with a status dot, uptime, the deployed commit, the last backup, the last
//                  automatic update and the server's memory
//   GET  /status   the same as JSON (scripts/host/blumodel.mjs `sites status` reads it)
//   POST /sites    { on: boolean, pin? }  needs the X-Face-Token header (the page and the CLI read
//                  it from the page), and the PIN when SERVER_FACE_PIN is set in blumodel.env
//   POST /update   { pin? }  Update now: the same trigger as Admin > System (same token and PIN
//                  rules); the page then follows the update's progress (logs/update-progress.json):
//                  checking GitHub, downloading, deploying, the restart and health check, the result
//
// It is never reachable through the tunnel: cloudflared forwards to the public port (8790) only,
// and this listener binds 127.0.0.1. Even if it were bound wider by mistake it refuses every peer
// that isn't loopback, and every Host header that isn't a loopback name (so a web page can't reach
// it by DNS rebinding). Writes also need the token (a page on another origin can't read it) and,
// when set, the PIN (5 wrong tries lock it for 5 minutes). Every change is audited
// (server/ops/sitesSwitch.mjs). Plain HTML, CSS and a few lines of script; nothing external.

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import { deployedInfo } from '../admin/system.mjs';
import { requestUpdate, serverHome, updateStatus } from '../admin/updates.mjs';
import { audit } from '../lib/audit.mjs';
import { listDaily } from '../ops/backup.mjs';

export const DEFAULT_FACE_PORT = 8799;
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;
const PIN_TRIES = 5;
const PIN_LOCK_MS = 5 * 60_000;

/** The face's port: SERVER_FACE_PORT, else 8799 in production and off (0) in development. */
export function facePort(env = process.env, { prod = false } = {}) {
  const v = String(env.SERVER_FACE_PORT ?? '').trim();
  if (v === '') return prod ? DEFAULT_FACE_PORT : 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : null;
}

const STATUS_LABEL = { live: 'Live', trial: 'Trial', setup: 'In setup', lapsed: 'Lapsed', suspended: 'Suspended', ended: 'Ended' };

/** Everything the page shows. No secret: names, addresses, statuses, times, a commit, sizes. */
export function faceStatus(ctx, { home = ctx.home === undefined ? serverHome() : ctx.home, rss = process.memoryUsage().rss } = {}) {
  const { config, services } = ctx;
  const t = ctx.now();
  const sw = ctx.sitesSwitch.state();
  const base = String(config.BASE_DOMAIN || 'blumodel.studio');
  const sales = [base, `www.${base}`].map((h) => ({ name: h === base ? 'Sales site' : 'Sales site (www)', address: h, kind: 'sales', status: 'live', label: 'Live', up: sw.on }));
  const tenants = (services.tenants.list?.() ?? []).map((tn) => {
    const custom = (services.tenants.hostnames?.(tn.id) ?? []).filter((h) => h.kind !== 'subdomain' && h.verified).map((h) => h.hostname);
    const available = services.tenants.isAvailable ? services.tenants.isAvailable(tn) : tn.status === 'live';
    return { name: tn.name, address: services.tenants.subdomainFor(tn.slug), also: custom, kind: tn.isDemo ? 'demo' : 'showroom', status: tn.status, label: STATUS_LABEL[tn.status] ?? tn.status, up: sw.on && available };
  });
  const backups = config.BACKUPS === 'on' ? listDaily(config.BACKUP_DIR) : [];
  let lastBackupAt = null;
  try {
    if (backups[0]) lastBackupAt = fs.statSync(backups[0].file).mtimeMs;
  } catch {
    lastBackupAt = null;
  }
  const up = updateStatus({ home });
  return {
    sitesOn: sw.on,
    since: sw.since,
    by: sw.by,
    via: sw.via,
    sites: [...sales, ...tenants],
    uptimeSec: Math.max(0, Math.floor((t - ctx.startedAt) / 1000)),
    commit: deployedInfo().commit,
    lastBackupAt,
    backupsOn: config.BACKUPS === 'on',
    update: up.available ? { installed: up.installed, enabled: up.enabled, time: up.time, pending: up.pending, progress: up.progress, deployed: up.deployed, head: up.head, last: up.last ? { outcome: up.last.outcome, at: up.last.at, to: up.last.to, error: up.last.error } : null } : null,
    memoryMb: Math.round(rss / 1048576),
    generatedAt: t,
  };
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * The face's request handler.
 * @param {{ ctx: any, pin?: string | null, token?: string, now?: () => number }} o
 */
export function createFace({ ctx, pin = null, token = crypto.randomBytes(24).toString('base64url'), now = Date.now }) {
  const tries = { n: 0, lockedUntil: 0 };
  const pinOn = typeof pin === 'string' && pin.length > 0;
  const status = () => ({ ...faceStatus(ctx), pinRequired: pinOn });
  const json = (res, code, body) => {
    const text = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text), 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  };
  const handler = (req, res) => {
    // Loopback only, whatever the listener was bound to; and a loopback Host (no DNS rebinding).
    if (!LOOPBACK_PEERS.has(req.socket?.remoteAddress ?? '')) {
      res.writeHead(403, { 'Content-Type': 'text/plain', Connection: 'close' });
      return res.end('The server face answers only on this machine.\n');
    }
    if (!LOOPBACK_HOST.test(String(req.headers.host ?? ''))) {
      res.writeHead(421, { 'Content-Type': 'text/plain', Connection: 'close' });
      return res.end('Open it as http://127.0.0.1:<port>/ on this machine.\n');
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = crypto.randomBytes(16).toString('base64');
      const html = facePage({ token, nonce, status: status() });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(html),
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, status());
    if (req.method === 'POST' && (url.pathname === '/sites' || url.pathname === '/update')) {
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(origin)) return json(res, 403, { error: 'Not from this machine’s page.', code: 'bad_origin' });
      if (!sameText(req.headers['x-face-token'], token)) return json(res, 403, { error: 'Reload the page and try again.', code: 'bad_token' });
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return json(res, 415, { error: 'Send JSON.' });
      let body = '';
      let over = false;
      req.setEncoding('utf8');
      req.on('data', (d) => {
        body += d;
        if (body.length > 1024) over = true;
      });
      req.on('end', () => {
        if (over) return json(res, 413, { error: 'Too big.' });
        let b;
        try {
          b = JSON.parse(body || '{}');
        } catch {
          return json(res, 400, { error: 'Not JSON.' });
        }
        if (url.pathname === '/sites' && typeof b.on !== 'boolean') return json(res, 400, { error: 'Say on: true or on: false.' });
        if (pinOn) {
          const t = now();
          if (tries.lockedUntil > t) return json(res, 429, { error: 'Too many wrong PINs. Wait 5 minutes.', code: 'pin_locked' });
          if (!sameText(b.pin, pin)) {
            tries.n += 1;
            if (tries.n >= PIN_TRIES) {
              tries.n = 0;
              tries.lockedUntil = t + PIN_LOCK_MS;
            }
            ctx.log?.warn?.('server face: a wrong PIN was entered');
            return json(res, 403, { error: 'Wrong PIN.', code: 'bad_pin' });
          }
          tries.n = 0;
        }
        const via = req.headers['x-face-client'] === 'cli' ? 'cli' : 'face';
        if (url.pathname === '/update') {
          // The same trigger as Admin > System > Update now: the automatic update picks it up
          // (blumodel-update.path at once on Linux; BluModelStudioUpdateNow within two minutes on Windows).
          try {
            const home = ctx.home === undefined ? serverHome() : ctx.home;
            const r = requestUpdate({ home, now: ctx.now, by: via === 'cli' ? 'the command line' : 'the server face' });
            audit(ctx.db, { admin: null, action: 'update_now', detail: { via, alreadyPending: r.already }, at: ctx.now() });
            return json(res, 200, { requested: true, alreadyPending: r.already, ...status() });
          } catch (err) {
            if (err?.code) return json(res, 409, { error: err.message, code: err.code });
            throw err;
          }
        }
        ctx.sitesSwitch.set(b.on, { via, by: via === 'cli' ? 'the command line' : 'the server face' });
        return json(res, 200, status());
      });
      return undefined;
    }
    return json(res, 404, { error: 'Not found.' });
  };
  return { handler, token };
}

/**
 * Starts the face's listener on 127.0.0.1:<port> (never another address). A port in use is a
 * warning, never a reason for the server not to start. Returns the http.Server, or null.
 * @param {{ ctx: any, port: number, pin?: string | null, log?: any }} o
 */
export function startFace({ ctx, port, pin = null, log = console }) {
  if (!port) return null;
  const { handler } = createFace({ ctx, pin });
  const server = http.createServer({ headersTimeout: 10_000, requestTimeout: 30_000 }, handler);
  server.maxConnections = 20;
  server.on('error', (err) => log.warn?.(`The server face could not listen on 127.0.0.1:${port} (${err.code ?? err.message}); the sites are unaffected. Set SERVER_FACE_PORT to a free port, or 0 to turn the face off.`));
  server.listen(port, '127.0.0.1', () => log.info?.(`Server face on http://127.0.0.1:${port} (this machine only)${pin ? ', PIN on' : ''}.`));
  server.unref();
  return server;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The page. The status is rendered on the server (works without script) and refreshed by script. */
export function facePage({ token, nonce, status: s }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="face-token" content="${esc(token)}">
<link rel="icon" href="data:,">
<title>BluModel Server</title>
<style nonce="${esc(nonce)}">
:root { --bg: #f4f3ef; --card: #ffffff; --ink: #1b2126; --muted: #56616b; --line: #dcd9d1; --on: #1d7a46; --on-bg: #e3f3e9; --off: #b3261e; --off-bg: #fbe7e5; --off-ink: #ffffff; --warn: #8a5a00; --btn: #1f4f8a; --btn-ink: #ffffff; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #121619; --card: #1b2126; --ink: #eef1f4; --muted: #aab4bd; --line: #2d353c; --on: #6fd49a; --on-bg: #16301f; --off: #ff8a80; --off-bg: #3a1714; --off-ink: #2a0805; --warn: #f0c060; --btn: #8ab8f0; --btn-ink: #0d1520; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 18px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 20px; font-size: 1rem; }
.sub.tight { margin: 0; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; margin-bottom: 16px; }
.switch { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; }
.state { font-size: 2rem; font-weight: 700; }
.state.on { color: var(--on); } .state.off { color: var(--off); }
.big { min-height: 64px; min-width: 200px; padding: 0 28px; border-radius: 14px; border: 0; font-size: 1.25rem; font-weight: 700; cursor: pointer; background: var(--btn); color: var(--btn-ink); }
.big.danger { background: var(--off); color: var(--off-ink); }
.big:focus-visible, .small:focus-visible, input:focus-visible { outline: 3px solid var(--btn); outline-offset: 2px; }
.small { min-height: 48px; padding: 0 20px; border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--ink); font-size: 1rem; cursor: pointer; }
.confirm { display: none; margin-top: 16px; padding: 16px; border-radius: 12px; background: var(--off-bg); }
.confirm.show { display: block; }
.confirm p { margin: 0 0 12px; }
.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
label.pin { display: none; gap: 8px; align-items: center; margin-top: 12px; }
label.pin.show { display: flex; }
input { min-height: 48px; font-size: 1.1rem; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); width: 9em; }
ul.sites { list-style: none; margin: 0; padding: 0; }
ul.sites li { display: flex; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
ul.sites li:first-child { border-top: 0; }
.dot { width: 14px; height: 14px; border-radius: 50%; flex: none; background: var(--off); }
.dot.up { background: var(--on); }
.site { flex: 1 1 200px; min-width: 0; }
.site b { display: block; } .site span { color: var(--muted); font-size: .95rem; word-break: break-all; }
.tag { font-size: .9rem; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; font-size: 1rem; }
dt { color: var(--muted); } dd { margin: 0; }
.upd { font-size: 1.15rem; font-weight: 600; }
.big:disabled { opacity: .55; cursor: default; }
.msg { margin-top: 12px; color: var(--off); font-weight: 600; min-height: 1.5em; }
@media (max-width: 480px) { .big { width: 100%; } dl { grid-template-columns: 1fr; gap: 2px; } dd { margin-bottom: 8px; } }
</style>
</head>
<body>
<main>
  <h1>BluModel Server</h1>
  <p class="sub">This machine only. Every website BluModel Studio serves: the sales site, the demo and every company's showroom.</p>
  <section class="card" aria-labelledby="all-sites">
    <div class="switch">
      <div>
        <div id="all-sites" class="sub tight">All websites are</div>
        <div id="state" class="state ${s.sitesOn ? 'on' : 'off'}" role="status" aria-live="polite">${s.sitesOn ? 'ON' : 'OFF'}</div>
      </div>
      <button id="toggle" class="big ${s.sitesOn ? 'danger' : ''}" type="button">${s.sitesOn ? 'Turn all sites OFF' : 'Turn all sites ON'}</button>
    </div>
    <div id="confirm" class="confirm" role="alertdialog" aria-labelledby="confirm-text">
      <p id="confirm-text"><b>Turn every website off?</b> Visitors will see “We’ll be right back” until you turn them on again. Nothing is deleted, and you can still sign in at blumodel.studio/admin to turn them back on.</p>
      <div class="row"><button id="yes" class="big danger" type="button">Yes, turn them off</button><button id="no" class="small" type="button">Cancel</button></div>
    </div>
    <label id="pinrow" class="pin ${s.pinRequired ? 'show' : ''}">PIN <input id="pin" type="password" inputmode="numeric" autocomplete="off" aria-label="PIN"></label>
    <div id="msg" class="msg" role="alert"></div>
  </section>
  <section class="card" aria-labelledby="upd-h">
    <div class="switch">
      <div>
        <div id="upd-h" class="sub tight">Software</div>
        <div id="upd-state" class="upd" role="status" aria-live="polite">${esc(s.update ? (s.update.enabled ? `Checks GitHub daily at ${s.update.time}` : 'Automatic updates are off') : 'Automatic updates are not set up here')}</div>
      </div>
      <button id="update" class="big" type="button">Update now</button>
    </div>
    <div id="umsg" class="msg" role="alert"></div>
  </section>
  <section class="card" aria-label="Sites">
    <ul id="sites" class="sites">${s.sites.map((x) => `<li><span class="dot${x.up ? ' up' : ''}" aria-hidden="true"></span><span class="site"><b>${esc(x.name)}</b><span>${esc(x.address)}${x.also?.length ? `, ${esc(x.also.join(', '))}` : ''}</span></span><span class="tag">${x.up ? esc(x.label) : s.sitesOn ? esc(x.label) : 'Off'}</span></li>`).join('')}</ul>
  </section>
  <section class="card" aria-label="Server">
    <dl id="facts"></dl>
  </section>
</main>
<script nonce="${esc(nonce)}">
(() => {
  const token = document.querySelector('meta[name=face-token]').content;
  let s = ${JSON.stringify(s).replace(/</g, '\\u003c')};
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const when = (ms) => (ms ? new Date(ms).toLocaleString() : 'never');
  const dur = (sec) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d ? d + ' d ' + h + ' h' : h ? h + ' h ' + m + ' min' : m + ' min'; };
  const OUT = { current: 'up to date', updated: 'updated', skipped: 'skipped a failed release', refused: 'refused', busy: 'busy', 'rolled-back': 'rolled back', failed: 'failed', down: 'failed, rollback failed', error: 'could not check' };
  function render() {
    $('state').textContent = s.sitesOn ? 'ON' : 'OFF';
    $('state').className = 'state ' + (s.sitesOn ? 'on' : 'off');
    $('toggle').textContent = s.sitesOn ? 'Turn all sites OFF' : 'Turn all sites ON';
    $('toggle').className = 'big' + (s.sitesOn ? ' danger' : '');
    $('pinrow').className = 'pin' + (s.pinRequired ? ' show' : '');
    $('sites').innerHTML = s.sites.map((x) => '<li><span class="dot' + (x.up ? ' up' : '') + '" aria-hidden="true"></span><span class="site"><b>' + esc(x.name) + '</b><span>' + esc(x.address) + (x.also && x.also.length ? ', ' + esc(x.also.join(', ')) : '') + '</span></span><span class="tag">' + (s.sitesOn ? esc(x.label) : 'Off') + '</span></li>').join('');
    const u = s.update;
    const rows = [
      ['Switched', s.since ? when(s.since) + (s.by ? ' (' + s.by + ')' : '') : 'never'],
      ['Up for', dur(s.uptimeSec)],
      ['Deployed commit', s.commit || 'not a deployed copy'],
      ['Last backup', s.backupsOn ? when(s.lastBackupAt) : 'backups off'],
      ['Last automatic update', u ? (u.last ? (OUT[u.last.outcome] || u.last.outcome) + ', ' + when(u.last.at) : 'not run yet') + (u.enabled ? ' (daily at ' + u.time + ')' : ' (off)') : 'not set up here'],
      ['Memory', s.memoryMb + ' MB'],
    ];
    $('facts').innerHTML = rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('');
    renderUpdate();
  }
  let watching = false, requestedAt = 0, lost = false, timer = null;
  const RESULT = { current: 'Already up to date.', updated: 'Updated', 'rolled-back': 'The new release failed its health check and was rolled back: the site runs the previous version.', down: 'The update failed and so did the rollback: check the site now.', skipped: 'Skipped: that release failed before.', refused: 'Refused', busy: 'Another update or deploy was running.', failed: 'The update stopped before the new version went in; nothing changed.', error: 'Could not check GitHub.' };
  function result(o, to, err) { return (o === 'updated' ? 'Updated to ' + String(to || '').slice(0, 7) + '. Done.' : RESULT[o] || o) + (err && o !== 'current' && o !== 'updated' ? ' ' + err : ''); }
  function updText() {
    const u = s.update;
    if (!u) return 'Automatic updates are not set up on this machine.';
    const p = u.progress;
    if (watching) {
      if (lost) return 'Restarting the server and checking its health…';
      const mine = p && p.startedAt && p.startedAt >= requestedAt - 10000;
      if (!mine) return 'Waiting for the updater to start…';
      if (p.stage === 'checking') return 'Checking GitHub for a new release…';
      if (p.stage === 'downloading') return 'Downloading the new release…';
      if (p.stage === 'deploying') return 'Deploying: database backed up, server restarting…';
      return result(p.outcome, p.to, p.error);
    }
    const last = u.last ? 'Last: ' + result(u.last.outcome, u.last.to, '') + ' ' + when(u.last.at) + '. ' : '';
    return last + (u.enabled ? 'Checks GitHub daily at ' + u.time + '.' : 'Automatic updates are off.');
  }
  function renderUpdate() {
    $('upd-state').textContent = updText();
    const u = s.update;
    $('update').disabled = watching || !u || !u.installed || !u.enabled;
    $('update').textContent = watching ? 'Updating…' : 'Update now';
  }
  async function poll() {
    try {
      const r = await fetch('/status', { cache: 'no-store' });
      if (!r.ok) throw new Error('status');
      s = await r.json();
      lost = false;
      const p = s.update && s.update.progress;
      if (p && p.stage === 'finished' && p.startedAt >= requestedAt - 10000) watching = false;
    } catch { lost = true; }
    if (Date.now() - requestedAt > 20 * 60000) watching = false;
    render();
    if (watching) timer = setTimeout(poll, 2000);
  }
  async function update() {
    $('umsg').textContent = '';
    try {
      const r = await fetch('/update', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Face-Token': token }, body: JSON.stringify({ pin: $('pin').value || undefined }) });
      const b = await r.json();
      if (r.status === 403 && b.code === 'bad_token') { location.reload(); return; }
      if (!r.ok) { $('umsg').textContent = b.error || 'That did not work.'; return; }
      $('pin').value = '';
      s = b; watching = true; requestedAt = Date.now(); lost = false;
      render();
      clearTimeout(timer); timer = setTimeout(poll, 1500);
    } catch { $('umsg').textContent = 'The server did not answer.'; }
  }
  $('update').addEventListener('click', update);
  async function send(on) {
    $('msg').textContent = '';
    try {
      const r = await fetch('/sites', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Face-Token': token }, body: JSON.stringify({ on, pin: $('pin').value || undefined }) });
      const b = await r.json();
      if (!r.ok) { $('msg').textContent = b.error || 'That did not work.'; return; }
      s = b; $('pin').value = ''; render();
    } catch { $('msg').textContent = 'The server did not answer.'; }
  }
  $('toggle').addEventListener('click', () => { if (s.sitesOn) { $('confirm').className = 'confirm show'; $('yes').focus(); } else send(true); });
  $('yes').addEventListener('click', () => { $('confirm').className = 'confirm'; send(false); });
  $('no').addEventListener('click', () => { $('confirm').className = 'confirm'; $('toggle').focus(); });
  setInterval(async () => { if (watching) return; try { const r = await fetch('/status'); if (r.ok) { s = await r.json(); render(); } } catch {} }, 15000);
  render();
})();
</script>
</body>
</html>`;
}
