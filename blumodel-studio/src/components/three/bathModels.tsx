import * as THREE from 'three';
import type { FrontSpec } from '../../lib/fronts';
import { Basin, Box, Counter, Cyl, Faucet, Front, cylGeo } from './parts';
import { M, cached, finishMaterial, sinkMaterial } from './materials';
import type { ModelProps } from './models';

/**
 * Bathroom pieces drawn from code: vanities, toilets, tubs, showers and mirrors. Same frame as every
 * other model: x across the width (centred), y up from the floor, z from the wall (-d/2) to the
 * front (+d/2). Sizes follow the product, so a 48″ vanity or a 72″ tub is drawn at its real size.
 */

const porcelain = (hex: string) => cached(`porcelain:${hex}`, () => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.08 }));
const glass = () => cached('showerGlass', () => new THREE.MeshPhysicalMaterial({ color: '#e7f0f2', roughness: 0.03, transparent: true, opacity: 0.18, depthWrite: false, clearcoat: 1 }));
const mirrorMat = () => cached('mirror', () => new THREE.MeshStandardMaterial({ color: '#cfd8dc', metalness: 1, roughness: 0.04 }));
const trimFor = (hex: string, material: string) => (material === 'metal' ? cached(`trim:${hex}`, () => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.9, roughness: 0.25 })) : M.chrome());

/** Doors (and a drawer bank on a double) under a vanity top. */
function vanityFronts(w: number, y0: number, h: number, double: boolean): FrontSpec[] {
  const fronts: FrontSpec[] = [];
  if (double) {
    const bank = Math.min(18, w * 0.3);
    const side = (w - bank) / 2;
    const rows = 3;
    for (let i = 0; i < rows; i++) {
      const fh = h / rows;
      fronts.push({ x: 0, y: y0 + i * fh, w: bank, h: fh, pull: { dir: 'h', x: 0, y: y0 + i * fh + fh - 2.5, len: Math.min(8, bank - 6) } });
    }
    for (const k of [-1, 1]) {
      const cx = k * (bank / 2 + side / 2);
      const n = side > 24 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const dw = side / n;
        const x = cx - side / 2 + dw * (j + 0.5);
        fronts.push({ x, y: y0, w: dw, h, pull: { dir: 'v', x: x + (n === 2 ? (j === 0 ? dw / 2 - 2 : -dw / 2 + 2) : k * (dw / 2 - 2)), y: y0 + h - 5, len: 5 } });
      }
    }
    return fronts;
  }
  // A false drawer front across the top (the basin sits behind it), doors below.
  const top = Math.min(6, h * 0.25);
  fronts.push({ x: 0, y: y0 + h - top, w, h: top, pull: null });
  const n = w > 24 ? 2 : 1;
  for (let j = 0; j < n; j++) {
    const dw = w / n;
    const x = -w / 2 + dw * (j + 0.5);
    fronts.push({ x, y: y0, w: dw, h: h - top, pull: { dir: 'v', x: x + (n === 2 ? (j === 0 ? dw / 2 - 2 : -dw / 2 + 2) : dw / 2 - 2), y: y0 + h - top - 5, len: 5 } });
  }
  return fronts;
}

export function VanityModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product } = r;
  const floating = product.variant === 'floating';
  const double = product.variant === 'double';
  const top = product.elevationIn + product.heightIn;
  const bodyY0 = floating ? product.elevationIn : 4;
  const bodyH = top - 1.5 - bodyY0;
  const body = finishMaterial(finish);
  // One basin, or two set 30″ apart (centre to centre) on a double.
  const bw = Math.min(17, w - 8);
  const bd = 12.5;
  const zc = -d / 2 + 3 + bd / 2 + 1;
  const centres = double ? [-Math.min(15, w / 4), Math.min(15, w / 4)] : [0];
  const cutouts = centres.map((cx) => ({ x0: cx - bw / 2, x1: cx + bw / 2, z0: zc - bd / 2, z1: zc + bd / 2 }));
  const basinMat = sinkMaterial({ id: 'white', name: 'White', hex: '#f4f3ef', material: 'ceramic' });
  return (
    <group>
      {!floating && <Box size={[w - 1, 4, d - 3.5]} pos={[0, 2, -1.75]} mat={M.toeKick()} />}
      <Box size={[w, bodyH, d - 0.1]} pos={[0, bodyY0 + bodyH / 2, 0]} mat={body} />
      {vanityFronts(w, bodyY0, bodyH, double).map((f, i) => (
        <Front key={i} f={f} z={d / 2} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} look={ctx.pull} />
      ))}
      <Counter r={r} ctx={ctx} x0={-w / 2} x1={w / 2} z0={-d / 2} z1={d / 2 + 0.75} yTop={top} cutouts={cutouts} />
      {centres.map((cx) => (
        <group key={cx}>
          <Basin cx={cx} cz={zc} w={bw} d={bd} depth={6} top={top - 1.5} mat={basinMat} cornerR={4} />
          <group position={[cx, 0, 0]}>
            <Faucet z={-d / 2 + 2.2} y={top} mat={ctx.faucetMat} fixture={ctx.faucet} />
          </group>
        </group>
      ))}
    </group>
  );
}

/** Bathroom geometry (toilet, tub), cached by size: the same few shapes for every piece in a plan. */
const toiletGeos = new Map<string, THREE.BufferGeometry>();
function toiletGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = toiletGeos.get(key);
  if (!g) {
    g = make();
    toiletGeos.set(key, g);
  }
  return g;
}

/** A rounded-rectangle slab (the tank, its lid), `r` the corner radius, extruded `h` tall with a soft edge. */
function roundedSlab(w: number, d: number, h: number, r: number): THREE.BufferGeometry {
  return toiletGeo(`slab:${w}:${d}:${h}:${r}`, () => {
    const s = new THREE.Shape();
    const x = w / 2;
    const z = d / 2;
    s.moveTo(-x + r, -z);
    s.lineTo(x - r, -z);
    s.quadraticCurveTo(x, -z, x, -z + r);
    s.lineTo(x, z - r);
    s.quadraticCurveTo(x, z, x - r, z);
    s.lineTo(-x + r, z);
    s.quadraticCurveTo(-x, z, -x, z - r);
    s.lineTo(-x, -z + r);
    s.quadraticCurveTo(-x, -z, -x + r, -z);
    const bevel = Math.min(0.6, h / 4);
    const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
    // Extruded along +z: stand it up (y), centred.
    g.rotateX(-Math.PI / 2);
    g.translate(0, bevel, 0);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * The bowl turned on a lathe: a narrow foot flaring into a full, rolled rim, the way a porcelain bowl
 * is cast. Stretched front to back afterwards for an elongated bowl.
 */
function bowlGeo(r: number, h: number): THREE.BufferGeometry {
  return toiletGeo(`bowl:${r}:${h}`, () => {
    const p = [
      [0, 0],
      [r * 0.74, 0],
      [r * 0.73, h * 0.03],
      [r * 0.64, h * 0.12],
      [r * 0.63, h * 0.22],
      [r * 0.68, h * 0.36],
      [r * 0.76, h * 0.55],
      [r * 0.9, h * 0.78],
      [r * 0.98, h * 0.92],
      [r, h * 0.98],
      [r * 0.97, h],
      [r * 0.82, h],
      [r * 0.7, h * 0.86],
      [0, h * 0.7],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(p, 40);
    g.computeVertexNormals();
    return g;
  });
}

/** The seat ring: a flattened torus, stretched like the bowl. */
function seatGeo(r: number): THREE.BufferGeometry {
  return toiletGeo(`seat:${r}`, () => {
    const g = new THREE.TorusGeometry(r - 1.2, 1.2, 10, 40);
    g.rotateX(Math.PI / 2);
    g.scale(1, 0.55, 1);
    return g;
  });
}

/**
 * A toilet in the style of the classic American two-piece (American Standard's elongated, comfort
 * height): a soft-cornered tank with an overhanging lid and a chrome lever, a turned elongated bowl
 * on a skirted foot that runs back into the tank, a seat and a closed lid on chrome hinges. The
 * wall-hung kind: the bowl alone on the wall, its flush plate above.
 */
export function ToiletModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const mat = porcelain(finish.hex);
  const wallHung = product.variant === 'wall-hung';
  const bowlR = Math.min(7.4, w / 2 - 1.2);
  const bowlLen = 18.5;
  const stretch = bowlLen / (bowlR * 2);
  const bowlZ = d / 2 - bowlLen / 2;
  const rim = wallHung ? 15.5 : 16.5;
  const seat = cached(`toiletSeat:${finish.hex}`, () => new THREE.MeshPhysicalMaterial({ color: finish.hex, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
  const bowlBottom = wallHung ? rim - 11 : 0;
  const bowlH = rim - bowlBottom;
  const tankW = Math.min(19.5, w - 0.5);
  const tankD = 8;
  const tankZ = -d / 2 + tankD / 2 + 0.4;
  return (
    <group>
      {/* The bowl, and (floor-standing) the skirt from its back into the tank. */}
      <mesh geometry={bowlGeo(bowlR, bowlH)} position={[0, bowlBottom, bowlZ]} scale={[1, 1, stretch]} material={mat} castShadow receiveShadow dispose={null} />
      {wallHung ? (
        <>
          <mesh geometry={roundedSlab(bowlR * 1.5, d - bowlLen + 3, bowlH * 0.8, 2)} position={[0, bowlBottom + bowlH * 0.15, -d / 2 + (d - bowlLen + 3) / 2]} material={mat} dispose={null} />
          <Box size={[9.5, 6.5, 0.5]} pos={[0, 40, -d / 2 + 0.25]} mat={M.chrome()} />
        </>
      ) : (
        <>
          <mesh geometry={roundedSlab(bowlR * 1.25, bowlZ - tankZ + 2, rim - 1.5, 2.6)} position={[0, 0, (tankZ + bowlZ) / 2 - 1]} material={mat} castShadow receiveShadow dispose={null} />
          {/* tank, then its lid a little proud on every side */}
          <mesh geometry={roundedSlab(tankW, tankD, 14.2, 1.6)} position={[0, rim + 0.8, tankZ]} material={mat} castShadow receiveShadow dispose={null} />
          <mesh geometry={roundedSlab(tankW + 0.8, tankD + 0.9, 1.3, 1.9)} position={[0, rim + 15, tankZ]} material={mat} castShadow dispose={null} />
          {/* trip lever on the front left */}
          <Box size={[3.2, 0.7, 0.7]} pos={[-tankW / 2 + 3.2, rim + 12.4, tankZ + tankD / 2 + 0.5]} mat={M.chrome()} />
          <Cyl r={0.9} h={0.6} pos={[-tankW / 2 + 1.6, rim + 12.4, tankZ + tankD / 2 + 0.3]} rot={[Math.PI / 2, 0, 0]} mat={M.chrome()} seg={16} />
        </>
      )}
      {/* seat, the closed lid over it, and the hinges */}
      <mesh geometry={seatGeo(bowlR + 0.3)} position={[0, rim + 0.7, bowlZ]} scale={[1, 1, stretch]} material={seat} dispose={null} />
      <group position={[0, rim + 1.7, bowlZ + 0.3]} scale={[1, 1, stretch]}>
        <mesh geometry={cylGeo(bowlR + 0.1, bowlR + 0.3, 0.9, 40)} material={seat} castShadow dispose={null} />
      </group>
      {[-1, 1].map((s) => (
        <Cyl key={s} r={0.55} h={1.6} pos={[s * 4, rim + 1.4, bowlZ - bowlLen / 2 + 0.8]} rot={[0, 0, Math.PI / 2]} mat={M.chrome()} seg={12} />
      ))}
    </group>
  );
}

/** A lathe-turned basin (unit radius, `h` deep), opened at the top, for a tub's inside. */
function basinGeo(h: number): THREE.BufferGeometry {
  return toiletGeo(`basin:${h}`, () => {
    const p = [
      [0, 0],
      [0.72, 0],
      [0.86, 0.04],
      [0.94, 0.16],
      [0.98, 0.45],
      [1, 1],
    ].map(([x, y]) => new THREE.Vector2(x, y * h));
    const g = new THREE.LatheGeometry(p, 48);
    g.computeVertexNormals();
    return g;
  });
}

/** A freestanding tub's shell turned on a lathe (unit radius): a narrow foot, flaring walls, a rolled rim. */
function freeShellGeo(h: number): THREE.BufferGeometry {
  return toiletGeo(`freeshell:${h}`, () => {
    const p = [
      [0, 0],
      [0.74, 0],
      [0.78, 0.03],
      [0.8, 0.12],
      [0.88, 0.45],
      [0.96, 0.8],
      [1, 0.95],
      [0.995, 1],
      [0.95, 1.01],
      [0.92, 0.97],
      [0.9, 0.6],
      [0.83, 0.2],
      [0.6, 0.12],
      [0, 0.12],
    ].map(([x, y]) => new THREE.Vector2(x, y * h));
    const g = new THREE.LatheGeometry(p, 56);
    g.computeVertexNormals();
    return g;
  });
}

/** A flat frame with an oval opening (the alcove tub's deck), `t` thick, standing at y = 0..t. */
function deckGeo(w: number, d: number, ow: number, od: number, t: number): THREE.BufferGeometry {
  return toiletGeo(`deck:${w}:${d}:${ow}:${od}:${t}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2);
    s.lineTo(w / 2, -d / 2);
    s.lineTo(w / 2, d / 2);
    s.lineTo(-w / 2, d / 2);
    s.lineTo(-w / 2, -d / 2);
    const hole = new THREE.Path();
    // A stadium: straight sides, round ends, the shape of a tub's opening.
    const rr = od / 2;
    const sx = ow / 2 - rr;
    hole.moveTo(-sx, -rr);
    hole.lineTo(sx, -rr);
    hole.absarc(sx, 0, rr, -Math.PI / 2, Math.PI / 2, false);
    hole.lineTo(-sx, rr);
    hole.absarc(-sx, 0, rr, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 2, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

export function TubModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const h = product.heightIn;
  const mat = porcelain(finish.hex);
  const spout = M.chrome();
  const inside = cached(`tubInside:${finish.hex}`, () => {
    const m = (porcelain(finish.hex) as THREE.MeshPhysicalMaterial).clone();
    m.side = THREE.DoubleSide;
    return m;
  });
  if (product.variant === 'freestanding') {
    return (
      <group>
        <mesh geometry={freeShellGeo(h)} scale={[w / 2, 1, d / 2]} material={inside} castShadow receiveShadow dispose={null} />
        {/* floor-mounted filler at the foot: a column, a gooseneck spout and the hand shower */}
        <Cyl r={0.8} h={36} pos={[w / 2 + 6, 18, 0]} mat={spout} seg={16} />
        <mesh geometry={toiletGeo('filler-arc', () => new THREE.TorusGeometry(4, 0.55, 10, 24, Math.PI))} position={[w / 2 + 2, 36, 0]} material={spout} dispose={null} />
        <Cyl r={0.9} h={2.4} pos={[w / 2 - 2, 34.6, 0]} mat={spout} seg={16} />
        <Box size={[1.2, 6, 1.2]} pos={[w / 2 + 7.5, 26, 1.2]} mat={spout} />
      </group>
    );
  }
  // Alcove: an apron front, a deck with an oval opening, a sloped basin inside. The tiled surround
  // is the walls' (backsplashSegments), so it cuts away with them.
  const deckT = 1.6;
  const ow = w - 10;
  const od = d - 9;
  return (
    <group>
      {/* the apron and the body under the deck */}
      <mesh geometry={roundedSlab(w, d - 0.5, h - deckT, 0.8)} position={[0, 0, 0.25]} material={mat} castShadow receiveShadow dispose={null} />
      <mesh geometry={deckGeo(w, d, ow, od, deckT)} position={[0, h - deckT, 0]} material={mat} receiveShadow dispose={null} />
      <mesh geometry={basinGeo(h - 4)} position={[0, 2.2, 0.6]} scale={[ow / 2, 1, od / 2]} material={inside} receiveShadow dispose={null} />
      {/* on the end wall: a curved spout, the valve with its lever, the shower arm and head */}
      <group position={[-w / 2 + 0.6, h + 4.5, 0]}>
        <Box size={[1.6, 2, 2]} pos={[0, 0, 0]} mat={spout} />
        <Box size={[4.6, 1.4, 1.6]} pos={[2.6, -0.2, 0]} mat={spout} />
        <Box size={[1.2, 1.2, 1.4]} pos={[4.8, -0.9, 0]} mat={spout} />
      </group>
      <Cyl r={2.8} h={0.5} pos={[-w / 2 + 0.3, h + 17, 0]} rot={[0, 0, Math.PI / 2]} mat={spout} seg={24} />
      <Box size={[2.6, 0.7, 0.7]} pos={[-w / 2 + 1.8, h + 17, 0]} mat={spout} />
      <Box size={[7, 0.8, 0.8]} pos={[-w / 2 + 3.5, 74, 0]} mat={spout} />
      <Cyl r={3.2} h={0.7} pos={[-w / 2 + 7, 73.2, 0]} mat={spout} seg={28} />
      {/* curtain rod across the front */}
      <Cyl r={0.5} h={w} pos={[0, 76, d / 2 - 2]} rot={[0, 0, Math.PI / 2]} mat={spout} seg={12} />
    </group>
  );
}

/** A flat base (curb `t` tall) of any outline, given as [x, z] points in the model's frame. */
function baseGeo(key: string, pts: [number, number][], t: number): THREE.BufferGeometry {
  return toiletGeo(`showerBase:${key}:${t}`, () => {
    // Drawn in the x/y plane with y = -z, so that turning it to stand up maps it back onto x/z.
    const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Showers, ten kinds (variant): `alcove` (sliding doors between three walls), `glass-door` (a
 * frameless door and a fixed panel), `corner` (two glass sides), `walk-in` (one fixed panel, no
 * door), `neo-angle` (a corner shower with an angled door), `quadrant` (a curved corner),
 * `wet-room` (curbless, a floor-to-ceiling fixed panel, a linear drain, a ceiling rain head),
 * `steam` (glass to the ceiling, a door with a transom over it, a bench and the steam head),
 * `inline` (fixed panel, door, fixed panel across the front) and `pony-wall` (a tiled half wall
 * topped with glass).
 */
export function ShowerModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product, item } = r;
  const v = product.variant;
  const ceiling = ctx?.ceiling ?? 96;
  const tall = v === 'wet-room' || v === 'steam';
  const h = tall ? ceiling : product.heightIn;
  const trim = trimFor(finish.hex, finish.material);
  const curb = v === 'walk-in' ? 0.8 : v === 'wet-room' ? 0.35 : 3;
  const sx = item.mirrored ? -1 : 1;
  const gH = (tall ? ceiling - 0.4 : h - 2) - curb;
  const glassY = curb + gH / 2;
  /** A glass panel `len` long, along x or z, centred at pos (x, z); `ht` tall from the curb. */
  const pane = (len: number, x: number, z: number, alongX: boolean, ht = gH, rail = !tall) => (
    <group>
      <Box size={alongX ? [len, ht, 0.38] : [0.38, ht, len]} pos={[x, curb + ht / 2, z]} mat={glass()} cast={false} />
      {rail && <Box size={alongX ? [len, 0.8, 0.8] : [0.8, 0.8, len]} pos={[x, curb + ht + 0.4, z]} mat={trim} />}
      {/* a slim channel where the glass meets the curb */}
      <Box size={alongX ? [len, 0.6, 0.7] : [0.7, 0.6, len]} pos={[x, curb + 0.3, z]} mat={trim} cast={false} />
    </group>
  );
  /** Pivot hinges and a long pull on a door whose free edge is at x (along the front, z). */
  const doorHardware = (hingeX: number, pullX: number, z: number) => (
    <>
      {[curb + 8, curb + Math.min(gH, 76) - 8].map((y) => (
        <Box key={y} size={[2.2, 1.6, 0.9]} pos={[hingeX, y, z]} mat={trim} />
      ))}
      <Box size={[0.7, 18, 0.7]} pos={[pullX, 44, z + 1.2]} mat={trim} />
      {[35, 53].map((y) => (
        <Box key={y} size={[0.5, 0.5, 1.2]} pos={[pullX, y, z + 0.6]} mat={trim} />
      ))}
    </>
  );
  const front = d / 2 - 0.6;
  const baseMat = porcelain('#f2f1ed');

  // The base: square for most, cut for a neo-angle, curved for a quadrant, a tiled tray for a wet room.
  const cut = Math.min(w, d) * 0.42;
  const base =
    v === 'neo-angle' ? (
      <mesh geometry={baseGeo(`neo:${w}:${d}:${cut}:${sx}`, [[-sx * w / 2, -d / 2], [sx * w / 2, -d / 2], [sx * w / 2, -d / 2 + cut], [-sx * w / 2 + cut * sx, d / 2], [-sx * w / 2, d / 2]], curb)} material={baseMat} receiveShadow dispose={null} />
    ) : v === 'quadrant' ? (
      <mesh
        geometry={toiletGeo(`quadBase:${w}:${curb}:${sx}`, () => {
          const s = new THREE.Shape();
          const R = w;
          const cx = -sx * w / 2;
          const cz = -d / 2;
          s.moveTo(cx, -cz);
          s.lineTo(cx + sx * R, -cz);
          for (let i = 1; i <= 24; i++) {
            const a = (i / 24) * (Math.PI / 2);
            s.lineTo(cx + sx * R * Math.cos(a), -(cz + R * Math.sin(a)));
          }
          s.lineTo(cx, -cz);
          const g = new THREE.ExtrudeGeometry(s, { depth: curb, bevelEnabled: false });
          g.rotateX(-Math.PI / 2);
          g.computeVertexNormals();
          return g;
        })}
        material={baseMat}
        receiveShadow
        dispose={null}
      />
    ) : (
      <Box size={[w, curb, d]} pos={[0, curb / 2, 0]} mat={v === 'wet-room' ? cached('wetTray', () => new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.55 })) : baseMat} />
    );

  return (
    <group>
      {base}
      {v === 'wet-room' ? (
        // a linear drain along the back wall
        <Box size={[w - 8, 0.15, 2]} pos={[0, curb + 0.08, -d / 2 + 4]} mat={trim} cast={false} />
      ) : v === 'quadrant' ? (
        <Cyl r={1.4} h={0.2} pos={[-sx * w * 0.15, curb + 0.05, -d * 0.15]} mat={trim} seg={16} cast={false} />
      ) : (
        <Cyl r={1.4} h={0.2} pos={[0, curb + 0.05, 0]} mat={trim} seg={16} cast={false} />
      )}

      {v === 'alcove' && (
        <>
          {pane(w / 2 + 2, -w / 4 + 1, d / 2 - 1.4, true)}
          {pane(w / 2 + 2, w / 4 - 1, d / 2 - 0.6, true)}
          <Box size={[1.2, 10, 1.2]} pos={[-1.5, 44, d / 2 + 0.3]} mat={trim} />
        </>
      )}
      {v === 'glass-door' && (
        <>
          {pane(w * 0.42, -w / 2 + (w * 0.42) / 2 + 0.4, front, true)}
          <Box size={[w * 0.56, gH, 0.38]} pos={[w / 2 - (w * 0.56) / 2 - 0.4, glassY, front]} mat={glass()} cast={false} />
          {doorHardware(w / 2 - 1.4, -w / 2 + w * 0.42 + 3.2, front)}
        </>
      )}
      {v === 'corner' && (
        <>
          {pane(w - 1, 0, front, true)}
          {pane(d - 1, sx * (w / 2 - 0.6), 0, false)}
        </>
      )}
      {v === 'walk-in' && pane(w * 0.6, -w / 2 + (w * 0.6) / 2 + 0.5, front, true)}
      {v === 'wet-room' && (
        <>
          {/* one fixed panel, floor to ceiling, with a channel at both ends; the end left open */}
          {pane(w * 0.66, -w / 2 + (w * 0.66) / 2 + 0.4, front, true)}
          <Box size={[w * 0.66, 0.6, 0.7]} pos={[-w / 2 + (w * 0.66) / 2 + 0.4, ceiling - 0.4, front]} mat={trim} cast={false} />
        </>
      )}
      {v === 'steam' && (
        <>
          {/* glass to the ceiling: a fixed panel, the door, and a transom over the door */}
          <Box size={[w * 0.45, gH, 0.38]} pos={[-w / 2 + (w * 0.45) / 2 + 0.4, glassY, front]} mat={glass()} cast={false} />
          <Box size={[w * 0.53, 76 - curb, 0.38]} pos={[w / 2 - (w * 0.53) / 2 - 0.4, curb + (76 - curb) / 2, front]} mat={glass()} cast={false} />
          <Box size={[w * 0.53, ceiling - 77.5, 0.38]} pos={[w / 2 - (w * 0.53) / 2 - 0.4, 77 + (ceiling - 77.5) / 2, front]} mat={glass()} cast={false} />
          <Box size={[w - 0.8, 0.8, 0.9]} pos={[0, 76.6, front]} mat={trim} />
          <Box size={[w - 0.8, 0.6, 0.8]} pos={[0, ceiling - 0.3, front]} mat={trim} cast={false} />
          {doorHardware(w / 2 - 1.4, -w / 2 + w * 0.47 + 3, front)}
          {/* a tiled bench along the back and the steam head low on the side wall */}
          <Box size={[w - 2, 17, 14]} pos={[0, curb + 8.5, -d / 2 + 7]} mat={baseMat} />
          <Cyl r={1.6} h={1.2} pos={[sx * (w / 2 - 0.6), 14, d * 0.1]} rot={[0, 0, Math.PI / 2]} mat={trim} seg={16} />
        </>
      )}
      {v === 'inline' && (
        <>
          {/* fixed panel, a door in the middle, fixed panel */}
          {pane((w - 26) / 2, -w / 2 + (w - 26) / 4 + 0.3, front, true)}
          {pane((w - 26) / 2, w / 2 - (w - 26) / 4 - 0.3, front, true)}
          <Box size={[25, gH - 1, 0.38]} pos={[0, glassY - 0.5, front + 0.6]} mat={glass()} cast={false} />
          {doorHardware(-12, 10.5, front + 0.6)}
        </>
      )}
      {v === 'pony-wall' && (
        <>
          {/* a tiled half wall 42″ tall along the front, topped with glass; the end left open */}
          <Box size={[w * 0.62, 42 - curb, 4]} pos={[-w / 2 + (w * 0.62) / 2, curb + (42 - curb) / 2, d / 2 - 2]} mat={baseMat} />
          <Box size={[w * 0.62 + 0.6, 0.8, 5]} pos={[-w / 2 + (w * 0.62) / 2, 42.4, d / 2 - 2]} mat={cached('ponyCap', () => new THREE.MeshPhysicalMaterial({ color: '#efece6', roughness: 0.2, clearcoat: 0.6 }))} />
          <Box size={[w * 0.62, gH - 40, 0.38]} pos={[-w / 2 + (w * 0.62) / 2, 42.8 + (gH - 40) / 2, d / 2 - 2]} mat={glass()} cast={false} />
          <Box size={[0.8, gH - 40, 0.8]} pos={[-w / 2 + w * 0.62, 42.8 + (gH - 40) / 2, d / 2 - 2]} mat={trim} />
        </>
      )}
      {v === 'neo-angle' && (
        <>
          {/* two short returns and the angled door between them */}
          {pane(cut, sx * (w / 2 - 0.4), -d / 2 + cut / 2, false)}
          {pane(cut, -sx * w / 2 + sx * cut / 2, d / 2 - 0.4, true)}
          <group position={[sx * (w / 2 - (w - cut) / 2) - sx * 0.2, 0, -d / 2 + cut + (d - cut) / 2 - 0.2]} rotation={[0, sx * (Math.PI / 4), 0]}>
            <Box size={[Math.hypot(w - cut, d - cut) - 1, gH, 0.38]} pos={[0, glassY, 0]} mat={glass()} cast={false} />
            <Box size={[Math.hypot(w - cut, d - cut) - 1, 0.8, 0.8]} pos={[0, curb + gH + 0.4, 0]} mat={trim} />
            <Box size={[0.7, 18, 0.7]} pos={[(Math.hypot(w - cut, d - cut) / 2 - 3) * -1, 44, 1.2]} mat={trim} />
          </group>
        </>
      )}
      {v === 'quadrant' && (
        <group position={[-sx * w / 2, 0, -d / 2]}>
          {/* curved glass on the arc, its sliding doors' handles at the middle, curved rails */}
          {/* the arc runs from the back wall round to the side wall: +x and +z from the corner (x mirrored) */}
          <group scale={[sx, 1, 1]}>
            <mesh position={[0, curb + gH / 2, 0]} material={glass()} dispose={null}>
              <cylinderGeometry args={[w - 0.6, w - 0.6, gH, 32, 1, true, 0, Math.PI / 2]} />
            </mesh>
            {[curb + gH + 0.4, curb + 0.4].map((y) => (
              <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={trim} dispose={null}>
                <torusGeometry args={[w - 0.6, 0.45, 8, 32, Math.PI / 2]} />
              </mesh>
            ))}
          </group>
          {[-0.08, 0.08].map((da) => {
            const a = Math.PI / 4 + da;
            return <Box key={da} size={[0.7, 14, 0.7]} pos={[sx * (w + 0.4) * Math.cos(a), 44, (w + 0.4) * Math.sin(a)]} mat={trim} />;
          })}
        </group>
      )}

      {/* the head: a ceiling rain head in a wet room or a steam shower, an arm from the wall otherwise; the valve */}
      {tall ? (
        <>
          <Cyl r={0.5} h={3} pos={[0, ceiling - 1.5, -d / 2 + 14]} mat={trim} seg={10} />
          <Box size={[11, 0.4, 11]} pos={[0, ceiling - 3.2, -d / 2 + 14]} mat={trim} />
        </>
      ) : (
        <>
          <Box size={[0.8, 0.8, 9]} pos={[0, h - 4, -d / 2 + 4.5]} mat={trim} />
          <Cyl r={4.5} h={0.4} pos={[0, h - 4.8, -d / 2 + 9]} mat={trim} seg={28} />
        </>
      )}
      <Cyl r={2.8} h={0.5} pos={[0, 44, -d / 2 + 0.6]} rot={[Math.PI / 2, 0, 0]} mat={trim} seg={20} />
    </group>
  );
}

export function MirrorModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const y0 = product.elevationIn;
  const h = product.heightIn;
  const frameless = finish.id === 'frameless';
  const frame = frameless ? mirrorMat() : trimFor(finish.hex, finish.material);
  if (product.variant === 'round') {
    return (
      <group>
        <Cyl r={w / 2} h={d} pos={[0, y0 + h / 2, -d / 2 + d / 2]} rot={[Math.PI / 2, 0, 0]} mat={frame} seg={48} />
        <Cyl r={w / 2 - (frameless ? 0 : 1)} h={0.2} pos={[0, y0 + h / 2, d / 2 + 0.05]} rot={[Math.PI / 2, 0, 0]} mat={mirrorMat()} seg={48} cast={false} />
      </group>
    );
  }
  const inset = frameless ? 0 : 1.2;
  return (
    <group>
      <Box size={[w, h, d]} pos={[0, y0 + h / 2, 0]} mat={product.variant === 'cabinet' ? cached('medcab', () => new THREE.MeshStandardMaterial({ color: '#e9e7e2', roughness: 0.6 })) : frame} />
      {product.variant === 'cabinet' && !frameless && <Box size={[w, h, 0.6]} pos={[0, y0 + h / 2, d / 2 - 0.3]} mat={frame} />}
      <Box size={[w - inset * 2, h - inset * 2, 0.2]} pos={[0, y0 + h / 2, d / 2 + 0.05]} mat={mirrorMat()} cast={false} />
    </group>
  );
}
