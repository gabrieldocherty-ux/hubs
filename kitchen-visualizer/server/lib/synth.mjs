// Synthetic assets: a box GLB at exact real-world size, and real PNGs. Used by the
// seeds (demo products) and re-exported for tests by server/test/fixtures/*.mjs.
// Lives under lib/ rather than test/ because deploy-local ships server/ without test/.

import zlib from 'node:zlib';

// ─── GLB ────────────────────────────────────────────────────────────────────

const pad4 = (buf, byte) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, byte)]);

/** Packs a glTF JSON object and an optional BIN payload into a GLB container. */
export function packGlb(json, bin) {
  const j = pad4(Buffer.from(JSON.stringify(json)), 0x20);
  const parts = [Buffer.alloc(12), Buffer.alloc(8), j];
  let b = null;
  if (bin && bin.length) {
    b = pad4(bin, 0);
    parts.push(Buffer.alloc(8), b);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  parts[0].writeUInt32LE(0x46546c67, 0); // 'glTF'
  parts[0].writeUInt32LE(2, 4);
  parts[0].writeUInt32LE(total, 8);
  parts[1].writeUInt32LE(j.length, 0);
  parts[1].writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  if (b) {
    parts[3].writeUInt32LE(b.length, 0);
    parts[3].writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  }
  return Buffer.concat(parts);
}

// Six faces of a unit box: normal, then four corners (counter-clockwise from outside).
const FACES = [
  [[1, 0, 0], [[1, 0, 1], [1, 0, -1], [1, 1, -1], [1, 1, 1]]],
  [[-1, 0, 0], [[-1, 0, -1], [-1, 0, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]],
  [[0, 0, 1], [[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, 0, -1], [-1, 0, -1], [-1, 1, -1], [1, 1, -1]]],
];

/**
 * A box w×h×d metres with its base centred on the origin (min.y = 0), one primitive
 * per material (faces dealt round-robin), POSITION/NORMAL/TEXCOORD_0 and uint16
 * indices. `GLTFLoader.parse` accepts it and `validateGlb` passes it.
 *
 * @param {{ w?: number, h?: number, d?: number, materials?: string[],
 *   image?: Buffer, imageMime?: string, transform?: { translation?: number[], rotation?: number[], scale?: number[], matrix?: number[] },
 *   json?: object | ((gltf: any) => any) }} [opts]
 *   `image` embeds that image (PNG by default) as material 0's base colour texture.
 *   `transform` puts the mesh under a parent node with that transform.
 *   `json` is merged over the generated glTF JSON (or maps it, when a function).
 */
export function makeGlb({ w = 0.762, h = 0.914, d = 0.66, materials = ['mise_finish', 'body'], image, imageMime = 'image/png', transform, json } = {}) {
  const mats = materials.length ? materials : ['material'];
  const pos = [];
  const nrm = [];
  const uv = [];
  FACES.forEach(([n, corners]) => {
    for (const [cx, cy, cz] of corners) {
      pos.push((cx * w) / 2, cy * h, (cz * d) / 2);
      nrm.push(...n);
    }
    uv.push(0, 1, 1, 1, 1, 0, 0, 0);
  });
  // Faces per material: round-robin over 6 faces; extra materials reuse a face.
  const facesOf = mats.map((_, k) => {
    const f = [];
    for (let i = 0; i < 6; i++) if (i % mats.length === k) f.push(i);
    return f.length ? f : [k % 6];
  });
  const indexRuns = facesOf.map((faces) => faces.flatMap((f) => [f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3]));
  const allIdx = indexRuns.flat();

  const posBuf = Buffer.from(new Float32Array(pos).buffer);
  const nrmBuf = Buffer.from(new Float32Array(nrm).buffer);
  const uvBuf = Buffer.from(new Float32Array(uv).buffer);
  const idxBuf = pad4(Buffer.from(new Uint16Array(allIdx).buffer), 0);
  let bin = Buffer.concat([posBuf, nrmBuf, uvBuf, idxBuf]);
  const bufferViews = [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length + nrmBuf.length, byteLength: uvBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length + nrmBuf.length + uvBuf.length, byteLength: allIdx.length * 2, target: 34963 },
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
  ];
  let offset = 0;
  const primitives = indexRuns.map((run, k) => {
    accessors.push({ bufferView: 3, byteOffset: offset * 2, componentType: 5123, count: run.length, type: 'SCALAR' });
    offset += run.length;
    return { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: accessors.length - 1, material: k };
  });
  const gltf = {
    asset: { version: '2.0', generator: 'mise synth' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: transform ? [{ ...transform, children: [1] }, { mesh: 0, name: 'box' }] : [{ mesh: 0, name: 'box' }],
    meshes: [{ name: 'box', primitives }],
    materials: mats.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.8 } })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  if (image) {
    const start = bin.length;
    bin = pad4(Buffer.concat([bin, image]), 0);
    bufferViews.push({ buffer: 0, byteOffset: start, byteLength: image.length });
    gltf.images = [{ bufferView: bufferViews.length - 1, mimeType: imageMime }];
    gltf.textures = [{ source: 0 }];
    gltf.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  gltf.buffers[0].byteLength = bin.length;
  const finalJson = typeof json === 'function' ? json(gltf) : json ? { ...gltf, ...json } : gltf;
  return packGlb(finalJson, bin);
}

// ─── Images ─────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * A real, decodable RGBA PNG (zlib-deflated scanlines). `rgba` is a solid colour, or
 * `(x, y) => [r, g, b, a]` for a pattern.
 */
export function makePng({ w = 4, h = 4, rgba = [201, 165, 122, 255] } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const px = typeof rgba === 'function' ? rgba(x, y) : rgba;
      raw.set(px, row + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A JPEG header stream (SOI, APP0, DQT, SOF0 with the given size, EOI): sniffable, not decodable. */
export function makeJpeg({ w = 8, h = 8 } = {}) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]), Buffer.alloc(64, 1)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 8, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sof, Buffer.from([0xff, 0xd9])]);
}

/** A WebP (RIFF + VP8X canvas header) of the given size: sniffable, not decodable. */
export function makeWebp({ w = 8, h = 8 } = {}) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

/** An SVG with a script: must always be rejected as an upload. */
export const svgBytes = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
