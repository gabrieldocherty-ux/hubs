// The architect AI adapter reads its answer with a byte cap it enforces while reading (not after
// the whole thing is in memory), checks the Content-Type and the image's first bytes, and stops at
// the render's timeout even when the body is still coming. Production refuses a plain-http URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeJpeg, makePng } from '../lib/synth.mjs';
import { createArchitectProvider, RenderFailure } from '../renders/providers.mjs';
import { loadConfig } from '../config.mjs';

const MAX_RESULT_BYTES = 25 * 1024 * 1024;
const imageKind = (b) => (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : null);

const CHUNK = 1024 * 1024;
const input = { image: Buffer.from('x'), mime: 'image/png', scene: {}, prompt: 'p', requestId: 'rn_x' };

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

const provider = (answer, timeoutMs = 10_000) => createArchitectProvider({ url: 'https://architect.example/r', key: 'k_FAKE', fetch: async (_u, init) => answer(init), timeoutMs });

test('an oversized answer with no Content-Length is cut off at the cap, not read whole', async () => {
  const s = streamOf(200 * CHUNK, makePng({ w: 4, h: 4 }));
  const p = provider(() => new Response(s.body, { headers: { 'Content-Type': 'image/png' } }));
  await assert.rejects(p.render(input), (e) => e instanceof RenderFailure && e.code === 'render_bad_result' && /too large/.test(e.message));
  assert.ok(s.pulled <= MAX_RESULT_BYTES + 2 * CHUNK, `pulled ${s.pulled} bytes`);
  assert.ok(s.cancelled, 'the stream was cancelled');
});

test('a Content-Length over the cap is refused before reading anything', async () => {
  const s = streamOf(4 * CHUNK);
  const p = provider(() => new Response(s.body, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_RESULT_BYTES + 1) } }));
  await assert.rejects(p.render(input), /too large/);
  assert.ok(s.pulled <= CHUNK, `pulled ${s.pulled}`);
});

test('a JSON answer is capped the same way', async () => {
  const s = streamOf(60 * CHUNK, Buffer.from('{"image":"'));
  const p = provider(() => new Response(s.body, { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(p.render(input), /too large/);
  assert.ok(s.pulled <= MAX_RESULT_BYTES + 2 * CHUNK);
});

test('the Content-Type must be an image or JSON, and the bytes must really be an image', async () => {
  const png = makePng({ w: 8, h: 8 });
  const ok = await provider(() => new Response(png, { headers: { 'Content-Type': 'image/png; charset=binary' } })).render(input);
  assert.equal(imageKind(ok.image), 'png');
  const jpg = await provider(() => new Response(makeJpeg({ w: 8, h: 8 }), { headers: { 'Content-Type': 'image/jpeg' } })).render(input);
  assert.equal(imageKind(jpg.image), 'jpeg');
  const viaJson = await provider(() => new Response(JSON.stringify({ image: png.toString('base64') }), { headers: { 'Content-Type': 'application/json' } })).render(input);
  assert.equal(imageKind(viaJson.image), 'png');
  // Says PNG, isn't one.
  await assert.rejects(provider(() => new Response(Buffer.from('<html>not a picture at all</html>'), { headers: { 'Content-Type': 'image/png' } })).render(input), /didn’t send an image/);
  // JSON whose "image" decodes to something that isn't a picture.
  await assert.rejects(provider(() => new Response(JSON.stringify({ image: Buffer.from('MZ executable bytes here').toString('base64') }), { headers: { 'Content-Type': 'application/json' } })).render(input), /didn’t send an image/);
  // Types it never asked for, refused without reading the body.
  for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', '']) {
    const s = streamOf(8 * CHUNK, png);
    await assert.rejects(provider(() => new Response(s.body, { headers: type ? { 'Content-Type': type } : {} })).render(input), /didn’t send an image/, type);
    assert.ok(s.pulled <= CHUNK, `${type}: pulled ${s.pulled}`);
  }
});

test('a body that keeps trickling stops at the render timeout', async () => {
  const p = provider(
    (init) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(makePng({ w: 4, h: 4 })));
            init.signal.addEventListener('abort', () => c.error(init.signal.reason));
          },
        }),
        { headers: { 'Content-Type': 'image/png' } },
      ),
    300,
  );
  const t0 = Date.now();
  await assert.rejects(p.render(input), (e) => e.code === 'render_timeout');
  assert.ok(Date.now() - t0 < 5000);
});

test('production refuses a plain-http ARCHITECT_AI_URL except to this machine', () => {
  const env = (u) => ({ DB_PATH: ':memory:', ARCHITECT_AI_URL: u, ARCHITECT_AI_KEY: 'k_FAKE' });
  assert.throws(() => loadConfig(env('http://architect.example/r'), ['--prod']), /https/);
  assert.equal(loadConfig(env('https://architect.example/r'), ['--prod']).rendersProvider, 'architect');
  assert.equal(loadConfig(env('http://127.0.0.1:9000/r'), ['--prod']).rendersProvider, 'architect');
  assert.equal(loadConfig(env('http://localhost:9000/r'), ['--prod']).rendersProvider, 'architect');
  assert.equal(loadConfig(env('http://architect.example/r'), []).rendersProvider, 'architect', 'development may use http');
});
