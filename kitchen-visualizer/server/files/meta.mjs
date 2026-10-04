// What an uploaded file is, judged from its bytes alone (never the filename or the
// Content-Type), plus the metadata the product editor and viewer need.

import { validateGlb, sniffImage } from '../lib/validators.mjs';

/** glTF extensions an uploaded model may use (BUILD_PLAN §3.5). KTX2/Basis is not wired. */
export const GLB_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
  'EXT_texture_webp',
  'KHR_materials_clearcoat',
  'KHR_materials_transmission',
  'KHR_materials_ior',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_emissive_strength',
  'KHR_materials_volume',
  'KHR_materials_unlit',
]);

export const MAX_IMAGE_SIDE = 4096;
export const MAX_TRIANGLES = 1_000_000;
const WARN_BYTES = 8 * 1024 * 1024;
const WARN_TRIANGLES = 150_000;
const WARN_TEXTURE = 2048;
const M_TO_IN = 39.3701;

const MIME = { glb: 'model/gltf-binary', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
export const mimeFor = (ext) => MIME[ext] || 'application/octet-stream';

class Rejection extends Error {}
const reject = (message) => {
  throw new Rejection(message);
};

// ─── 4×4 column-major matrices (glTF convention) ────────────────────────────

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function fromTrs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

const nums = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function nodeMatrix(node) {
  if (nums(node.matrix, 16)) return node.matrix;
  return fromTrs(nums(node.translation, 3) ? node.translation : undefined, nums(node.rotation, 4) ? node.rotation : undefined, nums(node.scale, 3) ? node.scale : undefined);
}

const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

/** Normalised-integer accessors store min/max as raw integers. */
const NORM_DIV = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

// ─── GLB ────────────────────────────────────────────────────────────────────

function glbJsonAndBin(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const off = 20 + jsonLen;
  const bin = off + 8 <= buf.length ? buf.subarray(off + 8, off + 8 + buf.readUInt32LE(off)) : Buffer.alloc(0);
  return { json, bin };
}

function primitiveTriangles(json, prim) {
  const mode = prim.mode ?? 4;
  const acc = json.accessors?.[prim.indices ?? prim.attributes?.POSITION];
  const count = acc?.count | 0;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

/**
 * Validates a GLB beyond the structural check (extension policy, triangle cap) and
 * measures it. Throws a Rejection with a user-facing message, or returns GlbMeta.
 */
export function inspectGlb(buf) {
  const v = validateGlb(buf);
  if (!v.ok) reject(v.error);
  const { json, bin } = glbJsonAndBin(buf);

  const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed.map(String) : [];
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired.map(String) : [];
  const warnings = [];
  if (used.includes('KHR_texture_basisu') || required.includes('KHR_texture_basisu')) reject('KTX2 / Basis textures (KHR_texture_basisu) aren’t supported yet. Export PNG, JPEG or WebP textures.');
  for (const e of required) if (!GLB_EXTENSIONS.has(e)) reject(`The model requires the extension ${e}, which Mise doesn’t support.`);
  for (const e of used) if (!GLB_EXTENSIONS.has(e) && !required.includes(e)) warnings.push(`The extension ${e} will be ignored.`);
  for (const [i, im] of (json.images || []).entries()) if (im.mimeType === 'image/ktx2') reject(`images[${i}] is a KTX2 texture, which isn’t supported yet.`);

  // Bounding box: POSITION min/max of every primitive, through the node hierarchy.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let missingBounds = false;
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const roots = json.scenes?.[sceneIndex]?.nodes || [];
  const visit = (index, parent, depth, stack) => {
    const node = nodes[index];
    if (!node || depth > 64 || stack.has(index)) return;
    stack.add(index);
    const world = multiply(parent, nodeMatrix(node));
    const mesh = Number.isInteger(node.mesh) ? json.meshes?.[node.mesh] : null;
    for (const prim of mesh?.primitives || []) {
      triangles += primitiveTriangles(json, prim);
      const acc = json.accessors?.[prim.attributes?.POSITION];
      if (!acc || !nums(acc.min, 3) || !nums(acc.max, 3)) {
        missingBounds = true;
        continue;
      }
      const div = acc.normalized ? NORM_DIV[acc.componentType] || 1 : 1;
      const lo = acc.min.map((x) => (div === 127 || div === 32767 ? Math.max(x / div, -1) : x / div));
      const hi = acc.max.map((x) => (div === 127 || div === 32767 ? Math.max(x / div, -1) : x / div));
      for (let c = 0; c < 8; c++) {
        const p = apply(world, [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]);
        for (let k = 0; k < 3; k++) {
          if (p[k] < min[k]) min[k] = p[k];
          if (p[k] > max[k]) max[k] = p[k];
        }
      }
    }
    for (const child of node.children || []) visit(child, world, depth + 1, stack);
    stack.delete(index);
  };
  for (const r of roots) visit(r, IDENTITY, 0, new Set());
  if (!Number.isFinite(min[0])) reject('The model has no visible geometry.');
  if (missingBounds) warnings.push('Some meshes have no POSITION bounds; the size may be understated.');
  if (triangles > MAX_TRIANGLES) reject(`The model has ${triangles.toLocaleString('en-US')} triangles; the limit is ${MAX_TRIANGLES.toLocaleString('en-US')}.`);

  const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  const bboxM = { x: round(size[0], 5), y: round(size[1], 5), z: round(size[2], 5) };
  const bboxIn = { w: round(size[0] * M_TO_IN, 2), h: round(size[1] * M_TO_IN, 2), d: round(size[2] * M_TO_IN, 2) };

  const materials = (json.materials || []).map((m, i) => (typeof m?.name === 'string' && m.name ? m.name : `material_${i}`));
  const slots = [...new Set(materials.filter((n) => n.startsWith('mise_')))];

  const images = (json.images || []).map((im) => {
    const view = Number.isInteger(im.bufferView) ? json.bufferViews?.[im.bufferView] : null;
    if (view) {
      const start = view.byteOffset | 0;
      const bytes = bin.subarray(start, start + (view.byteLength | 0));
      const s = sniffImage(bytes);
      if (s) return { mime: s.type, width: s.width, height: s.height };
    }
    warnings.push(`An embedded texture (${im.mimeType || 'unknown type'}) couldn’t be measured.`);
    return { mime: String(im.mimeType || ''), width: 0, height: 0 };
  });

  if (buf.length > WARN_BYTES) warnings.push(`The file is ${(buf.length / 1048576).toFixed(1)} MB; aim for under 8 MB so it loads quickly.`);
  if (triangles > WARN_TRIANGLES) warnings.push(`The model has ${triangles.toLocaleString('en-US')} triangles; aim for under 150,000.`);
  if (images.some((i) => i.width > WARN_TEXTURE || i.height > WARN_TEXTURE)) warnings.push('Some textures are larger than 2048 px; 2048 or less is plenty.');

  return { bboxM, bboxIn, triangles, materials, slots, images, extensions: used, warnings };
}

/** Image metadata `{ width, height }` with Mise's limits applied. */
export function inspectImage(sniff) {
  if (!(sniff.width > 0 && sniff.height > 0)) reject('That image has no size.');
  if (sniff.width > MAX_IMAGE_SIDE || sniff.height > MAX_IMAGE_SIDE) reject(`Images can be at most ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE} pixels.`);
  return { width: sniff.width, height: sniff.height };
}

const GLB_MAGIC = 0x46546c67;

/**
 * Classifies bytes as a GLB or a PNG/JPEG/WebP image and measures them.
 * Returns `{ ok: true, ext, mime, meta }` or `{ ok: false, error }`. SVG, GIF, HTML and
 * everything else is refused.
 */
export function inspectUpload(buf) {
  try {
    if (buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC) return { ok: true, ext: 'glb', mime: MIME.glb, meta: inspectGlb(buf) };
    const s = sniffImage(buf);
    if (s) return { ok: true, ext: s.ext, mime: s.type, meta: inspectImage(s) };
    return { ok: false, error: 'That file type isn’t supported. Upload a .glb model, or a PNG, JPEG or WebP image.' };
  } catch (err) {
    if (err instanceof Rejection) return { ok: false, error: err.message };
    return { ok: false, error: 'That file couldn’t be read.' };
  }
}
