import * as THREE from 'three';

export interface ItemXform {
  x: number;
  y: number;
  /** Plan rotation in degrees, clockwise. */
  rotation: number;
}

/**
 * A box whose UVs are laid out in world inches rather than per-face 0..1, so a
 * countertop or backsplash reads as one continuous slab across neighbouring pieces.
 * `center` is in the item's local frame (x along width, y up, z toward the front).
 */
export function worldUVBox(size: [number, number, number], center: [number, number, number], xf: ItemXform | null, tileIn: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  g.translate(center[0], center[1], center[2]);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const phi = xf ? (-xf.rotation * Math.PI) / 180 : 0;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const ox = xf?.x ?? 0;
  const oz = xf?.y ?? 0;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const lz = pos.getZ(i);
    const wx = lx * c + lz * s + ox;
    const wz = -lx * s + lz * c + oz;
    const nx = nrm.getX(i) * c + nrm.getZ(i) * s;
    const ny = nrm.getY(i);
    const nz = -nrm.getX(i) * s + nrm.getZ(i) * c;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = wx;
      v = wz;
    } else if (ax >= az) {
      u = wz;
      v = ly;
    } else {
      u = wx;
      v = ly;
    }
    uv.setXY(i, u / tileIn, v / tileIn);
  }
  uv.needsUpdate = true;
  return g;
}

export function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/**
 * A tapered hood canopy: bottom rectangle `wb × db`, top `wt × dt`, height `h`,
 * with the back face kept vertical so it sits flush on the wall.
 */
export function canopy(wb: number, db: number, wt: number, dt: number, h: number): THREE.BufferGeometry {
  const back = -db / 2;
  const v = [
    [-wb / 2, 0, back],
    [wb / 2, 0, back],
    [wb / 2, 0, db / 2],
    [-wb / 2, 0, db / 2],
    [-wt / 2, h, back],
    [wt / 2, h, back],
    [wt / 2, h, back + dt],
    [-wt / 2, h, back + dt],
  ];
  const quads = [
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [2, 1, 5, 6],
    [1, 0, 4, 5],
    [4, 7, 6, 5],
    [0, 1, 2, 3],
  ];
  const positions: number[] = [];
  for (const [a, b, c, d] of quads) {
    positions.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The texture coordinates of a point on a box face, in tiles, for a grained material (wood) or
 * any texture with a real-world size. The texture's v axis is its grain.
 *
 *  - Faces are mapped at real scale (inches / tile), not stretched 0..1 per face, so a 3″ rail and
 *    a 30″ door show the same grain width (BUILD_PLAN bug 17).
 *  - Grain direction: a vertical face runs it vertically (stiles, door panels, cabinet sides) unless
 *    the face is at least twice as wide as it is tall (rails, drawer fronts, toe-kicks), which run it
 *    horizontally; a horizontal face runs it along its longer side (shelves, tops).
 *
 * `n` is the face normal, `p` the point (both in the box's frame, centred), `size` the box size
 * and `tile` the texture's [width, height] in inches.
 */
export function grainUV(n: [number, number, number], p: [number, number, number], size: [number, number, number], tile: [number, number]): [number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  let a: number; // across the face
  let b: number; // along the face
  let alongB: boolean; // the grain runs along b
  if (ay >= ax && ay >= az) {
    // Top or bottom: x across, z along; the grain follows the longer side.
    a = p[0];
    b = p[2];
    alongB = size[2] > size[0];
  } else {
    // A side (normal ±x: z across) or the front/back (normal ±z: x across); y is up.
    a = ax >= az ? p[2] : p[0];
    b = p[1];
    const across = ax >= az ? size[2] : size[0];
    alongB = !(across >= 2 * size[1]);
  }
  return alongB ? [a / tile[0], b / tile[1]] : [b / tile[0], a / tile[1]];
}

const grainCache = new Map<string, THREE.BoxGeometry>();

/** A shared box with real-scale, grain-aware UVs (see grainUV). */
export function grainBoxGeo(w: number, h: number, d: number, tile: [number, number]): THREE.BoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${tile[0]}x${tile[1]}`;
  let g = grainCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const size: [number, number, number] = [w, h, d];
    for (let i = 0; i < pos.count; i++) {
      const [u, v] = grainUV([nrm.getX(i), nrm.getY(i), nrm.getZ(i)], [pos.getX(i), pos.getY(i), pos.getZ(i)], size, tile);
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    grainCache.set(key, g);
  }
  return g;
}

const boxCache = new Map<string, THREE.BoxGeometry>();

/** Shared unit-free box geometry keyed by size, so repeated doors and legs don't allocate. */
export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, g);
  }
  return g;
}
