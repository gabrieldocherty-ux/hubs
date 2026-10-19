/**
 * Real faucets, pulls and knobs from the retail catalog (`Fixture`), drawn at their listed size:
 * a pull's post spacing and overall length, a knob's diameter, a faucet's height. The shape comes
 * from the listing's name (`style`): a round bar on two posts, an arched bow, flat rectangular stock,
 * a finger tab; a turned mushroom or a flat disc knob; a pull-down gooseneck with its spray head, a
 * pull-out wand, a plain arc spout, a side sprayer, a coil-spring commercial faucet. Lathe and tube
 * geometry so they read as the product up close rather than as boxes. Inches, front face at `z`.
 */
import * as THREE from 'three';
import type { Fixture } from '../../types';
import type { PullSpec } from '../../lib/fronts';
import { cached } from './materials';

type V3 = [number, number, number];

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const k2 = (n: number) => Math.round(n * 100) / 100;

const cyl = (r: number, rb: number, h: number, seg = 20) => geo(`c|${k2(r)}|${k2(rb)}|${k2(h)}|${seg}`, () => new THREE.CylinderGeometry(r, rb, h, seg));
const sphere = (r: number) => geo(`s|${k2(r)}`, () => new THREE.SphereGeometry(r, 16, 12));
const box = (w: number, h: number, d: number) => geo(`b|${k2(w)}|${k2(h)}|${k2(d)}`, () => new THREE.BoxGeometry(w, h, d));
const tube = (key: string, pts: V3[], r: number, closedSeg = 48) =>
  geo(`t|${key}|${k2(r)}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), closedSeg, r, 14, false));
/** A turned part: `profile` is [radius, height] from the mounting face outward (+y, turned to +z by the caller). */
const lathe = (key: string, profile: [number, number][]) => geo(`l|${key}`, () => new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 32));

const rubber = () => cached('fixRubber', () => new THREE.MeshStandardMaterial({ color: '#262626', roughness: 0.8 }));

function Mesh({ g, pos, rot, mat }: { g: THREE.BufferGeometry; pos?: V3; rot?: V3; mat: THREE.Material }) {
  return <mesh geometry={g} position={pos} rotation={rot} material={mat} dispose={null} />;
}

// ── pulls and knobs ──────────────────────────────────────────────────────

/** Standoff from the front, inches: about 30 mm for a bar pull. */
const PROJ = 1.15;

/** One pull, laid out along +x in its own frame (centre at the origin, front face at z = 0). */
function PullBody({ f, mat, len, cc }: { f: Fixture; mat: THREE.Material; len: number; cc: number }) {
  const half = cc / 2;
  switch (f.style) {
    case 'arch': {
      // A bow that leaves the face at each post and peaks at the centre.
      const pts: V3[] = [
        [-half, 0, 0.05],
        [-half * 0.96, 0, PROJ * 0.55],
        [-half * 0.72, 0, PROJ * 0.92],
        [0, 0, PROJ * 1.05],
        [half * 0.72, 0, PROJ * 0.92],
        [half * 0.96, 0, PROJ * 0.55],
        [half, 0, 0.05],
      ];
      return (
        <group>
          <Mesh g={tube(`arch${k2(cc)}`, pts, 0.2)} mat={mat} />
          {[-half, half].map((x) => (
            <Mesh key={x} g={cyl(0.3, 0.32, 0.12)} pos={[x, 0, 0.06]} rot={[Math.PI / 2, 0, 0]} mat={mat} />
          ))}
        </group>
      );
    }
    case 'rect':
      // Flat rectangular stock on square legs.
      return (
        <group>
          <Mesh g={box(len, 0.42, 0.32)} pos={[0, 0, PROJ - 0.16]} mat={mat} />
          {[-half, half].map((x) => (
            <Mesh key={x} g={box(0.34, 0.42, PROJ - 0.3)} pos={[x, 0, (PROJ - 0.3) / 2]} mat={mat} />
          ))}
        </group>
      );
    case 'finger':
      // A slim tab: a plate on the face and a lip the fingers hook under.
      return (
        <group>
          <Mesh g={box(len, 1.1, 0.1)} pos={[0, -0.2, 0.05]} mat={mat} />
          <Mesh g={box(len, 0.12, 0.85)} pos={[0, 0.3, 0.45]} mat={mat} />
          <Mesh g={box(len, 0.3, 0.1)} pos={[0, 0.2, 0.85]} mat={mat} />
        </group>
      );
    default: {
      // A round bar on two posts, with rounded ends past them.
      const r = 0.24;
      return (
        <group>
          <Mesh g={cyl(r, r, len - 2 * r, 20)} pos={[0, 0, PROJ]} rot={[0, 0, Math.PI / 2]} mat={mat} />
          <Mesh g={sphere(r)} pos={[-len / 2 + r, 0, PROJ]} mat={mat} />
          <Mesh g={sphere(r)} pos={[len / 2 - r, 0, PROJ]} mat={mat} />
          {[-half, half].map((x) => (
            <Mesh key={x} g={cyl(0.2, 0.22, PROJ, 14)} pos={[x, 0, PROJ / 2]} rot={[Math.PI / 2, 0, 0]} mat={mat} />
          ))}
        </group>
      );
    }
  }
}

/** A knob, turned: a rosette on the face, a neck, then the head. */
function KnobBody({ f, mat }: { f: Fixture; mat: THREE.Material }) {
  const D = f.sizeIn.dia ?? 1.25;
  const R = D / 2;
  const P = Math.max(0.9, D * 0.78); // projection
  const profile: [number, number][] =
    f.style === 'disc'
      ? [
          [0, 0],
          [R * 0.5, 0],
          [R * 0.46, P * 0.08],
          [R * 0.3, P * 0.2],
          [R * 0.3, P * 0.5],
          [R * 0.9, P * 0.62],
          [R, P * 0.72],
          [R, P * 0.94],
          [R * 0.92, P],
          [0, P],
        ]
      : [
          [0, 0],
          [R * 0.62, 0],
          [R * 0.58, P * 0.08],
          [R * 0.34, P * 0.24],
          [R * 0.3, P * 0.38],
          [R * 0.62, P * 0.56],
          [R * 0.94, P * 0.72],
          [R, P * 0.82],
          [R * 0.9, P * 0.94],
          [R * 0.55, P * 0.995],
          [0, P],
        ];
  return <Mesh g={lathe(`${f.style}${k2(D)}`, profile)} rot={[Math.PI / 2, 0, 0]} mat={mat} />;
}

/**
 * A retail pull or knob where the built-in bar pull would be: at the same centre, the listed
 * length (shortened only if the front is narrower), turned with the pull's direction. Knobs on a
 * drawer wider than 30″ come in pairs, as they are fitted.
 */
export function FixturePull({ spec, z, mat, fixture: f, frontW }: { spec: NonNullable<PullSpec>; z: number; mat: THREE.Material; fixture: Fixture; frontW: number }) {
  const rot: V3 = spec.dir === 'v' ? [0, 0, Math.PI / 2] : [0, 0, 0];
  if (f.kind === 'knob') {
    const xs = spec.dir === 'h' && frontW > 30 ? [-frontW / 4, frontW / 4] : [0];
    return (
      <group>
        {xs.map((dx) => (
          <group key={dx} position={[spec.x + dx, spec.y, z]}>
            <KnobBody f={f} mat={mat} />
          </group>
        ))}
      </group>
    );
  }
  const room = Math.max(2, (spec.dir === 'h' ? frontW : 1000) - 1.5);
  const len = Math.min(f.sizeIn.length ?? 5, room);
  const cc = Math.min(f.sizeIn.cc ?? len - 0.75, len - 0.4);
  return (
    <group position={[spec.x, spec.y, z]} rotation={rot}>
      <PullBody f={f} mat={mat} len={len} cc={cc} />
    </group>
  );
}

// ── faucets ──────────────────────────────────────────────────────────────

function Lever({ x, y, mat, up = false }: { x: number; y: number; mat: THREE.Material; up?: boolean }) {
  // A side lever (a hub and a tapered blade) or, with `up`, a lever on top of the body.
  return up ? (
    <group position={[0, y, 0]}>
      <Mesh g={cyl(0.55, 0.62, 0.7)} pos={[0, 0.35, 0]} mat={mat} />
      <Mesh g={box(0.38, 0.32, 3.2)} pos={[0, 0.85, -1.3]} rot={[0.18, 0, 0]} mat={mat} />
    </group>
  ) : (
    <group position={[x, y, 0]}>
      <Mesh g={cyl(0.5, 0.5, 0.9)} pos={[0.45, 0, 0]} rot={[0, 0, Math.PI / 2]} mat={mat} />
      <Mesh g={box(0.34, 2.8, 0.34)} pos={[0.9, 1.25, -0.2]} rot={[-0.15, 0, -0.25]} mat={mat} />
    </group>
  );
}

function SoapPump({ x, mat }: { x: number; mat: THREE.Material }) {
  return (
    <group position={[x, 0, 0]}>
      <Mesh g={cyl(0.62, 0.7, 0.3)} pos={[0, 0.15, 0]} mat={mat} />
      <Mesh g={cyl(0.24, 0.26, 2.2)} pos={[0, 1.4, 0]} mat={mat} />
      <Mesh g={tube('soapNeck', [[0, 2.4, 0], [0, 2.9, 0.25], [0, 2.85, 1.1], [0, 2.55, 1.35]], 0.14, 16)} mat={mat} />
    </group>
  );
}

/** The faucet on a sink's back deck at `z`, the counter at `y`, spout reaching toward +z (the room). */
export function FixtureFaucet({ z, y = 36, mat, fixture: f }: { z: number; y?: number; mat: THREE.Material; fixture: Fixture }) {
  const H = Math.max(8, Math.min(26, f.sizeIn.height ?? 16));
  const head = rubber();
  const deck = <Mesh g={cyl(1.05, 1.2, 0.35)} pos={[0, 0.175, 0]} mat={mat} />;
  const soap = f.extras?.soap ? <SoapPump x={-5.5} mat={mat} /> : null;
  let body: JSX.Element;
  switch (f.style) {
    case 'spring': {
      // Commercial pull-down: a straight column, a coil spring around its top, the hose arcing over
      // to a spray head docked on a short arm.
      const colH = H - 3;
      const coil: V3[] = [];
      const turns = 11;
      const y0 = colH * 0.42;
      const y1 = H - 1.2;
      for (let i = 0; i <= turns * 12; i++) {
        const t = i / (turns * 12);
        const a = t * turns * Math.PI * 2;
        coil.push([Math.cos(a) * 1.05, y0 + (y1 - y0) * t, Math.sin(a) * 1.05]);
      }
      const reach = 8;
      // The spray head docks in a clip on an arm off the column; the hose drops to it from the arc.
      const dock = colH * 0.62;
      body = (
        <group>
          <Mesh g={cyl(0.62, 0.72, colH)} pos={[0, colH / 2, 0]} mat={mat} />
          <Mesh g={tube(`coil${k2(H)}`, coil, 0.11, 260)} mat={mat} />
          <Mesh g={tube(`springArc${k2(H)}`, [[0, H - 1.2, 0], [0, H + 0.4, 0.6], [0, H + 0.7, reach * 0.5], [0, H - 0.6, reach * 0.92], [0, H - 3, reach], [0, dock + 3.2, reach]], 0.32, 64)} mat={mat} />
          <Mesh g={cyl(0.62, 0.68, 2.8)} pos={[0, dock + 1.6, reach]} mat={mat} />
          <Mesh g={cyl(0.52, 0.52, 0.06)} pos={[0, dock + 0.17, reach]} mat={head} />
          <Mesh g={box(0.38, 0.38, reach - 0.9)} pos={[0, dock + 0.9, (reach - 0.9) / 2]} mat={mat} />
          <Mesh g={cyl(0.8, 0.8, 0.45, 24)} pos={[0, dock + 0.9, reach]} mat={mat} />
          <Lever x={0.6} y={colH * 0.25} mat={mat} />
        </group>
      );
      break;
    }
    case 'pullout': {
      // A low arc to a horizontal wand, the lever on the side.
      const b = H * 0.45;
      const reach = 8.5;
      body = (
        <group>
          <Mesh g={cyl(0.85, 0.95, b)} pos={[0, b / 2 + 0.3, 0]} mat={mat} />
          <Mesh g={tube(`pullout${k2(H)}`, [[0, b, 0], [0, H - 0.8, 0.6], [0, H, reach * 0.4], [0, H - 0.6, reach * 0.72]], 0.5)} mat={mat} />
          <Mesh g={cyl(0.66, 0.72, 3.4)} pos={[0, H - 1.25, reach * 0.72 + 1.5]} rot={[Math.PI / 2 + 0.35, 0, 0]} mat={mat} />
          <Mesh g={cyl(0.56, 0.56, 0.06)} pos={[0, H - 1.85, reach * 0.72 + 3.15]} rot={[Math.PI / 2 + 0.35, 0, 0]} mat={head} />
          <Lever x={0.8} y={b * 0.62} mat={mat} />
        </group>
      );
      break;
    }
    case 'single':
    case 'side-spray': {
      // A plain arc spout with an aerator, the lever on top; a side sprayer beside it when listed.
      const b = 2.6;
      const reach = 8.5;
      body = (
        <group>
          <Mesh g={cyl(0.95, 1.05, b)} pos={[0, b / 2 + 0.3, 0]} mat={mat} />
          <Lever x={0} y={b + 0.3} mat={mat} up />
          <Mesh g={tube(`arc${k2(H)}`, [[0, b * 0.7, 0.4], [0, H - 1, 0.9], [0, H, reach * 0.45], [0, H - 1.4, reach * 0.88], [0, H - 3, reach]], 0.46)} mat={mat} />
          <Mesh g={cyl(0.46, 0.46, 0.5)} pos={[0, H - 3.25, reach]} mat={mat} />
          <Mesh g={cyl(0.38, 0.38, 0.06)} pos={[0, H - 3.52, reach]} mat={head} />
          {f.extras?.sideSpray && (
            <group position={[4.5, 0, 0]}>
              <Mesh g={cyl(0.7, 0.8, 0.4)} pos={[0, 0.2, 0]} mat={mat} />
              <Mesh g={cyl(0.48, 0.42, 3.4)} pos={[0, 2.1, 0]} mat={mat} />
              <Mesh g={cyl(0.6, 0.48, 0.9)} pos={[0, 4.2, 0]} mat={mat} />
              <Mesh g={cyl(0.5, 0.5, 0.06)} pos={[0, 4.66, 0]} mat={head} />
            </group>
          )}
        </group>
      );
      break;
    }
    default: {
      // Pull-down: a tall body, a high gooseneck and a spray head hanging from its end.
      const b = H * 0.42;
      const reach = 8.8;
      const top = H - 0.2;
      body = (
        <group>
          <Mesh g={cyl(0.82, 0.98, b)} pos={[0, b / 2 + 0.3, 0]} mat={mat} />
          <Mesh g={tube(`goose${k2(H)}`, [[0, b, 0], [0, top - 2.6, 0], [0, top - 0.4, 1.5], [0, top, reach * 0.5], [0, top - 1.4, reach * 0.88], [0, top - 3.2, reach]], 0.47)} mat={mat} />
          <Mesh g={cyl(0.7, 0.8, 3)} pos={[0, top - 4.6, reach]} mat={mat} />
          <Mesh g={cyl(0.62, 0.62, 0.06)} pos={[0, top - 6.12, reach]} mat={head} />
          <Mesh g={cyl(0.72, 0.72, 0.25)} pos={[0, top - 3.35, reach]} mat={head} />
          <Lever x={0.75} y={b * 0.6} mat={mat} />
        </group>
      );
    }
  }
  return (
    <group position={[0, y, z]}>
      {deck}
      {body}
      {soap}
    </group>
  );
}
