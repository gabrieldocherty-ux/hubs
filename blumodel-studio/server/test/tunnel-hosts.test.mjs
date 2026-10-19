// The tunnel config for the showroom pivot (docs/SHOWROOM_PIVOT.md §4): blumodel.studio,
// www.blumodel.studio and every <slug>.blumodel.studio reach the server, and so do companies' own
// domains (Cloudflare for SaaS custom hostnames) unless --no-custom-domains. cloudflared itself is
// only ever run offline (ingress validate / ingress rule) on temp copies; never a tunnel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RESERVED_SLUGS as RESERVED } from '../tenancy/service.mjs';
import { HOSTNAME, TUNNEL_ID, findCloudflared, tunnelConfigYaml, tunnelRoutes } from '../../scripts/tunnel/tunnel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE = process.execPath;
const CREDS = `/srv/blumodel-studio/.cloudflared/${TUNNEL_ID}.json`;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-tunhosts-'));

/** The ingress rules as [hostname|null, service] in order (a reader for the shape tunnelConfigYaml writes). */
const rulesOf = (y) => {
  const body = y.split('\n');
  const i = body.indexOf('ingress:');
  const out = [];
  for (const l of body.slice(i + 1)) {
    const h = /^ {2}- hostname: '?([^']+?)'?$/.exec(l);
    const s = /^ {2}(?:- | {2})service: (\S+)$/.exec(l);
    if (h) out.push([h[1], null]);
    else if (s && /^ {2}- /.test(l)) out.push([null, s[1]]);
    else if (s) out[out.length - 1][1] = s[1];
  }
  return out;
};

test('the ingress, in order: the sales site, www, every showroom, then custom domains to the server (or 404 with customDomains false)', () => {
  const o = 'http://127.0.0.1:8790';
  assert.deepEqual(rulesOf(tunnelConfigYaml({ credentials: CREDS })), [
    ['blumodel.studio', o],
    ['www.blumodel.studio', o],
    ['*.blumodel.studio', o],
    [null, o],
  ]);
  assert.deepEqual(rulesOf(tunnelConfigYaml({ credentials: CREDS, customDomains: false })).at(-1), [null, 'http_status:404']);
  // The wildcard is quoted: a bare * starts a YAML alias.
  assert.match(tunnelConfigYaml({ credentials: CREDS }), /^ {2}- hostname: '\*\.blumodel\.studio'$/m);
  // One originRequest for every rule (top level), not repeated per rule.
  const y = tunnelConfigYaml({ credentials: CREDS });
  assert.equal((y.match(/originRequest:/g) || []).length, 1);
  assert.match(y, /^originRequest:\n {2}connectTimeout: 10s\n/m);
});

test('another base domain and port follow through every rule; a www. or bad base domain is refused', () => {
  const y = tunnelConfigYaml({ credentials: CREDS, hostname: 'Showrooms.Example.CA', origin: 'http://127.0.0.1:8935' });
  assert.deepEqual(rulesOf(y).map((r) => r[0]), ['showrooms.example.ca', 'www.showrooms.example.ca', '*.showrooms.example.ca', null]);
  assert.ok(rulesOf(y).every((r) => r[1] === 'http://127.0.0.1:8935'));
  assert.throws(() => tunnelConfigYaml({ credentials: CREDS, hostname: 'www.blumodel.studio' }), /base domain/);
  assert.throws(() => tunnelConfigYaml({ credentials: CREDS, hostname: '*.blumodel.studio' }), /Not a hostname/);
  assert.throws(() => tunnelConfigYaml({ credentials: CREDS, hostname: 'localhost' }), /Not a hostname/, 'a public domain, with a dot');
  assert.throws(() => tunnelConfigYaml({ credentials: CREDS, hostname: "x.studio\n  - service: http://evil" }), /Not a hostname/);
});

test('tunnelRoutes reads which hosts a config sends to the server: the new one has all four, a pre-showroom one only the sales site', () => {
  assert.deepEqual(tunnelRoutes(tunnelConfigYaml({ credentials: CREDS })), { sales: true, www: true, showrooms: true, customDomains: true });
  assert.deepEqual(tunnelRoutes(tunnelConfigYaml({ credentials: CREDS, customDomains: false })), { sales: true, www: true, showrooms: true, customDomains: false });
  // What setup-tunnel wrote before the pivot (commit 9d90a64), CRLF as on Windows.
  const old = [
    "# BluModel Studio: the Cloudflare tunnel 'blumodel' for blumodel.studio.",
    `tunnel: ${TUNNEL_ID}`,
    "credentials-file: 'C:\\Users\\owner\\.cloudflared\\x.json'",
    'ingress:',
    '  - hostname: blumodel.studio',
    '    service: http://127.0.0.1:8790',
    '    originRequest:',
    '      connectTimeout: 10s',
    '  - service: http_status:404',
    '',
  ].join('\r\n');
  assert.deepEqual(tunnelRoutes(old), { sales: true, www: false, showrooms: false, customDomains: false });
  assert.deepEqual(tunnelRoutes(''), { sales: false, www: false, showrooms: false, customDomains: false });
  assert.equal(tunnelRoutes(tunnelConfigYaml({ credentials: CREDS }), HOSTNAME).showrooms, true);
  assert.equal(tunnelRoutes(tunnelConfigYaml({ credentials: CREDS }), 'other.example').showrooms, true, 'the catch-all takes any domain');
  assert.equal(tunnelRoutes(tunnelConfigYaml({ credentials: CREDS, customDomains: false }), 'other.example').showrooms, false);
});

test('setup-tunnel --dry-run prints the multi-host config; --no-custom-domains ends in a 404', () => {
  const cli = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'tunnel', 'setup-tunnel.mjs'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const r = cli('--dry-run', '--platform', 'linux', '--home', '/srv/blumodel-studio', '--port', '8936');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /- hostname: www\.blumodel\.studio\n {4}service: http:\/\/127\.0\.0\.1:8936/);
  assert.match(r.stdout, /- hostname: '\*\.blumodel\.studio'\n {4}service: http:\/\/127\.0\.0\.1:8936/);
  assert.match(r.stdout, /\n {2}- service: http:\/\/127\.0\.0\.1:8936\n/);
  const strict = cli('--dry-run', '--platform', 'linux', '--home', '/srv/blumodel-studio', '--no-custom-domains');
  assert.equal(strict.status, 0, strict.stderr);
  assert.match(strict.stdout, /\n {2}- service: http_status:404\n/);
  assert.equal(cli('--dry-run', '--hostname', 'www.blumodel.studio').status, 2, 'www. is refused as the base domain');
});

const cf = process.platform === 'win32' ? findCloudflared() : null;

test('cloudflared routes the sales site, www, acme.blumodel.studio and a custom domain to the server (offline, a temp copy)', { skip: !cf && 'cloudflared not installed here', timeout: 60_000 }, () => {
  const dir = tempDir();
  try {
    for (const [name, customDomains] of [['all.yml', true], ['strict.yml', false]]) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, tunnelConfigYaml({ credentials: path.join(dir, 'creds.json'), origin: 'http://127.0.0.1:8937', customDomains, platform: 'linux' }));
      const run = (...a) => spawnSync(cf, ['tunnel', '--config', file, 'ingress', ...a], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
      const v = run('validate');
      assert.equal(v.status, 0, v.stdout + v.stderr);
      const rule = (url) => {
        const out = run('rule', url);
        return { hostname: /hostname: (\S+)/.exec(out.stdout + out.stderr)?.[1] ?? null, service: /service: (\S+)/.exec(out.stdout + out.stderr)?.[1] ?? null };
      };
      assert.deepEqual(rule('https://blumodel.studio/api/health'), { hostname: 'blumodel.studio', service: 'http://127.0.0.1:8937' });
      assert.deepEqual(rule('https://www.blumodel.studio/'), { hostname: 'www.blumodel.studio', service: 'http://127.0.0.1:8937' });
      assert.deepEqual(rule('https://acme.blumodel.studio/'), { hostname: '*.blumodel.studio', service: 'http://127.0.0.1:8937' });
      assert.deepEqual(rule('https://demo.blumodel.studio/#/studio'), { hostname: '*.blumodel.studio', service: 'http://127.0.0.1:8937' });
      assert.deepEqual(rule('https://showroom.acmekitchens.ca/'), { hostname: null, service: customDomains ? 'http://127.0.0.1:8937' : 'http_status:404' });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ONBOARDING_A_COMPANY.md: the one-time Cloudflare steps match the generated config, and every runbook step is there', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'ONBOARDING_A_COMPANY.md'), 'utf8');
  for (const re of [
    /\| CNAME \| `\*` \| `064671cd-a658-4240-8626-c697b9f148ac\.cfargotunnel\.com` \| \*\*Proxied\*\*/,
    /setup-tunnel\.mjs --home \/srv\/blumodel-studio --validate/,
    /sudo systemctl restart blumodel-tunnel/,
    /seed-demo-tenant\.mjs/,
    /Fallback Origin/,
    /`tunnel\.blumodel\.studio`/,
    /## 1\. Create the company/,
    /## 2\. Record the license/,
    /## 3\. Send the monthly link/,
    /## 4\. Model their products/,
    /## 5\. Their web address/,
    /## 6\. Their own domain \(Cloudflare for SaaS\)/,
    /## 7\. Go-live checklist/,
    /\*\*Mark verified\*\*/,
    /Launch showroom/,
  ])
    assert.match(text, re);
  // The fallback origin it recommends can never be a company's address.
  assert.ok(RESERVED.has('tunnel'));
  // Its in-page links point at headings.
  const anchors = new Set([...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')));
  for (const [, a] of text.matchAll(/\]\(#([\w-]+)\)/g)) assert.ok(anchors.has(a), `#${a} is a heading`);
  // The tunnel rules it shows are what tunnelConfigYaml writes.
  assert.deepEqual(tunnelRoutes(tunnelConfigYaml({ credentials: CREDS })), { sales: true, www: true, showrooms: true, customDomains: true });
});
