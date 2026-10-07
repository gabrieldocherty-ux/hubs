// Package generate: "Start from a photo". No real Anthropic calls: every test mocks fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, sampleDoc } from './helpers.mjs';
import { makeJpeg, makePng } from './fixtures/images.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { analyzePhotos, buildRequest, parseAnswer, API_URL } from '../llm/anthropic.mjs';
import { clampPhotoModel, photoModelJsonSchema } from '../llm/photoModel.mjs';

const KEY = 'sk-ant-test-0123456789abcdef-SECRET';
const LLM = { ANTHROPIC_API_KEY: KEY, MISE_LLM_MODEL: 'claude-opus-5-5' };

/** A model answer the way the analyser gives it: per-item confidence, some values out of range. */
const ANSWER = {
  room: { widthIn: 168, lengthIn: 900, ceilingIn: 108, confidence: 0.8 },
  openings: [{ type: 'window', wall: 'north', offsetIn: 60, widthIn: 36, heightIn: 42, sillIn: 42, confidence: 0.9 }],
  runs: [
    { wall: 'north', startIn: 0, endIn: 168, upper: true, confidence: 0.9 },
    { wall: 'west', startIn: 0, endIn: 120, upper: true, confidence: 0.4 },
  ],
  appliances: [
    { kind: 'sink', wall: 'north', offsetIn: 62, widthIn: 33, confidence: 0.95 },
    { kind: 'range', wall: 'west', offsetIn: 60, widthIn: 30, confidence: 0.7 },
    { kind: 'toaster', wall: 'west', offsetIn: 10, widthIn: 12, confidence: 0.2 },
  ],
  island: null,
  style: { cabinetHex: '#2f3c52', cabinetDoor: 'shaker', counter: 'calacatta', backsplash: 'subway-white', floor: 'herringbone', hardware: 'brass', wall: 'chalk', confidence: 0.85 },
  notes: ['The south wall is not visible.'],
};

const apiReply = (text, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra }),
});

/** A fetch mock that records each call and answers with `reply(call)`. */
function mockFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    const call = { url: String(url), init, body: JSON.parse(init.body) };
    calls.push(call);
    return reply(call);
  };
  fn.calls = calls;
  return fn;
}

/** A log that keeps every line, so tests can scan it. */
function captureLog() {
  const lines = [];
  const put = (...a) => lines.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return { lines, info: put, warn: put, error: put };
}

async function upload(agent, buf, name = 'kitchen.png', type = 'image/png') {
  const r = await agent.putRaw(`/api/files?kind=reference&name=${encodeURIComponent(name)}`, buf, type);
  assert.equal(r.status, 201, r.text);
  return r.body.file;
}

test('photo analysis is a 503 unless ANTHROPIC_API_KEY and MISE_LLM_MODEL are both set', async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: KEY }, { MISE_LLM_MODEL: 'claude-opus-5-5' }]) {
    const fetch = mockFetch(() => apiReply('{}'));
    const t = await startTestServer({ env, fetch });
    try {
      const alice = await t.user();
      const f = await upload(alice, makePng());
      const r = await alice.post('/api/generate/photo', { fileIds: [f.id] });
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { error: 'Photo analysis is not configured.' });
      assert.equal(fetch.calls.length, 0, 'nothing is sent anywhere');
      assert.equal((await alice.get('/api/config')).body.llm, false);
    } finally {
      await t.close();
    }
  }
});

test('a valid answer comes back validated and clamped, with warnings', async () => {
  const fetch = mockFetch(() => apiReply(JSON.stringify(ANSWER)));
  const t = await startTestServer({ env: LLM, fetch });
  try {
    const alice = await t.user();
    const a = await upload(alice, makePng({ w: 16, h: 12 }));
    const b = await upload(alice, makeJpeg(), 'b.jpg', 'image/jpeg');
    const r = await alice.post('/api/generate/photo', { fileIds: [a.id, b.id] });
    assert.equal(r.status, 200, r.text);
    const m = r.body.model;
    assert.equal(m.version, 1);
    assert.deepEqual(m.room, { widthIn: 168, lengthIn: 480, ceilingIn: 108 }, 'length clamped to the editor’s 40′');
    assert.ok(r.body.warnings.some((w) => w.startsWith('Room length')));
    assert.equal(m.appliances.length, 2, 'the unknown "toaster" is dropped');
    assert.equal(m.confidence.room, 0.8);
    assert.equal(m.confidence['runs.1'], 0.4);
    assert.equal(m.style.cabinetHex, '#2f3c52');
    assert.deepEqual(m.notes, ['The south wall is not visible.']);

    // What went to the API: the configured model, the key in a header, the photos as base64
    // image blocks, the PhotoModel JSON schema, and no free text from the user.
    assert.equal(fetch.calls.length, 1);
    const call = fetch.calls[0];
    assert.equal(call.url, API_URL);
    assert.equal(call.init.headers['x-api-key'], KEY);
    assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
    assert.ok(call.init.signal, 'the request can time out');
    assert.equal(call.body.model, 'claude-opus-5-5');
    const imgs = call.body.messages[0].content.filter((c) => c.type === 'image');
    assert.deepEqual(imgs.map((c) => c.source.media_type), ['image/png', 'image/jpeg']);
    assert.equal(Buffer.from(imgs[1].source.data, 'base64').equals(makeJpeg()), true);
    assert.equal(call.body.output_config.format.type, 'json_schema');
    assert.equal(call.body.output_config.format.schema.additionalProperties, false);
  } finally {
    await t.close();
  }
});

test('junk, prose around the JSON, a refusal or an API error is a 502 (busy is a 503)', async () => {
  const replies = [
    () => apiReply('I think this kitchen is about 12 by 14 feet.'),
    () => apiReply(`Here is the model:\n${JSON.stringify(ANSWER)}\nHope that helps!`),
    () => apiReply('{"room": "big"}'),
    () => apiReply('[1,2,3]'),
    () => apiReply('', { stop_reason: 'refusal', content: [] }),
    () => ({ ok: false, status: 400, json: async () => ({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }) }),
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } }),
  ];
  for (const reply of replies) {
    const t = await startTestServer({ env: LLM, fetch: mockFetch(reply) });
    try {
      const alice = await t.user();
      const f = await upload(alice, makePng());
      const r = await alice.post('/api/generate/photo', { fileIds: [f.id] });
      assert.equal(r.status, 502, r.text);
      assert.equal(typeof r.body.error, 'string');
    } finally {
      await t.close();
    }
  }
  const t = await startTestServer({ env: LLM, fetch: mockFetch(() => ({ ok: false, status: 529, json: async () => ({}) })) });
  try {
    const alice = await t.user();
    const f = await upload(alice, makePng());
    assert.equal((await alice.post('/api/generate/photo', { fileIds: [f.id] })).status, 503);
  } finally {
    await t.close();
  }
});

test('a JSON answer in one fenced block is accepted; anything else around it is not', () => {
  const json = JSON.stringify(ANSWER);
  assert.ok(parseAnswer(json));
  assert.ok(parseAnswer('```json\n' + json + '\n```'));
  assert.equal(parseAnswer('Sure! ```json\n' + json + '\n```'), null);
  assert.equal(parseAnswer(''), null);
  assert.equal(parseAnswer('null'), null);
});

test('someone else’s photo is a 404, a missing one too; signed-out callers get a 401', async () => {
  const fetch = mockFetch(() => apiReply(JSON.stringify(ANSWER)));
  const t = await startTestServer({ env: LLM, fetch });
  try {
    const alice = await t.user();
    const bob = await t.user();
    const f = await upload(alice, makePng());
    const r = await bob.post('/api/generate/photo', { fileIds: [f.id] });
    assert.equal(r.status, 404);
    assert.equal((await bob.post('/api/generate/photo', { fileIds: ['f_doesnotexist000000000000'] })).status, 404);
    assert.equal((await t.agent().post('/api/generate/photo', { fileIds: [f.id] })).status, 401);
    assert.equal(fetch.calls.length, 0);
    for (const bad of [{}, { fileIds: [] }, { fileIds: 'x' }, { fileIds: [1] }, { fileIds: Array(7).fill(f.id).map((x, i) => x + i) }]) {
      assert.equal((await alice.post('/api/generate/photo', bad)).status, 400, JSON.stringify(bad));
    }
  } finally {
    await t.close();
  }
});

test('photos over 5 MB are refused with a clear message; models are not photos', async () => {
  const fetch = mockFetch(() => apiReply(JSON.stringify(ANSWER)));
  const t = await startTestServer({ env: LLM, fetch });
  try {
    const alice = await t.user();
    // A real PNG padded past 5 MB with an ancillary chunk (still a valid image).
    const png = makePng();
    const pad = Buffer.alloc(5 * 1024 * 1024 + 100);
    const chunk = Buffer.alloc(12 + pad.length);
    chunk.writeUInt32BE(pad.length, 0);
    chunk.write('tEXt', 4, 'latin1');
    pad.copy(chunk, 8);
    const big = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    const file = t.file(alice, big, { kind: 'reference', originalName: 'huge.png' });
    const r = await alice.post('/api/generate/photo', { fileIds: [file.id] });
    assert.equal(r.status, 413);
    assert.match(r.body.error, /huge\.png.*5 MB/);
    const glb = t.file(alice, makeGlb({}), { kind: 'model' });
    assert.equal((await alice.post('/api/generate/photo', { fileIds: [glb.id] })).status, 400);
    assert.equal(fetch.calls.length, 0);
  } finally {
    await t.close();
  }
});

test('the API key and the photo bytes never reach the logs', async () => {
  const log = captureLog();
  const echo = (call) => ({ ok: false, status: 500, json: async () => ({ type: 'error', error: { type: 'api_error', message: `echo ${call.init.headers['x-api-key']} ${JSON.stringify(call.body).slice(0, 2000)}` } }) });
  const t = await startTestServer({ env: LLM, fetch: mockFetch(echo), log });
  try {
    const alice = await t.user();
    const png = makePng({ w: 8, h: 8, rgba: [1, 2, 3, 255] });
    const f = await upload(alice, png);
    assert.equal((await alice.post('/api/generate/photo', { fileIds: [f.id] })).status, 502);
    const junk = await startTestServer({ env: LLM, fetch: mockFetch(() => apiReply(`prose ${KEY}`)), log });
    try {
      const bob = await junk.user();
      const g = await upload(bob, png);
      assert.equal((await bob.post('/api/generate/photo', { fileIds: [g.id] })).status, 502);
    } finally {
      await junk.close();
    }
    const all = log.lines.join('\n');
    assert.ok(log.lines.length > 0, 'failures are logged');
    assert.ok(!all.includes(KEY), 'no API key');
    assert.ok(!all.includes(png.toString('base64').slice(0, 24)), 'no image bytes');
    assert.ok(!all.includes('echo'), 'no upstream error text');
  } finally {
    await t.close();
  }
});

test('analysis times out instead of hanging', async () => {
  const hang = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(analyzePhotos({ fetch: hang, apiKey: KEY, model: 'm', images: [{ ext: 'png', bytes: makePng() }], timeoutMs: 30 }), (err) => err.status === 504);
});

test('analysis is rate limited to 10 an hour per user', async () => {
  const fetch = mockFetch(() => apiReply(JSON.stringify(ANSWER)));
  const t = await startTestServer({ env: LLM, fetch, rateLimits: true });
  try {
    const alice = await t.user();
    const f = await upload(alice, makePng());
    for (let i = 0; i < 10; i++) assert.equal((await alice.post('/api/generate/photo', { fileIds: [f.id] })).status, 200);
    assert.equal((await alice.post('/api/generate/photo', { fileIds: [f.id] })).status, 429);
    const bob = await t.user();
    const g = await upload(bob, makePng());
    assert.equal((await bob.post('/api/generate/photo', { fileIds: [g.id] })).status, 200, 'per user, not global');
  } finally {
    await t.close();
  }
});

test('the request body follows the Messages API shape', () => {
  const body = buildRequest({ model: 'claude-opus-5-5', images: [{ ext: 'webp', bytes: Buffer.from('x') }] });
  assert.equal(body.max_tokens, 16000);
  assert.equal(typeof body.system, 'string');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.deepEqual(body.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: Buffer.from('x').toString('base64') } });
  assert.ok(!('thinking' in body) && !('temperature' in body), 'no settings that some models reject');
  // The schema accepts what the clamp accepts.
  assert.ok(clampPhotoModel(ANSWER));
});

test('the answer schema stays inside what structured outputs accept', () => {
  // No numeric, string or array constraints (the clamp enforces ranges instead); every object
  // closed with additionalProperties:false and every property required.
  const bad = [];
  const walk = (o, p) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${p}[${i}]`));
    for (const k of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems']) if (k in o) bad.push(`${p}.${k}`);
    if (o.type === 'object') {
      if (o.additionalProperties !== false) bad.push(`${p}: additionalProperties`);
      const req = new Set(o.required ?? []);
      for (const k of Object.keys(o.properties ?? {})) if (!req.has(k)) bad.push(`${p}.${k}: not required`);
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`);
  };
  walk(photoModelJsonSchema(), '$');
  assert.deepEqual(bad, []);
});

test('reference photos attach to a kitchen: owner only, own uploads only', async () => {
  const t = await startTestServer({});
  try {
    const alice = await t.user();
    const bob = await t.user();
    const p = (await alice.post('/api/projects', { name: 'From a photo', doc: sampleDoc() })).body.project;
    const a = await upload(alice, makePng());
    const b = await upload(alice, makeJpeg(), 'b.jpg', 'image/jpeg');
    const bobs = await upload(bob, makePng({ w: 2, h: 2 }));

    assert.deepEqual((await alice.get(`/api/generate/photos/${p.id}`)).body, { files: [] });
    const put = await alice.put(`/api/generate/photos/${p.id}`, { fileIds: [b.id, a.id] });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual(put.body.files.map((f) => f.id), [b.id, a.id], 'order kept');
    assert.equal(put.body.files[0].url, `/api/files/${b.id}/content`, 'private URLs');
    assert.deepEqual((await alice.get(`/api/generate/photos/${p.id}`)).body.files.map((f) => f.id), [b.id, a.id]);

    assert.equal((await bob.get(`/api/generate/photos/${p.id}`)).status, 404, 'not your kitchen');
    assert.equal((await bob.put(`/api/generate/photos/${p.id}`, { fileIds: [bobs.id] })).status, 404);
    assert.equal((await alice.put(`/api/generate/photos/${p.id}`, { fileIds: [bobs.id] })).status, 404, 'not your photo');
    assert.equal((await t.agent().get(`/api/generate/photos/${p.id}`)).status, 401);

    assert.equal((await alice.put(`/api/generate/photos/${p.id}`, { fileIds: [] })).status, 200);
    assert.deepEqual((await alice.get(`/api/generate/photos/${p.id}`)).body.files, []);

    await alice.put(`/api/generate/photos/${p.id}`, { fileIds: [a.id] });
    assert.equal((await alice.delete(`/api/projects/${p.id}`)).status, 200);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM generate_photo_refs').get().n, 0, 'deleted with the kitchen');
  } finally {
    await t.close();
  }
});
