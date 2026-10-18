// The home server's folder (launch items 7 and 8): the supervisor scripts deploy-local writes, the
// private settings template, the move from the pre-rename home (scripts/migrate-home.mjs), the
// scheduled-task definitions (scripts/register-tasks.mjs, only ever with --dry-run here) and the
// Cloudflare tunnel's files (scripts/tunnel/). Everything runs in temp folders; nothing here starts
// a tunnel, registers a task or touches a real home. Settings files in these tests are fakes made
// by the test, and even those are checked by size and file identity, never opened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENV_FILE_KEYS, parseEnvFile } from '../lib/envFile.mjs';
import { loadConfig } from '../config.mjs';
import {
  CLEARED_ENV,
  createSettingsTemplate,
  deployBackupDirs,
  dirtyDeployFiles,
  homeLayout,
  homeProcesses,
  homeTasks,
  restrictToCurrentUser,
  serverScripts,
  settingsTemplate,
  taskXml,
} from '../ops/home.mjs';
import { migrateHome, planMove } from '../../scripts/migrate-home.mjs';
import { TUNNEL_ID, credentialsFile, findCloudflared, tunnelConfigYaml, tunnelScripts } from '../../scripts/tunnel/tunnel.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WIN = process.platform === 'win32';
const tempDir = (p = 'blumodel-home-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
const NODE = process.execPath;
const FAKE_KEY = 'sk_test_FAKE_FOR_TESTS';
const FAKE_WHSEC = 'whsec_FAKE_FOR_TESTS';

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });

/** The shell's settings must not leak into a spawned script. */
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(STRIPE_|ANTHROPIC_|BLUMODEL_|MISE_|PAYMENTS$|DEMO_PAYMENTS$|PUBLIC_URL$|NODE_ENV$|TRUST_PROXY$|ADMIN_EMAILS$|LEGAL_|SUPPORT_EMAIL$|DB_PATH$|PORT$|HOST$)/.test(k)) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return env;
};

// ── the server's supervisor scripts ──────────────────────────────────────

test('run-server.cmd: port 8790 on 127.0.0.1, settings from %~dp0blumodel.env only, never DEMO_PAYMENTS; CRLF', () => {
  const s = serverScripts({ node: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.deepEqual(Object.keys(s).sort(), ['run-server.cmd', 'start-hidden.vbs', 'start-server.cmd', 'stop-server.cmd']);
  for (const [name, body] of Object.entries(s)) {
    assert.ok(!/[^\r]\n/.test(body), `${name} has CRLF line ends only`);
    assert.ok(body.endsWith('\r\n'), name);
  }
  const run = s['run-server.cmd'];
  assert.match(run, /^set PORT=8790\r$/m);
  assert.match(run, /^set HOST=127\.0\.0\.1\r$/m);
  assert.match(run, /^set "DB_PATH=%~dp0data\\blumodel\.db"\r$/m);
  assert.match(run, /^set "BLUMODEL_ENV_FILE=%~dp0blumodel\.env"\r$/m);
  assert.match(run, /^set "BLUMODEL_LOG_FILE=%~dp0logs\\server\.log"\r$/m);
  assert.match(run, /^set "BLUMODEL_SHUTDOWN_FILE=%~dp0shutdown\.request"\r$/m);
  // DEMO_PAYMENTS is only ever cleared, never given a value.
  assert.deepEqual(run.match(/^set "?DEMO_PAYMENTS[^\r]*/gm), ['set "DEMO_PAYMENTS="']);
  for (const k of [...ENV_FILE_KEYS, 'PAYMENTS', 'NODE_ENV', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'MISE_ENV_FILE']) assert.match(run, new RegExp(`^set "${k}="\\r$`, 'm'), k);
  assert.ok(CLEARED_ENV.includes('STRIPE_SECRET_KEY') && CLEARED_ENV.includes('ANTHROPIC_API_KEY'));
  assert.match(run, /"C:\\Program Files\\nodejs\\node\.exe" --max-old-space-size=384 --no-warnings "%~dp0app\\server\\index\.mjs" --prod >> logs\\console\.log 2>&1/);
  assert.match(run, /rotate-log\.mjs" "%~dp0logs\\console\.log"/);
  assert.match(s['start-hidden.vbs'], /sh\.Run "cmd \/c """ & dir & "\\run-server\.cmd""", 0, False/);
  assert.match(s['stop-server.cmd'], /echo\.> shutdown\.request/);
  assert.match(serverScripts({ node: 'n', port: 8851 })['run-server.cmd'], /findstr \/R \/C:":8851 \.\*LISTENING"/);
  assert.throws(() => serverScripts({ node: 'n', port: '87 & calc' }), /Not a port/);
  assert.throws(() => serverScripts({ node: 'n', host: '127.0.0.1 & calc' }), /Not a host/);
});

/** A home whose "server" is a stub: it records which variables it got (names and booleans, no values), marks the home stopped, exits 3. */
function stubHome() {
  const home = tempDir('blumodel-stubhome-');
  const L = homeLayout(home);
  fs.mkdirSync(path.join(L.app, 'server', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(L.app, 'server', 'ops'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server', 'scripts', 'rotate-log.mjs'), path.join(L.app, 'server', 'scripts', 'rotate-log.mjs'));
  fs.copyFileSync(path.join(ROOT, 'server', 'ops', 'logs.mjs'), path.join(L.app, 'server', 'ops', 'logs.mjs'));
  fs.writeFileSync(
    L.serverEntry,
    `import fs from 'node:fs';
const e = process.env;
const got = { PORT: e.PORT, HOST: e.HOST, DB_PATH: e.DB_PATH, BLUMODEL_ENV_FILE: e.BLUMODEL_ENV_FILE, BLUMODEL_LOG_FILE: e.BLUMODEL_LOG_FILE,
  BLUMODEL_SHUTDOWN_FILE: e.BLUMODEL_SHUTDOWN_FILE, argv: process.argv.slice(2), cwd: process.cwd(),
  set: ${JSON.stringify(CLEARED_ENV)}.filter((k) => e[k] !== undefined && e[k] !== '') };
fs.appendFileSync('stub-ran.jsonl', JSON.stringify(got) + '\\n');
fs.writeFileSync('stopped', '');
console.log('stub server output');
process.exit(3);
`,
  );
  return { home, L };
}

test('run-server.cmd really runs: the server gets the home’s settings file and a clean environment; it logs the exit and stops when asked', { skip: !WIN }, async () => {
  const { home, L } = stubHome();
  try {
    const port = await freePort();
    for (const [name, body] of Object.entries(serverScripts({ node: NODE, port }))) fs.writeFileSync(path.join(home, name), body);
    // Variables a user might have set for other work: none may reach the server.
    // NODE_OPTIONS here is harmless (--no-deprecation) but would be --inspect or --require in the bad case.
    const env = { ...cleanEnv(), STRIPE_SECRET_KEY: FAKE_KEY, ANTHROPIC_API_KEY: 'FAKE_FOR_TESTS', DEMO_PAYMENTS: '1', NODE_ENV: 'development', MISE_ENV_FILE: 'C:\\nowhere\\mise.env', NODE_OPTIONS: '--no-deprecation', NODE_TLS_REJECT_UNAUTHORIZED: '0' };
    const r = spawnSync('cmd.exe', ['/d', '/c', L.runServer], { cwd: os.tmpdir(), env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const runs = fs.readFileSync(path.join(home, 'stub-ran.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(runs.length, 1, 'stopped after one run');
    const got = runs[0];
    assert.equal(got.PORT, String(port));
    assert.equal(got.HOST, '127.0.0.1');
    assert.equal(got.DB_PATH, path.join(home, 'data', 'blumodel.db'));
    assert.equal(got.BLUMODEL_ENV_FILE, L.settings);
    assert.equal(got.BLUMODEL_LOG_FILE, path.join(home, 'logs', 'server.log'));
    assert.equal(got.BLUMODEL_SHUTDOWN_FILE, L.shutdownFile);
    assert.deepEqual(got.argv, ['--prod']);
    assert.equal(path.resolve(got.cwd), path.resolve(home));
    assert.deepEqual(got.set, [], 'every settings variable from the parent environment was cleared');
    const consoleLog = fs.readFileSync(path.join(home, 'logs', 'console.log'), 'utf8');
    assert.match(consoleLog, new RegExp(`starting on 127\\.0\\.0\\.1:${port}`));
    assert.match(consoleLog, /stub server output/);
    assert.match(consoleLog, /server exited with code 3/);
    assert.ok(!consoleLog.includes('FAKE_FOR_TESTS'));
  } finally {
    rm(home);
  }
});

test('run-server.cmd leaves a port that something else holds alone (logs it, exits 0, starts nothing)', { skip: !WIN }, async () => {
  const { home, L } = stubHome();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const { port } = /** @type {net.AddressInfo} */ (blocker.address());
  try {
    for (const [name, body] of Object.entries(serverScripts({ node: NODE, port }))) fs.writeFileSync(path.join(home, name), body);
    const r = spawnSync('cmd.exe', ['/d', '/c', L.runServer], { env: cleanEnv(), encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(path.join(home, 'stub-ran.jsonl')), 'the server was not started');
    assert.match(fs.readFileSync(path.join(home, 'logs', 'console.log'), 'utf8'), new RegExp(`port ${port} is already in use by another process: not starting`));
  } finally {
    await new Promise((r) => blocker.close(r));
    rm(home);
  }
});

test('stop-server.cmd asks the server to stop through shutdown.request, waits for it, and marks the home stopped', { skip: !WIN }, async () => {
  const home = tempDir('blumodel-stop-');
  const L = homeLayout(home);
  const port = await freePort();
  for (const [name, body] of Object.entries(serverScripts({ node: NODE, port }))) fs.writeFileSync(path.join(home, name), body);
  // A stand-in for the server: listens, and exits 0 once the shutdown file appears (as index.mjs does).
  const code = `const http=require('http');const fs=require('fs');const f=process.argv[1];
const s=http.createServer((q,r)=>r.end('ok')).listen(${port},'127.0.0.1');
setInterval(()=>{if(fs.existsSync(f)){fs.rmSync(f,{force:true});s.close(()=>process.exit(0));}},200);`;
  const child = spawn(NODE, ['-e', code, L.shutdownFile], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((r) => child.once('exit', (c) => r(c)));
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const started = Date.now();
    const r = spawnSync('cmd.exe', ['/d', '/c', path.join(home, 'stop-server.cmd')], { encoding: 'utf8', timeout: 40_000, windowsHide: true });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(await exited, 0, 'the server exited by itself (gracefully), not killed');
    assert.ok(Date.now() - started < 15_000);
    assert.match(r.stdout, /BluModel Studio server stopped\./);
    assert.doesNotMatch(r.stdout, /ended forcibly/);
    assert.ok(fs.existsSync(L.stopped));
    assert.ok(!fs.existsSync(L.shutdownFile));
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    rm(home);
  }
});

// ── the private settings template ────────────────────────────────────────

test('the blumodel.env template: every settings key once, secrets empty, the public server’s defaults; the server starts with payments off', () => {
  const text = settingsTemplate({ adminEmails: 'owner@blumodel.example' });
  const { values, malformed } = parseEnvFile(text);
  assert.deepEqual(malformed, []);
  assert.deepEqual(Object.keys(values).sort(), [...ENV_FILE_KEYS].sort());
  for (const k of ENV_FILE_KEYS) assert.equal(text.split(/\r?\n/).filter((l) => l.startsWith(`${k}=`)).length, 1, k);
  assert.equal(values.STRIPE_SECRET_KEY, '');
  assert.equal(values.STRIPE_WEBHOOK_SECRET, '');
  assert.equal(values.ANTHROPIC_API_KEY, '');
  assert.equal(values.PUBLIC_URL, 'https://blumodel.studio');
  assert.equal(values.ADMIN_EMAILS, 'owner@blumodel.example');
  assert.equal(values.DEMO_PAYMENTS, '0');
  assert.equal(values.TRUST_PROXY, '1');
  assert.equal(values.BASE_DOMAIN, '', 'empty: the production default');
  // What the production server makes of it: no Stripe, no demo, so payments are 'none'.
  const c = loadConfig({ ...values }, ['--prod']);
  assert.equal(c.BASE_DOMAIN, 'blumodel.studio', 'showrooms at <slug>.blumodel.studio');
  assert.equal(loadConfig({ ...values, BASE_DOMAIN: 'Showrooms.Example.CA' }, ['--prod']).BASE_DOMAIN, 'showrooms.example.ca');
  assert.equal(c.paymentsProvider, 'none');
  assert.equal(c.TRUST_PROXY, 1);
  assert.deepEqual([...c.ADMIN_EMAILS], ['owner@blumodel.example']);
  assert.equal(c.legal.ready, false);
});

test('createSettingsTemplate never overwrites a file that is there, and restricts the one it makes', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'blumodel.env');
    const calls = [];
    const r = createSettingsTemplate(file, { text: settingsTemplate(), restrict: (f) => (calls.push(f), 'TESTPC\\owner') });
    assert.deepEqual(r, { created: true, restrictedTo: 'TESTPC\\owner', restrictError: null });
    assert.deepEqual(calls, [file]);
    const before = fs.statSync(file);
    const again = createSettingsTemplate(file, { text: 'SOMETHING ELSE=1\n', restrict: () => assert.fail('not restricted again') });
    assert.deepEqual(again, { created: false });
    const after = fs.statSync(file);
    assert.equal(after.size, before.size, 'unchanged (checked by size and time, not by opening it)');
    assert.equal(after.mtimeMs, before.mtimeMs);
    // A failing ACL change is reported, not thrown: the template still exists.
    const other = path.join(dir, 'other.env');
    const r2 = createSettingsTemplate(other, { text: 'X=1\n', restrict: () => { throw new Error('icacls failed'); } });
    assert.equal(r2.created, true);
    assert.equal(r2.restrictError, 'icacls failed');
  } finally {
    rm(dir);
  }
});

test('restrictToCurrentUser: no inherited access; only the current account (real icacls on a temp file)', { skip: !WIN }, () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'acl-probe.txt');
    fs.writeFileSync(file, 'probe');
    const who = restrictToCurrentUser(file);
    const acl = spawnSync('icacls', [file], { encoding: 'utf8', windowsHide: true }).stdout;
    const entries = acl.split(/\r?\n/).map((l) => l.replace(file, '').trim()).filter((l) => /:\(/.test(l));
    assert.deepEqual(entries.map((e) => e.toLowerCase()), [`${who.toLowerCase()}:(f)`], acl);
  } finally {
    rm(dir);
  }
});

// ── deploy backups ───────────────────────────────────────────────────────

test('pre-deploy backup pruning only looks at the deploy’s timestamped folders, never daily\\ or uploads-mirror\\', () => {
  const dir = tempDir();
  try {
    for (const n of ['daily', 'uploads-mirror', '2026-10-01T10-00-00-000Z', '2026-10-03T10-00-00-000Z', '2026-10-02T10-00-00-000Z', 'notes']) fs.mkdirSync(path.join(dir, n));
    fs.writeFileSync(path.join(dir, '2026-10-04T10-00-00-000Z'), 'a file, not a folder');
    assert.deepEqual(deployBackupDirs(dir), ['2026-10-01T10-00-00-000Z', '2026-10-02T10-00-00-000Z', '2026-10-03T10-00-00-000Z']);
    assert.deepEqual(deployBackupDirs(path.join(dir, 'missing')), []);
  } finally {
    rm(dir);
  }
});

test('homeProcesses finds a server by the home in its command line (and nothing from another folder)', { skip: !WIN }, async () => {
  const home = tempDir('blumodel-procs-');
  const L = homeLayout(home);
  const child = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)', L.serverEntry], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((r) => child.once('exit', r));
  try {
    await new Promise((r) => setTimeout(r, 300));
    const p = homeProcesses(home);
    assert.deepEqual(p.servers.map((x) => x.pid), [child.pid]);
    assert.deepEqual([p.supervisors, p.tunnels, p.others], [[], [], []]);
    const none = homeProcesses(path.join(home, 'elsewhere'));
    assert.deepEqual(none.servers, []);
    // The caller (and its parents) are never listed, though their command line may name the folder.
    assert.deepEqual(homeProcesses(home, { exclude: [child.pid] }).servers, []);
  } finally {
    child.kill();
    await exited;
    rm(home);
  }
});

// ── scheduled tasks ──────────────────────────────────────────────────────

test('task definitions: at logon, hidden VBS launchers, interactive token, no time limit, one instance; paths are XML-escaped', () => {
  const tasks = homeTasks('C:\\Users\\owner\\Projects\\BluModelStudio', 'TESTPC\\owner');
  assert.deepEqual(tasks.map((t) => t.name), ['BluModelStudioServer', 'BluModelTunnel']);
  assert.equal(tasks[0].launcher, 'C:\\Users\\owner\\Projects\\BluModelStudio\\start-hidden.vbs');
  assert.equal(tasks[1].launcher, 'C:\\Users\\owner\\Projects\\BluModelStudio\\start-tunnel.vbs');
  for (const t of tasks) {
    assert.match(t.xml, /<LogonTrigger>\s*<UserId>TESTPC\\owner<\/UserId>\s*<\/LogonTrigger>/);
    assert.match(t.xml, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(t.xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    assert.match(t.xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
    assert.match(t.xml, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
    assert.match(t.xml, /<Command>wscript\.exe<\/Command>/);
    assert.ok(t.xml.includes(`<Arguments>"${t.launcher}"</Arguments>`));
  }
  const odd = taskXml({ name: 'T', description: 'a & b', launcher: "C:\\R&D's <x>\\start.vbs", workingDir: 'C:\\R&D', user: 'u' });
  assert.ok(odd.includes('<Arguments>"C:\\R&amp;D&apos;s &lt;x&gt;\\start.vbs"</Arguments>'));
  assert.ok(odd.includes('<Description>a &amp; b</Description>'));
});

test('register-tasks --dry-run prints both definitions (checked as XML) and changes nothing', { skip: !WIN }, () => {
  const home = tempDir('blumodel-tasks-');
  try {
    const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'register-tasks.mjs'), '--dry-run', '--home', home, '--delete-old', '--user', 'TESTPC\\owner'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /BluModelStudioServer: at logon of TESTPC\\owner, runs wscript\.exe ".*start-hidden\.vbs" {2}\(that file does not exist yet\)/);
    assert.match(r.stdout, /BluModelTunnel: at logon of TESTPC\\owner, runs wscript\.exe ".*start-tunnel\.vbs"/);
    assert.match(r.stdout, /would run: schtasks \/Create \/TN BluModelStudioServer \/XML/);
    assert.match(r.stdout, /would run: schtasks \/Delete \/TN MiseKitchenServer \/F/);
    assert.match(r.stdout, /Dry run: no task was created, changed or deleted\./);
    const bad = spawnSync(NODE, [path.join(ROOT, 'scripts', 'register-tasks.mjs'), '--dry-run', '--frobnicate'], { encoding: 'utf8', windowsHide: true });
    assert.equal(bad.status, 2);
  } finally {
    rm(home);
  }
});

// ── migrate-home: the pre-rename folder to the new one ───────────────────

/** A home as the Mise deploy left it: an app, data\mise.db with its WAL, backups, uploads, logs, a FAKE mise.env, old scripts. */
function oldHome(root, name = 'Mise') {
  const h = path.join(root, name);
  fs.mkdirSync(path.join(h, 'app', 'server'), { recursive: true });
  fs.writeFileSync(path.join(h, 'app', 'DEPLOYED.txt'), 'commit 2e6cf2c\n');
  fs.mkdirSync(path.join(h, 'data', 'backups', '2026-10-07T22-52-59-037Z'), { recursive: true });
  fs.writeFileSync(path.join(h, 'data', 'backups', '2026-10-07T22-52-59-037Z', 'mise.db'), 'old backup');
  fs.mkdirSync(path.join(h, 'data', 'uploads', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(h, 'data', 'uploads', 'ab', 'abcdef.glb'), 'model');
  fs.writeFileSync(path.join(h, 'data', 'mise.db'), 'db main');
  fs.writeFileSync(path.join(h, 'data', 'mise.db-wal'), 'db wal holding most of the data');
  fs.writeFileSync(path.join(h, 'data', 'mise.db-shm'), 'shm');
  fs.mkdirSync(path.join(h, 'logs'));
  fs.writeFileSync(path.join(h, 'logs', 'server.log'), 'old log\n');
  fs.writeFileSync(path.join(h, 'mise.env'), `STRIPE_SECRET_KEY=${FAKE_KEY}\nSTRIPE_WEBHOOK_SECRET=${FAKE_WHSEC}\n`);
  fs.writeFileSync(path.join(h, 'run-server.cmd'), '@echo off\r\nrem Mise home server supervisor.\r\nset DB_PATH=%~dp0data\\mise.db\r\n');
  fs.writeFileSync(path.join(h, 'start-hidden.vbs'), "' Starts the Mise server supervisor with no console window.\r\n");
  fs.writeFileSync(path.join(h, 'start-server.cmd'), '@echo off\r\necho Mise is starting\r\n');
  fs.writeFileSync(path.join(h, 'stop-server.cmd'), '@echo off\r\necho Mise server stopped.\r\n');
  // The old stop-server.cmd leaves this when the old server is stopped before the move.
  fs.writeFileSync(path.join(h, 'stopped'), '\r\n');
  return h;
}

const noProcs = () => ({ servers: [], supervisors: [], tunnels: [], others: [] });
const ident = (f) => {
  const s = fs.statSync(f, { bigint: true });
  return `${s.ino}:${s.size}`;
};

test('migrate-home moves the old folder, renames the database (with its WAL) and the settings file without opening it, sidelines the old scripts; twice is a no-op', async () => {
  const root = tempDir('blumodel-migrate-');
  try {
    const from = oldHome(root);
    const to = path.join(root, 'BluModelStudio');
    const envId = ident(path.join(from, 'mise.env'));
    const walId = ident(path.join(from, 'data', 'mise.db-wal'));
    const out = [];
    const restricted = [];
    const opts = { from, to, ports: [await freePort()], out: (s) => out.push(s), processes: noProcs, restrict: (f) => (restricted.push(f), 'TESTPC\\owner') };

    // Dry run: says everything, changes nothing.
    const dry = await migrateHome({ ...opts, dryRun: true });
    assert.equal(dry.ok, true, out.join('\n'));
    assert.ok(fs.existsSync(from) && !fs.existsSync(to));
    const dryText = out.join('\n');
    assert.match(dryText, /Would: move .*Mise to .*BluModelStudio/);
    assert.match(dryText, /Would: rename data\\mise\.db \(with -wal, -shm\) to data\\blumodel\.db/);
    assert.match(dryText, /Would: rename mise\.env to blumodel\.env \(the file is not opened\)/);
    assert.match(dryText, /Would: rename run-server\.cmd \(written before the rename\) to run-server\.cmd\.pre-migration/);
    assert.match(dryText, /Would: rename start-server\.cmd \(written before the rename\) to start-server\.cmd\.pre-migration/);
    assert.match(dryText, /\$env:BLUMODEL_HOME = '.*BluModelStudio'; npm run deploy:local/);
    assert.match(dryText, /schtasks \/Delete \/TN MiseKitchenServer \/F/);
    assert.match(dryText, /register-tasks\.mjs --home ".*BluModelStudio" --dry-run/);
    // The tunnel files before the tasks: register-tasks refuses while start-tunnel.vbs is missing.
    assert.ok(dryText.indexOf('setup-tunnel.mjs') < dryText.indexOf('register-tasks.mjs'), 'setup-tunnel is listed before register-tasks');
    assert.deepEqual(restricted, []);

    out.length = 0;
    const r = await migrateHome(opts);
    assert.equal(r.ok, true, out.join('\n'));
    assert.ok(!fs.existsSync(from), 'the old folder is gone (moved)');
    const L = homeLayout(to);
    assert.ok(fs.existsSync(L.db) && fs.existsSync(L.db + '-wal') && fs.existsSync(L.db + '-shm'));
    assert.ok(!fs.existsSync(L.legacyDb) && !fs.existsSync(L.legacyDb + '-wal'));
    assert.equal(ident(L.db + '-wal'), walId, 'the WAL was renamed, not copied');
    assert.ok(fs.existsSync(L.settings) && !fs.existsSync(L.legacySettings));
    assert.equal(ident(L.settings), envId, 'blumodel.env is the same file, renamed');
    assert.deepEqual(restricted, [L.settings]);
    assert.ok(fs.existsSync(path.join(to, 'data', 'backups', '2026-10-07T22-52-59-037Z', 'mise.db')), 'backups kept');
    assert.ok(fs.existsSync(path.join(to, 'data', 'uploads', 'ab', 'abcdef.glb')), 'uploads kept');
    assert.ok(fs.existsSync(path.join(to, 'logs', 'server.log')), 'logs kept');
    for (const s of ['run-server.cmd', 'start-hidden.vbs', 'start-server.cmd', 'stop-server.cmd']) {
      assert.ok(!fs.existsSync(path.join(to, s)) && fs.existsSync(path.join(to, `${s}.pre-migration`)), s);
    }
    assert.ok(!out.join('\n').includes('FAKE_FOR_TESTS'), 'no settings value is ever printed');
    assert.ok(!fs.existsSync(L.stopped), 'the old stopped marker is gone, so the deploy starts the server');
    assert.match(out.join('\n'), /remove the 'stopped' marker the old folder had/);

    out.length = 0;
    const again = await migrateHome(opts);
    assert.equal(again.ok, true);
    assert.deepEqual(again.did, []);
    assert.match(out.join('\n'), /does not exist: nothing to move/);
    assert.match(out.join('\n'), /Nothing to do: .* is already migrated\./);
  } finally {
    rm(root);
  }
});

test('migrate-home refuses, changing nothing, while a server listens or a process runs from the folder, or when both folders hold a database or a settings file', async () => {
  const root = tempDir('blumodel-migrate-');
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const { port } = /** @type {net.AddressInfo} */ (blocker.address());
  try {
    const from = oldHome(root);
    const to = path.join(root, 'BluModelStudio');
    const out = [];
    const base = { from, to, out: (s) => out.push(s), processes: noProcs, restrict: () => 'x' };

    const listening = await migrateHome({ ...base, ports: [port] });
    assert.equal(listening.ok, false);
    assert.match(listening.blocked[0], new RegExp(`Something is listening on 127\\.0\\.0\\.1:${port}`));
    assert.match(out.join('\n'), /REFUSED: nothing was changed\./);
    assert.ok(fs.existsSync(path.join(from, 'mise.env')) && !fs.existsSync(to));

    const running = await migrateHome({ ...base, ports: [], processes: (h) => (h === path.resolve(from) ? { ...noProcs(), servers: [{ pid: 4242, name: 'node.exe' }] } : noProcs()) });
    assert.equal(running.ok, false);
    assert.match(running.blocked[0], /Processes are running from .*Mise: node\.exe \(pid 4242\)/);

    // The new folder already has a database (say, a deploy ran there first): a person decides.
    fs.mkdirSync(path.join(to, 'data'), { recursive: true });
    fs.writeFileSync(path.join(to, 'data', 'blumodel.db'), 'another db');
    fs.writeFileSync(path.join(to, 'blumodel.env'), 'TEMPLATE=1\n');
    const both = await migrateHome({ ...base, ports: [] });
    assert.equal(both.ok, false);
    assert.equal(both.blocked.length, 2);
    assert.match(both.blocked[0], /Both folders hold a database/);
    assert.match(both.blocked[1], /Both folders hold a private settings file .* Neither is opened by this script/);
    assert.ok(fs.existsSync(path.join(from, 'data', 'mise.db')) && fs.existsSync(path.join(from, 'mise.env')), 'nothing moved');
  } finally {
    await new Promise((r) => blocker.close(r));
    rm(root);
  }
});

test('migrate-home refuses cleanly when Windows won’t move the folder (a process has its current folder inside it), and finishes once it is closed', { skip: !WIN }, async () => {
  const root = tempDir('blumodel-migrate-');
  /** A process whose current folder is `dir`: what an open terminal there looks like to Windows. */
  const holder = async (dir) => {
    const child = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, stdio: 'ignore', windowsHide: true });
    await new Promise((r) => setTimeout(r, 500));
    return child;
  };
  const kill = async (c) => {
    c.kill();
    await new Promise((r) => (c.exitCode !== null ? r() : c.once('exit', r)));
  };
  try {
    // A plain move: refused, nothing changed, then done after the holder goes.
    const from = oldHome(root);
    const to = path.join(root, 'BluModelStudio');
    const out = [];
    const base = { from, to, ports: [], out: (s) => out.push(s), processes: noProcs, restrict: () => 'TESTPC\\owner' };
    let h = await holder(path.join(from, 'data'));
    const r = await migrateHome(base);
    await kill(h);
    assert.equal(r.ok, false, out.join('\n'));
    assert.match(r.blocked[0], /Windows would not move .*Mise \((EPERM|EBUSY|EACCES)\): something has it, or a file in it, open: a terminal/);
    assert.match(out.join('\n'), /REFUSED: nothing was changed\./);
    assert.deepEqual(r.did, []);
    assert.ok(fs.existsSync(path.join(from, 'mise.env')) && fs.existsSync(path.join(from, 'data', 'mise.db')) && !fs.existsSync(to), 'nothing moved');
    out.length = 0;
    assert.equal((await migrateHome(base)).ok, true, out.join('\n'));
    assert.ok(fs.existsSync(homeLayout(to).db) && fs.existsSync(homeLayout(to).settings));

    // A merge stopped part-way: says so, and a second run carries on.
    const from2 = oldHome(root, 'Mise2');
    const to2 = path.join(root, 'BluModelStudio2');
    fs.mkdirSync(to2);
    out.length = 0;
    h = await holder(path.join(from2, 'data'));
    const m = await migrateHome({ ...base, from: from2, to: to2 });
    await kill(h);
    assert.equal(m.ok, false);
    assert.match(m.blocked[0], /Windows would not move .*Mise2\\data .*1 of \d+ item\(s\) were moved before it; running this again carries on from there\./);
    assert.match(out.join('\n'), /STOPPED part-way: nothing was overwritten/);
    assert.ok(fs.existsSync(path.join(to2, 'app', 'DEPLOYED.txt')), 'app\\ (first in order) moved before the stop');
    out.length = 0;
    const m2 = await migrateHome({ ...base, from: from2, to: to2 });
    assert.equal(m2.ok, true, out.join('\n'));
    assert.ok(fs.existsSync(homeLayout(to2).db) && fs.existsSync(homeLayout(to2).settings) && !fs.existsSync(from2));
  } finally {
    rm(root);
  }
});

test('migrate-home merges into an existing new folder without overwriting anything there, and lists what stayed behind', async () => {
  const root = tempDir('blumodel-migrate-');
  try {
    const from = oldHome(root);
    const to = path.join(root, 'BluModelStudio');
    // The new folder has its own app and a log of the same name, but no database or settings yet.
    fs.mkdirSync(path.join(to, 'app'), { recursive: true });
    fs.writeFileSync(path.join(to, 'app', 'DEPLOYED.txt'), 'commit new\n');
    fs.mkdirSync(path.join(to, 'logs'));
    fs.writeFileSync(path.join(to, 'logs', 'server.log'), 'new log\n');
    const out = [];
    const r = await migrateHome({ from, to, ports: [], out: (s) => out.push(s), processes: noProcs, restrict: () => 'x' });
    assert.equal(r.ok, true, out.join('\n'));
    assert.equal(fs.readFileSync(path.join(to, 'app', 'DEPLOYED.txt'), 'utf8'), 'commit new\n', 'the new app is kept');
    assert.equal(fs.readFileSync(path.join(to, 'logs', 'server.log'), 'utf8'), 'new log\n', 'the new log is kept');
    assert.ok(fs.existsSync(path.join(to, 'data', 'blumodel.db-wal')));
    assert.ok(fs.existsSync(path.join(to, 'blumodel.env')) && !fs.existsSync(path.join(from, 'mise.env')));
    assert.deepEqual(r.left.map((p) => path.relative(from, p)).sort(), ['app', path.join('logs', 'server.log')]);
    assert.match(out.join('\n'), /Left in .*Mise \(the new folder already has a file of that name; nothing was overwritten\)/);
    assert.ok(fs.existsSync(from), 'the old folder stays while something is left in it');
    assert.ok(!fs.existsSync(path.join(from, 'data')), 'emptied folders are removed');
  } finally {
    rm(root);
  }
});

test('planMove: rename when the new folder is missing, nothing when the old one is', () => {
  const root = tempDir('blumodel-plan-');
  try {
    const from = oldHome(root);
    assert.equal(planMove(from, path.join(root, 'New')).kind, 'rename');
    assert.equal(planMove(path.join(root, 'Missing'), from).kind, 'none');
  } finally {
    rm(root);
  }
});

test('the migrate-home CLI: --dry-run against temp folders, a refusal exits 1, an unknown option exits 2', { skip: !WIN }, async () => {
  const root = tempDir('blumodel-migrate-cli-');
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const { port } = /** @type {net.AddressInfo} */ (blocker.address());
  try {
    const from = oldHome(root);
    const to = path.join(root, 'BluModelStudio');
    const cli = (...a) => spawnSync(NODE, [path.join(ROOT, 'scripts', 'migrate-home.mjs'), '--from', from, '--to', to, ...a], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const free = await freePort();
    const dry = cli('--dry-run', '--port', String(free));
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /Dry run: nothing was changed\./);
    assert.ok(fs.existsSync(from) && !fs.existsSync(to));
    const refused = cli('--port', String(port));
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /REFUSED: nothing was changed\./);
    assert.ok(fs.existsSync(path.join(from, 'mise.env')));
    assert.equal(cli('--bogus').status, 2);
    assert.ok(!(dry.stdout + refused.stdout).includes('FAKE_FOR_TESTS'));
  } finally {
    await new Promise((r) => blocker.close(r));
    rm(root);
  }
});

// ── the Cloudflare tunnel ────────────────────────────────────────────────

test('cloudflared.yml: the blumodel tunnel, its credentials under %USERPROFILE%\\.cloudflared, blumodel.studio, www and every showroom to 127.0.0.1:8790, custom domains to the server too', () => {
  const creds = credentialsFile(TUNNEL_ID, 'C:\\Users\\owner');
  assert.equal(creds, 'C:\\Users\\owner\\.cloudflared\\064671cd-a658-4240-8626-c697b9f148ac.json');
  const y = tunnelConfigYaml({ credentials: creds });
  assert.match(y, /^tunnel: 064671cd-a658-4240-8626-c697b9f148ac$/m);
  assert.match(y, /^credentials-file: 'C:\\Users\\owner\\\.cloudflared\\064671cd-a658-4240-8626-c697b9f148ac\.json'$/m);
  assert.match(y, /^originRequest:\n {2}connectTimeout: 10s\n {2}noHappyEyeballs: true\n/m);
  assert.match(y, /^ {2}- hostname: blumodel\.studio\n {4}service: http:\/\/127\.0\.0\.1:8790\n/m);
  assert.match(y, /^ {2}- hostname: www\.blumodel\.studio\n {4}service: http:\/\/127\.0\.0\.1:8790\n/m);
  assert.match(y, /^ {2}- hostname: '\*\.blumodel\.studio'\n {4}service: http:\/\/127\.0\.0\.1:8790\n/m);
  assert.ok(y.trimEnd().endsWith('- service: http://127.0.0.1:8790'), 'the catch-all is last and goes to the server (custom domains)');
  assert.ok(tunnelConfigYaml({ credentials: creds, customDomains: false }).trimEnd().endsWith('- service: http_status:404'), 'without custom domains: 404');
  assert.throws(() => tunnelConfigYaml({ credentials: creds, origin: 'http://0.0.0.0:8790' }), /origin must be/);
  assert.throws(() => tunnelConfigYaml({ credentials: creds, hostname: 'a b' }), /Not a hostname/);
  assert.match(tunnelConfigYaml({ credentials: "C:\\it's\\x.json" }), /credentials-file: 'C:\\it''s\\x\.json'/);
});

test('the tunnel supervisor: restarts cloudflared with this folder’s config, rotates logs\\tunnel.log, stops on tunnel.stopped; stop-tunnel only ends this folder’s cloudflared', () => {
  const s = tunnelScripts({ cloudflared: 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', node: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.deepEqual(Object.keys(s).sort(), ['run-tunnel.cmd', 'start-tunnel.cmd', 'start-tunnel.vbs', 'stop-tunnel.cmd']);
  const run = s['run-tunnel.cmd'];
  assert.match(run, /"C:\\Program Files \(x86\)\\cloudflared\\cloudflared\.exe" tunnel --config "%~dp0cloudflared\.yml" --no-autoupdate run >> logs\\tunnel\.log 2>&1/);
  assert.match(run, /rotate-log\.mjs" "%~dp0logs\\tunnel\.log"/);
  assert.match(run, /^if exist tunnel\.stopped exit \/b 0\r$/m);
  assert.match(run, /^goto loop\r$/m);
  assert.ok(!/route|service install|login|delete/i.test(run.replace(/rem [^\r]*/g, '')), 'the supervisor only ever runs the tunnel');
  assert.match(s['stop-tunnel.cmd'], /\$_\.Name -eq 'cloudflared\.exe' -and \$_\.CommandLine -and \$_\.CommandLine\.ToLower\(\)\.Contains\(\$c\)/);
  assert.match(s['start-tunnel.vbs'], /run-tunnel\.cmd""", 0, False/);
});

test('run-tunnel.cmd really loops: it logs each exit, restarts, and stops once tunnel.stopped appears (a stand-in exe, never cloudflared)', { skip: !WIN, timeout: 60_000 }, async () => {
  const home = tempDir('blumodel-tunnel-');
  try {
    // whoami.exe rejects cloudflared's arguments and exits 1 at once: a safe stand-in for a tunnel that drops.
    const standIn = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe');
    for (const [name, body] of Object.entries(tunnelScripts({ cloudflared: standIn, node: NODE }))) fs.writeFileSync(path.join(home, name), body);
    const child = spawn('cmd.exe', ['/d', '/c', path.join(home, 'run-tunnel.cmd')], { stdio: 'ignore', windowsHide: true });
    const exited = new Promise((r) => child.once('exit', (c) => r(c)));
    const log = path.join(home, 'logs', 'tunnel.log');
    const count = () => (fs.existsSync(log) ? (fs.readFileSync(log, 'utf8').match(/the tunnel exited with code/g) || []).length : 0);
    for (let i = 0; i < 300 && count() < 2; i++) await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(home, 'tunnel.stopped'), '');
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 20_000))]);
    if (code === 'timeout') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    assert.equal(code, 0);
    const text = fs.readFileSync(log, 'utf8');
    assert.ok((text.match(/starting the tunnel/g) || []).length >= 2, text);
    assert.match(text, /the tunnel exited with code 1/);
  } finally {
    rm(home);
  }
});

test('stop-tunnel.cmd ends only the process started with THIS folder’s cloudflared.yml (stand-ins named node.exe; another folder’s is left running)', { skip: !WIN }, async () => {
  const home = tempDir('blumodel-stoptun-');
  const other = tempDir('blumodel-stoptun-other-');
  const sleeper = (cfg) => spawn(NODE, ['-e', 'setInterval(() => {}, 1000)', 'tunnel', '--config', cfg, 'run'], { stdio: 'ignore', windowsHide: true });
  const mine = sleeper(path.join(home, 'cloudflared.yml'));
  const theirs = sleeper(path.join(other, 'cloudflared.yml'));
  const mineExit = new Promise((r) => mine.once('exit', r));
  const theirsExit = new Promise((r) => theirs.once('exit', r));
  try {
    for (const [name, body] of Object.entries(tunnelScripts({ cloudflared: 'C:\\nowhere\\cloudflared.exe', node: NODE, processName: 'node.exe' }))) fs.writeFileSync(path.join(home, name), body);
    await new Promise((r) => setTimeout(r, 300));
    const r = spawnSync('cmd.exe', ['/d', '/c', path.join(home, 'stop-tunnel.cmd')], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`Stopped node\\.exe \\(pid ${mine.pid}\\)\\.`));
    assert.doesNotMatch(r.stdout, new RegExp(`pid ${theirs.pid}\\b`));
    await mineExit;
    assert.equal(theirs.exitCode, null, 'the other folder’s tunnel still runs');
    assert.ok(fs.existsSync(path.join(home, 'tunnel.stopped')));
    // Run again: nothing left to stop, and it says so.
    const again = spawnSync('cmd.exe', ['/d', '/c', path.join(home, 'stop-tunnel.cmd')], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.match(again.stdout, /No node\.exe was running with .*cloudflared\.yml\./);
  } finally {
    if (mine.exitCode === null) mine.kill();
    theirs.kill();
    await Promise.all([mineExit, theirsExit]);
    rm(home);
    rm(other);
  }
});

test('cloudflared itself accepts the generated config (offline: ingress validate and ingress rule, on a temp copy)', { skip: !WIN || !findCloudflared() }, () => {
  const dir = tempDir('blumodel-cfg-');
  try {
    const file = path.join(dir, 'cloudflared.yml');
    fs.writeFileSync(file, tunnelConfigYaml({ credentials: path.join(dir, 'creds.json') }));
    const cf = findCloudflared();
    const v = spawnSync(cf, ['tunnel', '--config', file, 'ingress', 'validate'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(v.status, 0, v.stdout + v.stderr);
    const rule = spawnSync(cf, ['tunnel', '--config', file, 'ingress', 'rule', 'https://blumodel.studio/any/path'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.match(rule.stdout + rule.stderr, /service: http:\/\/127\.0\.0\.1:8790/);
    const shop = spawnSync(cf, ['tunnel', '--config', file, 'ingress', 'rule', 'https://acme.blumodel.studio/'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.match(shop.stdout + shop.stderr, /hostname: \*\.blumodel\.studio\s+service: http:\/\/127\.0\.0\.1:8790/);
    const other = spawnSync(cf, ['tunnel', '--config', file, 'ingress', 'rule', 'https://www.example.com/'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.match(other.stdout + other.stderr, /service: http:\/\/127\.0\.0\.1:8790/, 'a custom domain reaches the server, which answers 404 for hosts it does not know');
  } finally {
    rm(dir);
  }
});

test('dirtyDeployFiles reads git status --porcelain -z (changed, untracked, renamed)', () => {
  const z = [' M server/routes/webhooks.mjs', '?? server/db/migrations/admin.mjs', 'R  src/new.ts', 'src/old.ts', 'A  server/admin/x.mjs', ''].join('\0');
  assert.deepEqual(dirtyDeployFiles(z), [
    { status: 'M', file: 'server/routes/webhooks.mjs' },
    { status: '??', file: 'server/db/migrations/admin.mjs' },
    { status: 'R', file: 'src/new.ts' },
    { status: 'A', file: 'server/admin/x.mjs' },
  ]);
  assert.deepEqual(dirtyDeployFiles(''), []);
});

test('deploy-local refuses an uncommitted migration before it stops or copies anything', { skip: !WIN || spawnSync('git', ['--version'], { windowsHide: true }).status !== 0 }, () => {
  // A throwaway git checkout holding just what deploy-local needs to get as far as its checks.
  const repo = tempDir('blumodel-dirty-');
  const home = tempDir('blumodel-dirty-home-');
  try {
    for (const rel of ['scripts/deploy-local.mjs', 'scripts/host/lib.mjs', 'scripts/tunnel/tunnel.mjs', 'server/ops/home.mjs', 'server/ops/homePort.mjs', 'server/ops/sites.mjs', 'server/lib/envFile.mjs']) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), path.join(repo, rel));
    }
    fs.mkdirSync(path.join(repo, 'src', 'data'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'data', 'plans.json'), '[]');
    fs.mkdirSync(path.join(repo, 'dist'));
    fs.writeFileSync(path.join(repo, 'dist', 'index.html'), '<!doctype html>');
    fs.mkdirSync(path.join(repo, 'server', 'generated'));
    fs.writeFileSync(path.join(repo, 'server', 'generated', 'export-kit.mjs'), '');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\nserver/generated/\n');
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.equal(git('init', '-q').status, 0);
    git('add', '-A');
    assert.equal(git('commit', '-q', '-m', 'x').status, 0);
    fs.mkdirSync(path.join(repo, 'server', 'db', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'server', 'db', 'migrations', 'wip.mjs'), 'export const steps = [];');
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'deploy-local.mjs')], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      env: { ...process.env, BLUMODEL_HOME: home, BLUMODEL_PORT: '8929' },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Not deploying: 1 file\(s\)/);
    assert.match(r.stderr, /\?\? server\/db\/migrations\/wip\.mjs/);
    assert.deepEqual(fs.readdirSync(home), [], 'nothing was written into the home');
  } finally {
    rm(repo);
    rm(home);
  }
});
