import * as THREE from 'three';
import type { FrontSpec } from '../../lib/fronts';
import { Basin, Box, Counter, Cyl, Faucet, Front } from './parts';
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

export function ToiletModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const mat = porcelain(finish.hex);
  const wallHung = product.variant === 'wall-hung';
  // An elongated bowl: a tapered cylinder stretched front to back.
  const bowlR = Math.min(7.6, w / 2 - 1);
  const bowlLen = 18.5;
  const stretch = bowlLen / (bowlR * 2);
  const bowlZ = d / 2 - bowlLen / 2;
  const rim = wallHung ? 15.5 : 16.5;
  return (
    <group>
      {wallHung ? (
        <>
          <Box size={[10, 9, d - bowlLen + 2]} pos={[0, rim - 6, -d / 2 + (d - bowlLen + 2) / 2]} mat={mat} />
          <group position={[0, rim - 5, bowlZ]} scale={[1, 1, stretch]}>
            <Cyl r={bowlR} rb={bowlR * 0.72} h={10} pos={[0, 0, 0]} mat={mat} seg={28} />
          </group>
          {/* The flush plate on the wall above */}
          <Box size={[9.5, 6.5, 0.5]} pos={[0, 40, -d / 2 + 0.25]} mat={M.chrome()} />
        </>
      ) : (
        <>
          {/* tank */}
          <Box size={[Math.min(19, w - 1), 14.5, 7.5]} pos={[0, 22.75, -d / 2 + 4.5]} mat={mat} />
          <Box size={[Math.min(19.6, w - 0.4), 1.2, 8.3]} pos={[0, 30.4, -d / 2 + 4.5]} mat={mat} />
          <Box size={[2.6, 0.6, 1.2]} pos={[-w / 2 + 3.5, 26, -d / 2 + 8.6]} mat={M.chrome()} />
          {/* pedestal and bowl */}
          <Box size={[8, 9, 14]} pos={[0, 4.5, bowlZ - 2]} mat={mat} />
          <group position={[0, rim - 7, bowlZ]} scale={[1, 1, stretch]}>
            <Cyl r={bowlR} rb={bowlR * 0.6} h={14} pos={[0, 0, 0]} mat={mat} seg={28} />
          </group>
        </>
      )}
      {/* seat and lid */}
      <group position={[0, rim + 0.6, bowlZ]} scale={[1, 1, stretch]}>
        <Cyl r={bowlR + 0.2} h={1.1} pos={[0, 0, 0]} mat={mat} seg={28} />
      </group>
    </group>
  );
}

export function TubModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const h = product.heightIn;
  const mat = porcelain(finish.hex);
  const spout = M.chrome();
  if (product.variant === 'freestanding') {
    const side = cached(`tubside:${finish.hex}`, () => {
      const m = (porcelain(finish.hex) as THREE.MeshPhysicalMaterial).clone();
      m.side = THREE.DoubleSide;
      return m;
    });
    return (
      <group>
        <group position={[0, h / 2 + 1.5, 0]} scale={[w / 2, 1, d / 2]}>
          <mesh material={side} castShadow receiveShadow>
            <cylinderGeometry args={[1, 0.82, h - 1.5, 40, 1, true]} />
          </mesh>
        </group>
        <group position={[0, 3, 0]} scale={[w / 2 - 2, 1, d / 2 - 2]}>
          <Cyl r={1} h={1} pos={[0, 0, 0]} mat={mat} seg={40} />
        </group>
        <group position={[0, h + 0.6, 0]} scale={[w / 2, 1, d / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={mat}>
            <torusGeometry args={[0.985, 0.03, 8, 48]} />
          </mesh>
        </group>
        {/* floor-mounted filler at the foot */}
        <Cyl r={0.8} h={36} pos={[w / 2 + 5, 18, 0]} mat={spout} seg={12} />
        <Box size={[6, 0.8, 0.8]} pos={[w / 2 + 2.4, 35.5, 0]} mat={spout} />
      </group>
    );
  }
  // Alcove: an apron front, a rim on all sides, a basin floor. The tiled surround is the walls' (backsplashSegments), so it cuts away with them.
  const t = 3;
  return (
    <group>
      <Box size={[w, h, t]} pos={[0, h / 2, d / 2 - t / 2]} mat={mat} />
      <Box size={[w, h, t]} pos={[0, h / 2, -d / 2 + t / 2]} mat={mat} />
      <Box size={[t, h, d]} pos={[-w / 2 + t / 2, h / 2, 0]} mat={mat} />
      <Box size={[t, h, d]} pos={[w / 2 - t / 2, h / 2, 0]} mat={mat} />
      <Box size={[w - t * 2, 2, d - t * 2]} pos={[0, 3, 0]} mat={mat} />
      {/* spout, valve and shower head on the end wall */}
      <Box size={[4.5, 1.2, 1.2]} pos={[-w / 2 + 2.6, h + 5, 0]} mat={spout} />
      <Cyl r={2.6} h={0.5} pos={[-w / 2 + 0.6, h + 16, 0]} rot={[0, 0, Math.PI / 2]} mat={spout} seg={20} />
      <Box size={[6, 0.8, 0.8]} pos={[-w / 2 + 3, 74, 0]} mat={spout} />
      <Cyl r={3} h={0.6} pos={[-w / 2 + 6, 73, 0]} mat={spout} seg={24} />
      {/* curtain rod across the front */}
      <Cyl r={0.5} h={w} pos={[0, 76, d / 2 - 2]} rot={[0, 0, Math.PI / 2]} mat={spout} seg={10} />
    </group>
  );
}

export function ShowerModel({ r, finish }: ModelProps) {
  const { w, d, product, item } = r;
  const h = product.heightIn;
  const trim = trimFor(finish.hex, finish.material);
  const v = product.variant;
  const curb = v === 'walk-in' ? 0.8 : 3;
  const sx = item.mirrored ? -1 : 1;
  const pane = (len: number, pos: [number, number, number], alongX: boolean) => (
    <group>
      <Box size={alongX ? [len, h - curb - 2, 0.38] : [0.38, h - curb - 2, len]} pos={pos} mat={glass()} cast={false} />
      <Box size={alongX ? [len, 0.8, 0.8] : [0.8, 0.8, len]} pos={[pos[0], h - 0.6, pos[2]]} mat={trim} />
    </group>
  );
  const glassY = curb + (h - curb - 2) / 2 + 1;
  return (
    <group>
      <Box size={[w, curb, d]} pos={[0, curb / 2, 0]} mat={porcelain('#f2f1ed')} />
      <Cyl r={1.4} h={0.2} pos={[0, curb + 0.05, 0]} mat={trim} seg={16} cast={false} />
      {v === 'alcove' && (
        <>
          {pane(w / 2 + 2, [-w / 4 + 1, glassY, d / 2 - 1.4], true)}
          {pane(w / 2 + 2, [w / 4 - 1, glassY, d / 2 - 0.6], true)}
          <Box size={[1.2, 10, 1.2]} pos={[-1.5, 44, d / 2 + 0.3]} mat={trim} />
        </>
      )}
      {v === 'corner' && (
        <>
          {pane(w - 1, [0, glassY, d / 2 - 0.6], true)}
          {pane(d - 1, [sx * (w / 2 - 0.6), glassY, 0], false)}
        </>
      )}
      {v === 'walk-in' && pane(w * 0.6, [-w / 2 + (w * 0.6) / 2 + 0.5, glassY, d / 2 - 0.6], true)}
      {/* rain head on an arm from the back wall, and the valve */}
      <Box size={[0.8, 0.8, 9]} pos={[0, h - 4, -d / 2 + 4.5]} mat={trim} />
      <Cyl r={4.5} h={0.4} pos={[0, h - 4.8, -d / 2 + 9]} mat={trim} seg={28} />
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
