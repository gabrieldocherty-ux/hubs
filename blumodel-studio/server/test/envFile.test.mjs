// The private settings file (server/lib/envFile.mjs) and the names kept from before the rename.
// Every key and secret here is an obviously fake test value; nothing reaches Stripe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENV_FILE_KEYS, deployedHome, describeEnvFile, envFilePath, loadEnvFile, parseEnvFile, resolveEnvFile } from '../lib/envFile.mjs';
import { loadConfig } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_KEY = 'sk_test_FAKE_FOR_TESTS';
const FAKE_WHSEC = 'whsec_FAKE_FOR_TESTS';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-envfile-'));
const BOM = String.fromCharCode(0xfeff);

test('parseEnvFile: KEY=VALUE, comments, export, quotes, inline comments, CRLF and a BOM', () => {
  const text = [
    `${BOM}# private`,
    `STRIPE_SECRET_KEY=${FAKE_KEY}`,
    '',
    'export PUBLIC_URL = https://blumodel.example ',
    'ADMIN_EMAILS="a@b.test, c@d.test"',
    "QUOTED='has # hash'",
    'TRUST_PROXY=1 # one proxy',
    'EMPTY=',
    'LAST=1',
    'LAST=2',
    '',
  ].join('\r\n');
  assert.deepEqual(parseEnvFile(text), {
    values: {
      STRIPE_SECRET_KEY: FAKE_KEY,
      PUBLIC_URL: 'https://blumodel.example',
      ADMIN_EMAILS: 'a@b.test, c@d.test',
      QUOTED: 'has # hash',
      TRUST_PROXY: '1',
      EMPTY: '',
      LAST: '2',
    },
    malformed: [],
  });
});

test('parseEnvFile: a bad line is skipped and reported by its number only, never its text', () => {
  for (const [text, lines, kept] of [
    [`OK=1\n${FAKE_KEY}\n`, [2], { OK: '1' }],
    [`=${FAKE_KEY}`, [1], {}],
    [`A=1\nB=2\nBAD KEY=${FAKE_KEY}`, [3], { A: '1', B: '2' }],
    [`KEY="${FAKE_KEY}\nSTRIPE_WEBHOOK_SECRET=${FAKE_WHSEC}`, [1], { STRIPE_WEBHOOK_SECRET: FAKE_WHSEC }],
  ]) {
    const r = parseEnvFile(text);
    assert.deepEqual(r.malformed, lines);
    assert.deepEqual(r.values, kept);
    const said = describeEnvFile({ path: 'x.env', source: 'BLUMODEL_ENV_FILE', set: 0, total: 0, malformed: r.malformed, ignored: [] });
    const all = [...said.info, ...said.warn].join('\n');
    assert.match(all, new RegExp(`line ${lines[0]}\\b`));
    assert.ok(!all.includes('FAKE'), `the report leaks the line: ${all}`);
  }
});

test('loadEnvFile: only the settings keys are applied; other keys are ignored and reported by line, never by name', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'blumodel.env');
    // A pasted key with an "=" in it looks like KEY=VALUE: its "name" must never be printed.
    fs.writeFileSync(file, `STRIPE_SECRET_KEY=${FAKE_KEY}\nPORT=9999\n${FAKE_KEY}_AS_NAME=1\nNODE_ENV=development\nLEGAL_NAME="BluModel Studio LLC"\n`);
    const env = {};
    const info = loadEnvFile(env, { file });
    assert.deepEqual(info, { path: file, source: 'argument', set: 2, total: 2, malformed: [], ignored: [2, 3, 4] });
    assert.deepEqual(env, { STRIPE_SECRET_KEY: FAKE_KEY, LEGAL_NAME: 'BluModel Studio LLC' });
    const said = describeEnvFile(info);
    const all = [...said.info, ...said.warn].join('\n');
    assert.match(all, /ignored lines 2, 3, 4/);
    assert.ok(!all.includes('FAKE'), all);
    assert.ok(!all.includes('9999'), all);
    assert.deepEqual([...ENV_FILE_KEYS].sort(), [
      'ADMIN_EMAILS',
      'ANTHROPIC_API_KEY',
      'BLUMODEL_LLM_MODEL',
      'DEMO_PAYMENTS',
      'EMAIL_FROM',
      'LEGAL_JURISDICTION',
      'LEGAL_NAME',
      'POSTMARK_TOKEN',
      'PUBLIC_URL',
      'RESEND_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'SUPPORT_EMAIL',
      'TRUST_PROXY',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnvFile: BLUMODEL_ENV_FILE, then the deprecated MISE_ENV_FILE; the environment wins', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'blumodel.env');
    fs.writeFileSync(file, `STRIPE_SECRET_KEY=${FAKE_KEY}\nSTRIPE_WEBHOOK_SECRET=${FAKE_WHSEC}\nPUBLIC_URL=https://blumodel.example\n`);
    assert.equal(loadEnvFile({}), null, 'no file named, and a checkout has no default: nothing to do');

    const env = { BLUMODEL_ENV_FILE: file, PUBLIC_URL: 'http://127.0.0.1:8850' };
    assert.deepEqual(loadEnvFile(env), { path: file, source: 'BLUMODEL_ENV_FILE', set: 2, total: 3, malformed: [], ignored: [] });
    assert.equal(env.STRIPE_SECRET_KEY, FAKE_KEY);
    assert.equal(env.PUBLIC_URL, 'http://127.0.0.1:8850', 'a value already set is not replaced');

    const legacy = { MISE_ENV_FILE: file };
    assert.equal(envFilePath(legacy), file);
    const li = loadEnvFile(legacy);
    assert.equal(li.set, 3);
    assert.equal(li.source, 'MISE_ENV_FILE');
    assert.match(describeEnvFile(li).warn.join(' '), /MISE_ENV_FILE is deprecated/);
    assert.equal(envFilePath({ BLUMODEL_ENV_FILE: file, MISE_ENV_FILE: 'C:\\old\\mise.env' }), file, 'the new name wins');
    assert.equal(envFilePath({ BLUMODEL_ENV_FILE: `"${file}"` }), file, 'quotes from a cmd `set` are dropped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the default settings file: blumodel.env in a deployed home, else the old mise.env; a checkout has none', () => {
  const dir = tempDir();
  try {
    const home = path.join(dir, 'BluModelStudio');
    const serverDir = path.join(home, 'app', 'server');
    fs.mkdirSync(serverDir, { recursive: true });
    assert.equal(deployedHome(serverDir), home);
    assert.equal(deployedHome(path.join(dir, 'blumodel-studio', 'server')), null, 'a checkout is not a home');
    assert.equal(resolveEnvFile({}, { serverDir }), null, 'no file yet');

    fs.writeFileSync(path.join(home, 'mise.env'), `STRIPE_WEBHOOK_SECRET=${FAKE_WHSEC}\n`);
    assert.deepEqual(resolveEnvFile({}, { serverDir }), { file: path.join(home, 'mise.env'), source: 'default-legacy' });
    const env = {};
    const legacy = loadEnvFile(env, { serverDir });
    assert.equal(env.STRIPE_WEBHOOK_SECRET, FAKE_WHSEC);
    assert.match(describeEnvFile(legacy).warn.join(' '), /Rename it to blumodel\.env/);

    fs.writeFileSync(path.join(home, 'blumodel.env'), `STRIPE_SECRET_KEY=${FAKE_KEY}\n`);
    assert.deepEqual(resolveEnvFile({}, { serverDir }), { file: path.join(home, 'blumodel.env'), source: 'default' });
    assert.equal(resolveEnvFile({ BLUMODEL_ENV_FILE: 'C:\\elsewhere.env' }, { serverDir }).file, 'C:\\elsewhere.env', 'a named file wins over the default');
    // The server run from this checkout never picks up a home's file.
    assert.equal(resolveEnvFile({}), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnvFile: a named file that is missing stops the start instead of running without its keys', () => {
  const dir = tempDir();
  try {
    const missing = path.join(dir, 'nope.env');
    assert.throws(() => loadEnvFile({ BLUMODEL_ENV_FILE: missing }), /Can't read the settings file .*nope\.env \(ENOENT\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config reads MISE_LLM_MODEL as a deprecated fallback for BLUMODEL_LLM_MODEL', () => {
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k', MISE_LLM_MODEL: 'm-old' }, []).BLUMODEL_LLM_MODEL, 'm-old');
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k', MISE_LLM_MODEL: 'm-old', BLUMODEL_LLM_MODEL: 'm-new' }, []).BLUMODEL_LLM_MODEL, 'm-new');
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k', MISE_LLM_MODEL: 'm-old' }, []).llmEnabled, true);
});

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });

/** A clean environment for a spawned server: none of the shell's payment or settings names. */
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(STRIPE_|ANTHROPIC_|BLUMODEL_|MISE_|PAYMENTS$|DEMO_PAYMENTS$|PUBLIC_URL$|NODE_ENV$|TRUST_PROXY$|ADMIN_EMAILS$|LEGAL_|SUPPORT_EMAIL$|BACKUP)/.test(k)) delete env[k];
  return env;
};

test('the real server started with a settings file: Stripe TEST mode, and no secret reaches its output or public endpoints', async () => {
  const dir = tempDir();
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>BluModel Studio</title><div id="root"></div>');
  const file = path.join(dir, 'blumodel.env');
  fs.writeFileSync(file, `# fake keys for the test\nSTRIPE_SECRET_KEY=${FAKE_KEY}\nSTRIPE_WEBHOOK_SECRET="${FAKE_WHSEC}"\nPUBLIC_URL=https://blumodel.example\nUNKNOWN_THING=${FAKE_KEY}\nnot a line\n`);
  const port = await freePort();
  const env = cleanEnv();
  Object.assign(env, { BLUMODEL_ENV_FILE: file, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(dir, 'blumodel.db'), DIST_DIR: dist });
  const child = spawn(process.execPath, ['--no-warnings', path.join(HERE, '..', 'index.mjs'), '--prod'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    const deadline = Date.now() + 15_000;
    while (!/Stripe: (TEST|LIVE) mode/.test(out)) {
      if (child.exitCode !== null) throw new Error(`the server exited: ${out}`);
      if (Date.now() > deadline) throw new Error(`the server did not start: ${out}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(out, /Read 3 settings from .*blumodel\.env \(3 applied/);
    assert.match(out, /payments: stripe, production/);
    assert.match(out, /Stripe: TEST mode/);
    assert.match(out, /skipped line 6/);
    assert.match(out, /ignored line 5/);
    const bodies = [];
    for (const p of ['/api/config', '/api/billing/plans', '/', '/api/nope', '/api/health']) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`);
      bodies.push(`${p} ${r.status} ${JSON.stringify([...r.headers])} ${await r.text()}`);
    }
    const cfg = JSON.parse(bodies[0].slice(bodies[0].indexOf('{"')));
    assert.equal(cfg.payments, 'stripe');
    assert.equal(cfg.publicUrl, 'https://blumodel.example');
    for (const b of [out, ...bodies]) {
      assert.ok(!b.includes('FAKE_FOR_TESTS'), `a secret leaked: ${b.slice(0, 300)}`);
    }
  } finally {
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real server refuses to start when its named settings file is missing, and says why', async () => {
  const dir = tempDir();
  try {
    const env = { ...cleanEnv(), BLUMODEL_ENV_FILE: path.join(dir, 'missing.env'), PORT: '0', DB_PATH: path.join(dir, 'x.db') };
    const child = spawn(process.execPath, ['--no-warnings', path.join(HERE, '..', 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const code = await new Promise((r) => child.once('exit', r));
    assert.equal(code, 1);
    assert.match(out, /did not start: Can't read the settings file .*missing\.env/);
    assert.ok(!fs.existsSync(path.join(dir, 'x.db')), 'it stopped before opening a database');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
