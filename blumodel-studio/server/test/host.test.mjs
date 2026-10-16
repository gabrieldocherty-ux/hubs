// Running the site on another computer (docs/HOSTING.md): the platform-aware home layout, the
// settings template and its permissions, the startup-tasks marker, putting a new app in place with
// app.previous kept for a rollback, the systemd units and the Windows startup tasks, the build's
// memory guard, the update's plan and its rollback, the tunnel config on Linux, and the install
// scripts (bash -n, LF line ends, a PowerShell parse, and their --dry-run output).
//
// Everything runs in temp folders or prints a plan: nothing here starts a service, registers a
// task or a unit, runs cloudflared other than its offline `ingress validate|rule`, or touches a
// real home. There is no Linux machine in this test run on Windows, so the Linux pieces are checked
// as generated text and dry-run plans (and run for real only where the test runs on Linux).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENV_FILE_KEYS, parseEnvFile } from '../lib/envFile.mjs';
import {
  LINUX_HOME,
  defaultHome,
  homeLayout,
  readStartupTasks,
  restrictSettings,
  serverScripts,
  settingsTemplate,
  writeStartupTasks,
} from '../ops/home.mjs';
import { EXIT, readDeployed, rollbackApp, stageApp, swapInApp } from '../../scripts/host/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WIN = process.platform === 'win32';
const NODE = process.execPath;
const tempDir = (p = 'blumodel-host-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

/** The shell's settings must not leak into a spawned script. */
const cleanEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(STRIPE_|ANTHROPIC_|BLUMODEL_|MISE_|PAYMENTS$|DEMO_PAYMENTS$|PUBLIC_URL$|NODE_ENV$|TRUST_PROXY$|ADMIN_EMAILS$|LEGAL_|SUPPORT_EMAIL$|DB_PATH$|PORT$|HOST$)/.test(k)) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
};

// ── 1. the home on either platform ───────────────────────────────────────

test('the default home: %USERPROFILE%\\Projects\\BluModelStudio on Windows, /srv/blumodel-studio on Linux; no user name or drive letter is built in', () => {
  assert.equal(defaultHome('C:\\Users\\owner', 'win32'), 'C:\\Users\\owner\\Projects\\BluModelStudio');
  assert.equal(defaultHome('D:\\Profiles\\someone', 'win32'), 'D:\\Profiles\\someone\\Projects\\BluModelStudio');
  assert.equal(defaultHome('/home/whoever', 'linux'), LINUX_HOME);
  assert.equal(LINUX_HOME, '/srv/blumodel-studio');
  // This machine's default follows its platform and its own profile folder.
  assert.equal(defaultHome(), WIN ? path.join(os.homedir(), 'Projects', 'BluModelStudio') : LINUX_HOME);
});

test('homeLayout uses the platform’s separators: every Linux path is under /srv/blumodel-studio with /, every Windows one with \\', () => {
  const lin = homeLayout('/srv/blumodel-studio', 'linux');
  const win = homeLayout('C:\\Users\\owner\\Projects\\BluModelStudio', 'win32');
  assert.deepEqual(Object.keys(lin).sort(), Object.keys(win).sort());
  for (const [k, v] of Object.entries(lin)) {
    assert.ok(v.startsWith('/srv/blumodel-studio'), `${k}: ${v}`);
    assert.ok(!v.includes('\\'), `${k}: ${v}`);
  }
  for (const [k, v] of Object.entries(win)) assert.ok(v.startsWith('C:\\Users\\owner\\Projects\\BluModelStudio') && !v.includes('/'), `${k}: ${v}`);
  assert.equal(lin.db, '/srv/blumodel-studio/data/blumodel.db');
  assert.equal(lin.settings, '/srv/blumodel-studio/blumodel.env');
  assert.equal(lin.appPrevious, '/srv/blumodel-studio/app.previous');
  assert.equal(lin.serverEntry, '/srv/blumodel-studio/app/server/index.mjs');
  assert.equal(lin.cloudflaredDir, '/srv/blumodel-studio/.cloudflared');
  assert.equal(lin.repo, '/srv/blumodel-studio/repo');
  assert.equal(homeLayout('/opt/elsewhere/', 'linux').home, '/opt/elsewhere', 'any home, normalised');
});

test('the settings template on Linux: the same keys and values as on Windows, LF line ends, and the systemd restart hint', () => {
  const lin = settingsTemplate({ adminEmails: 'owner@blumodel.example', platform: 'linux' });
  const win = settingsTemplate({ adminEmails: 'owner@blumodel.example', platform: 'win32' });
  assert.ok(!lin.includes('\r'), 'LF only');
  assert.ok(!/[^\r]\n/.test(win), 'CRLF only on Windows');
  assert.deepEqual(parseEnvFile(lin).values, parseEnvFile(win).values);
  assert.deepEqual(Object.keys(parseEnvFile(lin).values).sort(), [...ENV_FILE_KEYS].sort());
  assert.match(lin, /restart it after editing \(sudo systemctl restart blumodel-studio\)/);
  assert.match(win, /restart it after editing \(stop-server\.cmd, then start-server\.cmd\)/);
  // A new template names no one: the deploy no longer fills in an owner's address.
  assert.equal(parseEnvFile(settingsTemplate({ platform: 'linux' })).values.ADMIN_EMAILS, '');
});

test('restrictSettings: icacls on Windows; on Linux mode 600 (and owned by blumodel when run as root), never reading the file', { skip: !WIN && process.getuid?.() === 0 }, () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'blumodel.env');
    fs.writeFileSync(file, 'X=1\n', { mode: 0o644 });
    const who = restrictSettings(file, { platform: 'linux' });
    assert.equal(who, `${os.userInfo().username} (mode 600)`);
    if (!WIN) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    rm(dir);
  }
});

test('the deploy no longer writes an owner’s email into a new settings file (ADMIN_EMAILS only from BLUMODEL_ADMIN_EMAILS)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy-local.mjs'), 'utf8');
  assert.doesNotMatch(src, /@gmail\.com|DEFAULT_ADMIN_EMAILS/);
  assert.match(src, /process\.env\.BLUMODEL_ADMIN_EMAILS \|\| ''/);
});

test('nothing in the hosting code, scripts or docs names this PC: no user folder, drive-letter path or personal address', () => {
  const files = [
    'server/ops/home.mjs',
    'scripts/deploy-local.mjs',
    'scripts/register-tasks.mjs',
    'scripts/migrate-home.mjs',
    'scripts/stripe-check.mjs',
    'scripts/tunnel/tunnel.mjs',
    'scripts/tunnel/setup-tunnel.mjs',
    ...fs.readdirSync(path.join(ROOT, 'scripts', 'host')).map((f) => `scripts/host/${f}`),
    ...['docs/HOSTING.md', 'docs/OPERATIONS.md', 'docs/LAUNCH.md', 'README.md'].filter((f) => fs.existsSync(path.join(ROOT, f))),
  ].filter((f) => fs.statSync(path.join(ROOT, f)).isFile());
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // C:\Users\<you> and the like are fine; a real profile folder is not.
    const userFolder = /[A-Za-z]:\\Users\\(?!<you>|owner\\|you\\|<user>)[A-Za-z0-9][^\s`'"]*/.exec(text);
    assert.equal(userFolder, null, `${f} names a user folder: ${userFolder?.[0]}`);
    const thisPc = /\bgdoch\b|[\w.]+@gmail\.com|Desktop\\Hyperliquid|Hyperliquid-Bot/i.exec(text);
    assert.equal(thisPc, null, `${f} names this PC: ${thisPc?.[0]}`);
  }
});

// ── the startup-tasks marker (Windows homes whose tasks run at startup) ───

test('startup-tasks: written one name a line (CRLF), read back as a set, removed when empty; start-server.cmd and start-tunnel.cmd check it with findstr', async () => {
  const home = tempDir('blumodel-startup-');
  try {
    assert.deepEqual([...readStartupTasks(home)], []);
    writeStartupTasks(home, ['BluModelTunnel', 'BluModelStudioServer', 'BluModelTunnel']);
    const file = homeLayout(home).startupTasks;
    assert.equal(fs.readFileSync(file, 'utf8'), 'BluModelStudioServer\r\nBluModelTunnel\r\n');
    assert.deepEqual([...readStartupTasks(home)].sort(), ['BluModelStudioServer', 'BluModelTunnel']);
    if (WIN) {
      // The exact check the .cmd scripts make (findstr only reads the file).
      const find = (name) => spawnSync('cmd.exe', ['/d', '/c', `findstr /X /C:${name} startup-tasks >nul 2>&1`], { cwd: home, windowsHide: true }).status;
      assert.equal(find('BluModelStudioServer'), 0);
      assert.equal(find('BluModelTunnel'), 0);
      assert.equal(find('BluModelStudio'), 1, 'a whole line, not a prefix');
    }
    writeStartupTasks(home, []);
    assert.ok(!fs.existsSync(file));
    const { tunnelScripts } = await import('../../scripts/tunnel/tunnel.mjs');
    const start = serverScripts({ node: 'C:\\n\\node.exe' })['start-server.cmd'];
    assert.match(start, /^findstr \/X \/C:BluModelStudioServer startup-tasks >nul 2>&1 && schtasks \/Run \/TN BluModelStudioServer >nul 2>&1 && goto started\r$/m);
    assert.ok(start.indexOf('wscript.exe "%~dp0start-hidden.vbs"') > start.indexOf('findstr'), 'falls back to starting it directly');
    const tstart = tunnelScripts({ cloudflared: 'C:\\c\\cloudflared.exe', node: 'C:\\n\\node.exe' })['start-tunnel.cmd'];
    assert.match(tstart, /^findstr \/X \/C:BluModelTunnel startup-tasks >nul 2>&1 && schtasks \/Run \/TN BluModelTunnel >nul 2>&1 && goto started\r$/m);
    assert.throws(() => serverScripts({ node: 'n', task: 'x & calc' }), /Not a task name/);
  } finally {
    rm(home);
  }
});

// ── putting a new app in place, and rolling back ──────────────────────────

/** A checkout with a build: server/ (with data/ and test/ that must not ship), src/data/*.json, package.json, dist/. */
function fakeCheckout(dir) {
  const r = path.join(dir, 'checkout');
  for (const d of ['server/data', 'server/test', 'server/generated', 'server/lib', 'src/data', 'dist/assets']) fs.mkdirSync(path.join(r, d), { recursive: true });
  fs.writeFileSync(path.join(r, 'server', 'index.mjs'), '// server\n');
  fs.writeFileSync(path.join(r, 'server', 'lib', 'x.mjs'), '// lib\n');
  fs.writeFileSync(path.join(r, 'server', 'generated', 'export-kit.mjs'), '// kit\n');
  fs.writeFileSync(path.join(r, 'server', 'data', 'blumodel.db'), 'a dev database: never shipped');
  fs.writeFileSync(path.join(r, 'server', 'test', 'a.test.mjs'), '// test');
  fs.writeFileSync(path.join(r, 'src', 'data', 'plans.json'), '{}');
  fs.writeFileSync(path.join(r, 'src', 'data', 'kinds.json'), '{}');
  fs.writeFileSync(path.join(r, 'src', 'data', 'catalog.ts'), '// not runtime');
  fs.writeFileSync(path.join(r, 'package.json'), '{"name":"blumodel-studio","version":"0.1.0"}');
  fs.writeFileSync(path.join(r, 'dist', 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(r, 'dist', 'assets', 'a.js'), '');
  return r;
}

test('stageApp + swapInApp: app.new has dist, server (no data or test), src/data JSON, package.json and DEPLOYED.txt; the app it replaces is kept as app.previous', () => {
  const dir = tempDir();
  try {
    const root = fakeCheckout(dir);
    const L = homeLayout(path.join(dir, 'home'));
    fs.mkdirSync(L.home);
    stageApp({ root, dist: path.join(root, 'dist'), staging: L.appNew, commit: 'aaa1111', now: new Date('2026-10-16T00:00:00Z') });
    const files = (d) => fs.readdirSync(d, { recursive: true }).map((f) => String(f).replace(/\\/g, '/')).sort();
    assert.deepEqual(files(L.appNew), [
      'DEPLOYED.txt',
      'dist',
      'dist/assets',
      'dist/assets/a.js',
      'dist/index.html',
      'package.json',
      'server',
      'server/generated',
      'server/generated/export-kit.mjs',
      'server/index.mjs',
      'server/lib',
      'server/lib/x.mjs',
      'src',
      'src/data',
      'src/data/kinds.json',
      'src/data/plans.json',
    ]);
    assert.deepEqual(swapInApp(L), { kept: false });
    assert.deepEqual(readDeployed(L.app), { commit: 'aaa1111', deployed: '2026-10-16T00:00:00.000Z', from: root });
    assert.ok(!fs.existsSync(L.appNew) && !fs.existsSync(L.appPrevious));

    stageApp({ root, dist: path.join(root, 'dist'), staging: L.appNew, commit: 'bbb2222' });
    assert.deepEqual(swapInApp(L), { kept: true });
    assert.equal(readDeployed(L.app).commit, 'bbb2222');
    assert.equal(readDeployed(L.appPrevious).commit, 'aaa1111');

    // A third deploy drops the oldest: only one previous app is kept.
    stageApp({ root, dist: path.join(root, 'dist'), staging: L.appNew, commit: 'ccc3333' });
    swapInApp(L);
    assert.equal(readDeployed(L.appPrevious).commit, 'bbb2222');

    // Rollback: previous back in place, the failed one kept; a second rollback has nothing to go to.
    assert.deepEqual(rollbackApp(L), { failedKept: true });
    assert.equal(readDeployed(L.app).commit, 'bbb2222');
    assert.equal(readDeployed(L.appFailed).commit, 'ccc3333');
    assert.ok(!fs.existsSync(L.appPrevious));
    assert.throws(() => rollbackApp(L), /There is no app\.previous to go back to/);
    assert.equal(readDeployed(L.app).commit, 'bbb2222', 'unchanged by the refused rollback');
  } finally {
    rm(dir);
  }
});

test('swapInApp puts the old app back when the new one can’t be moved in', () => {
  const dir = tempDir();
  try {
    const L = homeLayout(path.join(dir, 'home'));
    fs.mkdirSync(L.app, { recursive: true });
    fs.writeFileSync(path.join(L.app, 'DEPLOYED.txt'), 'commit old1234\n');
    // No app.new: the second rename fails.
    assert.throws(() => swapInApp(L), /ENOENT/);
    assert.equal(readDeployed(L.app).commit, 'old1234', 'the running app is where it was');
    assert.equal(readDeployed(path.join(dir, 'nowhere')), null);
  } finally {
    rm(dir);
  }
});

test('deploy-local refuses, changing nothing: an unknown option (2), no build in --dist (1), --rollback with no app.previous (1)', () => {
  const dir = tempDir();
  try {
    const home = path.join(dir, 'home');
    const run = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'deploy-local.mjs'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000, env: cleanEnv({ BLUMODEL_HOME: home, BLUMODEL_PORT: '8909' }) });
    assert.equal(run('--frobnicate').status, EXIT.USAGE);
    const nobuild = run('--dist', path.join(dir, 'empty'));
    assert.equal(nobuild.status, EXIT.REFUSED);
    assert.match(nobuild.stderr, /No build found in/);
    const rb = run('--rollback');
    assert.equal(rb.status, EXIT.REFUSED);
    assert.match(rb.stderr, WIN ? /Nothing to roll back to: .*app\.previous does not exist/ : /run it with sudo|Nothing to roll back to|no 'blumodel' account|is not installed/);
    assert.ok(!fs.existsSync(home), 'no home was made');
  } finally {
    rm(dir);
  }
});
