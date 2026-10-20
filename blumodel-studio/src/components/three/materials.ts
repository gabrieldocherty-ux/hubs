import * as THREE from 'three';
import type { Finish } from '../../types';
import { getPattern, type PatternSpec } from '../../lib/textures';
import { hashString, luminance, mulberry32, shade } from '../../lib/color';

const texCache = new Map<string, { tex: THREE.Texture; tileIn: number }>();
const matCache = new Map<string, THREE.Material>();

export function texFor(spec: PatternSpec): { tex: THREE.Texture; tileIn: number } {
  const info = getPattern(spec);
  let hit = texCache.get(info.key);
  if (!hit) {
    const tex = new THREE.CanvasTexture(info.canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    hit = { tex, tileIn: info.widthIn };
    texCache.set(info.key, hit);
  }
  return hit;
}

let brushed: THREE.Texture | null = null;

/**
 * Brushed-metal grain: fine streaks along the height, light and dark, used as a colour map (a
 * faint grain) and a roughness map (the streaks catch the light at slightly different angles), so a
 * stainless front shows the room's light running along it instead of a flat grey.
 */
export function brushedTex(): THREE.Texture {
  if (brushed) return brushed;
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(232,232,232)';
  g.fillRect(0, 0, W, H);
  const rand = mulberry32(hashString('brushed'));
  for (let i = 0; i < 1400; i++) {
    const x = rand() * W;
    const v = 214 + Math.floor(rand() * 41);
    g.fillStyle = `rgba(${v},${v},${v},${0.12 + rand() * 0.22})`;
    const y = rand() * H;
    const len = 60 + rand() * 400;
    const w = 0.4 + rand() * 1.1;
    g.fillRect(x, y, w, len);
    if (y + len > H) g.fillRect(x, y - H, w, len);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  brushed = tex;
  return tex;
}

/** Brushed stainless (or any light metal) in `hex`. */
export function brushedMetal(hex: string, roughness = 0.24): THREE.MeshStandardMaterial {
  return cached(`brushed:${hex}:${roughness}`, () => {
    const t = brushedTex();
    // Satin, not mirror: part diffuse so it stays a light steel, with the environment running along the grain.
    const m = new THREE.MeshStandardMaterial({ color: hex, map: t, roughnessMap: t, metalness: 0.62, roughness, envMapIntensity: 1.7 });
    // A 6″ × 12″ patch of grain, run along each part's length (parts.tsx Box).
    m.userData.tileIn = [6, 12];
    return m;
  });
}

export function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

export function finishMaterial(f: Finish): THREE.Material {
  return cached(`finish:${f.id}:${f.hex}:${f.material}`, () => {
    switch (f.material) {
      case 'wood': {
        const m = new THREE.MeshStandardMaterial({ map: texFor({ type: 'wood', base: f.hex }).tex, roughness: 0.62 });
        // The wood canvas is 12″ × 24″ with its grain along the height; Box maps it at that size.
        m.userData.tileIn = [12, 24];
        return m;
      }
      case 'metal': {
        const lum = luminance(f.hex);
        const dark = lum < 0.1;
        // Light metals are brushed stainless: part diffuse, so a fridge or range front reads as a
        // light satin steel under the room's lights rather than a mirror of the grey surroundings.
        if (lum > 0.35) return brushedMetal(f.hex, 0.3);
        return new THREE.MeshStandardMaterial({ color: f.hex, metalness: 0.9, roughness: dark ? 0.38 : 0.28, envMapIntensity: 1.1 });
      }
      case 'glass':
        return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.15, transmission: 0, transparent: true, opacity: 0.92, emissive: new THREE.Color(f.hex).multiplyScalar(0.55), clearcoat: 1 });
      case 'stone':
        return new THREE.MeshPhysicalMaterial({ map: texFor({ type: 'marble', base: f.hex, vein: shade(f.hex, luminance(f.hex) > 0.25 ? -0.4 : 0.5), intensity: 0.6 }).tex, roughness: 0.25, clearcoat: 0.5 });
      case 'ceramic':
        return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 });
      case 'fabric':
        return new THREE.MeshStandardMaterial({ color: f.hex, roughness: 0.95 });
      case 'leather':
        return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color(shade(f.hex, 0.3)) });
      case 'foliage':
        return new THREE.MeshStandardMaterial({ color: f.hex, roughness: 0.8 });
      case 'paint':
      case 'panel':
      default:
        return new THREE.MeshStandardMaterial({ color: f.hex, roughness: 0.5 });
    }
  });
}

/** Warm white of glazed fireclay. */
export const FIRECLAY = '#f2efe8';

/**
 * What a sink bowl is made of. Glazed fireclay gets a hard, glossy clear-coat so its rolled edges
 * catch the room's light, and a near-white glaze is pulled a touch warm, toward real fireclay rather
 * than paper white. Matte glazes and composite stay soft; steel and copper keep their metal finish.
 * Every variant reads the occlusion that the sink geometry bakes into its vertex colours.
 */
export function sinkMaterial(f: Finish): THREE.Material {
  return cached(`sink:${f.id}:${f.hex}:${f.material}`, () => {
    switch (f.material) {
      case 'ceramic': {
        const lum = luminance(f.hex);
        if (lum < 0.2) return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.45, vertexColors: true });
        const color = new THREE.Color(f.hex);
        if (lum > 0.8) color.lerp(new THREE.Color(FIRECLAY), 0.75);
        return new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.07, vertexColors: true });
      }
      case 'stone':
        // Granite composite: one even, faintly lustrous colour, not a veined countertop slab.
        return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.5, vertexColors: true });
      default: {
        const m = (finishMaterial(f) as THREE.MeshStandardMaterial).clone();
        m.vertexColors = true;
        return m;
      }
    }
  });
}

/** How much relief a pattern's dark lines get (grout, plank seams): the texture itself is the bump map. */
const RELIEF: Partial<Record<PatternSpec['type'], number>> = {
  tile: 3.3, brick: 3.3, subway: 3, zellige: 3.9, stack: 3, hex: 3.3, penny: 3.6, checker: 1.2,
  planks: 1.8, herringbone: 1.8, chevron: 1.8, concrete: 0.9, plaster: 0.6, terrazzo: 0.6,
};
/** QA builds can scale the relief from localStorage (the realism bench). */
const RELIEF_SCALE = (() => {
  try {
    const v = Number(localStorage.getItem('blumodel.qa.relief'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
})();

export function surfaceMaterial(key: string, spec: PatternSpec, gloss: number): { mat: THREE.Material; tileIn: number } {
  const { tex, tileIn } = texFor(spec);
  const relief = (RELIEF[spec.type] ?? 0) * RELIEF_SCALE;
  const mat = cached(`surface:${key}:${JSON.stringify(spec)}`, () =>
    new THREE.MeshPhysicalMaterial({
      map: tex,
      ...(relief > 0 ? { bumpMap: tex, bumpScale: relief } : {}),
      roughness: THREE.MathUtils.lerp(0.85, 0.12, gloss),
      clearcoat: gloss > 0.6 ? 0.6 : 0,
      clearcoatRoughness: 0.2,
    }),
  );
  return { mat, tileIn };
}

export const M = {
  steel: () => brushedMetal('#c9ccd0', 0.26),
  darkSteel: () => cached('darkSteel', () => new THREE.MeshStandardMaterial({ color: '#2b2c2e', metalness: 0.7, roughness: 0.45 })),
  castIron: () => cached('castIron', () => new THREE.MeshStandardMaterial({ color: '#1c1c1c', metalness: 0.3, roughness: 0.75 })),
  blackGlass: () => cached('blackGlass', () => new THREE.MeshPhysicalMaterial({ color: '#0d0e10', roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 })),
  ovenGlass: () => cached('ovenGlass', () => new THREE.MeshPhysicalMaterial({ color: '#141619', roughness: 0.1, metalness: 0.2, clearcoat: 1 })),
  clearGlass: () => cached('clearGlass', () => new THREE.MeshPhysicalMaterial({ color: '#dfeaf0', roughness: 0.04, transparent: true, opacity: 0.22, metalness: 0, clearcoat: 1, depthWrite: false })),
  tintGlass: () => cached('tintGlass', () => new THREE.MeshPhysicalMaterial({ color: '#2a2f33', roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, depthWrite: false })),
  toeKick: () => cached('toeKick', () => new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.9 })),
  interior: () => cached('interior', () => new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: 0.8 })),
  wallCap: () => cached('wallCap', () => new THREE.MeshStandardMaterial({ color: '#2f2a25', roughness: 0.9 })),
  plinth: () => cached('plinth', () => new THREE.MeshStandardMaterial({ color: '#e4dccf', roughness: 0.95 })),
  bulb: () => cached('bulb', () => new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: new THREE.Color('#ffd79a'), emissiveIntensity: 2.4 })),
  led: () => cached('led', () => new THREE.MeshStandardMaterial({ color: '#fff4de', emissive: new THREE.Color('#ffd9a3'), emissiveIntensity: 1.8 })),
  shadeInner: () => cached('shadeInner', () => new THREE.MeshStandardMaterial({ color: '#fff8ec', emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.55, side: THREE.DoubleSide })),
  soil: () => cached('soil', () => new THREE.MeshStandardMaterial({ color: '#3b2c22', roughness: 1 })),
  bark: () => cached('bark', () => new THREE.MeshStandardMaterial({ color: '#6d5a48', roughness: 0.9 })),
  trim: (hex: string) => cached(`trim:${hex}`, () => new THREE.MeshStandardMaterial({ color: shade(hex, 0.35), roughness: 0.45 })),
  cord: () => cached('cord', () => new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.6 })),
  brass: () => cached('brass', () => new THREE.MeshStandardMaterial({ color: '#c6a15b', metalness: 0.95, roughness: 0.3 })),
  chrome: () => cached('chrome', () => new THREE.MeshStandardMaterial({ color: '#e3e5e8', metalness: 1, roughness: 0.12 })),
};

export function hardwareMaterial(hex: string, roughness: number): THREE.Material {
  // Black hardware is a powder coat over metal, not polished black metal: at full metalness a
  // near-black colour reflects almost nothing and a knob or faucet reads as a flat silhouette.
  const coated = luminance(hex) < 0.06;
  return cached(`hw:${hex}:${roughness}`, () =>
    coated ? new THREE.MeshStandardMaterial({ color: shade(hex, 0.07), metalness: 0.55, roughness: Math.min(Math.max(roughness, 0.3), 0.38) }) : new THREE.MeshStandardMaterial({ color: hex, metalness: 0.95, roughness }),
  );
}

/** Tangent-space normal map of vertical reeds, for fluted cabinet doors. */
export function flutedNormal(): THREE.Texture {
  const key = 'fluted-normal';
  const hit = texCache.get(key);
  if (hit) return hit.tex;
  const W = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, 4);
  for (let x = 0; x < W; x++) {
    const t = (x / W) * Math.PI * 2;
    const nx = Math.sin(t) * 0.85;
    const nz = Math.sqrt(1 - nx * nx);
    for (let y = 0; y < 4; y++) {
      const i = (y * W + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = 128;
      img.data[i + 2] = nz * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  texCache.set(key, { tex, tileIn: 1.25 });
  return tex;
}

export function flutedMaterial(f: Finish): THREE.Material {
  return cached(`fluted:${f.id}:${f.hex}`, () => {
    const base = finishMaterial(f) as THREE.MeshStandardMaterial;
    const m = base.clone();
    m.normalMap = flutedNormal();
    m.normalScale = new THREE.Vector2(1.4, 1.4);
    return m;
  });
}

/** Woven kilim with stepped diamonds, seeded so each rug is stable. */
export function rugMaterial(hex: string, variant: string, seed: string): THREE.Material {
  return cached(`rug:${hex}:${variant}:${seed}`, () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    const rand = mulberry32(hashString(seed));
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 256, 512);
    const light = shade(hex, 0.55);
    const dark = shade(hex, -0.4);
    ctx.fillStyle = dark;
    ctx.fillRect(10, 10, 236, 492);
    ctx.fillStyle = hex;
    ctx.fillRect(18, 18, 220, 476);
    if (variant === 'area' || hex === '#d9cdb7') {
      for (let y = 30; y < 490; y += 22) {
        ctx.fillStyle = rand() > 0.5 ? dark : light;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(26, y, 204, 4 + rand() * 6);
      }
    } else {
      for (let cy = 60; cy < 470; cy += 90) {
        for (let s = 5; s > 0; s--) {
          ctx.fillStyle = s % 2 ? light : dark;
          ctx.beginPath();
          ctx.moveTo(128, cy - s * 9);
          ctx.lineTo(128 + s * 14, cy);
          ctx.lineTo(128, cy + s * 9);
          ctx.lineTo(128 - s * 14, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    const img = ctx.getImageData(0, 0, 256, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 22;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  });
}

/** A soft daylight view for behind windows: sky, haze and a hedge line. */
export function skyMaterial(): THREE.Material {
  return cached('sky', () => {
    // A garden outside the window, bright as daylight is next to a room: sky with soft clouds, a far
    // treeline in haze, nearer trees with sunlit tops, and lawn. Seen through glass, slightly soft.
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const rand = mulberry32(42);
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#9fc3e0');
    sky.addColorStop(0.7, '#d6e6f0');
    sky.addColorStop(1, '#eef2ee');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Clouds: clusters of soft white puffs.
    for (let k = 0; k < 7; k++) {
      const cx = rand() * W;
      const cy = 40 + rand() * 120;
      for (let i = 0; i < 9; i++) {
        const x = cx + (rand() - 0.5) * 160;
        const y = cy + (rand() - 0.5) * 30;
        const r = 20 + rand() * 40;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.75)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // Trees: crowns of many small leaf clusters, darker underneath and lit on top, drawn on their
    // own layer and softened a touch (they're 30-60 feet away, through glass).
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const lc = layer.getContext('2d')!;
    const treeline = (base: number, height: number, dark: string, mid: string, light: string, count: number, puff: number) => {
      for (let i = 0; i < count; i++) {
        const x = (i / count) * W + (rand() - 0.5) * (W / count);
        const top = base - height * (0.5 + rand() * 0.5);
        const half = 18 + rand() * 30;
        for (let p = 0; p < 90; p++) {
          const t = rand();
          const py = top + t * (base - top);
          const spread = half * Math.sin(Math.PI * Math.min(1, 0.15 + t * 1.1));
          const px = x + (rand() - 0.5) * 2 * spread;
          const r = puff * (0.5 + rand());
          const col = t < 0.3 ? light : t < 0.7 ? mid : dark;
          for (const ox of [0, W, -W]) {
            lc.fillStyle = col;
            lc.beginPath();
            lc.arc(px + ox, py, r, 0, Math.PI * 2);
            lc.fill();
          }
        }
      }
    };
    treeline(H * 0.62, 120, '#6b8466', '#7a9472', '#93ab86', 34, 5);
    lc.fillStyle = 'rgba(222,232,236,0.38)';
    lc.fillRect(0, 0, W, H * 0.63);
    treeline(H * 0.68, 190, '#3e573a', '#52703f', '#7c9c5e', 20, 7);
    ctx.filter = 'blur(1px)';
    ctx.drawImage(layer, 0, 0);
    ctx.filter = 'none';
    // Lawn with a little light and shade.
    const lawn = ctx.createLinearGradient(0, H * 0.66, 0, H);
    lawn.addColorStop(0, '#86a466');
    lawn.addColorStop(1, '#6b8b4f');
    ctx.fillStyle = lawn;
    ctx.fillRect(0, H * 0.66, W, H * 0.34);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,220' : '40,60,30'},0.08)`;
      ctx.fillRect(rand() * W, H * 0.66 + rand() * H * 0.34, 6 + rand() * 30, 2 + rand() * 4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  });
}
