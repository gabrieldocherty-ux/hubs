// The research validator cases (scratch qa/validators-test.mjs), as assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateGlb, sniffImage, verifyStripeSignature } from '../lib/validators.mjs';
import { packGlb, makeGlb } from './fixtures/glb.mjs';
import { makePng, makeJpeg, makeWebp, svgBytes } from './fixtures/images.mjs';

const NM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules');

const pos = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
const gltf = {
  asset: { version: '2.0', generator: 'test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  bufferViews: [{ buffer: 0, byteLength: 36 }],
  buffers: [{ byteLength: 36 }],
};
const good = packGlb(gltf, pos);

test('a minimal valid GLB passes validateGlb', () => {
  const r = validateGlb(good);
  assert.equal(r.ok, true);
  assert.equal(r.info.nodes, 1);
  assert.equal(r.info.meshes, 1);
});

test('three GLTFLoader.parse accepts the minimal GLB and makeGlb output', async () => {
  const { GLTFLoader } = await import(pathToFileURL(path.join(NM, 'three/examples/jsm/loaders/GLTFLoader.js')).href);
  const THREE = await import(pathToFileURL(path.join(NM, 'three/build/three.module.js')).href);
  const parse = (buf) => new Promise((ok, no) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '', ok, no));
  const a = await parse(good);
  const sizeA = new THREE.Box3().setFromObject(a.scene).getSize(new THREE.Vector3()).toArray();
  assert.deepEqual(sizeA, [1, 1, 0]);
  const box = makeGlb({ w: 0.762, h: 0.914, d: 0.66 });
  assert.equal(validateGlb(box).ok, true);
  const b = await parse(box);
  const sizeB = new THREE.Box3().setFromObject(b.scene).getSize(new THREE.Vector3()).toArray();
  for (const [got, want] of sizeB.map((v, i) => [v, [0.762, 0.914, 0.66][i]])) assert.ok(Math.abs(got - want) < 1e-5, `${got} ≈ ${want}`);
  const names = [];
  b.scene.traverse((o) => {
    if (o.material) names.push(o.material.name);
  });
  assert.ok(names.includes('mise_finish') && names.includes('body'));
});

test('GLB rejections', () => {
  assert.match(validateGlb(packGlb({ ...gltf, buffers: [{ byteLength: 36, uri: 'https://evil.example/x.bin' }] }, pos)).error, /external file/);
  const bad = Buffer.from(good);
  bad.writeUInt32LE(0x12345678, 0);
  assert.match(validateGlb(bad).error, /Not a binary glTF/);
  assert.equal(validateGlb(good.subarray(0, good.length - 4)).ok, false, 'truncated');
  assert.match(validateGlb(packGlb({ ...gltf, extensionsRequired: ['KHR_evil'] }, pos)).error, /Unsupported required extension KHR_evil/);
  assert.match(validateGlb(packGlb({ ...gltf, asset: { version: '1.0' } }, pos)).error, /2\.0/);
  assert.match(validateGlb(packGlb({ ...gltf, images: [{ uri: 'file:///C:/Windows/win.ini' }] }, pos)).error, /external file/);
  assert.equal(validateGlb(Buffer.alloc(10)).ok, false, 'too small');
  const v1 = Buffer.from(good);
  v1.writeUInt32LE(1, 4);
  assert.match(validateGlb(v1).error, /glTF 2\.0/);
});

test('sniffImage: PNG, JPEG and WebP dimensions; SVG rejected', () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(png);
  png.write('IHDR', 12, 'latin1');
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(sniffImage(png), { type: 'image/png', ext: 'png', width: 640, height: 480 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  assert.deepEqual(sniffImage(jpg), { type: 'image/jpeg', ext: 'jpg', width: 640, height: 480 });
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'latin1');
  webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8, 'latin1');
  webp.write('VP8X', 12, 'latin1');
  webp.writeUIntLE(1023, 24, 3);
  webp.writeUIntLE(767, 27, 3);
  assert.deepEqual(sniffImage(webp), { type: 'image/webp', ext: 'webp', width: 1024, height: 768 });
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniffImage(svgBytes()), null);
  assert.equal(sniffImage(Buffer.from('GIF89a\x01\x00\x01\x00')), null);
});

test('fixture generators produce sniffable images', () => {
  assert.deepEqual(sniffImage(makePng({ w: 7, h: 5 })), { type: 'image/png', ext: 'png', width: 7, height: 5 });
  assert.deepEqual(sniffImage(makeJpeg({ w: 33, h: 21 })), { type: 'image/jpeg', ext: 'jpg', width: 33, height: 21 });
  assert.deepEqual(sniffImage(makeWebp({ w: 12, h: 9 })), { type: 'image/webp', ext: 'webp', width: 12, height: 9 });
});

test('verifyStripeSignature: the six signature cases', () => {
  const secret = 'whsec_test_' + crypto.randomBytes(8).toString('hex');
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }));
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig},v0=deadbeef`, secret), true, 'valid');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${sig}`, secret), true, 'rotated secrets (two v1)');
  assert.equal(verifyStripeSignature(Buffer.from(body.toString().replace('evt_1', 'evt_2')), `t=${t},v1=${sig}`, secret), false, 'tampered body');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, Date.now() + 600_000), false, 'stale (10 min)');
  assert.equal(verifyStripeSignature(body, `t=${t},v0=${sig}`, secret), false, 'v0 only');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=abcd`, secret), false, 'short signature, no throw');
  assert.equal(verifyStripeSignature(body, undefined, secret), false, 'no header');
});
