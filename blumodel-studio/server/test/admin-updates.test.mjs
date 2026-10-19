// Admin > System > Updates (server/admin/updates.mjs, POST /api/admin/system/update-now): the card's
// data from the files the automatic update writes, and Update now leaving its trigger file, audited.
// Every home is a temp folder; nothing runs an update.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from './helpers.mjs';
import { serverHome, updateStatus } from '../admin/updates.mjs';

const tempHome = () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-adminup-'));
  fs.mkdirSync(path.join(h, 'logs'));
  return h;
};
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const OLD = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('the home: BLUMODEL_HOME, else the folder a deployed app/ sits in, else none (a development server)', () => {
  const h = tempHome();
  try {
    assert.equal(serverHome({ env: { BLUMODEL_HOME: h } }), path.resolve(h));
    fs.mkdirSync(path.join(h, 'app', 'server'), { recursive: true });
    assert.equal(serverHome({ env: {}, serverDir: path.join(h, 'app', 'server') }), null, 'no DEPLOYED.txt: not a deployed app');
    fs.writeFileSync(path.join(h, 'app', 'DEPLOYED.txt'), 'commit 1111111\n');
    assert.equal(serverHome({ env: {}, serverDir: path.join(h, 'app', 'server') }), h);
    assert.equal(serverHome({ env: {}, serverDir: path.join(h, 'checkout', 'server') }), null);
    assert.deepEqual(updateStatus({ home: null }), { available: false, reason: 'not_a_home' });
  } finally {
    rm(h);
  }
});

test('GET /api/admin/system has the Updates card: not installed, then on with its time; the last result with a rolled-back warning; error text redacted; only commits and times leave the file', async () => {
  const t = await startTestServer();
  const h = tempHome();
  try {
    const admin = await t.user({ role: 'admin' });
    t.ctx.home = null;
    assert.deepEqual((await admin.get('/api/admin/system')).body.updates, { available: false, reason: 'not_a_home' });
    t.ctx.home = h;
    let u = (await admin.get('/api/admin/system')).body.updates;
    assert.equal(u.available, true);
    assert.equal(u.installed, false);
    fs.writeFileSync(path.join(h, 'auto-update.conf'), 'AUTO_UPDATE=on\nAUTO_UPDATE_TIME=04:00\n');
    fs.writeFileSync(
      path.join(h, 'logs', 'update-status.json'),
      JSON.stringify({
        checkedAt: '2026-10-18T04:03:00.000Z',
        branch: 'blumodel-studio',
        deployed: OLD.slice(0, 7),
        head: NEW,
        source: 'abcdef0123456',
        result: { at: '2026-10-18T04:03:00.000Z', from: OLD.slice(0, 7), to: NEW, outcome: 'rolled-back', durationMs: 4000, error: 'health check failed; key sk_live_FAKEFAKEFAKEFAKE0000 was in a log', by: 'schedule', secretThing: 'nope' },
        lastUpdate: { at: '2026-10-10T04:01:00.000Z', from: '0000000', to: OLD, outcome: 'updated', durationMs: 9000, error: null, by: 'schedule' },
        failed: { commit: NEW, at: '2026-10-18T04:03:00.000Z' },
      }),
    );
    u = (await admin.get('/api/admin/system')).body.updates;
    assert.equal(u.installed, true);
    assert.equal(u.enabled, true);
    assert.equal(u.time, '04:00');
    assert.equal(u.branch, 'blumodel-studio');
    assert.equal(u.deployed, OLD.slice(0, 7));
    assert.equal(u.head, NEW);
    assert.equal(u.source, 'abcdef0123456');
    assert.equal(u.last.outcome, 'rolled-back');
    assert.equal(u.rolledBack, true);
    assert.equal(u.failed.commit, NEW);
    assert.equal(u.lastUpdate.to, OLD);
    assert.doesNotMatch(JSON.stringify(u), /sk_live_FAKE/, 'redacted');
    assert.doesNotMatch(JSON.stringify(u), /secretThing|nope/, 'only the known fields');
    assert.equal(u.pending, false);
  } finally {
    await t.close();
    rm(h);
  }
});

test('POST /api/admin/system/update-now: refused (409) with nothing to pick it up; otherwise leaves the trigger file, says when one was already waiting, and is audited', async () => {
  const t = await startTestServer();
  const h = tempHome();
  try {
    const admin = await t.user({ role: 'admin' });
    const customer = await t.user();
    t.ctx.home = null;
    let r = await admin.post('/api/admin/system/update-now', {});
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not_a_home');
    t.ctx.home = h;
    r = await admin.post('/api/admin/system/update-now', {});
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not_installed');
    fs.writeFileSync(path.join(h, 'auto-update.conf'), 'AUTO_UPDATE=off\nAUTO_UPDATE_TIME=04:00\n');
    r = await admin.post('/api/admin/system/update-now', {});
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'auto_update_off');
    const trigger = path.join(h, 'logs', 'update-now.request');
    assert.ok(!fs.existsSync(trigger));

    fs.writeFileSync(path.join(h, 'auto-update.conf'), 'AUTO_UPDATE=on\nAUTO_UPDATE_TIME=04:00\n');
    assert.equal((await customer.post('/api/admin/system/update-now', {})).status, 403);
    assert.equal((await admin.request('POST', '/api/admin/system/update-now', { body: {}, csrf: false })).status, 403, 'CSRF header required');
    assert.ok(!fs.existsSync(trigger));
    r = await admin.post('/api/admin/system/update-now', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.requested, r.body.alreadyPending, r.body.updates.pending], [true, false, true]);
    assert.ok(fs.existsSync(trigger));
    assert.equal(JSON.parse(fs.readFileSync(trigger, 'utf8')).by, admin.user.email);
    r = await admin.post('/api/admin/system/update-now', {});
    assert.equal(r.body.alreadyPending, true);
    const rows = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'update_now' ORDER BY id").all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].admin_email, admin.user.email);
    assert.deepEqual(JSON.parse(rows[1].detail), { alreadyPending: true });
  } finally {
    await t.close();
    rm(h);
  }
});
