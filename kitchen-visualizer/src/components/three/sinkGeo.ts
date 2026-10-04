import * as THREE from 'three';

/**
 * Soft sink geometry. A sink bowl is a cross-section profile swept around a rounded rectangle:
 * outer wall, rolled rim, inner wall, rounded inside corner, then a floor that dishes down to a
 * round drain. Every ring of the sweep is a rounded rectangle (half extents hx/hz, corner radius r)
 * sampled at the same angles, so neighbouring rings stitch into one smooth mesh, and normals are
 * written analytically (plan normal × profile normal) so long flat faces such as the apron shade
 * evenly instead of picking up interpolation gradients.
 *
 * All units are inches. Geometries are cached by size and shared, so meshes using them must pass
 * `dispose={null}`.
 */

interface RingPt {
  hx: number;
  hz: number;
  /** Plan corner radius of this ring. */
  r: number;
  y: number;
  /** Profile normal: outward (in plan) and up components. */
  nu: number;
  ny: number;
}

/** A cross-section for one point of the perimeter. `front` is 0..1, how squarely that point faces +z. */
type ProfileFn = (front: number, cornerR: number) => RingPt[];

const CORNERS = [
  { sx: 1, sz: 1, a0: 0 },
  { sx: -1, sz: 1, a0: Math.PI / 2 },
  { sx: -1, sz: -1, a0: Math.PI },
  { sx: 1, sz: -1, a0: Math.PI * 1.5 },
];

/** Corner arcs are this finely divided; the straight runs between them need no extra vertices. */
const CORNER_SEGS = 10;

function sweep(profile: ProfileFn, radii: [number, number, number, number], cap: boolean): THREE.BufferGeometry {
  const cols: { c: number; th: number }[] = [];
  for (let c = 0; c < 4; c++) for (let k = 0; k <= CORNER_SEGS; k++) cols.push({ c, th: CORNERS[c].a0 + (k / CORNER_SEGS) * (Math.PI / 2) });
  const nc = cols.length;
  const sections = cols.map(({ c, th }) => profile(Math.max(0, Math.sin(th)) ** 2, radii[c]));
  const nr = sections[0].length;

  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const n = new THREE.Vector3();
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x, y, z);
    n.set(nx, ny, nz).normalize();
    nrm.push(n.x, n.y, n.z);
    uv.push(x / 12, (z + y) / 12);
  };
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      const { c, th } = cols[j];
      const p = sections[j][i];
      const r = Math.max(0, Math.min(p.r, p.hx, p.hz));
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      put(CORNERS[c].sx * (p.hx - r) + r * cs, p.y, CORNERS[c].sz * (p.hz - r) + r * sn, p.nu * cs, p.ny, p.nu * sn);
    }
  }

  const idx: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c3 = new THREE.Vector3();
  const face = new THREE.Vector3();
  const want = new THREE.Vector3();
  // Wind each triangle to agree with its analytic normals, so faces never flip whatever the profile does.
  const tri = (i0: number, i1: number, i2: number) => {
    a.fromArray(pos, i0 * 3);
    b.fromArray(pos, i1 * 3).sub(a);
    c3.fromArray(pos, i2 * 3).sub(a);
    face.crossVectors(b, c3);
    if (face.lengthSq() < 1e-12) return;
    want.fromArray(nrm, i0 * 3).add(n.fromArray(nrm, i1 * 3)).add(n.fromArray(nrm, i2 * 3));
    if (face.dot(want) >= 0) idx.push(i0, i1, i2);
    else idx.push(i0, i2, i1);
  };
  for (let i = 0; i < nr - 1; i++) {
    for (let j = 0; j < nc; j++) {
      const p00 = i * nc + j;
      const p01 = i * nc + ((j + 1) % nc);
      const p10 = (i + 1) * nc + j;
      const p11 = (i + 1) * nc + ((j + 1) % nc);
      tri(p00, p01, p11);
      tri(p00, p11, p10);
    }
  }
  if (cap) {
    // Flat underside closing the first ring.
    const base = pos.length / 3;
    const y0 = pos[1];
    for (let j = 0; j < nc; j++) put(pos[j * 3], y0, pos[j * 3 + 2], 0, -1, 0);
    put(0, y0, 0, 0, -1, 0);
    for (let j = 0; j < nc; j++) tri(base + nc, base + j, base + ((j + 1) % nc));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const lerp = THREE.MathUtils.lerp;

/** Quarter-ish arc in the (u, y) profile plane; `concave` arcs face their centre. */
function arc(out: RingPt[], hx0: number, hz0: number, uc: number, yc: number, rad: number, a0: number, a1: number, steps: number, r: (u: number, t: number) => number, concave = false, skipFirst = true) {
  for (let k = skipFirst ? 1 : 0; k <= steps; k++) {
    const t = k / steps;
    const a = lerp(a0, a1, t);
    const u = uc + rad * Math.cos(a);
    const s = concave ? -1 : 1;
    out.push({ hx: hx0 + u, hz: hz0 + u, r: r(u, t), y: yc + rad * Math.sin(a), nu: s * Math.cos(a), ny: s * Math.sin(a) });
  }
}

interface BowlInterior {
  hx0: number;
  hz0: number;
  /** Inner wall at the top of the bowl: offset from the outline (negative = inward), height, plan radius. */
  uTop: number;
  yTop: number;
  rTop: number;
  /** How far the inner wall leans in by the time it reaches the floor. */
  draft: number;
  rBottom: number;
  /** Radius of the rounded joint between the inner walls and the floor. */
  fillet: number;
  yFloor: number;
  /** The floor falls this much from its edge to the drain. */
  fall: number;
  drainR: number;
}

/** Inner wall, rounded inside corner and dished floor down to the drain opening. */
function interior(out: RingPt[], o: BowlInterior) {
  const uW = o.uTop - o.draft;
  const yW = o.yFloor + o.fillet;
  // Wall leans in slightly; its normal is the arc-end normal so the joint shades smoothly.
  out.push({ hx: o.hx0 + uW, hz: o.hz0 + uW, r: o.rBottom, y: yW, nu: -1, ny: 0 });
  const rAt = (u: number) => Math.max(0.35, o.rBottom + (u - uW));
  arc(out, o.hx0, o.hz0, uW - o.fillet, yW, o.fillet, 0, -Math.PI / 2, 6, rAt, true);
  const uF = uW - o.fillet;
  const hx1 = o.hx0 + uF;
  const hz1 = o.hz0 + uF;
  const r1 = rAt(uF);
  const steps = 7;
  const run = (hx1 + hz1) / 2 - o.drainR;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const e = t * t * (1.6 - 0.6 * t); // flat near the walls, dishing toward the drain
    const de = (2 * 1.6 * t - 3 * 0.6 * t * t) / run; // d(e)/d(distance) for the normal
    const slope = o.fall * de;
    out.push({ hx: lerp(hx1, o.drainR, t), hz: lerp(hz1, o.drainR, t), r: lerp(r1, o.drainR, t), y: o.yFloor - o.fall * e, nu: -slope, ny: 1 });
  }
}

export const DRAIN_R = 1.75;

const cache = new Map<string, THREE.BufferGeometry>();
function memo(key: string, make: () => THREE.BufferGeometry) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

export interface FarmhouseBowlDims {
  /** Outer width, front-to-back depth and height (the apron height). */
  w: number;
  d: number;
  h: number;
  wall: number;
  cornerR: number;
}

/**
 * Fireclay apron-front sink, origin at the centre of its underside. The front (+z) gets a fully
 * rolled lip; the sides and back, which the counter butts against, keep a crisp rim so the seam is
 * a hairline. The drain opening is at (0, floorAtDrain, 0).
 */
export function farmhouseBowl(s: FarmhouseBowlDims): { geo: THREE.BufferGeometry; drainY: number } {
  const yFloor = 0.95;
  const fall = 0.32;
  const geo = memo(`farm|${s.w}|${s.d}|${s.h}|${s.wall}|${s.cornerR}`, () => {
    const hx0 = s.w / 2;
    const hz0 = s.d / 2;
    const H = s.h;
    const t = s.wall;
    const bevel = 0.3;
    const lipIn = 0.3;
    const profile: ProfileFn = (front, r0) => {
      const out: RingPt[] = [];
      const lipOut = lerp(0.07, 0.42, front);
      const rOuter = (u: number) => Math.max(0.05, r0 + u);
      // Softened bottom edge of the apron.
      out.push({ hx: hx0 - bevel, hz: hz0 - bevel, r: rOuter(-bevel), y: 0, nu: 0, ny: -1 });
      arc(out, hx0, hz0, -bevel, bevel, bevel, -Math.PI / 2, 0, 4, rOuter);
      // Apron face / outer walls.
      out.push({ hx: hx0, hz: hz0, r: r0, y: H - lipOut, nu: 1, ny: 0 });
      // Rolled lip over the top and down into the bowl.
      arc(out, hx0, hz0, -lipOut, H - lipOut, lipOut, 0, Math.PI / 2, 5, rOuter);
      const uIn = -(t - lipIn);
      out.push({ hx: hx0 + uIn, hz: hz0 + uIn, r: rOuter(uIn), y: H, nu: 0, ny: 1 });
      const rTop = Math.max(r0, 1.5);
      arc(out, hx0, hz0, uIn, H - lipIn, lipIn, Math.PI / 2, Math.PI, 5, (_u, k) => lerp(rOuter(uIn), rTop, k));
      interior(out, { hx0, hz0, uTop: -t, yTop: H - lipIn, rTop, draft: 0.45, rBottom: 2.1, fillet: 1.4, yFloor, fall, drainR: DRAIN_R });
      return out;
    };
    // Rounder corners at the apron, tighter ones at the back where the counter meets them.
    return sweep(profile, [s.cornerR, s.cornerR, 0.35, 0.35], true);
  });
  return { geo, drainY: yFloor - fall };
}

/**
 * Bowl hung under a rectangular counter cutout `w × d`, origin at the centre of the cutout on the
 * counter's underside. A flange runs out under the counter so the cutout's square corners show glaze
 * (or steel), not the cabinet; the bowl itself sits a hair inside the cut edge.
 */
export function undermountBowl(w: number, d: number, depth: number, cornerR: number): { geo: THREE.BufferGeometry; drainY: number } {
  const fall = 0.25;
  const yFloor = -depth + fall;
  const geo = memo(`under|${w}|${d}|${depth}|${cornerR}`, () => {
    const hx0 = w / 2;
    const hz0 = d / 2;
    const reveal = 0.1;
    const roll = Math.min(0.2, cornerR * 0.5);
    const flange = 0.85;
    const yt = -0.03;
    const profile: ProfileFn = (_front, r0) => {
      const out: RingPt[] = [];
      out.push({ hx: hx0 + flange, hz: hz0 + flange, r: r0 + flange, y: yt, nu: 0, ny: 1 });
      const uEdge = -reveal + roll;
      const rr = (u: number) => Math.max(0.05, r0 + u);
      out.push({ hx: hx0 + uEdge, hz: hz0 + uEdge, r: rr(uEdge), y: yt, nu: 0, ny: 1 });
      arc(out, hx0, hz0, uEdge, yt - roll, roll, Math.PI / 2, Math.PI, 3, rr);
      interior(out, {
        hx0,
        hz0,
        uTop: -reveal,
        yTop: yt - roll,
        rTop: rr(-reveal),
        draft: Math.min(0.4, depth * 0.04),
        rBottom: Math.max(rr(-reveal), cornerR * 1.2),
        fillet: Math.min(cornerR, 1.4),
        yFloor,
        fall,
        drainR: Math.min(DRAIN_R, w / 5, d / 5),
      });
      return out;
    };
    return sweep(profile, [cornerR, cornerR, cornerR, cornerR], false);
  });
  return { geo, drainY: yFloor - fall };
}

/** Stainless strainer flange: a rolled ring sitting on the floor around the drain opening. */
export function strainerGeo(drainR: number): THREE.BufferGeometry {
  return memo(`strainer|${drainR}`, () => {
    const R = drainR;
    const pts = [
      [R + 0.34, -0.03],
      [R + 0.34, 0.02],
      [R + 0.3, 0.07],
      [R + 0.2, 0.11],
      [R + 0.05, 0.12],
      [R - 0.08, 0.09],
      [R - 0.15, 0.03],
      [R - 0.17, -0.05],
      [R - 0.17, -0.55],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 40);
  });
}

/** The recessed basket inside the strainer ring, with a centre post. */
export function basketGeo(drainR: number): THREE.BufferGeometry {
  return memo(`basket|${drainR}`, () => {
    const R = drainR - 0.17;
    const pts = [
      [0, -0.62],
      [R * 0.98, -0.62],
      [R, -0.58],
      [R, -0.5],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 32);
  });
}
