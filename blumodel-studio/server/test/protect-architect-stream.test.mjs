// The MyArchitectAI adapter reads its JSON answer and the finished picture with byte caps it
// enforces while reading (not after the whole thing is in memory), checks the picture's first
// bytes, only downloads from an https address, never sends the key there, and stops at the render's
// timeout even when a body is still coming. Production refuses a plain-http ARCHITECT_AI_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeJpeg, makePng } from '../lib/synth.mjs';
import { createArchitectProvider, MAX_REQUEST_BYTES, MYARCHITECTAI_URL, RenderFailure } from '../renders/providers.mjs';
import { loadConfig } from '../config.mjs';

const MAX_RESULT_BYTES = 25 * 1024 * 1024;
const imageKind = (b) => (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : null);

const CHUNK = 1024 * 1024;
const PIC = 'https://cdn.myarchitectai.example/out/r.png';
const input = { image: Buffer.from('x'), mime: 'image/png', scene: {}, prompt: 'p', requestId: 'rn_x' };
const json = (o, init = {}) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' }, ...init });
const answer = { output: [PIC], balance: 1, cost: 1, requestId: 1 };

/** A body of `total` bytes (starting with `head`) that counts how much was pulled from it. */
function streamOf(total, head = Buffer.alloc(0)) {
  const s = { pulled: 0, cancelled: false };
  s.body = new ReadableStream({
    pull(c) {
      if (s.pulled >= total) return c.close();
      const n = Math.min(CHUNK, total - s.pulled);
      const b = Buffer.alloc(n, 0x41);
      if (s.pulled === 0) head.copy(b);
      s.pulled += n;
      c.enqueue(new Uint8Array(b));
    },
    cancel() {
      s.cancelled = true;
    },
  });
  return s;
}

/** `render` answers the POST to MyArchitectAI, `picture` the download of the first output URL. */
const provider = ({ render = () => json(answer), picture = () => new Response(makePng({ w: 8, h: 8 }), { headers: { 'Content-Type': 'image/png' } }) } = {}, timeoutMs = 10_000) =>
  createArchitectProvider({ key: 'k_FAKE', fetch: async (u, init) => (String(u) === MYARCHITECTAI_URL ? render(init) : picture(init, String(u))), timeoutMs });

test('the key alone is enough: it posts to MyArchitectAI’s address, then downloads the first picture', async () => {
  const seen = [];
  const p = createArchitectProvider({
    key: 'k_FAKE',
    timeoutMs: 5000,
    fetch: async (u, init) => {
      seen.push([String(u), init.headers['x-api-key']]);
      return String(u) === MYARCHITECTAI_URL ? json({ ...answer, output: [PIC, 'https://other.example/2.png'] }) : new Response(makePng({ w: 8, h: 8 }), { headers: { 'Content-Type': 'image/png' } });
    },
  });
  const r = await p.render(input);
  assert.equal(imageKind(r.image), 'png');
  assert.deepEqual(seen, [[MYARCHITECTAI_URL, 'k_FAKE'], [PIC, undefined]]);
});

test('a body over MyArchitectAI’s 10 MB limit is refused before it is sent', async () => {
  let called = false;
  const p = createArchitectProvider({ key: 'k', timeoutMs: 1000, fetch: async () => ((called = true), json(answer)) });
  await assert.rejects(p.render({ ...input, image: Buffer.alloc(MAX_REQUEST_BYTES) }), (e) => e instanceof RenderFailure && /too large/.test(e.message));
  assert.equal(called, false);
});

test('an oversized picture with no Content-Length is cut off at the cap, not read whole', async () => {
  const s = streamOf(60 * CHUNK, makePng({ w: 4, h: 4 }));
  await assert.rejects(provider({ picture: () => new Response(s.body, { headers: { 'Content-Type': 'image/png' } }) }).render(input), (e) => e instanceof RenderFailure && e.code === 'render_bad_result' && /too large/.test(e.message));
  assert.ok(s.cancelled);
  assert.ok(s.pulled <= MAX_RESULT_BYTES + 2 * CHUNK, `pulled ${s.pulled}`);
});

test('a Content-Length over the cap is refused before reading anything', async () => {
  const s = streamOf(8 * CHUNK, makePng({ w: 4, h: 4 }));
  await assert.rejects(
    provider({ picture: () => new Response(s.body, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_RESULT_BYTES + 1) } }) }).render(input),
    /too large/,
  );
  assert.ok(s.pulled <= CHUNK, `pulled ${s.pulled}`);
  assert.ok(s.cancelled);
});

test('the JSON answer is capped (it is a few URLs, never megabytes)', async () => {
  const s = streamOf(60 * CHUNK, Buffer.from('{"output":["'));
  await assert.rejects(provider({ render: () => new Response(s.body, { headers: { 'Content-Type': 'application/json' } }) }).render(input), /too large/);
  assert.ok(s.pulled <= 4 * CHUNK, `pulled ${s.pulled}`);
});

test('the picture must really be one, and a JPEG is fine too', async () => {
  const jpg = await provider({ picture: () => new Response(makeJpeg({ w: 8, h: 8 }), { headers: { 'Content-Type': 'image/jpeg' } }) }).render(input);
  assert.equal(imageKind(jpg.image), 'jpeg');
  // A host that serves a download with no useful type is fine when the bytes are a picture.
  const octet = await provider({ picture: () => new Response(makePng({ w: 8, h: 8 }), { headers: { 'Content-Type': 'application/octet-stream' } }) }).render(input);
  assert.equal(imageKind(octet.image), 'png');
  // Says PNG, isn't one.
  await assert.rejects(provider({ picture: () => new Response(Buffer.from('<html>not a picture at all</html>'), { headers: { 'Content-Type': 'image/png' } }) }).render(input), /didn’t send an image/);
  // Types it never asked for, refused without reading the body.
  for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
    const s = streamOf(8 * CHUNK, makePng({ w: 4, h: 4 }));
    await assert.rejects(provider({ picture: () => new Response(s.body, { headers: { 'Content-Type': type } }) }).render(input), /didn’t send an image/, type);
    assert.ok(s.pulled <= CHUNK, `${type}: pulled ${s.pulled}`);
  }
});

test('only an https picture address is followed', async () => {
  for (const output of [['http://cdn.example/a.png'], ['file:///etc/passwd'], ['javascript:alert(1)'], ['not a url'], [], [7], 'https://cdn.example/a.png', null]) {
    let downloaded = false;
    const p = provider({ render: () => json({ ...answer, output }), picture: () => ((downloaded = true), new Response(makePng({ w: 8, h: 8 }))) });
    await assert.rejects(p.render(input), /didn’t send an image/, JSON.stringify(output));
    assert.equal(downloaded, false);
  }
});

test('a 200 with an error body is a failure, with a plain message and the service’s words kept out', async () => {
  const cases = [
    [{ error: 'secret details k_FAKE', balance: 1, cost: 1, requestId: 1 }, /couldn’t make this render/],
    [{ error: 'x', code: 'CONTENT_POLICY_VIOLATION', balance: 1, cost: 1, requestId: 1 }, /content rules/],
    [{ error: 'x', code: 'SAFETY_CHECK_UNAVAILABLE', balance: 1, cost: 0, requestId: 1 }, /safety check/],
  ];
  for (const [body, msg] of cases) {
    const e = await provider({ render: () => json(body) }).render(input).catch((x) => x);
    assert.ok(e instanceof RenderFailure);
    assert.match(e.message, msg);
    assert.match(e.message, /credits were returned/);
    assert.ok(!e.message.includes('k_FAKE') && !e.message.includes('secret details'));
  }
});

test('each documented status gets its own plain message', async () => {
  const want = { 401: /didn’t accept the key/, 403: /didn’t accept the key/, 402: /out of balance/, 413: /too large/, 429: /busy/, 500: /answered 500/, 502: /answered 502/ };
  for (const [status, re] of Object.entries(want)) {
    const e = await provider({ render: () => new Response('body k_FAKE', { status: Number(status) }) }).render(input).catch((x) => x);
    assert.ok(e instanceof RenderFailure, status);
    assert.match(e.message, re, status);
    assert.ok(!e.message.includes('k_FAKE'));
  }
});

test('a body that keeps trickling stops at the render timeout', async () => {
  const p = provider(
    {
      picture: (init) =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(makePng({ w: 4, h: 4 })));
              init.signal.addEventListener('abort', () => c.error(init.signal.reason));
            },
          }),
          { headers: { 'Content-Type': 'image/png' } },
        ),
    },
    300,
  );
  const t0 = Date.now();
  await assert.rejects(p.render(input), (e) => e.code === 'render_timeout');
  assert.ok(Date.now() - t0 < 5000);
});

test('production refuses a plain-http ARCHITECT_AI_URL except to this machine; a key alone uses MyArchitectAI', () => {
  const env = (u) => ({ DB_PATH: ':memory:', ARCHITECT_AI_URL: u, ARCHITECT_AI_KEY: 'k_FAKE' });
  assert.throws(() => loadConfig(env('http://architect.example/r'), ['--prod']), /https/);
  assert.equal(loadConfig(env('https://architect.example/r'), ['--prod']).rendersProvider, 'architect');
  assert.equal(loadConfig(env('http://127.0.0.1:9000/r'), ['--prod']).rendersProvider, 'architect');
  assert.equal(loadConfig(env('http://localhost:9000/r'), ['--prod']).rendersProvider, 'architect');
  assert.equal(loadConfig(env('http://architect.example/r'), []).rendersProvider, 'architect', 'development may use http');
  const keyOnly = loadConfig({ DB_PATH: ':memory:', ARCHITECT_AI_KEY: 'k_FAKE' }, ['--prod']);
  assert.equal(keyOnly.rendersProvider, 'architect');
  assert.equal(keyOnly.ARCHITECT_AI_URL, MYARCHITECTAI_URL);
});
