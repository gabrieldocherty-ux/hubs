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
      case 'wood':
        return new THREE.MeshStandardMaterial({ map: texFor({ type: 'wood', base: f.hex }).tex, roughness: 0.62 });
      case 'metal': {
        const dark = luminance(f.hex) < 0.1;
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
 */
export function sinkMaterial(f: Finish): THREE.Material {
  return cached(`sink:${f.id}:${f.hex}:${f.material}`, () => {
    switch (f.material) {
      case 'ceramic': {
        const lum = luminance(f.hex);
        if (lum < 0.2) return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.45 });
        const color = new THREE.Color(f.hex);
        if (lum > 0.8) color.lerp(new THREE.Color(FIRECLAY), 0.75);
        return new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.07 });
      }
      case 'stone':
        // Granite composite: one even, faintly lustrous colour, not a veined countertop slab.
        return new THREE.MeshPhysicalMaterial({ color: f.hex, roughness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.5 });
      default:
        return finishMaterial(f);
    }
  });
}

export function surfaceMaterial(key: string, spec: PatternSpec, gloss: number): { mat: THREE.Material; tileIn: number } {
  const { tex, tileIn } = texFor(spec);
  const mat = cached(`surface:${key}:${JSON.stringify(spec)}`, () =>
    new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: THREE.MathUtils.lerp(0.85, 0.12, gloss),
      clearcoat: gloss > 0.6 ? 0.6 : 0,
      clearcoatRoughness: 0.2,
    }),
  );
  return { mat, tileIn };
}

export const M = {
  steel: () => cached('steel', () => new THREE.MeshStandardMaterial({ color: '#c3c6ca', metalness: 0.9, roughness: 0.28 })),
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
  return cached(`hw:${hex}:${roughness}`, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.95, roughness }));
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
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#bcd5e6');
    g.addColorStop(0.55, '#eef1ea');
    g.addColorStop(1, '#f7efe0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const rand = mulberry32(42);
    for (let i = 0; i < 40; i++) {
      const x = rand() * 256;
      const r = 18 + rand() * 30;
      const y = 200 + rand() * 20;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(110,138,96,0.85)');
      grd.addColorStop(1, 'rgba(110,138,96,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  });
}
