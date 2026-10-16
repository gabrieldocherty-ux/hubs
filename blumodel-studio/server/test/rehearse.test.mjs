// What the new-machine rehearsal found (docs/HOSTING.md followed literally on a fresh temp machine):
// a home installed on a port other than 8790 (install-linux.sh --port, install-windows.ps1 -Port)
// must keep that port through every later command that isn't told it again: the update's deploy
// and health check, a rollback, and the data scripts' "is the server stopped?" check. The home's own
// generated files say which port it uses (server/ops/homePort.mjs).
//
// Temp folders and an ephemeral port only: nothing here starts a server, touches a real home or
// connects to 8787/8790/8795.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homePort } from '../ops/homePort.mjs';
import { serverScripts, systemdServerUnit } from '../ops/home.mjs';
import { scriptConfig } from '../ops/backup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WIN = process.platform === 'win32';
const NODE = process.execPath;
const tempDir = (p = 'blumodel-rehearse-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
const cleanEnv = (extra = {}) => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(STRIPE_|ANTHROPIC_|BLUMODEL_|MISE_|PAYMENTS$|DEMO_PAYMENTS$|PUBLIC_URL$|NODE_ENV$|TRUST_PROXY$|ADMIN_EMAILS$|LEGAL_|SUPPORT_EMAIL$|DB_PATH$|PORT$|HOST$)/.test(k)) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
};

test('homePort on Windows: the port in the home’s run-server.cmd (as deploy-local writes it); null for a new home', () => {
  const dir = tempDir();
  try {
    assert.equal(homePort(dir, { platform: 'win32' }), null, 'no run-server.cmd yet');
    fs.writeFileSync(path.join(dir, 'run-server.cmd'), serverScripts({ node: 'C:\\Program Files\\nodejs\\node.exe', port: 8931 })['run-server.cmd']);
    assert.equal(homePort(dir, { platform: 'win32' }), 8931);
    fs.writeFileSync(path.join(dir, 'run-server.cmd'), '@echo off\r\nset PORT=99999\r\n');
    assert.equal(homePort(dir, { platform: 'win32' }), null, 'not a port');
  } finally {
    rm(dir);
  }
});

test('homePort on Linux: Environment=PORT from blumodel-studio.service, only when the unit is this home’s (its DB_PATH)', () => {
  const unit = systemdServerUnit({ home: '/srv/blumodel-studio', port: 8932 });
  const reads = [];
  const readFile = (f) => {
    reads.push(f);
    return unit;
  };
  assert.equal(homePort('/srv/blumodel-studio', { platform: 'linux', readFile }), 8932);
  assert.deepEqual(reads, ['/etc/systemd/system/blumodel-studio.service'], 'reads the unit, nothing else');
  assert.equal(homePort('/srv/blumodel-studio/', { platform: 'linux', readFile }), 8932, 'a trailing slash is the same home');
  assert.equal(homePort('/srv/other-home', { platform: 'linux', readFile }), null, 'another home’s unit says nothing about this one');
  const missing = () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  assert.equal(homePort('/srv/blumodel-studio', { platform: 'linux', readFile: missing }), null, 'no unit installed');
  assert.equal(homePort('', { platform: 'linux', readFile }), null);
});

test('the data scripts (import-data, restore) ask the home’s own port when none is given; --port and PORT still win; --db alone keeps 8790', () => {
  const portOf = (home) => (home === path.resolve('/x/home') ? 8933 : null);
  assert.equal(scriptConfig({ argv: ['--home', '/x/home'], env: {}, portOf }).config.PORT, 8933);
  assert.equal(scriptConfig({ argv: ['--home', '/x/home', '--port', '8934'], env: {}, portOf }).config.PORT, 8934);
  assert.equal(scriptConfig({ argv: ['--home', '/x/home'], env: { PORT: '8929' }, portOf }).config.PORT, 8929);
  assert.equal(scriptConfig({ argv: ['--db', '/x/home/data/blumodel.db'], env: {}, portOf }).config.PORT, 8790);
  // Run from a deployed home's app/server/scripts with nothing given: that home's port.
  const serverDir = path.resolve('/x/home/app/server');
  assert.equal(scriptConfig({ argv: [], env: {}, serverDir, portOf }).config.PORT, 8933);
  assert.equal(scriptConfig({ argv: [], env: { DB_PATH: '/y/blumodel.db' }, serverDir, portOf }).config.PORT, 8790, 'DB_PATH names another database');
});

test('deploy-local uses the port the home was installed with when BLUMODEL_PORT is not set (the update passes none)', { skip: !WIN && 'the Linux deploy needs root and systemd', timeout: 60_000 }, async () => {
  const dir = tempDir();
  // Something else holds the home's port, so the deploy must stop at "Port <n> is in use", before
  // it changes anything: proof it checked the home's port, not 8790.
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = /** @type {net.AddressInfo} */ (blocker.address()).port;
  try {
    const home = path.join(dir, 'home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'run-server.cmd'), serverScripts({ node: NODE, port })['run-server.cmd']);
    const dist = path.join(dir, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
    const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'deploy-local.mjs'), '--dist', dist, '--commit', 'test'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 50_000,
      env: cleanEnv({ BLUMODEL_HOME: home }),
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`Port ${port} is in use`));
    assert.doesNotMatch(r.stdout + r.stderr, /8790/);
    assert.ok(!fs.existsSync(path.join(home, 'app')), 'nothing was deployed');
    assert.match(fs.readFileSync(path.join(home, 'run-server.cmd'), 'utf8'), new RegExp(`^set PORT=${port}\\r?$`, 'm'), 'the supervisor keeps its port');
  } finally {
    await new Promise((r) => blocker.close(r));
    rm(dir);
  }
});
