import { hashString, hexToRgb, mix, mulberry32, rgba, shade } from './color';

export type PatternSpec =
  | { type: 'solid'; color: string }
  | { type: 'plaster'; color: string }
  | { type: 'marble'; base: string; vein: string; intensity?: number }
  | { type: 'terrazzo'; base: string; chips: string[] }
  | { type: 'concrete'; base: string }
  | { type: 'wood'; base: string; grain?: 'straight' | 'block' }
  | { type: 'planks'; base: string; plankIn?: number }
  | { type: 'herringbone'; base: string; plankIn?: number }
  | { type: 'checker'; a: string; b: string; tileIn?: number }
  | { type: 'tile'; base: string; grout: string; tileIn?: number; vary?: number }
  | { type: 'subway'; base: string; grout: string; vary?: number }
  | { type: 'zellige'; base: string; grout: string }
  | { type: 'stack'; base: string; grout: string };

export interface TextureInfo {
  key: string;
  canvas: HTMLCanvasElement;
  pxPerIn: number;
  widthIn: number;
  heightIn: number;
}

const cache = new Map<string, TextureInfo>();
const urlCache = new Map<string, string>();

export function getPattern(spec: PatternSpec): TextureInfo {
  const key = JSON.stringify(spec);
  let info = cache.get(key);
  if (!info) {
    info = build(spec, key);
    cache.set(key, info);
  }
  return info;
}

export function patternDataUrl(spec: PatternSpec): string {
  const info = getPattern(spec);
  let url = urlCache.get(info.key);
  if (!url) {
    url = info.canvas.toDataURL('image/png');
    urlCache.set(info.key, url);
  }
  return url;
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

/** Draws `fn` at every neighbouring period offset so random features wrap seamlessly. */
function wrapped(ctx: CanvasRenderingContext2D, w: number, h: number, fn: () => void) {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      ctx.save();
      ctx.translate(ox, oy);
      fn();
      ctx.restore();
    }
  }
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function build(spec: PatternSpec, key: string): TextureInfo {
  const rand = mulberry32(hashString(key));
  switch (spec.type) {
    case 'solid': {
      const { canvas, ctx } = makeCanvas(32, 32);
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, 0, 32, 32);
      return { key, canvas, pxPerIn: 4, widthIn: 8, heightIn: 8 };
    }
    case 'plaster': {
      const S = 256;
      const { canvas, ctx } = makeCanvas(S, S);
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, 0, S, S);
      wrapped(ctx, S, S, () => {
        const r2 = mulberry32(7);
        for (let i = 0; i < 40; i++) {
          blob(ctx, r2() * S, r2() * S, 20 + r2() * 60, shade(spec.color, r2() > 0.5 ? 0.12 : -0.08), 0.12);
        }
      });
      grain(ctx, S, S, 6, rand);
      return { key, canvas, pxPerIn: S / 48, widthIn: 48, heightIn: 48 };
    }
    case 'marble':
      return marble(spec.base, spec.vein, spec.intensity ?? 1, key, rand);
    case 'terrazzo': {
      const S = 256;
      const { canvas, ctx } = makeCanvas(S, S);
      ctx.fillStyle = spec.base;
      ctx.fillRect(0, 0, S, S);
      const chips = Array.from({ length: 520 }, () => ({
        x: rand() * S,
        y: rand() * S,
        r: 0.8 + Math.pow(rand(), 2.2) * 7,
        c: spec.chips[Math.floor(rand() * spec.chips.length)],
        n: 4 + Math.floor(rand() * 4),
        rot: rand() * Math.PI,
        j: Array.from({ length: 8 }, () => 0.6 + rand() * 0.5),
      }));
      wrapped(ctx, S, S, () => {
        for (const c of chips) {
          ctx.beginPath();
          for (let k = 0; k < c.n; k++) {
            const a = c.rot + (k / c.n) * Math.PI * 2;
            const px = c.x + Math.cos(a) * c.r * c.j[k];
            const py = c.y + Math.sin(a) * c.r * c.j[k];
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = c.c;
          ctx.fill();
        }
      });
      grain(ctx, S, S, 8, rand);
      return { key, canvas, pxPerIn: S / 24, widthIn: 24, heightIn: 24 };
    }
    case 'concrete': {
      const S = 256;
      const { canvas, ctx } = makeCanvas(S, S);
      ctx.fillStyle = spec.base;
      ctx.fillRect(0, 0, S, S);
      const blobs = Array.from({ length: 70 }, () => ({
        x: rand() * S,
        y: rand() * S,
        r: 10 + rand() * 50,
        light: rand() > 0.5,
      }));
      const pits = Array.from({ length: 160 }, () => ({ x: rand() * S, y: rand() * S, r: 0.4 + rand() * 1.1 }));
      wrapped(ctx, S, S, () => {
        for (const b of blobs) blob(ctx, b.x, b.y, b.r, shade(spec.base, b.light ? 0.15 : -0.12), 0.18);
        for (const p of pits) {
          ctx.fillStyle = rgba(shade(spec.base, -0.35), 0.5);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      grain(ctx, S, S, 16, rand);
      return { key, canvas, pxPerIn: S / 36, widthIn: 36, heightIn: 36 };
    }
    case 'wood':
      return wood(spec.base, spec.grain ?? 'straight', key, rand);
    case 'planks':
      return planks(spec.base, spec.plankIn ?? 7, key, rand);
    case 'herringbone':
      return herringbone(spec.base, spec.plankIn ?? 3.5, key);
    case 'checker': {
      const tileIn = spec.tileIn ?? 12;
      const S = 256;
      const { canvas, ctx } = makeCanvas(S, S);
      const t = S / 2;
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const base = (i + j) % 2 === 0 ? spec.a : spec.b;
          ctx.fillStyle = base;
          ctx.fillRect(i * t, j * t, t, t);
          ctx.save();
          ctx.beginPath();
          ctx.rect(i * t, j * t, t, t);
          ctx.clip();
          for (let k = 0; k < 10; k++) {
            blob(ctx, i * t + rand() * t, j * t + rand() * t, 10 + rand() * 40, shade(base, rand() > 0.5 ? 0.08 : -0.08), 0.35);
          }
          ctx.strokeStyle = rgba(shade(base, -0.25), 0.25);
          ctx.lineWidth = 0.8;
          for (let v = 0; v < 2; v++) {
            ctx.beginPath();
            let x = i * t + rand() * t;
            let y = j * t;
            ctx.moveTo(x, y);
            while (y < (j + 1) * t) {
              x += (rand() - 0.5) * 10;
              y += 6;
              ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      ctx.strokeStyle = rgba('#8c857a', 0.55);
      ctx.lineWidth = 1.5;
      for (let k = 0; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(k * t, 0);
        ctx.lineTo(k * t, S);
        ctx.moveTo(0, k * t);
        ctx.lineTo(S, k * t);
        ctx.stroke();
      }
      grain(ctx, S, S, 6, rand);
      return { key, canvas, pxPerIn: S / (tileIn * 2), widthIn: tileIn * 2, heightIn: tileIn * 2 };
    }
    case 'tile': {
      const tileIn = spec.tileIn ?? 24;
      const vary = spec.vary ?? 0.05;
      const S = 256;
      const { canvas, ctx } = makeCanvas(S, S);
      const t = S / 2;
      ctx.fillStyle = spec.grout;
      ctx.fillRect(0, 0, S, S);
      const g = Math.max(1.5, S / (tileIn * 2) * 0.125);
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const c = shade(spec.base, (rand() - 0.5) * vary * 2);
          ctx.fillStyle = c;
          ctx.fillRect(i * t + g / 2, j * t + g / 2, t - g, t - g);
          ctx.save();
          ctx.beginPath();
          ctx.rect(i * t + g / 2, j * t + g / 2, t - g, t - g);
          ctx.clip();
          for (let k = 0; k < 14; k++) {
            blob(ctx, i * t + rand() * t, j * t + rand() * t, 8 + rand() * 36, shade(c, rand() > 0.5 ? 0.1 : -0.1), 0.25);
          }
          ctx.restore();
        }
      }
      grain(ctx, S, S, 8, rand);
      return { key, canvas, pxPerIn: S / (tileIn * 2), widthIn: tileIn * 2, heightIn: tileIn * 2 };
    }
    case 'subway':
      return brickTiles({ ...spec, tileW: 6, tileH: 3, cols: 4, rows: 4, offset: 0.5, vary: spec.vary ?? 0.05, gloss: 0.35 }, key, rand);
    case 'zellige':
      return brickTiles({ base: spec.base, grout: spec.grout, tileW: 4, tileH: 4, cols: 4, rows: 4, offset: 0, vary: 0.16, gloss: 0.55, wobble: true }, key, rand);
    case 'stack':
      return brickTiles({ base: spec.base, grout: spec.grout, tileW: 2, tileH: 8, cols: 4, rows: 2, offset: 0, vary: 0.07, gloss: 0.4 }, key, rand);
  }
}

function marble(base: string, vein: string, intensity: number, key: string, rand: () => number): TextureInfo {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  const clouds = Array.from({ length: 46 }, () => ({
    x: rand() * S,
    y: rand() * S,
    r: 40 + rand() * 140,
    c: rand() > 0.55 ? mix(base, vein, 0.25) : shade(base, 0.08),
  }));

  type Vein = { pts: [number, number][]; w: number; a: number };
  const veins: Vein[] = [];
  const major = 5 + Math.floor(rand() * 3);
  for (let v = 0; v < major + 14; v++) {
    const isMajor = v < major;
    let x = rand() * S;
    let y = rand() * S;
    let ang = -0.6 + rand() * 1.2 + (rand() > 0.5 ? 0 : Math.PI);
    const steps = isMajor ? 140 : 30 + Math.floor(rand() * 40);
    const pts: [number, number][] = [[x, y]];
    for (let s = 0; s < steps; s++) {
      ang += (rand() - 0.5) * 0.55;
      x += Math.cos(ang) * 6;
      y += Math.sin(ang) * 6;
      pts.push([x, y]);
    }
    veins.push({ pts, w: isMajor ? 1 + rand() * 2.4 : 0.4 + rand() * 0.8, a: (isMajor ? 0.5 + rand() * 0.35 : 0.25 + rand() * 0.3) * intensity });
  }

  wrapped(ctx, S, S, () => {
    for (const c of clouds) blob(ctx, c.x, c.y, c.r, c.c, 0.22);
    for (const v of veins) {
      const path = new Path2D();
      v.pts.forEach(([px, py], i) => (i === 0 ? path.moveTo(px, py) : path.lineTo(px, py)));
      ctx.save();
      ctx.filter = 'blur(4px)';
      ctx.strokeStyle = rgba(vein, v.a * 0.35);
      ctx.lineWidth = v.w * 5;
      ctx.stroke(path);
      ctx.restore();
      ctx.strokeStyle = rgba(vein, v.a);
      ctx.lineWidth = v.w;
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
  });
  grain(ctx, S, S, 5, rand);
  return { key, canvas, pxPerIn: S / 48, widthIn: 48, heightIn: 48 };
}

function wood(base: string, style: 'straight' | 'block', key: string, rand: () => number): TextureInfo {
  const W = 256;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  if (style === 'block') {
    const strip = 32;
    for (let x = 0; x < W; x += strip) {
      let y = -rand() * H;
      while (y < H) {
        const len = 120 + rand() * 260;
        ctx.fillStyle = shade(base, (rand() - 0.5) * 0.22);
        for (const oy of [0, H]) ctx.fillRect(x, y + oy, strip, len);
        ctx.fillStyle = rgba(shade(base, -0.45), 0.5);
        for (const oy of [0, H]) ctx.fillRect(x, y + oy + len - 1, strip, 1.2);
        y += len;
      }
      ctx.fillStyle = rgba(shade(base, -0.4), 0.45);
      ctx.fillRect(x, 0, 1, H);
    }
  }

  const lines = style === 'block' ? 90 : 120;
  const defs = Array.from({ length: lines }, () => ({
    x: rand() * W,
    amp: 1 + rand() * 6,
    k: 1 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
    w: 0.4 + rand() * 1.6,
    c: rand() > 0.3 ? shade(base, -0.12 - rand() * 0.18) : shade(base, 0.08 + rand() * 0.1),
    a: 0.18 + rand() * 0.4,
  }));
  for (const ox of [-W, 0, W]) {
    for (const d of defs) {
      ctx.beginPath();
      for (let y = 0; y <= H; y += 8) {
        const x = d.x + ox + Math.sin((y / H) * Math.PI * 2 * d.k + d.phase) * d.amp;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(d.c, d.a);
      ctx.lineWidth = d.w;
      ctx.stroke();
    }
  }
  grain(ctx, W, H, 7, rand);
  return { key, canvas, pxPerIn: W / 12, widthIn: 12, heightIn: 24 };
}

function planks(base: string, plankIn: number, key: string, rand: () => number): TextureInfo {
  const S = 512;
  const rows = 8;
  const rowH = S / rows;
  const pxPerIn = rowH / plankIn;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  for (let r = 0; r < rows; r++) {
    const y = r * rowH;
    let x = -rand() * 36 * pxPerIn;
    while (x < S) {
      const len = (26 + rand() * 40) * pxPerIn;
      const c = shade(base, (rand() - 0.5) * 0.24);
      const grains = Array.from({ length: 10 + Math.floor(rand() * 6) }, () => ({
        y: rand() * rowH,
        amp: 0.5 + rand() * 2.5,
        k: 1 + rand() * 3,
        ph: rand() * 6,
        c: shade(c, -0.1 - rand() * 0.2),
        a: 0.2 + rand() * 0.35,
      }));
      const knot = rand() > 0.82 ? { x: rand() * len, y: rowH * (0.3 + rand() * 0.4), r: 2 + rand() * 4 } : null;
      for (const ox of [0, S, -S]) {
        const px = x + ox;
        if (px > S || px + len < 0) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, y, len, rowH);
        ctx.clip();
        ctx.fillStyle = c;
        ctx.fillRect(px, y, len, rowH);
        for (const g of grains) {
          ctx.beginPath();
          for (let gx = 0; gx <= len; gx += 10) {
            const gy = y + g.y + Math.sin((gx / len) * Math.PI * g.k + g.ph) * g.amp;
            if (gx === 0) ctx.moveTo(px + gx, gy);
            else ctx.lineTo(px + gx, gy);
          }
          ctx.strokeStyle = rgba(g.c, g.a);
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        if (knot) {
          ctx.fillStyle = rgba(shade(c, -0.35), 0.6);
          ctx.beginPath();
          ctx.ellipse(px + knot.x, y + knot.y, knot.r * 1.8, knot.r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(shade(base, -0.5), 0.55);
        ctx.fillRect(px + len - 1, y, 1.2, rowH);
        ctx.restore();
      }
      x += len;
    }
    ctx.fillStyle = rgba(shade(base, -0.5), 0.5);
    ctx.fillRect(0, y, S, 1.2);
  }
  grain(ctx, S, S, 6, rand);
  return { key, canvas, pxPerIn, widthIn: S / pxPerIn, heightIn: S / pxPerIn };
}

function herringbone(base: string, plankIn: number, key: string): TextureInfo {
  const n = 5;
  const P = 60;
  const Wpx = P / Math.SQRT2;
  const CW = n * P;
  const CH = 4 * P;
  const pxPerIn = Wpx / plankIn;
  const { canvas, ctx } = makeCanvas(CW, CH);
  ctx.fillStyle = shade(base, -0.4);
  ctx.fillRect(0, 0, CW, CH);

  const c45 = Math.SQRT1_2;
  const toCanvas = (la: number, lb: number): [number, number] => [la * c45 - lb * c45, la * c45 + lb * c45];
  const plankColor = (cx: number, cy: number) => {
    const kx = Math.round((((cx % CW) + CW) % CW) * 2) % (CW * 2);
    const ky = Math.round((((cy % CH) + CH) % CH) * 2) % (CH * 2);
    const r = mulberry32(hashString(`${kx}:${ky}:${key}`));
    return { c: shade(base, (r() - 0.5) * 0.26), r };
  };

  ctx.save();
  ctx.rotate(Math.PI / 4);
  const range = 26;
  const drawPlank = (x: number, y: number, w: number, h: number, horizontal: boolean) => {
    const [cx, cy] = toCanvas(x + w / 2, y + h / 2);
    const { c, r } = plankColor(cx, cy);
    ctx.fillStyle = c;
    ctx.fillRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let g = 0; g < 7; g++) {
      ctx.strokeStyle = rgba(shade(c, -0.12 - r() * 0.18), 0.25 + r() * 0.3);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      if (horizontal) {
        const gy = y + r() * h;
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + w * 0.3, gy + (r() - 0.5) * 3, x + w * 0.6, gy + (r() - 0.5) * 3, x + w, gy);
      } else {
        const gx = x + r() * w;
        ctx.moveTo(gx, y);
        ctx.bezierCurveTo(gx + (r() - 0.5) * 3, y + h * 0.3, gx + (r() - 0.5) * 3, y + h * 0.6, gx, y + h);
      }
      ctx.stroke();
    }
    ctx.restore();
  };
  for (let b = -range; b <= range; b++) {
    for (let m = -range; m <= range; m++) {
      const a0 = b + 2 * n * m;
      if (a0 < -range - n || a0 > range + n) continue;
      drawPlank(a0 * Wpx, b * Wpx, n * Wpx, Wpx, true);
    }
  }
  for (let a = -range; a <= range; a++) {
    for (let m = -range; m <= range; m++) {
      const b0 = a - 2 * n * m - 2 * n + 1;
      if (b0 < -range - n || b0 > range + n) continue;
      drawPlank(a * Wpx, b0 * Wpx, Wpx, n * Wpx, false);
    }
  }
  ctx.restore();
  return { key, canvas, pxPerIn, widthIn: CW / pxPerIn, heightIn: CH / pxPerIn };
}

interface BrickOpts {
  base: string;
  grout: string;
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  offset: number;
  vary: number;
  gloss: number;
  wobble?: boolean;
}

function brickTiles(o: BrickOpts, key: string, rand: () => number): TextureInfo {
  const pxPerIn = 16;
  const tw = o.tileW * pxPerIn;
  const th = o.tileH * pxPerIn;
  const W = tw * o.cols;
  const H = th * o.rows;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = o.grout;
  ctx.fillRect(0, 0, W, H);
  const g = 2.2;
  const [br, bg, bb] = hexToRgb(o.base);
  const isDark = br + bg + bb < 240;

  for (let r = 0; r < o.rows; r++) {
    const shift = (r % 2) * o.offset * tw;
    for (let c = 0; c < o.cols; c++) {
      const x0 = c * tw + shift;
      const y0 = r * th;
      const col = shade(o.base, (rand() - 0.5) * o.vary * 2);
      const jit: number[] = o.wobble ? Array.from({ length: 8 }, () => (rand() - 0.5) * 2.2) : new Array(8).fill(0);
      const blobs = Array.from({ length: o.wobble ? 5 : 2 }, () => ({ x: rand(), y: rand(), r: 0.3 + rand() * 0.6, l: rand() > 0.5 }));
      for (const x of [x0, x0 - W]) {
        if (x + tw <= 0 || x >= W) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + g / 2 + jit[0], y0 + g / 2 + jit[1]);
        ctx.lineTo(x + tw - g / 2 + jit[2], y0 + g / 2 + jit[3]);
        ctx.lineTo(x + tw - g / 2 + jit[4], y0 + th - g / 2 + jit[5]);
        ctx.lineTo(x + g / 2 + jit[6], y0 + th - g / 2 + jit[7]);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.clip();
        for (const b of blobs) {
          blob(ctx, x + b.x * tw, y0 + b.y * th, b.r * Math.max(tw, th), shade(col, b.l ? 0.14 : -0.14), 0.35);
        }
        const hl = ctx.createLinearGradient(x, y0, x + tw * 0.6, y0 + th);
        hl.addColorStop(0, `rgba(255,255,255,${o.gloss * (isDark ? 0.35 : 0.55)})`);
        hl.addColorStop(0.45, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.fillRect(x, y0, tw, th);
        ctx.strokeStyle = rgba(shade(col, -0.3), 0.35);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  grain(ctx, W, H, 5, rand);
  return { key, canvas, pxPerIn, widthIn: W / pxPerIn, heightIn: H / pxPerIn };
}
