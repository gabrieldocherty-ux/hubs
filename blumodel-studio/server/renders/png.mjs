// Just enough PNG for the demo render provider: decode an 8-bit, non-interlaced RGB/RGBA PNG (what
// a browser canvas writes), grade it, stamp "DEMO RENDER" on it and encode it again. node:zlib only.

import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * Decodes a PNG into `{ width, height, rgba }`, or returns null for anything this can't read
 * (palette, 16-bit, grey, interlaced, damaged). Never throws.
 * @param {Buffer} buf
 * @param {{ maxPixels?: number }} [o]
 */
export function decodePng(buf, { maxPixels = 4096 * 4096 } = {}) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) return null;
    let off = 8;
    let ihdr = null;
    const idat = [];
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (data.length !== len) return null;
      if (type === 'IHDR') ihdr = data;
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      off += 12 + len;
    }
    if (!ihdr || !idat.length) return null;
    const width = ihdr.readUInt32BE(0);
    const height = ihdr.readUInt32BE(4);
    const depth = ihdr[8];
    const color = ihdr[9];
    const interlace = ihdr[12];
    if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) return null;
    if (!width || !height || width * height > maxPixels) return null;
    const bpp = color === 6 ? 4 : 3;
    const stride = width * bpp;
    const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height + 1024 });
    if (raw.length < (stride + 1) * height) return null;
    const out = Buffer.alloc(width * height * 4);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)];
      const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else if (f !== 0) return null;
        line[i] = v & 0xff;
      }
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        out[o] = line[x * bpp];
        out[o + 1] = line[x * bpp + 1];
        out[o + 2] = line[x * bpp + 2];
        out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
      }
      prev = line;
    }
    return { width, height, rgba: out };
  } catch {
    return null;
  }
}

/** Encodes RGBA pixels as a PNG. */
export function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// A 5×7 bitmap font for the stamp's few letters.
const GLYPHS = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/** Draws `text` (letters of GLYPHS) at (x, y) with `scale`-pixel dots. */
function drawText(img, text, x0, y0, scale, rgb) {
  const { width, height, rgba } = img;
  let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let gy = 0; gy < 7; gy++)
      for (let gx = 0; gx < 5; gx++) {
        if (g[gy][gx] !== '1') continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const px = x + gx * scale + dx;
            const py = y0 + gy * scale + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const o = (py * width + px) * 4;
            rgba[o] = rgb[0];
            rgba[o + 1] = rgb[1];
            rgba[o + 2] = rgb[2];
            rgba[o + 3] = 255;
          }
      }
    x += 6 * scale;
  }
}

/**
 * The demo "render": the captured view with a warm, slightly contrasty grade and a soft vignette,
 * and a "DEMO RENDER" band across the bottom, so nobody mistakes it for the real thing.
 * @param {{ width: number, height: number, rgba: Buffer }} img  changed in place and returned
 */
export function stampDemo(img) {
  const { width, height, rgba } = img;
  const cx = width / 2;
  const cy = height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const vig = 1 - 0.28 * Math.pow(Math.hypot(x - cx, y - cy) / maxD, 2.2);
      for (let c = 0; c < 3; c++) {
        let v = rgba[o + c] / 255;
        v = 0.5 + (v - 0.5) * 1.08; // a little contrast
        v *= c === 0 ? 1.04 : c === 2 ? 0.95 : 1; // warmer
        rgba[o + c] = Math.max(0, Math.min(255, Math.round(v * vig * 255)));
      }
      rgba[o + 3] = 255;
    }
  const scale = Math.max(2, Math.round(Math.min(width, height) / 90));
  const band = scale * 11;
  const top = height - band;
  for (let y = Math.max(0, top); y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = Math.round(rgba[o] * 0.25 + 20 * 0.75);
      rgba[o + 1] = Math.round(rgba[o + 1] * 0.25 + 24 * 0.75);
      rgba[o + 2] = Math.round(rgba[o + 2] * 0.25 + 32 * 0.75);
    }
  const text = 'DEMO RENDER';
  const tw = text.length * 6 * scale - scale;
  drawText(img, text, Math.max(scale, Math.round((width - tw) / 2)), top + 2 * scale, scale, [255, 255, 255]);
  return img;
}

/** A plain card of `width` × `height` with the stamp, for a captured view this can't decode (JPEG, WebP). */
export function demoCard(width, height) {
  const w = Math.max(64, Math.min(1600, width | 0 || 1280));
  const h = Math.max(36, Math.min(1600, height | 0 || 720));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const t = y / h;
      rgba[o] = Math.round(222 - 40 * t);
      rgba[o + 1] = Math.round(214 - 44 * t);
      rgba[o + 2] = Math.round(200 - 50 * t);
      rgba[o + 3] = 255;
    }
  return stampDemo({ width: w, height: h, rgba });
}
