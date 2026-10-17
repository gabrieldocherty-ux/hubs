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

// ── 2. starting on boot with nobody logged in ────────────────────────────

/** A systemd unit as { Section: { Key: [values] } } (comments and blank lines skipped). */
function parseUnit(text) {
  const out = {};
  let section = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const s = /^\[(\w+)\]$/.exec(line);
    if (s) {
      section = out[s[1]] = {};
      continue;
    }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(line);
    assert.ok(kv && section, `a key=value line inside a section: ${line}`);
    (section[kv[1]] ??= []).push(kv[2]);
  }
  return out;
}

test('blumodel-studio.service: node server/index.mjs --prod from <home>/app as blumodel, production, restarted for ever, writes only data and logs, sandboxed', async () => {
  const { systemdServerUnit } = await import('../ops/home.mjs');
  const text = systemdServerUnit();
  assert.ok(!text.includes('\r'), 'LF only');
  const u = parseUnit(text);
  assert.deepEqual(Object.keys(u), ['Unit', 'Service', 'Install']);
  const S = u.Service;
  assert.deepEqual(S.ExecStart, ['/usr/bin/node --no-warnings /srv/blumodel-studio/app/server/index.mjs --prod']);
  assert.deepEqual(S.WorkingDirectory, ['/srv/blumodel-studio/app']);
  assert.deepEqual([S.User, S.Group], [['blumodel'], ['blumodel']]);
  assert.deepEqual(S.Environment, [
    'NODE_ENV=production',
    'PORT=8790',
    'HOST=127.0.0.1',
    'DB_PATH=/srv/blumodel-studio/data/blumodel.db',
    'BLUMODEL_ENV_FILE=/srv/blumodel-studio/blumodel.env',
    'BLUMODEL_LOG_FILE=/srv/blumodel-studio/logs/server.log',
  ]);
  assert.ok(!S.Environment.some((e) => /^(DEMO_PAYMENTS|STRIPE_|PAYMENTS|NODE_OPTIONS)/.test(e)), 'the settings file alone decides payments');
  assert.deepEqual([S.Restart, S.RestartSec, S.KillSignal, S.TimeoutStopSec], [['always'], ['5'], ['SIGTERM'], ['30']]);
  assert.deepEqual(u.Unit.StartLimitIntervalSec, ['0'], 'never stops retrying');
  assert.deepEqual(S.ReadWritePaths, ['/srv/blumodel-studio/data /srv/blumodel-studio/logs']);
  for (const [k, v] of Object.entries({ NoNewPrivileges: 'yes', ProtectSystem: 'strict', ProtectHome: 'yes', PrivateTmp: 'yes', PrivateDevices: 'yes', RestrictSUIDSGID: 'yes', CapabilityBoundingSet: '', UMask: '0027' })) assert.deepEqual(S[k], [v], k);
  assert.equal(S.MemoryDenyWriteExecute, undefined, 'Node’s JIT needs it off');
  assert.deepEqual(u.Install.WantedBy, ['multi-user.target']);
  // Another home, port and node: all follow; unsafe values are refused rather than written.
  const other = parseUnit(systemdServerUnit({ home: '/opt/bms', port: 8899, node: '/usr/local/bin/node', user: 'bms' })).Service;
  assert.deepEqual(other.ExecStart, ['/usr/local/bin/node --no-warnings /opt/bms/app/server/index.mjs --prod']);
  assert.ok(other.Environment.includes('PORT=8899') && other.Environment.includes('DB_PATH=/opt/bms/data/blumodel.db'));
  assert.deepEqual(other.User, ['bms']);
  assert.throws(() => systemdServerUnit({ home: '/srv/blu model' }), /absolute path/);
  assert.throws(() => systemdServerUnit({ home: 'srv/blumodel' }), /absolute path/);
  assert.throws(() => systemdServerUnit({ home: '/srv/../etc' }), /absolute path/);
  assert.throws(() => systemdServerUnit({ node: 'C:\\Program Files\\nodejs\\node.exe' }), /absolute path/);
  assert.throws(() => systemdServerUnit({ user: 'root; rm' }), /Not a user name/);
  assert.throws(() => systemdServerUnit({ port: '87 90' }), /Not a port/);
});

test('blumodel-tunnel.service: cloudflared with <home>/cloudflared.yml as blumodel, after and wanting the server and the network, restarted for ever, sandboxed', async () => {
  const { systemdTunnelUnit } = await import('../ops/home.mjs');
  const text = systemdTunnelUnit();
  assert.ok(!text.includes('\r'));
  const u = parseUnit(text);
  assert.deepEqual(u.Service.ExecStart, ['/usr/bin/cloudflared tunnel --config /srv/blumodel-studio/cloudflared.yml --no-autoupdate run']);
  assert.deepEqual(u.Unit.After, ['network-online.target blumodel-studio.service']);
  assert.deepEqual(u.Unit.Wants, ['network-online.target blumodel-studio.service']);
  assert.deepEqual([u.Service.User, u.Service.Restart, u.Service.RestartSec], [['blumodel'], ['always'], ['10']]);
  for (const k of ['NoNewPrivileges', 'ProtectHome', 'PrivateTmp']) assert.deepEqual(u.Service[k], ['yes'], k);
  assert.deepEqual(u.Service.ProtectSystem, ['strict']);
  assert.equal(u.Service.ReadWritePaths, undefined, 'the tunnel writes nothing');
  assert.match(text, /Enable it only at the cutover/);
  assert.ok(!/\btoken\b|login|route|delete/i.test(u.Service.ExecStart[0]), 'it only ever runs the tunnel');
});

test('the Linux install plan: both unit files, daemon-reload, the server enabled; the tunnel enabled only when asked (the cutover); --only filters', async () => {
  const { systemdInstallPlan, systemdUnits } = await import('../ops/home.mjs');
  const units = systemdUnits();
  const plan = systemdInstallPlan({ units });
  assert.deepEqual(plan.writes.map((w) => w.file), ['/etc/systemd/system/blumodel-studio.service', '/etc/systemd/system/blumodel-tunnel.service']);
  assert.deepEqual(plan.commands, [['systemctl', 'daemon-reload'], ['systemctl', 'enable', 'blumodel-studio.service']]);
  assert.ok(!plan.commands.flat().includes('start') && !plan.commands.flat().includes('--now'), 'never starts anything');
  assert.deepEqual(systemdInstallPlan({ units, enableTunnel: true }).commands.at(-1), ['systemctl', 'enable', 'blumodel-tunnel.service']);
  const t = systemdInstallPlan({ units, only: 'tunnel' });
  assert.deepEqual(t.writes.map((w) => path.posix.basename(w.file)), ['blumodel-tunnel.service']);
  assert.deepEqual(t.commands, [['systemctl', 'daemon-reload']]);
});

test('Windows tasks at startup: a boot trigger (30 s delay) and a stored-password logon instead of logon + interactive token; the logon definition is unchanged', async () => {
  const { homeTasks, taskXml } = await import('../ops/home.mjs');
  const boot = homeTasks('C:\\Users\\owner\\Projects\\BluModelStudio', 'WYSE\\owner', { atStartup: true });
  assert.deepEqual(boot.map((t) => t.name), ['BluModelStudioServer', 'BluModelTunnel']);
  for (const t of boot) {
    assert.match(t.xml, /<BootTrigger>\s*<Delay>PT30S<\/Delay>\s*<\/BootTrigger>/);
    assert.doesNotMatch(t.xml, /LogonTrigger|InteractiveToken/);
    assert.match(t.xml, /<UserId>WYSE\\owner<\/UserId>\s*<LogonType>Password<\/LogonType>\s*<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(t.xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    assert.match(t.xml, /when Windows starts \(whether or not anyone is signed in\)/);
    assert.doesNotMatch(t.xml, /<Password>|<RunAsPassword/i, 'no password is ever in a definition');
  }
  const logon = homeTasks('C:\\Users\\owner\\Projects\\BluModelStudio', 'WYSE\\owner');
  assert.match(logon[0].xml, /<LogonTrigger>\s*<UserId>WYSE\\owner<\/UserId>\s*<\/LogonTrigger>/);
  assert.match(logon[0].xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.equal(taskXml({ name: 'T', description: 'd', launcher: 'C:\\a.vbs', workingDir: 'C:\\', user: 'u' }), taskXml({ name: 'T', description: 'd', launcher: 'C:\\a.vbs', workingDir: 'C:\\', user: 'u', trigger: 'logon' }));
  assert.throws(() => taskXml({ name: 'T', description: 'd', launcher: 'a', workingDir: 'b', user: 'u', trigger: 'idle' }), /Not a trigger/);
  if (WIN) {
    // The definition parses as XML (read-only, as register-tasks checks them).
    const dir = tempDir();
    try {
      const file = path.join(dir, 't.xml');
      fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(boot[0].xml.replace(/\r?\n/g, '\r\n'), 'utf16le')]));
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', `$x = [xml](Get-Content -Raw -Encoding Unicode -LiteralPath '${file}'); $x.Task.Triggers.BootTrigger.Delay`], { encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.trim(), 'PT30S');
    } finally {
      rm(dir);
    }
  }
});

test('register-tasks --dry-run --at-startup: asks schtasks for the password (/RU <account> /RP *, never a password), lists the tasks for startup-tasks, changes nothing', { skip: !WIN }, () => {
  const home = tempDir('blumodel-tasks-');
  try {
    const cli = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'register-tasks.mjs'), '--dry-run', '--at-startup', '--home', home, '--user', 'WYSE\\owner', ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const r = cli();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /BluModelStudioServer: when Windows starts, as WYSE\\owner \(signed in or not\), runs wscript\.exe ".*start-hidden\.vbs"/);
    assert.match(r.stdout, /would run: schtasks \/Create \/TN BluModelStudioServer \/XML "<the definition below>" \/RU WYSE\\owner \/RP \* \/F/);
    assert.match(r.stdout, /would run: schtasks \/Create \/TN BluModelTunnel \/XML "<the definition below>" \/RU WYSE\\owner \/RP \* \/F/);
    assert.match(r.stdout, /<BootTrigger>/);
    assert.match(r.stdout, /would list BluModelStudioServer, BluModelTunnel in .*startup-tasks/);
    assert.match(r.stdout, /Dry run: no task was created, changed or deleted\./);
    assert.ok(!fs.existsSync(path.join(home, 'startup-tasks')));
    const one = cli('--only', 'server');
    assert.equal(one.status, 0);
    assert.doesNotMatch(one.stdout, /BluModelTunnel/);
  } finally {
    rm(home);
  }
});

test('register-tasks --dry-run --platform linux prints the two units and the systemctl commands (server enabled, tunnel not), and refuses --platform without --dry-run', () => {
  const cli = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'register-tasks.mjs'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const r = cli('--dry-run', '--platform', 'linux', '--home', '/srv/blumodel-studio');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^would write \/etc\/systemd\/system\/blumodel-studio\.service$/m);
  assert.match(r.stdout, /^would write \/etc\/systemd\/system\/blumodel-tunnel\.service$/m);
  assert.match(r.stdout, /^ {4}ExecStart=\/usr\/bin\/node --no-warnings \/srv\/blumodel-studio\/app\/server\/index\.mjs --prod$/m);
  assert.match(r.stdout, /^ {4}ExecStart=\/usr\/bin\/cloudflared tunnel --config \/srv\/blumodel-studio\/cloudflared\.yml --no-autoupdate run$/m);
  assert.match(r.stdout, /^would run: systemctl daemon-reload$/m);
  assert.match(r.stdout, /^would run: systemctl enable blumodel-studio\.service$/m);
  assert.doesNotMatch(r.stdout, /would run: systemctl enable blumodel-tunnel/);
  assert.match(r.stdout, /blumodel-tunnel\.service is installed but NOT enabled\. At the cutover .*sudo systemctl enable --now blumodel-tunnel\.service/);
  assert.match(r.stdout, /Dry run: no unit was written, enabled or started\./);
  const t = cli('--dry-run', '--platform', 'linux', '--enable-tunnel', '--port', '8899', '--home', '/opt/bms');
  assert.equal(t.status, 0, t.stderr);
  assert.match(t.stdout, /^would run: systemctl enable blumodel-tunnel\.service$/m);
  assert.match(t.stdout, /Environment=PORT=8899/);
  assert.match(t.stdout, /WorkingDirectory=\/opt\/bms\/app/);
  if (process.platform !== 'linux') assert.equal(cli('--platform', 'linux').status, 2, 'only a dry run may pretend to be Linux');
  assert.equal(cli('--dry-run', '--platform', 'linux', '--home', '/srv/blu model').status, 2, 'a home systemd would need quoting is refused');
  assert.equal(cli('--dry-run', '--only', 'both').status, 2);
});

test('register-tasks on Linux without root refuses before writing a unit', { skip: process.platform !== 'linux' || process.getuid?.() === 0 }, () => {
  const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'register-tasks.mjs')], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs root/);
});

// ── 3. install, build and update ─────────────────────────────────────────

const MB = 1024 * 1024;

test('the build’s memory guard: half the RAM (1024-2048 MB heap); refused with the swap-file fix under 2 GB of RAM + swap', async () => {
  const { buildMemoryPlan, parseMeminfo, machineMemory } = await import('../../scripts/host/lib.mjs');
  const wyse4 = buildMemoryPlan({ ram: 3800 * MB, swap: 0, platform: 'linux' });
  assert.deepEqual([wyse4.ok, wyse4.heapMb], [true, 1900], 'a 4 GB Wyse');
  assert.equal(buildMemoryPlan({ ram: 7800 * MB, swap: 2048 * MB }).heapMb, 2048, 'capped at 2 GB');
  assert.deepEqual(buildMemoryPlan({ ram: 1024 * MB, swap: 1024 * MB }), { ok: true, ramMb: 1024, swapMb: 1024, heapMb: 1024, message: 'Building with a 1024 MB heap (RAM 1024 MB, swap 1024 MB).' });
  const small = buildMemoryPlan({ ram: 1500 * MB, swap: 0, platform: 'linux' });
  assert.equal(small.ok, false);
  assert.match(small.message, /1500 MB of RAM and 0 MB of swap\. Building BluModel Studio needs about 2048 MB/);
  assert.match(small.message, /sudo fallocate -l 2G \/swapfile && sudo chmod 600 \/swapfile && sudo mkswap \/swapfile && sudo swapon \/swapfile/);
  assert.match(small.message, /deploy-local\.mjs --dist <folder>/);
  assert.match(buildMemoryPlan({ ram: 1500 * MB, platform: 'win32' }).message, /Virtual memory/);
  assert.deepEqual(parseMeminfo('MemTotal:        3891204 kB\nMemFree:  100 kB\nSwapTotal:       2097148 kB\n'), { ram: 3891204 * 1024, swap: 2097148 * 1024 });
  assert.deepEqual(parseMeminfo(''), { ram: 0, swap: 0 });
  assert.deepEqual(machineMemory({ platform: 'linux', readFile: () => 'MemTotal: 4000 kB\nSwapTotal: 1000 kB\n' }), { ram: 4000 * 1024, swap: 1000 * 1024 });
  assert.deepEqual(machineMemory({ platform: 'win32', totalmem: () => 42 }), { ram: 42, swap: 0 });
});

test('build.mjs: build-kit then vite into dist with NODE_OPTIONS=--max-old-space-size; --dry-run prints them and builds nothing', async () => {
  const { buildSteps } = await import('../../scripts/host/build.mjs');
  const steps = buildSteps({ root: '/srv/blumodel-studio/repo/blumodel-studio', heapMb: 1900, node: '/usr/bin/node', out: 'dist' });
  assert.deepEqual(steps.map((s) => s.env), [{ NODE_OPTIONS: '--max-old-space-size=1900' }, { NODE_OPTIONS: '--max-old-space-size=1900' }]);
  assert.match(steps[0].args[0], /scripts[\\/]build-kit\.mjs$/);
  assert.match(steps[1].args[0], /node_modules[\\/]vite[\\/]bin[\\/]vite\.js$/);
  assert.deepEqual(steps[1].args.slice(1), ['build', '--outDir', 'dist', '--emptyOutDir']);
  const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'host', 'build.mjs'), '--dry-run', '--out', '.build/never'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Building with a \d+ MB heap/);
  assert.match(r.stdout, /\+ NODE_OPTIONS=--max-old-space-size=\d+ .*vite\.js.* build --outDir \.build\/never --emptyOutDir/);
  assert.ok(!fs.existsSync(path.join(ROOT, '.build', 'never')));
  assert.equal(spawnSync(NODE, [path.join(ROOT, 'scripts', 'host', 'build.mjs'), '--bogus'], { windowsHide: true }).status, 2);
});

test('update: the home is the one the checkout sits in (<home>/repo/blumodel-studio), else the platform’s default; npm runs from npm-cli.js beside node', async () => {
  const { inferHome, npmCommand } = await import('../../scripts/host/update.mjs');
  const has = (set) => (p) => set.includes(p.replace(/\\/g, '/'));
  assert.equal(inferHome('/srv/blumodel-studio/repo/blumodel-studio', { platform: 'linux', exists: has(['/srv/blumodel-studio/data']) }), '/srv/blumodel-studio');
  assert.equal(inferHome('/opt/bms/repo/blumodel-studio', { platform: 'linux', exists: has(['/opt/bms/app']) }), '/opt/bms');
  assert.equal(inferHome('/home/me/code/blumodel-studio', { platform: 'linux', exists: () => true }), '/srv/blumodel-studio', 'a checkout elsewhere: the default home');
  assert.equal(inferHome('D:\\BMS\\repo\\blumodel-studio', { platform: 'win32', exists: has(['D:/BMS/data']) }), 'D:\\BMS');
  assert.deepEqual(npmCommand({ platform: 'linux', node: '/usr/bin/node', exists: () => true }), { cmd: '/usr/bin/node', pre: ['/usr/lib/node_modules/npm/bin/npm-cli.js'], shell: false });
  assert.deepEqual(npmCommand({ platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe', exists: () => true }), { cmd: 'C:\\Program Files\\nodejs\\node.exe', pre: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'], shell: false });
  assert.deepEqual(npmCommand({ platform: 'linux', exists: () => false }), { cmd: 'npm', pre: [], shell: false });
});

/**
 * A fake machine for runUpdate: records every command, answers git questions, and returns the
 * deploy's and rollback's exit codes from `codes`.
 */
function fakeExec({ dirty = '', pullStatus = 0, commit = 'new5678', deploy = 0, rollback = 0, npm = 0, build = 0 } = {}) {
  const calls = [];
  const exec = (cmd, args, opts) => {
    const all = [cmd, ...args];
    calls.push({ line: all.join(' '), env: opts.env ?? null });
    const has = (s) => all.some((a) => String(a).endsWith(s) || a === s);
    if (has('status')) return { status: 0, stdout: dirty };
    if (has('pull')) return { status: pullStatus, stdout: '' };
    if (has('rev-parse')) return { status: 0, stdout: `${commit}\n` };
    if (has('ci')) return { status: npm, stdout: '' };
    if (all.some((a) => /build\.mjs$/.test(a))) return { status: build, stdout: '' };
    if (has('--rollback')) return { status: rollback, stdout: '' };
    if (all.some((a) => /deploy-local\.mjs$/.test(a))) return { status: deploy, stdout: '' };
    return { status: 0, stdout: '' };
  };
  return { exec, calls };
}

/** A home whose app/DEPLOYED.txt says `commit`. */
function homeWithApp(commit) {
  const home = tempDir('blumodel-uphome-');
  fs.mkdirSync(path.join(home, 'app'), { recursive: true });
  if (commit) fs.writeFileSync(path.join(home, 'app', 'DEPLOYED.txt'), `commit ${commit}\n`);
  return home;
}

test('runUpdate: refuses on local changes or a pull that can’t fast-forward; stops when the commit is already deployed; otherwise npm ci, build, deploy in that order', async () => {
  const { runUpdate } = await import('../../scripts/host/update.mjs');
  const home = homeWithApp('old1234');
  try {
    const base = { root: path.join(home, 'repo', 'blumodel-studio'), home, platform: process.platform, out: () => {} };
    let f = fakeExec({ dirty: ' M src/app.tsx\n' });
    assert.equal(runUpdate({ ...base, exec: f.exec }).code, EXIT.REFUSED);
    assert.equal(f.calls.length, 1, 'stopped after git status');

    f = fakeExec({ pullStatus: 1 });
    assert.equal(runUpdate({ ...base, exec: f.exec }).code, EXIT.REFUSED);
    assert.ok(!f.calls.some((c) => / ci /.test(` ${c.line} `)), 'nothing installed');

    f = fakeExec({ commit: 'old1234' });
    assert.deepEqual(runUpdate({ ...base, exec: f.exec }), { code: EXIT.OK, deployed: 'old1234' });
    assert.ok(!f.calls.some((c) => /deploy-local/.test(c.line)), 'already deployed: nothing redeployed');
    f = fakeExec({ commit: 'old1234' });
    assert.equal(runUpdate({ ...base, exec: f.exec, force: true }).deployed, 'old1234', '--force redeploys');
    assert.ok(f.calls.some((c) => /deploy-local/.test(c.line)));

    f = fakeExec({ npm: 1 });
    assert.equal(runUpdate({ ...base, exec: f.exec }).code, EXIT.REFUSED);
    assert.ok(!f.calls.some((c) => /deploy-local/.test(c.line)), 'a failed npm ci never reaches the deploy');
    f = fakeExec({ build: 1 });
    assert.equal(runUpdate({ ...base, exec: f.exec }).code, EXIT.REFUSED);
    assert.ok(!f.calls.some((c) => /deploy-local/.test(c.line)), 'a failed build never reaches the deploy');

    f = fakeExec();
    const out = [];
    assert.deepEqual(runUpdate({ ...base, exec: f.exec, out: (s) => out.push(s) }), { code: EXIT.OK, deployed: 'new5678' });
    const order = f.calls.map((c) => (/status/.test(c.line) ? 'status' : /pull/.test(c.line) ? 'pull' : /rev-parse/.test(c.line) ? 'rev-parse' : / ci /.test(` ${c.line} `) ? 'ci' : /build\.mjs/.test(c.line) ? 'build' : /deploy-local/.test(c.line) ? 'deploy' : c.line));
    assert.deepEqual(order, ['status', 'pull', 'rev-parse', 'ci', 'build', 'deploy']);
    const deploy = f.calls.at(-1);
    assert.match(deploy.line, /deploy-local\.mjs --dist .*dist --commit new5678$/);
    assert.deepEqual(deploy.env, { BLUMODEL_HOME: home }, 'deploys into the home it checked');
    assert.match(out.join('\n'), /Updated: commit new5678 is running\./);
  } finally {
    rm(home);
  }
});

test('runUpdate rolls back when the new app fails its health check (deploy exit 3), never when the deploy refused; a failed rollback says the site may be down', async () => {
  const { runUpdate } = await import('../../scripts/host/update.mjs');
  const home = homeWithApp('old1234');
  try {
    const base = { root: path.join(home, 'repo', 'blumodel-studio'), home, platform: process.platform };
    let out = [];
    let f = fakeExec({ deploy: EXIT.UNHEALTHY });
    assert.equal(runUpdate({ ...base, exec: f.exec, out: (s) => out.push(s) }).code, EXIT.REFUSED);
    assert.match(f.calls.at(-1).line, /deploy-local\.mjs --rollback$/);
    assert.deepEqual(f.calls.at(-1).env, { BLUMODEL_HOME: home });
    assert.match(out.join('\n'), /ROLLED BACK: commit old1234 is running again; new5678 did not start healthy/);

    out = [];
    f = fakeExec({ deploy: EXIT.UNHEALTHY, rollback: EXIT.UNHEALTHY });
    assert.equal(runUpdate({ ...base, exec: f.exec, out: (s) => out.push(s) }).code, EXIT.UNHEALTHY);
    assert.match(out.join('\n'), /THE ROLLBACK FAILED TOO/);

    f = fakeExec({ deploy: EXIT.REFUSED });
    assert.equal(runUpdate({ ...base, exec: f.exec, out: () => {} }).code, EXIT.REFUSED);
    assert.ok(!f.calls.some((c) => /--rollback/.test(c.line)), 'nothing was swapped, so nothing to roll back');

    // The script changed with the pull: hand over to the new one before doing anything else.
    f = fakeExec();
    assert.deepEqual(runUpdate({ ...base, exec: f.exec, out: () => {}, afterPull: () => true }), { code: EXIT.OK, reexec: true });
    assert.deepEqual(f.calls.map((c) => c.line.split(' ').slice(-2).join(' ')), ['--porcelain --untracked-files=no', 'pull --ff-only']);
  } finally {
    rm(home);
  }
});

test('runUpdate on Linux as root: git, npm and the build run as the checkout’s owner (runuser, HOME = the home); the deploy and rollback run as root', async () => {
  const { runUpdate } = await import('../../scripts/host/update.mjs');
  const f = fakeExec({ deploy: EXIT.UNHEALTHY });
  runUpdate({ root: '/srv/blumodel-studio/repo/blumodel-studio', home: '/srv/blumodel-studio', platform: 'linux', serviceUser: 'blumodel', asRoot: true, node: '/usr/bin/node', exec: f.exec, out: () => {} });
  const svc = 'runuser -u blumodel -- env HOME=/srv/blumodel-studio PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  const lines = f.calls.map((c) => c.line);
  assert.equal(lines[0], `${svc} git -C /srv/blumodel-studio/repo/blumodel-studio status --porcelain --untracked-files=no`);
  assert.equal(lines[1], `${svc} git -C /srv/blumodel-studio/repo/blumodel-studio pull --ff-only`);
  assert.ok(lines.some((l) => l.startsWith(svc) && / ci --no-audit --no-fund$/.test(l)), 'npm ci as blumodel');
  assert.ok(lines.includes(`${svc} /usr/bin/node /srv/blumodel-studio/repo/blumodel-studio/scripts/host/build.mjs --out dist`));
  assert.ok(lines.includes('/usr/bin/node /srv/blumodel-studio/repo/blumodel-studio/scripts/deploy-local.mjs --dist /srv/blumodel-studio/repo/blumodel-studio/dist --commit new5678'));
  assert.ok(lines.includes('/usr/bin/node /srv/blumodel-studio/repo/blumodel-studio/scripts/deploy-local.mjs --rollback'));
});

test('update.mjs --dry-run --platform linux prints the whole plan, the rollback it would run, and runs nothing; --platform needs --dry-run', () => {
  const cli = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'host', 'update.mjs'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000, env: cleanEnv() });
  const r = cli('--dry-run', '--platform', 'linux');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const re of [
    /checkout \/srv\/blumodel-studio\/repo\/blumodel-studio, home \/srv\/blumodel-studio/,
    /\+ runuser -u blumodel -- .* git -C \/srv\/blumodel-studio\/repo\/blumodel-studio pull --ff-only/,
    /\+ runuser -u blumodel -- .* npm ci --no-audit --no-fund/,
    /\+ runuser -u blumodel -- .* \/usr\/bin\/node .*build\.mjs --out dist/,
    /\+ BLUMODEL_HOME=\/srv\/blumodel-studio \/usr\/bin\/node .*deploy-local\.mjs --dist .*dist --commit/,
    /Only if that health check fails: rolling back/,
    /\+ BLUMODEL_HOME=\/srv\/blumodel-studio \/usr\/bin\/node .*deploy-local\.mjs --rollback/,
    /Dry run: nothing was pulled, built, deployed or restarted\./,
  ])
    assert.match(r.stdout, re);
  if (process.platform !== 'linux') assert.equal(cli('--platform', 'linux').status, EXIT.USAGE);
  assert.equal(cli('--bogus').status, EXIT.USAGE);
});

// ── the scripts themselves ───────────────────────────────────────────────

const HOST_DIR = path.join(ROOT, 'scripts', 'host');
const shellScripts = fs.readdirSync(HOST_DIR).filter((f) => f.endsWith('.sh'));

/** A real bash: on Windows Git's (never System32\bash.exe, the WSL launcher, which has no Linux here). */
function findBash() {
  if (!WIN) return spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? 'bash' : null;
  const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const r of roots) for (const rel of ['Git\\bin\\bash.exe', 'Git\\usr\\bin\\bash.exe']) if (fs.existsSync(path.join(r, rel))) return path.join(r, rel);
  return null;
}
const BASH = findBash();

test('every shell script: LF line ends only, a bash shebang, `set -euo pipefail`, and `bash -n` passes', { skip: !BASH && 'no bash here' }, () => {
  assert.deepEqual(shellScripts.sort(), ['install-linux.sh', 'update-linux.sh']);
  assert.match(fs.readFileSync(path.join(HOST_DIR, '.gitattributes'), 'utf8'), /^\*\.sh text eol=lf$/m);
  for (const f of shellScripts) {
    const file = path.join(HOST_DIR, f);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('\r'), `${f} has CR characters`);
    assert.ok(text.startsWith('#!/usr/bin/env bash\n'), f);
    assert.match(text, /^set -euo pipefail$/m, f);
    assert.ok(/^[\x00-\x7f]*$/.test(text), `${f} is ASCII`);
    const r = spawnSync(BASH, ['-n', file], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `bash -n ${f}: ${r.stderr}`);
  }
});

test('install-linux.sh --dry-run prints every step (apt repos, the account, the sparse clone, npm ci, the build, the units, the deploy, the tunnel config) and runs none', { skip: !BASH && 'no bash here', timeout: 120_000 }, () => {
  // A PATH without node or cloudflared on Windows, so the NodeSource and Cloudflare steps show too.
  const env = cleanEnv(WIN ? { PATH: '/usr/bin:/bin' } : {});
  const run = (...a) => spawnSync(BASH, [path.join(HOST_DIR, 'install-linux.sh'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 90_000, env });
  const r = run('--dry-run', '--home', '/srv/blumodel-dryrun', '--port', '8899');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const o = r.stdout;
  for (const re of [
    /DRY RUN: every command is printed/,
    /\+ useradd --system --user-group --home-dir \/srv\/blumodel-dryrun --no-create-home --shell \/usr\/sbin\/nologin --comment BluModel\\ Studio blumodel/,
    /\+ install -d -m 0750 -o blumodel -g blumodel \/srv\/blumodel-dryrun \/srv\/blumodel-dryrun\/data \/srv\/blumodel-dryrun\/logs/,
    /\+ install -d -m 0700 -o blumodel -g blumodel \/srv\/blumodel-dryrun\/\.cloudflared/,
    /\+ runuser -u blumodel -- env -C \/srv\/blumodel-dryrun HOME=\/srv\/blumodel-dryrun PATH=\S+ git clone --filter=blob:none --sparse --branch blumodel-studio --single-branch https:\/\/github\.com\/gabrieldocherty-ux\/hubs\.git \/srv\/blumodel-dryrun\/repo/,
    /git sparse-checkout set blumodel-studio/,
    /env -C \/srv\/blumodel-dryrun\/repo\/blumodel-studio HOME=\/srv\/blumodel-dryrun PATH=\S+ npm ci --no-audit --no-fund/,
    /node scripts\/host\/build\.mjs --out dist/,
    /\+ node \/srv\/blumodel-dryrun\/repo\/blumodel-studio\/scripts\/register-tasks\.mjs --home \/srv\/blumodel-dryrun --user blumodel --port 8899 --node \S+ --cloudflared \S+/,
    /\+ env BLUMODEL_HOME=\/srv\/blumodel-dryrun BLUMODEL_PORT=8899 node \/srv\/blumodel-dryrun\/repo\/blumodel-studio\/scripts\/deploy-local\.mjs --dist \/srv\/blumodel-dryrun\/repo\/blumodel-studio\/dist --commit/,
    /\+ node \/srv\/blumodel-dryrun\/repo\/blumodel-studio\/scripts\/tunnel\/setup-tunnel\.mjs --home \/srv\/blumodel-dryrun --port 8899 --validate/,
    /sudo systemctl enable --now blumodel-tunnel/,
    /Dry run: nothing was installed, written, started or changed\./,
  ])
    assert.match(o, re);
  if (/Installing Node\.js/.test(o)) {
    assert.match(o, /\+ curl -fsSL https:\/\/deb\.nodesource\.com\/gpgkey\/nodesource-repo\.gpg\.key \| gpg --dearmor --yes -o \/etc\/apt\/keyrings\/nodesource\.gpg/);
    assert.match(o, /deb \[signed-by=\/etc\/apt\/keyrings\/nodesource\.gpg\] https:\/\/deb\.nodesource\.com\/node_24\.x nodistro main/);
    assert.match(o, /apt-get install -y nodejs/);
  }
  if (/Installing cloudflared/.test(o)) {
    assert.match(o, /\+ curl -fsSL https:\/\/pkg\.cloudflare\.com\/cloudflare-main\.gpg -o \/usr\/share\/keyrings\/cloudflare-main\.gpg/);
    assert.match(o, /deb \[signed-by=\/usr\/share\/keyrings\/cloudflare-main\.gpg\] https:\/\/pkg\.cloudflare\.com\/cloudflared any main/);
    assert.match(o, /apt-get install -y cloudflared/);
  }
  // The tunnel is never started by the install, and no command line carries a secret.
  assert.doesNotMatch(o, /^\+ .*systemctl (start|enable).*blumodel-tunnel/m);
  assert.doesNotMatch(o, /^\+ .*(cloudflared (tunnel|service) (run|login|route|create|delete|token|install)|--token)/m);
  // Bad input is refused before anything.
  assert.equal(run('--home', 'relative/path').status, 1);
  assert.equal(run('--home', '/srv/with space').status, 1);
  assert.equal(run('--frobnicate').status, 2);
});

test('update-linux.sh: needs sudo (unless --dry-run) and hands everything to update.mjs', { skip: !BASH && 'no bash here' }, () => {
  const text = fs.readFileSync(path.join(HOST_DIR, 'update-linux.sh'), 'utf8');
  assert.match(text, /exec node "\$APP_SRC\/scripts\/host\/update\.mjs" "\$@"/);
  if (!WIN && process.getuid?.() !== 0) {
    const r = spawnSync(BASH, [path.join(HOST_DIR, 'update-linux.sh')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Run it with sudo/);
  }
});

test('install-windows.ps1: ASCII only, parses, and -DryRun prints every step (never installing software, never starting the tunnel) and changes nothing', { skip: !WIN, timeout: 120_000 }, () => {
  const file = path.join(HOST_DIR, 'install-windows.ps1');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(/^[\x00-\x7f]*$/.test(text), 'Windows PowerShell 5.1 reads a BOM-less script as ANSI: keep it ASCII');
  assert.doesNotMatch(text.replace(/^\s*#.*$/gm, ''), /winget install(?![^'"]*['"])/, 'winget only appears inside printed text');
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const parse = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);$e.Count`], { encoding: 'utf8', windowsHide: true });
  assert.equal(parse.stdout.trim(), '0', parse.stdout + parse.stderr);
  const dir = tempDir('blumodel-winst-');
  const home = path.join(dir, 'Home');
  try {
    const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-DryRun', '-HomeDir', home, '-Port', '8903'], { encoding: 'utf8', windowsHide: true, timeout: 90_000, env: cleanEnv() });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const o = r.stdout;
    for (const re of [
      /git clone --filter=blob:none --sparse --branch blumodel-studio --single-branch https:\/\/github\.com\/gabrieldocherty-ux\/hubs\.git .*Home\\repo/,
      /sparse-checkout set blumodel-studio/,
      /\+ npm\.cmd ci --no-audit --no-fund/,
      /\+ node scripts\\host\\build\.mjs --out dist/,
      /\+ node scripts\\deploy-local\.mjs --dist .*Home\\repo\\blumodel-studio\\dist --commit <commit>/,
      /\+ node scripts\\tunnel\\setup-tunnel\.mjs --home .*Home --port 8903 --validate/,
      /\+ node scripts\\register-tasks\.mjs --home .*Home --at-startup --only server/,
      /--at-startup --only tunnel/,
      /Dry run: nothing was installed, written, started or changed\./,
    ])
      assert.match(o, re);
    assert.doesNotMatch(o, /^\+ .*schtasks \/Run \/TN BluModelTunnel/m, 'the tunnel is never started by the install');
    assert.ok(!fs.existsSync(home), 'nothing was made');
  } finally {
    rm(dir);
  }
});

// ── 4. the tunnel on another machine ─────────────────────────────────────

test('the tunnel’s credentials: %USERPROFILE%\\.cloudflared\\<id>.json on Windows, <home>/.cloudflared/<id>.json on Linux (readable by blumodel)', async () => {
  const { TUNNEL_ID, credentialsFor } = await import('../../scripts/tunnel/tunnel.mjs');
  assert.equal(credentialsFor({ platform: 'win32', homedir: 'C:\\Users\\owner' }), `C:\\Users\\owner\\.cloudflared\\${TUNNEL_ID}.json`);
  assert.equal(credentialsFor({ platform: 'linux', home: '/srv/blumodel-studio' }), `/srv/blumodel-studio/.cloudflared/${TUNNEL_ID}.json`);
  assert.equal(credentialsFor({ platform: 'linux', home: '/opt/bms', id: '00000000-0000-0000-0000-000000000000' }), '/opt/bms/.cloudflared/00000000-0000-0000-0000-000000000000.json');
});

test('cloudflared.yml on Linux: the same tunnel and ingress as on Windows, the credentials under the home, and says blumodel-tunnel.service runs it', async () => {
  const { tunnelConfigYaml, TUNNEL_ID } = await import('../../scripts/tunnel/tunnel.mjs');
  const creds = `/srv/blumodel-studio/.cloudflared/${TUNNEL_ID}.json`;
  const lin = tunnelConfigYaml({ credentials: creds, platform: 'linux' });
  const win = tunnelConfigYaml({ credentials: creds, platform: 'win32' });
  const body = (y) => y.split('\n').filter((l) => !l.startsWith('#')).join('\n');
  assert.equal(body(lin), body(win), 'only the comment differs');
  assert.match(lin, new RegExp(`^credentials-file: '/srv/blumodel-studio/\\.cloudflared/${TUNNEL_ID}\\.json'$`, 'm'));
  assert.match(lin, /^# Run by blumodel-tunnel\.service \(systemd\)\. .*sudo systemctl restart blumodel-tunnel\.$/m);
  assert.match(win, /^# Run by run-tunnel\.cmd \(the BluModelTunnel task starts it\)\./m);
  assert.match(lin, /^ {2}- hostname: blumodel\.studio\n {4}service: http:\/\/127\.0\.0\.1:8790\n/m);
  assert.match(lin, /^ {2}- hostname: '\*\.blumodel\.studio'\n {4}service: http:\/\/127\.0\.0\.1:8790\n/m);
  assert.ok(lin.trimEnd().endsWith('- service: http://127.0.0.1:8790'));
  assert.ok(!lin.includes('\r'));
  assert.throws(() => tunnelConfigYaml({ credentials: '', platform: 'linux' }), /needs the credentials file path/);
});

test('setup-tunnel --dry-run --platform linux: only cloudflared.yml (no .cmd scripts), the .cloudflared folder for the credentials, and how to copy them in; --credentials overrides', () => {
  const cli = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'tunnel', 'setup-tunnel.mjs'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const r = cli('--dry-run', '--platform', 'linux', '--home', '/srv/blumodel-studio');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /── would write \/srv\/blumodel-studio\/cloudflared\.yml/);
  assert.doesNotMatch(r.stdout, /\.cmd|\.vbs/);
  assert.match(r.stdout, /credentials-file: '\/srv\/blumodel-studio\/\.cloudflared\/064671cd-a658-4240-8626-c697b9f148ac\.json'/);
  assert.match(r.stdout, /would create \/srv\/blumodel-studio\/\.cloudflared \(mode 700, owned by blumodel\)/);
  assert.match(r.stdout, /Copy 064671cd-a658-4240-8626-c697b9f148ac\.json there yourself, then: sudo chown blumodel:blumodel .* && sudo chmod 600 /);
  assert.match(r.stdout, /Dry run: nothing was written\./);
  const other = cli('--dry-run', '--platform', 'linux', '--home', '/srv/blumodel-studio', '--credentials', '/etc/cloudflared/blumodel.json', '--port', '8899');
  assert.equal(other.status, 0, other.stderr);
  assert.match(other.stdout, /credentials-file: '\/etc\/cloudflared\/blumodel\.json'/);
  assert.match(other.stdout, /service: http:\/\/127\.0\.0\.1:8899/);
  if (process.platform !== 'linux') assert.equal(cli('--platform', 'linux').status, 2, 'only a dry run may pretend to be Linux');
  assert.equal(cli('--dry-run', '--tunnel-id', 'not-an-id').status, 2);
});

test('setup-tunnel writes the Windows files into a temp home and cloudflared validates them offline (named credentials, never the real ones)', { skip: (!WIN && 'Windows supervisor files') || false, timeout: 60_000 }, async () => {
  const { findCloudflared } = await import('../../scripts/tunnel/tunnel.mjs');
  const cf = findCloudflared();
  const home = tempDir('blumodel-tunwrite-');
  try {
    const args = [path.join(ROOT, 'scripts', 'tunnel', 'setup-tunnel.mjs'), '--home', home, '--port', '8904', '--credentials', path.join(home, 'creds.json')];
    if (cf) args.push('--validate');
    else args.push('--cloudflared', 'C:\\nowhere\\cloudflared.exe');
    const r = spawnSync(NODE, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    if (!cf) {
      assert.equal(r.status, 1, 'refuses without cloudflared');
      return;
    }
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(fs.readdirSync(home).sort(), ['cloudflared.yml', 'run-tunnel.cmd', 'start-tunnel.cmd', 'start-tunnel.vbs', 'stop-tunnel.cmd']);
    assert.match(r.stdout, /PASS {2}cloudflared ingress validate/);
    assert.match(r.stdout, /PASS {2}https:\/\/blumodel\.studio\/ \(the sales site\) goes to http:\/\/127\.0\.0\.1:8904 by the rule for blumodel\.studio/);
    assert.match(r.stdout, /PASS {2}https:\/\/www\.blumodel\.studio\/ .* by the rule for www\.blumodel\.studio/);
    assert.match(r.stdout, /PASS {2}https:\/\/acme\.blumodel\.studio\/ \(a showroom\) goes to http:\/\/127\.0\.0\.1:8904 by the rule for \*\.blumodel\.studio/);
    assert.match(r.stdout, /PASS {2}https:\/\/showroom\.acmekitchens\.example\/ .* goes to http:\/\/127\.0\.0\.1:8904 by the last rule/);
    assert.match(r.stderr, /creds\.json does not exist/);
  } finally {
    rm(home);
  }
});

test('cloudflared accepts the Linux config too (offline ingress validate and rule on a temp copy)', { skip: !WIN && 'cloudflared is only looked for on Windows here', timeout: 60_000 }, async () => {
  const { findCloudflared, tunnelConfigYaml, TUNNEL_ID } = await import('../../scripts/tunnel/tunnel.mjs');
  const cf = findCloudflared();
  if (!cf) return;
  const dir = tempDir('blumodel-cfglin-');
  try {
    const file = path.join(dir, 'cloudflared.yml');
    fs.writeFileSync(file, tunnelConfigYaml({ credentials: `/srv/blumodel-studio/.cloudflared/${TUNNEL_ID}.json`, platform: 'linux' }));
    const v = spawnSync(cf, ['tunnel', '--config', file, 'ingress', 'validate'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const rule = spawnSync(cf, ['tunnel', '--config', file, 'ingress', 'rule', 'https://blumodel.studio/api/health'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.match(rule.stdout + rule.stderr, /service: http:\/\/127\.0\.0\.1:8790/);
  } finally {
    rm(dir);
  }
});

// ── 5. the runbook matches the scripts ───────────────────────────────────

test('every script command in HOSTING.md, OPERATIONS.md, LAUNCH.md and the README names a script that exists and only options it takes', () => {
  const docs = ['docs/HOSTING.md', 'docs/OPERATIONS.md', 'docs/LAUNCH.md', 'README.md'];
  const seen = new Set();
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      // A script path (from the repo, the deployed app/ or an absolute home), then what follows it on the line.
      const re = /(?:^|[\s`"(/\\])((?:server[\\/]scripts|scripts)[\\/][\w\\/.-]+?\.(?:mjs|sh|ps1)|install-linux\.sh|install-windows\.ps1)"?([^`|]*)/g;
      for (const m of line.matchAll(re)) {
        // The installers are also run as downloaded copies (no folder): they are scripts/host's.
        const rel = /^install-/.test(m[1]) ? `scripts/host/${m[1]}` : m[1].replace(/\\/g, '/');
        const file = path.join(ROOT, rel);
        assert.ok(fs.existsSync(file), `${doc} names ${rel}, which does not exist`);
        const src = fs.readFileSync(file, 'utf8');
        // Stop at the next command on the line (&&, ;) or a closing parenthesis of prose.
        const tail = m[2].split(/&&|;|\)\s|\s\(/)[0];
        for (const flag of tail.match(/(?<=^|\s)--[a-z][\w-]*/g) || []) {
          assert.ok(src.includes(flag), `${doc}: ${rel} does not take ${flag} (line: ${line.trim()})`);
          seen.add(`${rel} ${flag}`);
        }
        if (rel.endsWith('.ps1')) for (const p of tail.match(/(?<=^|\s)-[A-Z]\w+/g) || []) assert.ok(src.includes(`$${p.slice(1)}`), `${doc}: ${rel} has no parameter ${p}`);
      }
    }
  }
  // The runbook's key commands are among those checked.
  for (const k of ['scripts/deploy-local.mjs --rollback', 'scripts/register-tasks.mjs --at-startup', 'scripts/host/install-linux.sh --dry-run', 'server/scripts/import-data.mjs --replace', 'scripts/deploy-local.mjs --commit']) assert.ok(seen.has(k), `checked: ${k}`);
});

test('HOSTING.md covers what the runbook must: OS choice, BIOS/power, install on both, settings with a new key, data, both tunnel moves and the split-brain rule, cutover, verify, rollback, update, backups, logs, disk and RAM', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'HOSTING.md'), 'utf8');
  for (const re of [
    /Ubuntu Server 24\.04 LTS/,
    /ThinOS[^.]*\*\*cannot\*\* run this app/,
    /AC Recovery\*: \*\*Power On\*\*/,
    /Wake on LAN/,
    /sudo bash install-linux\.sh --dry-run/,
    /install-windows\.ps1" -DryRun/,
    /Unified Write Filter/,
    /\*\*new\*\* key/,
    /MOVING_DATA\.md/,
    /\*\*A\. Copy the credentials file \(recommended\)\.\*\*/,
    /cloudflared service install <token>/,
    /\*\*Do not copy `cert\.pem`\*\*/,
    /### The split-brain rule/,
    /stop the PC's tunnel and server first/,
    /sudo systemctl enable --now blumodel-tunnel/,
    /schtasks \/Change \/TN BluModelTunnel \/Disable/,
    /Reboot test/,
    /sudo systemctl disable --now blumodel-tunnel/,
    /update-linux\.sh/,
    /journalctl -u blumodel-studio/,
    /sudo fallocate -l 2G \/swapfile/,
    /df -h \//,
  ])
    assert.match(text, re);
  // Linked anchors exist.
  const anchors = new Set([...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')));
  for (const [, a] of text.matchAll(/\]\(#([\w-]+)\)/g)) assert.ok(anchors.has(a), `#${a} is a heading`);
});
