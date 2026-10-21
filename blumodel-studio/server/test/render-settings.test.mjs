// Admin > System > Render service (server/renders/settings.mjs): an admin pastes the render
// service's address and key; renders use it at once (no restart); the key is stored sealed, never
// sent back, logged or audited; blumodel.env wins; only admins; the key file is what opens it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sampleDoc, startTestServer } from './helpers.mjs';
import { makePng } from '../lib/synth.mjs';
import { createRenderSettings, keyProblem, urlProblem } from '../renders/settings.mjs';
import { loadConfig } from '../config.mjs';

const KEY = 'arch_PANEL_TEST_KEY_9z7Q';
const URL_ = 'https://architect.example/v1/render';
const view = () => makePng({ w: 320, h: 180 }).toString('base64');
const SCENE = { room: { kind: 'kitchen', widthIn: 200, lengthIn: 156, ceilingIn: 108 }, camera: { view: 'current', widthPx: 320, heightPx: 180 } };

function recorder() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(makePng({ w: 400, h: 225 }), { headers: { 'Content-Type': 'image/png' } });
  };
  return { calls, fetch };
}

test('an admin saves the address and key; renders use it at once; the key never comes back', async () => {
  const { calls, fetch } = recorder();
  const lines = [];
  const log = { info: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) };
  const t = await startTestServer({ env: { FREE_RENDERS: '0', RENDER_PROVIDER: 'auto' }, fetch, log });
  try {
    const admin = await t.user({ role: 'admin' });
    const before = await admin.get('/api/admin/system/renders');
    assert.equal(before.status, 200);
    assert.equal(before.body.renders.source, null);

    // A showroom with credits and a staff member, rendering before and after.
    const tn = t.tenant({ name: 'Acme Kitchens', slug: 'acme' });
    t.services.credits.grantMonth(tn.id, 'in_acme');
    const staff = await t.showroomUser(tn, { role: 'staff' });
    const sp = await staff.post('/api/projects', { name: 'Staff kitchen', doc: sampleDoc({ name: 'Staff kitchen' }) });

    // Refused: http in production rules only apply in prod; a bad address and a key with a space are refused here.
    assert.equal((await admin.post('/api/admin/system/renders', { url: 'ftp://x', key: KEY })).status, 400);
    const spaced = await admin.post('/api/admin/system/renders', { url: URL_, key: 'abc def ghi' });
    assert.equal(spaced.status, 400);
    assert.equal(spaced.body.errors[0].field, 'key');

    const saved = await admin.post('/api/admin/system/renders', { url: URL_, key: `  ${KEY}\n` });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.renders.source, 'admin');
    assert.equal(saved.body.renders.provider, 'architect');
    assert.equal(saved.body.renders.keyLast4, KEY.slice(-4));
    assert.ok(!saved.text.includes(KEY), 'the key is not in the answer');
    assert.ok(!(await admin.get('/api/admin/system/renders')).text.includes(KEY));

    // Stored sealed: the row has no trace of the key.
    const row = t.db.prepare('SELECT * FROM render_settings').get();
    assert.ok(!JSON.stringify(row).includes(KEY));
    assert.match(row.key_sealed, /^v1\./);

    // No restart: the next render goes to the service, with the key in the header only.
    const r = await staff.post('/api/renders', { projectId: sp.body.project.id, image: view(), scene: SCENE });
    assert.equal(r.status, 202, r.text);
    await t.services.renders.settled();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, URL_);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal((await staff.get(`/api/renders/${r.body.render.id}`)).body.render.status, 'done');

    // Test it: one small render through the service.
    const tr = await admin.post('/api/admin/system/renders/test', {});
    assert.equal(tr.status, 200);
    assert.equal(tr.body.ok, true);
    assert.equal(calls.length, 2);

    // Changing only the address keeps the saved key.
    const moved = await admin.post('/api/admin/system/renders', { url: 'https://architect.example/v2/render' });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.body.renders.keyLast4, KEY.slice(-4));
    await admin.post('/api/admin/system/renders/test', {});
    assert.equal(calls[2].url, 'https://architect.example/v2/render');
    assert.equal(calls[2].init.headers.Authorization, `Bearer ${KEY}`);

    // Audited without the key; never logged.
    const audits = t.db.prepare("SELECT action, detail FROM admin_audit WHERE action LIKE 'render_service%'").all();
    assert.equal(audits.length, 2);
    assert.ok(audits.every((a) => !String(a.detail).includes(KEY) && !String(a.detail).includes('/v1/render')));
    assert.ok(lines.every((l) => !l.includes(KEY)), 'the key is never logged');

    // Removed: renders are not set up again.
    const gone = await admin.post('/api/admin/system/renders/remove', {});
    assert.equal(gone.status, 200);
    assert.equal(gone.body.renders.source, null);
    assert.notEqual(gone.body.renders.provider, 'architect');
  } finally {
    await t.close();
  }
});

test('only admins see or change it', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'auto' } });
  try {
    const studio = await t.user({ role: 'studio' });
    assert.equal((await studio.get('/api/admin/system/renders')).status, 403);
    assert.equal((await studio.post('/api/admin/system/renders', { url: URL_, key: KEY })).status, 403);
    const anon = t.agent();
    assert.equal((await anon.post('/api/admin/system/renders', { url: URL_, key: KEY })).status, 401);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM render_settings').get().n, 0);
  } finally {
    await t.close();
  }
});

test('blumodel.env wins: the panel shows it (last four only) and can’t change it', async () => {
  const t = await startTestServer({ env: { ARCHITECT_AI_URL: URL_, ARCHITECT_AI_KEY: KEY } });
  try {
    const admin = await t.user({ role: 'admin' });
    const v = await admin.get('/api/admin/system/renders');
    assert.equal(v.body.renders.source, 'env');
    assert.equal(v.body.renders.keyLast4, KEY.slice(-4));
    assert.ok(!v.text.includes(KEY));
    const r = await admin.post('/api/admin/system/renders', { url: 'https://other.example/', key: 'another_key_123' });
    assert.equal(r.status, 400);
    assert.match(r.body.errors[0].message, /blumodel\.env/);
  } finally {
    await t.close();
  }
});

test('the key file opens it: a copy of the database alone can’t, and says so', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-rs-'));
  try {
    const dbPath = path.join(dir, 'blumodel.db');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE render_settings (id INTEGER PRIMARY KEY CHECK (id = 1), url TEXT NOT NULL, key_sealed TEXT NOT NULL, key_last4 TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)');
    const config = loadConfig({ DB_PATH: dbPath }, []);
    const fetch = async () => new Response('');
    const a = createRenderSettings({ db, config, now: () => 1, fetch });
    a.save({ url: URL_, key: KEY, by: 'gabe@test' });
    const keyFile = path.join(dir, 'render-settings.key');
    assert.equal(fs.statSync(keyFile).size, 32);
    assert.equal(a.current()?.id, 'architect');
    // Another machine's key file (or none): unreadable, flagged, renders not on.
    fs.writeFileSync(keyFile, Buffer.alloc(32, 7));
    const b = createRenderSettings({ db, config, now: () => 2, fetch });
    assert.equal(b.view().keyUnreadable, true);
    assert.notEqual(b.current()?.id, 'architect');
    // Pasting the key again fixes it.
    b.save({ url: URL_, key: KEY, by: 'gabe@test' });
    assert.equal(b.view().keyUnreadable, false);
    assert.equal(createRenderSettings({ db, config, now: () => 3, fetch }).current()?.id, 'architect');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('address and key rules', () => {
  assert.equal(urlProblem(URL_, { prod: true }), null);
  assert.match(urlProblem('http://architect.example/', { prod: true }), /https/);
  assert.equal(urlProblem('http://127.0.0.1:9000/render', { prod: true }), null);
  assert.match(urlProblem('https://user:pw@architect.example/', { prod: false }), /key box/);
  assert.equal(keyProblem(KEY), null);
  assert.match(keyProblem('short'), /8 to/);
  assert.match(keyProblem('has\nbreak123'), /line break/);
});
