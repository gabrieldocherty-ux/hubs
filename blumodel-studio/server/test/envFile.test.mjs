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
import { envFilePath, loadEnvFile, parseEnvFile } from '../lib/envFile.mjs';
import { loadConfig } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_KEY = 'sk_test_FAKE_FOR_TESTS';
const FAKE_WHSEC = 'whsec_FAKE_FOR_TESTS';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-envfile-'));

test('parseEnvFile: KEY=VALUE, comments, export, quotes, inline comments, CRLF and a BOM', () => {
  const text = '\uFEFF# private\r\nSTRIPE_SECRET_KEY=sk_test_FAKE_FOR_TESTS\r\n\r\nexport PUBLIC_URL = https://blumodel.example \r\nADMIN_EMAILS="a@b.test, c@d.test"\nQUOTED=\'has # hash\'\nTRUST_PROXY=1 # one proxy\nEMPTY=\nLAST=1\nLAST=2\n';
  assert.deepEqual(parseEnvFile(text), {
    STRIPE_SECRET_KEY: FAKE_KEY,
    PUBLIC_URL: 'https://blumodel.example',
    ADMIN_EMAILS: 'a@b.test, c@d.test',
    QUOTED: 'has # hash',
    TRUST_PROXY: '1',
    EMPTY: '',
    LAST: '2',
  });
});

test('parseEnvFile: a bad line is reported by number only, never by its text', () => {
  for (const [text, line] of [
    ['OK=1\nsk_test_FAKE_FOR_TESTS\n', 2],
    ['=sk_test_FAKE_FOR_TESTS', 1],
    ['A=1\nB=2\nBAD KEY=sk_test_FAKE_FOR_TESTS', 3],
    ['KEY="sk_test_FAKE_FOR_TESTS', 1],
  ]) {
    assert.throws(
      () => parseEnvFile(text),
      (err) => {
        assert.match(err.message, new RegExp(`line ${line}\\b`));
        assert.ok(!err.message.includes('FAKE'), `the message leaks the line: ${err.message}`);
        return true;
      },
    );
  }
});

test('loadEnvFile: BLUMODEL_ENV_FILE, then the deprecated MISE_ENV_FILE; the environment wins', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'blumodel.env');
    fs.writeFileSync(file, `STRIPE_SECRET_KEY=${FAKE_KEY}\nSTRIPE_WEBHOOK_SECRET=${FAKE_WHSEC}\nPORT=9999\n`);
    assert.equal(loadEnvFile({}), null, 'no file named: nothing to do');

    const env = { BLUMODEL_ENV_FILE: file, PORT: '8850' };
    assert.deepEqual(loadEnvFile(env), { path: file, set: 2, total: 3 });
    assert.equal(env.STRIPE_SECRET_KEY, FAKE_KEY);
    assert.equal(env.PORT, '8850', 'a value already set is not replaced');

    const legacy = { MISE_ENV_FILE: file };
    assert.equal(envFilePath(legacy), file);
    assert.equal(loadEnvFile(legacy).set, 3);
    assert.equal(envFilePath({ BLUMODEL_ENV_FILE: file, MISE_ENV_FILE: 'C:\\old\\mise.env' }), file, 'the new name wins');
    assert.equal(envFilePath({ BLUMODEL_ENV_FILE: `"${file}"` }), file, 'quotes from a cmd `set` are dropped');
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

test('the real server started with a settings file: Stripe is on, and no secret reaches its output or public endpoints', async () => {
  const dir = tempDir();
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>BluModel Studio</title><div id="root"></div>');
  const file = path.join(dir, 'blumodel.env');
  fs.writeFileSync(file, `# fake keys for the test\nSTRIPE_SECRET_KEY=${FAKE_KEY}\nSTRIPE_WEBHOOK_SECRET="${FAKE_WHSEC}"\nPUBLIC_URL=https://blumodel.example\n`);
  const port = await freePort();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(STRIPE_|ANTHROPIC_|BLUMODEL_|MISE_|PAYMENTS$|DEMO_PAYMENTS$|PUBLIC_URL$|NODE_ENV$)/.test(k)) delete env[k];
  Object.assign(env, { BLUMODEL_ENV_FILE: file, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(dir, 'blumodel.db'), DIST_DIR: dist });
  const child = spawn(process.execPath, ['--no-warnings', path.join(HERE, '..', 'index.mjs'), '--prod'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    const deadline = Date.now() + 15_000;
    while (!/listening on/.test(out)) {
      if (child.exitCode !== null) throw new Error(`the server exited: ${out}`);
      if (Date.now() > deadline) throw new Error(`the server did not start: ${out}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(out, /Read 3 settings from .*blumodel\.env \(3 applied/);
    assert.match(out, /payments: stripe, production/);
    const bodies = [];
    for (const p of ['/api/config', '/api/billing/plans', '/', '/api/nope']) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`);
      bodies.push(`${p} ${r.status} ${JSON.stringify([...r.headers])} ${await r.text()}`);
    }
    assert.equal(JSON.parse(bodies[0].slice(bodies[0].indexOf('{"'))).payments, 'stripe');
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
    const env = { ...process.env, BLUMODEL_ENV_FILE: path.join(dir, 'missing.env'), PORT: '0', DB_PATH: path.join(dir, 'x.db') };
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
