import crypto from 'node:crypto';

// ─── GLB (binary glTF 2.0) structural validation, zero deps ────────────────
// Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout
const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const ALLOWED_EXT = new Set([
  'KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization',
  'KHR_texture_transform', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular',
  'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_sheen', 'KHR_materials_emissive_strength',
  'KHR_materials_unlit', 'KHR_texture_basisu', 'EXT_texture_webp', 'KHR_lights_punctual',
]);
const LIMITS = { bytes: 25 * 1024 * 1024, jsonBytes: 4 * 1024 * 1024, nodes: 5000, meshes: 2000, materials: 256, images: 64, accessorCount: 2_000_000 };

export function validateGlb(buf) {
  const fail = (m) => ({ ok: false, error: m });
  if (buf.length < 20) return fail('File is too small to be a GLB.');
  if (buf.length > LIMITS.bytes) return fail('Model is larger than 25 MB.');
  if (buf.readUInt32LE(0) !== GLB_MAGIC) return fail('Not a binary glTF (.glb) file.');
  if (buf.readUInt32LE(4) !== 2) return fail('Only glTF 2.0 is supported.');
  if (buf.readUInt32LE(8) !== buf.length) return fail('GLB length header does not match the file size.');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) return fail('First chunk must be JSON.');
  if (jsonLen % 4 || jsonLen > LIMITS.jsonBytes || 20 + jsonLen > buf.length) return fail('Bad JSON chunk length.');
  let json;
  try { json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)); } catch { return fail('Model JSON is malformed.'); }
  let off = 20 + jsonLen, binLen = 0;
  if (off < buf.length) {
    if (off + 8 > buf.length) return fail('Truncated chunk header.');
    binLen = buf.readUInt32LE(off);
    if (buf.readUInt32LE(off + 4) !== CHUNK_BIN) return fail('Second chunk must be BIN.');
    if (binLen % 4 || off + 8 + binLen !== buf.length) return fail('Bad BIN chunk length (or trailing chunks).');
  }
  if (!json || typeof json !== 'object' || json.asset?.version !== '2.0') return fail('asset.version must be "2.0".');
  if (!Array.isArray(json.scenes) || !json.scenes.length) return fail('Model has no scene.');
  for (const e of json.extensionsRequired || []) if (!ALLOWED_EXT.has(e)) return fail(`Unsupported required extension ${e}.`);
  // Self-contained only: no external or data: URIs (data: would bypass size accounting and is never needed in a GLB).
  for (const [i, b] of (json.buffers || []).entries()) {
    if (b.uri !== undefined) return fail(`buffers[${i}] references an external file; upload a self-contained .glb.`);
    if (i === 0 && b.byteLength > binLen) return fail('buffers[0] is larger than the BIN chunk.');
  }
  if ((json.buffers || []).length > 1) return fail('Only one buffer (the GLB BIN chunk) is allowed.');
  for (const [i, im] of (json.images || []).entries()) {
    if (im.uri !== undefined) return fail(`images[${i}] references an external file; embed textures in the .glb.`);
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/ktx2'].includes(im.mimeType)) return fail(`images[${i}] has an unsupported type.`);
  }
  const n = (k) => (Array.isArray(json[k]) ? json[k].length : 0);
  if (n('nodes') > LIMITS.nodes || n('meshes') > LIMITS.meshes || n('materials') > LIMITS.materials || n('images') > LIMITS.images) return fail('Model is too complex.');
  let verts = 0;
  for (const a of json.accessors || []) verts = Math.max(verts, a.count | 0);
  if (verts > LIMITS.accessorCount) return fail('Model has too many vertices.');
  return { ok: true, info: { generator: json.asset.generator || '', nodes: n('nodes'), meshes: n('meshes'), materials: n('materials'), images: n('images'), extensions: json.extensionsUsed || [] } };
}

// ─── Image sniffing (never trust Content-Type or filename) ────────────────
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function sniffImage(buf) {
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIG) && buf.toString('latin1', 12, 16) === 'IHDR')
    return { type: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // Walk marker segments to the first SOFn (frame header) for dimensions.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      if (m === 0xff) { i += 1; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: 'image/jpeg', ext: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fmt = buf.toString('latin1', 12, 16);
    if (fmt === 'VP8X') return { type: 'image/webp', ext: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'image/webp', ext: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    if (fmt === 'VP8 ') return { type: 'image/webp', ext: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null; // SVG, GIF, HTML, anything else: rejected
}

// ─── Stripe webhook signature (manual verification per docs.stripe.com/webhooks) ─
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, now = Date.now()) {
  if (typeof header !== 'string') return false;
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v); // ignore v0 and unknown schemes (downgrade protection)
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return v1.some((sig) => {
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}
