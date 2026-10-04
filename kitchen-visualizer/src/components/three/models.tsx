import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import type { Finish } from '../../types';
import type { Resolved } from '../../lib/geometry';
import { hashString, luminance, mulberry32 } from '../../lib/color';
import { Basin, Box, Counter, Cyl, Faucet, Front, Pull, baseFronts, type FrontSpec, type SceneCtx } from './parts';
import { M, cached, finishMaterial, rugMaterial } from './materials';
import { boxGeo, canopy } from './geom3d';

export interface ModelProps {
  r: Resolved;
  finish: Finish;
  ctx: SceneCtx;
  lightOn: boolean;
}

function doubleSided(f: Finish) {
  return cached(`ds:${f.id}:${f.hex}:${f.material}`, () => {
    const m = (finishMaterial(f) as THREE.MeshStandardMaterial).clone();
    m.side = THREE.DoubleSide;
    return m;
  });
}

function Toe({ w, d }: { w: number; d: number }) {
  return <Box size={[w - 0.5, 4, d - 3.5]} pos={[0, 2, -1.75]} mat={M.toeKick()} />;
}

function BaseModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product } = r;
  const fronts = baseFronts(w, product.variant);
  return (
    <group>
      <Toe w={w} d={d} />
      <Box size={[w, 30.5, d - 0.1]} pos={[0, 19.25, 0]} mat={finishMaterial(finish)} />
      {fronts.map((f, i) => (
        <Front key={i} f={f} z={d / 2} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} />
      ))}
      <Counter r={r} ctx={ctx} x0={-w / 2} x1={w / 2} z0={-d / 2} z1={d / 2 + 1.5} />
    </group>
  );
}

function CornerModel({ r, finish, ctx }: ModelProps) {
  const sx = r.item.mirrored ? -1 : 1;
  const body = finishMaterial(finish);
  return (
    <group>
      <Box size={[35.5, 4, 20.5]} pos={[0, 2, -7.75]} mat={M.toeKick()} />
      <Box size={[20.5, 4, 12]} pos={[sx * -7.75, 2, 12]} mat={M.toeKick()} />
      <Box size={[36, 30.5, 24]} pos={[0, 19.25, -6]} mat={body} />
      <Box size={[24, 30.5, 12]} pos={[sx * -6, 19.25, 12]} mat={body} />
      <Front f={{ x: sx * 12, y: 4, w: 12, h: 30.5, pull: { dir: 'v', x: sx * 7.8, y: 24, len: 5 } }} z={6} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} />
      <group position={[sx * 6, 0, 12]} rotation={[0, sx * (Math.PI / 2), 0]}>
        <Front f={{ x: 0, y: 4, w: 12, h: 30.5, pull: null }} z={0} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} />
      </group>
      <Counter r={r} ctx={ctx} x0={-18} x1={18} z0={-18} z1={7.5} />
      <Counter r={r} ctx={ctx} x0={sx > 0 ? -18 : -7.5} x1={sx > 0 ? 7.5 : 18} z0={7.5} z1={18} />
    </group>
  );
}

function WallCabModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product } = r;
  const y0 = product.elevationIn;
  const h = product.heightIn;
  const body = finishMaterial(finish);
  const glass = product.variant === 'glass';
  const bridge = product.variant === 'bridge';
  const doors = w > 21 ? 2 : 1;
  const fronts: FrontSpec[] = [];
  for (let i = 0; i < doors; i++) {
    const dw = w / doors;
    const pullX = doors === 2 ? (i === 0 ? -2 : 2) : w / 2 - 2.2;
    fronts.push({ x: -w / 2 + dw * (i + 0.5), y: y0, w: dw, h, glass, pull: { dir: 'v', x: pullX, y: bridge ? y0 + 3.5 : y0 + 4.5, len: bridge ? 4 : 5 } });
  }
  const rng = mulberry32(hashString(r.item.id));
  return (
    <group>
      {glass ? (
        <group>
          <Box size={[w, 0.75, d]} pos={[0, y0 + 0.375, 0]} mat={body} />
          <Box size={[w, 0.75, d]} pos={[0, y0 + h - 0.375, 0]} mat={body} />
          <Box size={[0.75, h, d]} pos={[-w / 2 + 0.375, y0 + h / 2, 0]} mat={body} />
          <Box size={[0.75, h, d]} pos={[w / 2 - 0.375, y0 + h / 2, 0]} mat={body} />
          <Box size={[w - 1.5, h - 1.5, 0.5]} pos={[0, y0 + h / 2, -d / 2 + 0.25]} mat={M.interior()} />
          {[1, 2].map((s) => (
            <Box key={s} size={[w - 1.5, 0.6, d - 1]} pos={[0, y0 + (h / 3) * s, 0]} mat={M.interior()} />
          ))}
          {[0, 1, 2].map((row) =>
            Array.from({ length: Math.max(1, Math.floor((w - 4) / 6)) }).map((_, i, arr) => {
              const x = -w / 2 + 3 + ((w - 6) / arr.length) * (i + 0.5);
              const yb = y0 + (h / 3) * row + (row === 0 ? 0.75 : 0.3);
              const plates = rng() > 0.45;
              return plates ? (
                <group key={`${row}-${i}`}>
                  {[0, 1, 2, 3].map((p) => (
                    <Cyl key={p} r={2.6} h={0.35} pos={[x, yb + 0.2 + p * 0.4, -1]} mat={cached('plate', () => new THREE.MeshPhysicalMaterial({ color: '#f5f2ec', roughness: 0.25, clearcoat: 0.8 }))} seg={20} />
                  ))}
                </group>
              ) : (
                <Cyl key={`${row}-${i}`} r={1.3} rb={1.1} h={4.2} pos={[x, yb + 2.1, -1]} mat={M.clearGlass()} seg={14} />
              );
            }),
          )}
        </group>
      ) : (
        <Box size={[w, h, d - 0.1]} pos={[0, y0 + h / 2, 0]} mat={body} />
      )}
      {fronts.map((f, i) => (
        <Front key={i} f={f} z={d / 2} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} />
      ))}
      {!bridge && <Box size={[w - 3, 0.25, 0.6]} pos={[0, y0 - 0.12, d / 2 - 2]} mat={M.led()} cast={false} />}
    </group>
  );
}

function TallModel({ r, finish, ctx }: ModelProps) {
  const { w, d } = r;
  const doors = w > 21 ? 2 : 1;
  const fronts: FrontSpec[] = [];
  for (const [ya, yb] of [
    [4, 50],
    [50, 84],
  ]) {
    for (let i = 0; i < doors; i++) {
      const dw = w / doors;
      const pullX = doors === 2 ? (i === 0 ? -2 : 2) : w / 2 - 2.2;
      fronts.push({ x: -w / 2 + dw * (i + 0.5), y: ya, w: dw, h: yb - ya, pull: { dir: 'v', x: pullX, y: ya === 4 ? 44 : 56, len: 8 } });
    }
  }
  return (
    <group>
      <Toe w={w} d={d} />
      <Box size={[w, 80, d - 0.1]} pos={[0, 44, 0]} mat={finishMaterial(finish)} />
      {fronts.map((f, i) => (
        <Front key={i} f={f} z={d / 2} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} />
      ))}
    </group>
  );
}

function OvenFront({ w, y0, y1, z, mat, trim }: { w: number; y0: number; y1: number; z: number; mat: THREE.Material; trim: THREE.Material }) {
  const h = y1 - y0;
  return (
    <group>
      <Box size={[w, h - 0.3, 1.3]} pos={[0, y0 + h / 2, z + 0.65]} mat={mat} />
      <Box size={[w - 6, h * 0.42, 0.2]} pos={[0, y0 + h * 0.42, z + 1.35]} mat={M.ovenGlass()} />
      <Box size={[w - 3, 1.6, 0.2]} pos={[0, y1 - 1.3, z + 1.35]} mat={M.blackGlass()} />
      <Pull spec={{ dir: 'h', x: 0, y: y1 - 4.2, len: w - 6 }} z={z + 1.3} mat={trim} />
    </group>
  );
}

function OvenTowerModel({ r, finish, ctx }: ModelProps) {
  const { w, d } = r;
  const cab = ctx.cabinet;
  const steel = finishMaterial(finish);
  const trim = finish.material === 'metal' && luminance(finish.hex) < 0.1 ? M.darkSteel() : M.steel();
  return (
    <group>
      <Toe w={w} d={d} />
      <Box size={[w, 80, d - 0.1]} pos={[0, 44, 0]} mat={finishMaterial(cab)} />
      <Front f={{ x: 0, y: 4, w, h: 14, pull: { dir: 'h', x: 0, y: 15, len: 10 } }} z={d / 2} finish={cab} style={ctx.doorStyle} hw={ctx.hwMat} />
      <OvenFront w={w - 1.5} y0={18.2} y1={43.8} z={d / 2} mat={steel} trim={trim} />
      <OvenFront w={w - 1.5} y0={44.2} y1={69.8} z={d / 2} mat={steel} trim={trim} />
      <Front f={{ x: 0, y: 70, w, h: 14, pull: { dir: 'h', x: 0, y: 73, len: 10 } }} z={d / 2} finish={cab} style={ctx.doorStyle} hw={ctx.hwMat} />
    </group>
  );
}

function IslandModel({ r, finish, ctx }: ModelProps) {
  const { w, d } = r;
  const dc = d - 12;
  const zc = -d / 2 + dc / 2;
  const waterfall = ctx.counterIsStone;
  const cw = waterfall ? w - 3 : w;
  const cols = Math.max(2, Math.round(cw / 24));
  const colW = cw / cols;
  const body = finishMaterial(finish);
  return (
    <group>
      <Box size={[cw - 7, 4, dc - 7]} pos={[0, 2, zc]} mat={M.toeKick()} />
      <Box size={[cw, 30.5, dc]} pos={[0, 19.25, zc]} mat={body} />
      <group position={[0, 0, -d / 2]} rotation={[0, Math.PI, 0]}>
        {Array.from({ length: cols }).map((_, c) =>
          baseFronts(colW, c % 2 === 0 ? 'door-drawer' : 'drawers').map((f, i) => (
            <Front key={`${c}-${i}`} f={{ ...f, x: f.x - cw / 2 + colW * (c + 0.5), pull: f.pull && { ...f.pull, x: f.pull.x - cw / 2 + colW * (c + 0.5) } }} z={0} finish={finish} style={ctx.doorStyle} hw={ctx.hwMat} />
          )),
        )}
      </group>
      {Array.from({ length: cols }).map((_, c) => (
        <Front key={`p${c}`} f={{ x: -cw / 2 + colW * (c + 0.5), y: 4, w: colW, h: 30.5, pull: null }} z={zc + dc / 2} finish={finish} style={ctx.doorStyle === 'fluted' ? 'fluted' : 'shaker'} hw={ctx.hwMat} />
      ))}
      <Counter r={r} ctx={ctx} x0={-w / 2} x1={w / 2} z0={-d / 2 - 0.75} z1={d / 2} />
      {waterfall ? (
        <>
          <Counter r={r} ctx={ctx} x0={-w / 2} x1={-w / 2 + 1.5} z0={-d / 2 - 0.75} z1={d / 2} yTop={34.5} thick={34.5} />
          <Counter r={r} ctx={ctx} x0={w / 2 - 1.5} x1={w / 2} z0={-d / 2 - 0.75} z1={d / 2} yTop={34.5} thick={34.5} />
        </>
      ) : (
        [-1, 1].map((s) => <Box key={s} size={[2.5, 6, 10]} pos={[s * (cw / 2 - 3), 31.5, zc + dc / 2 + 5]} mat={body} />)
      )}
    </group>
  );
}

function SinkModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product } = r;
  const cab = ctx.cabinet;
  const body = finishMaterial(cab);
  const basinMat = finishMaterial(finish);
  const v = product.variant;
  let cutouts: { x0: number; x1: number; z0: number; z1: number }[] = [];
  let basins: JSX.Element | null = null;
  let fronts: FrontSpec[];
  const farm = v === 'farmhouse';

  if (farm) {
    const bw = w - 3;
    const zb0 = -d / 2 + 4;
    const zb1 = d / 2 + 0.9;
    const mid = (zb0 + zb1) / 2;
    cutouts = [{ x0: -bw / 2, x1: bw / 2, z0: zb0, z1: d / 2 + 1.5 }];
    basins = (
      <group>
        <Box size={[bw, 10.2, 1.2]} pos={[0, 30.1, zb1 - 0.6]} mat={basinMat} />
        <Box size={[bw, 10.2, 1.2]} pos={[0, 30.1, zb0 + 0.6]} mat={basinMat} />
        <Box size={[1.2, 10.2, zb1 - zb0]} pos={[-bw / 2 + 0.6, 30.1, mid]} mat={basinMat} />
        <Box size={[1.2, 10.2, zb1 - zb0]} pos={[bw / 2 - 0.6, 30.1, mid]} mat={basinMat} />
        <Box size={[bw, 1.2, zb1 - zb0]} pos={[0, 25.6, mid]} mat={basinMat} />
        <Cyl r={1.3} h={0.1} pos={[0, 26.26, mid]} mat={M.darkSteel()} />
      </group>
    );
    fronts = baseFronts(w, 'door-drawer')
      .filter((f) => f.y < 28)
      .map((f) => ({ ...f, h: 20.8, pull: f.pull && { ...f.pull, y: 21 } }));
  } else if (v === 'double') {
    const bw = (w - 9) / 2;
    const bd = 16;
    const zc = -d / 2 + 5 + bd / 2;
    cutouts = [
      { x0: -bw - 1.5, x1: -1.5, z0: zc - bd / 2, z1: zc + bd / 2 },
      { x0: 1.5, x1: 1.5 + bw, z0: zc - bd / 2, z1: zc + bd / 2 },
    ];
    basins = (
      <group>
        <Basin cx={-1.5 - bw / 2} cz={zc} w={bw} d={bd} mat={basinMat} />
        <Basin cx={1.5 + bw / 2} cz={zc} w={bw} d={bd} mat={basinMat} />
      </group>
    );
    fronts = baseFronts(w, 'door-drawer', { falseTop: true });
  } else {
    const prep = v === 'prep';
    const bw = prep ? Math.min(12, w - 4) : Math.min(w - 7, 30);
    const bd = prep ? 12 : 16;
    const zc = -d / 2 + 5 + bd / 2;
    cutouts = [{ x0: -bw / 2, x1: bw / 2, z0: zc - bd / 2, z1: zc + bd / 2 }];
    basins = <Basin cx={0} cz={zc} w={bw} d={bd} depth={prep ? 7 : 9} mat={basinMat} />;
    fronts = baseFronts(w, 'door-drawer', { falseTop: true });
  }

  return (
    <group>
      <Toe w={w} d={d} />
      <Box size={[w, 21, d - 0.1]} pos={[0, 14.5, 0]} mat={body} />
      <Box size={[0.75, 9.5, d - 0.1]} pos={[-w / 2 + 0.375, 29.75, 0]} mat={body} />
      <Box size={[0.75, 9.5, d - 0.1]} pos={[w / 2 - 0.375, 29.75, 0]} mat={body} />
      <Box size={[w, 9.5, 0.75]} pos={[0, 29.75, -d / 2 + 0.375]} mat={body} />
      {!farm && <Box size={[w, 9.5, 0.75]} pos={[0, 29.75, d / 2 - 0.4]} mat={body} />}
      {fronts.map((f, i) => (
        <Front key={i} f={f} z={d / 2} finish={cab} style={ctx.doorStyle} hw={ctx.hwMat} />
      ))}
      <Counter r={r} ctx={ctx} x0={-w / 2} x1={w / 2} z0={-d / 2} z1={d / 2 + 1.5} cutouts={cutouts} />
      {basins}
      <Faucet z={-d / 2 + 2.4} mat={ctx.hwMat} bridge={farm} />
    </group>
  );
}

function DishwasherModel({ r, finish, ctx }: ModelProps) {
  const { w, d } = r;
  const panel = finish.id === 'panel';
  const dark = luminance(finish.hex) < 0.1;
  return (
    <group>
      <Box size={[w - 0.5, 4, d - 3.5]} pos={[0, 2, -1.75]} mat={M.darkSteel()} />
      <Box size={[w - 0.5, 30.5, d - 1.5]} pos={[0, 19.25, -0.75]} mat={M.darkSteel()} />
      {panel ? (
        <Front f={{ x: 0, y: 4, w, h: 30.5, pull: { dir: 'h', x: 0, y: 31.2, len: 12 } }} z={d / 2 - 0.75} finish={ctx.cabinet} style={ctx.doorStyle} hw={ctx.hwMat} />
      ) : (
        <group>
          <Box size={[w - 0.25, 30.3, 1.2]} pos={[0, 19.25, d / 2 - 0.4]} mat={finishMaterial(finish)} />
          <Pull spec={{ dir: 'h', x: 0, y: 31.6, len: w - 5 }} z={d / 2 + 0.2} mat={dark ? M.darkSteel() : M.steel()} />
        </group>
      )}
      <Counter r={r} ctx={ctx} x0={-w / 2} x1={w / 2} z0={-d / 2} z1={d / 2 + 1.5} />
    </group>
  );
}

function WineModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product } = r;
  const frame = finishMaterial(finish);
  const inner = cached('wineInner', () => new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.7 }));
  const bottle = cached('bottle', () => new THREE.MeshPhysicalMaterial({ color: '#1f3524', roughness: 0.2, clearcoat: 1, emissive: new THREE.Color('#0b1a10') }));
  const rng = mulberry32(hashString(r.item.id));
  const cans = ['#c9442f', '#e8d8b0', '#2f6d8c', '#e0b33a', '#3c7a4d', '#f1efe9'];
  const cols = Math.max(2, Math.floor((w - 4) / 3.4));
  const inW = w - 3;
  return (
    <group>
      <Toe w={w} d={d} />
      <Box size={[w, 1.5, d - 0.5]} pos={[0, 33.75, -0.25]} mat={frame} />
      <Box size={[w, 2, d - 0.5]} pos={[0, 5, -0.25]} mat={frame} />
      <Box size={[1.5, 30.5, d - 0.5]} pos={[-w / 2 + 0.75, 19.25, -0.25]} mat={frame} />
      <Box size={[1.5, 30.5, d - 0.5]} pos={[w / 2 - 0.75, 19.25, -0.25]} mat={frame} />
      <Box size={[inW, 27, 0.5]} pos={[0, 19.5, -d / 2 + 0.5]} mat={inner} />
      <Box size={[inW - 1, 0.25, 0.4]} pos={[0, 32.6, d / 2 - 3]} mat={M.led()} cast={false} />
      {product.variant === 'wine'
        ? [0, 1, 2, 3, 4].map((row) =>
            Array.from({ length: cols }).map((_, c) => (
              <Cyl key={`${row}-${c}`} r={1.35} h={11} pos={[-inW / 2 + (inW / cols) * (c + 0.5), 8.5 + row * 5, d / 2 - 8]} rot={[Math.PI / 2, 0, 0]} mat={bottle} seg={12} />
            )),
          )
        : [0, 1, 2].map((row) => (
            <group key={row}>
              <Box size={[inW, 0.3, d - 4]} pos={[0, 7 + row * 9, -1]} mat={M.steel()} />
              {Array.from({ length: cols }).map((_, c) => {
                const col = cans[Math.floor(rng() * cans.length)];
                return <Cyl key={c} r={1.15} h={4.8} pos={[-inW / 2 + (inW / cols) * (c + 0.5), 7.3 + row * 9 + 2.4, d / 2 - 6]} mat={cached(`can${col}`, () => new THREE.MeshStandardMaterial({ color: col, metalness: 0.6, roughness: 0.35 }))} seg={12} />;
              })}
            </group>
          ))}
      <group>
        <Box size={[w, 2, 1]} pos={[0, 33, d / 2 + 0.2]} mat={frame} />
        <Box size={[w, 2, 1]} pos={[0, 5, d / 2 + 0.2]} mat={frame} />
        <Box size={[1.6, 30, 1]} pos={[-w / 2 + 0.8, 19, d / 2 + 0.2]} mat={frame} />
        <Box size={[1.6, 30, 1]} pos={[w / 2 - 0.8, 19, d / 2 + 0.2]} mat={frame} />
        <mesh geometry={boxGeo(w - 3, 26, 0.2)} position={[0, 19, d / 2 + 0.2]} material={M.tintGlass()} dispose={null} />
        <Pull spec={{ dir: 'v', x: w / 2 - 2.6, y: 22, len: 14 }} z={d / 2 + 0.7} mat={M.steel()} />
      </group>
      <Counter r={r} ctx={ctx} x0={-w / 2} x1={w / 2} z0={-d / 2} z1={d / 2 + 1.5} />
    </group>
  );
}

function RangeModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const body = finishMaterial(finish);
  // Look flags are product data (they used to be keyed off the built-in brand names).
  const brass = product.flags?.trim === 'brass';
  const backguard = !!product.flags?.backguard;
  const trim = brass ? M.brass() : product.flags?.trim === 'steel' ? M.steel() : luminance(finish.hex) < 0.1 ? M.steel() : finish.material === 'metal' ? M.steel() : M.chrome();
  const knobMat = brass ? M.brass() : luminance(finish.hex) < 0.1 ? M.steel() : M.darkSteel();
  const v = product.variant;
  const induction = v === 'induction';
  const griddle = v === 'griddle';
  const knobs = w <= 30 ? 5 : w <= 36 ? 7 : 9;
  const doors = griddle ? [w * 0.6, w * 0.4] : [w];
  const topY = 36;
  const cookW = griddle ? (w - 2) * 0.66 : w - 2;
  const cols = induction || v === 'gas-4' ? 2 : 3;
  const zTop0 = -d / 2 + 1.5;
  const zTop1 = d / 2 - 5;
  const cellW = cookW / cols;
  const cellD = (zTop1 - zTop0) / 2;
  const burners: [number, number, number][] = [];
  for (let c = 0; c < cols; c++) {
    for (let rr = 0; rr < 2; rr++) {
      const cx = -w / 2 + 1 + cellW * (c + 0.5);
      const cz = zTop0 + cellD * (rr + 0.5);
      burners.push([cx, cz, Math.min(cellW, cellD) * (induction ? ((c + rr) % 2 === 0 ? 0.42 : 0.34) : 0.3)]);
    }
  }
  const zoneMat = cached('zone', () => new THREE.MeshStandardMaterial({ color: '#6b6b6b', emissive: new THREE.Color('#3a2a22'), roughness: 0.4 }));
  let cursor = -w / 2;
  return (
    <group>
      <Box size={[w - 1, 4, d - 3]} pos={[0, 2, -1.5]} mat={M.toeKick()} />
      <Box size={[w, 31, d - 1]} pos={[0, 19.5, -0.5]} mat={body} />
      <Box size={[w - 0.4, 4.6, 1.4]} pos={[0, 32.6, d / 2 - 0.3]} mat={body} />
      {Array.from({ length: knobs }).map((_, i) => (
        <Cyl key={i} r={0.95} h={1.3} pos={[-w / 2 + (w / knobs) * (i + 0.5), 32.6, d / 2 + 0.9]} rot={[Math.PI / 2, 0, 0]} mat={knobMat} seg={14} />
      ))}
      {doors.map((dw, i) => {
        const cx = cursor + dw / 2;
        cursor += dw;
        return (
          <group key={i}>
            <Box size={[dw - 0.6, 25, 1.3]} pos={[cx, 17.4, d / 2 + 0.05]} mat={body} />
            <Box size={[dw - 7, 9.5, 0.2]} pos={[cx, 16.2, d / 2 + 0.75]} mat={M.ovenGlass()} />
            <Pull spec={{ dir: 'h', x: cx, y: 27.6, len: dw - 5 }} z={d / 2 + 0.7} mat={trim} />
          </group>
        );
      })}
      <Box size={[w, 1, d - 1]} pos={[0, 35.5, -0.5]} mat={induction ? M.blackGlass() : body} />
      {induction
        ? burners.map(([cx, cz, rad], i) => (
            <mesh key={i} position={[cx, topY + 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]} material={zoneMat}>
              <torusGeometry args={[rad, 0.12, 6, 48]} />
            </mesh>
          ))
        : burners.map(([cx, cz, rad], i) => (
            <group key={i}>
              <Cyl r={rad * 0.78} h={0.35} pos={[cx, topY + 0.2, cz]} mat={M.darkSteel()} seg={20} />
              <Cyl r={rad * 0.5} h={0.6} pos={[cx, topY + 0.55, cz]} mat={M.castIron()} seg={20} />
              <Box size={[cellW - 0.6, 0.55, 0.55]} pos={[cx, topY + 1.2, cz]} mat={M.castIron()} />
              <Box size={[0.55, 0.55, cellD - 0.6]} pos={[cx, topY + 1.2, cz]} mat={M.castIron()} />
              <Box size={[cellW - 0.6, 0.55, 0.55]} pos={[cx, topY + 1.2, cz - cellD / 2 + 0.6]} mat={M.castIron()} />
              <Box size={[cellW - 0.6, 0.55, 0.55]} pos={[cx, topY + 1.2, cz + cellD / 2 - 0.6]} mat={M.castIron()} />
              <Box size={[0.55, 0.55, cellD - 0.6]} pos={[cx - cellW / 2 + 0.6, topY + 1.2, cz]} mat={M.castIron()} />
              <Box size={[0.55, 0.55, cellD - 0.6]} pos={[cx + cellW / 2 - 0.6, topY + 1.2, cz]} mat={M.castIron()} />
            </group>
          ))}
      {griddle && <Box size={[w - 2 - cookW - 1.5, 0.7, zTop1 - zTop0 - 1]} pos={[w / 2 - 1 - (w - 2 - cookW - 1.5) / 2, topY + 0.35, (zTop0 + zTop1) / 2]} mat={M.steel()} />}
      {backguard && <Box size={[w, 3.5, 1.4]} pos={[0, topY + 1.75, -d / 2 + 0.7]} mat={body} />}
    </group>
  );
}

function FridgeModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product, item } = r;
  const h = product.heightIn;
  const v = product.variant;
  const panel = finish.id === 'panel';
  const bodyMat = panel ? finishMaterial(ctx.cabinet) : finishMaterial(finish);
  const handle = panel ? ctx.hwMat : v === 'retro' ? M.chrome() : luminance(finish.hex) < 0.1 ? M.darkSteel() : M.steel();
  const dz = d / 2 - 1;

  if (v === 'retro') {
    return (
      <group>
        {[-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.8} h={2} pos={[sx * (w / 2 - 2), 1, sz * (d / 2 - 3)]} mat={M.chrome()} />))}
        <RoundedBox args={[w, h - 2, d - 1]} radius={3.2} smoothness={4} position={[0, 2 + (h - 2) / 2, -0.5]} material={bodyMat} castShadow receiveShadow />
        <Box size={[w - 1, 0.35, 0.4]} pos={[0, 44, d / 2 - 0.9]} mat={M.toeKick()} />
        <Box size={[1.2, 3, 3]} pos={[w / 2 - 3, 50, d / 2]} mat={M.chrome()} />
        <Box size={[1.2, 3, 3]} pos={[w / 2 - 3, 36, d / 2]} mat={M.chrome()} />
        <Box size={[w * 0.4, 1.4, 0.3]} pos={[0, 8, d / 2 - 0.4]} mat={M.chrome()} />
      </group>
    );
  }

  if (v === 'column') {
    const hingeLeft = !item.mirrored;
    return (
      <group>
        <Toe w={w} d={d} />
        <Box size={[w, h - 4, d - 1]} pos={[0, 4 + (h - 4) / 2, -0.5]} mat={bodyMat} />
        {panel ? (
          <Front f={{ x: 0, y: 4, w, h: h - 4, pull: { dir: 'v', x: hingeLeft ? w / 2 - 2.5 : -w / 2 + 2.5, y: 44, len: 24 } }} z={d / 2 - 0.75} finish={ctx.cabinet} style={ctx.doorStyle} hw={ctx.hwMat} />
        ) : (
          <group>
            <Box size={[w - 0.2, h - 4.2, 1.6]} pos={[0, 4 + (h - 4) / 2, d / 2 - 0.3]} mat={bodyMat} />
            <Pull spec={{ dir: 'v', x: hingeLeft ? w / 2 - 2.5 : -w / 2 + 2.5, y: 44, len: 30 }} z={d / 2 + 0.5} mat={handle} />
          </group>
        )}
      </group>
    );
  }

  const split = 30.5;
  return (
    <group>
      <Box size={[w, h - 1, d - 2]} pos={[0, 1 + (h - 1) / 2, -1]} mat={bodyMat} />
      {panel ? (
        <group>
          <Front f={{ x: -w / 4, y: split, w: w / 2, h: h - split, pull: { dir: 'v', x: -2, y: split + 16, len: 12 } }} z={dz} finish={ctx.cabinet} style={ctx.doorStyle} hw={ctx.hwMat} />
          <Front f={{ x: w / 4, y: split, w: w / 2, h: h - split, pull: { dir: 'v', x: 2, y: split + 16, len: 12 } }} z={dz} finish={ctx.cabinet} style={ctx.doorStyle} hw={ctx.hwMat} />
          <Front f={{ x: 0, y: 1, w, h: split - 1, pull: { dir: 'h', x: 0, y: split - 4, len: 14 } }} z={dz} finish={ctx.cabinet} style={ctx.doorStyle} hw={ctx.hwMat} />
        </group>
      ) : (
        <group>
          <Box size={[w / 2 - 0.25, h - split - 0.3, 1.8]} pos={[-w / 4, split + (h - split) / 2, dz + 0.9]} mat={bodyMat} />
          <Box size={[w / 2 - 0.25, h - split - 0.3, 1.8]} pos={[w / 4, split + (h - split) / 2, dz + 0.9]} mat={bodyMat} />
          <Box size={[w - 0.3, split - 1.4, 1.8]} pos={[0, 1 + (split - 1) / 2, dz + 0.9]} mat={bodyMat} />
          <Pull spec={{ dir: 'v', x: -1.6, y: split + 16, len: 24 }} z={dz + 1.8} mat={handle} />
          <Pull spec={{ dir: 'v', x: 1.6, y: split + 16, len: 24 }} z={dz + 1.8} mat={handle} />
          <Pull spec={{ dir: 'h', x: 0, y: split - 3.5, len: w - 10 }} z={dz + 1.8} mat={handle} />
        </group>
      )}
    </group>
  );
}

function HoodModel({ r, finish, ctx }: ModelProps) {
  const { w, d, product } = r;
  const y0 = product.elevationIn;
  const h = product.heightIn;
  const mat = finishMaterial(finish);
  const plaster = product.variant === 'plaster';
  const geo = useMemo(
    () => (plaster ? canopy(w + 2, d + 1, w * 0.6, d * 0.55, Math.max(8, ctx.ceiling - y0 - 5)) : canopy(w, d, 11, 9, h - 2.5)),
    [plaster, w, d, h, y0, ctx.ceiling],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  if (plaster) {
    return (
      <group>
        <Box size={[w + 2, 5, d + 1]} pos={[0, y0 + 2.5, 0.5]} mat={mat} />
        <Box size={[w + 2.3, 0.7, d + 1.3]} pos={[0, y0 + 5, 0.5]} mat={M.brass()} />
        <mesh geometry={geo} position={[0, y0 + 5, 0.5]} material={mat} castShadow receiveShadow />
        <Box size={[w - 2, 0.2, d - 3]} pos={[0, y0 + 0.1, 0.5]} mat={M.darkSteel()} />
      </group>
    );
  }
  const top = y0 + h;
  return (
    <group>
      <Box size={[w, 2.5, d]} pos={[0, y0 + 1.25, 0]} mat={mat} />
      <mesh geometry={geo} position={[0, y0 + 2.5, 0]} material={mat} castShadow receiveShadow />
      {ctx.ceiling > top && <Box size={[11, ctx.ceiling - top, 9]} pos={[0, (top + ctx.ceiling) / 2, -d / 2 + 4.5]} mat={mat} />}
      <Box size={[w - 3, 0.2, d - 3]} pos={[0, y0 + 0.1, 0]} mat={M.darkSteel()} />
      <Cyl r={1.2} h={0.2} pos={[-w / 4, y0 - 0.05, 0]} mat={M.bulb()} cast={false} />
      <Cyl r={1.2} h={0.2} pos={[w / 4, y0 - 0.05, 0]} mat={M.bulb()} cast={false} />
    </group>
  );
}

function MicrowaveModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const y0 = product.elevationIn;
  const h = product.heightIn;
  return (
    <group>
      <Box size={[w, h, d]} pos={[0, y0 + h / 2, 0]} mat={finishMaterial(finish)} />
      <Box size={[w * 0.68, h - 3.5, 0.2]} pos={[-w * 0.14, y0 + h / 2, d / 2 + 0.1]} mat={M.ovenGlass()} />
      <Box size={[w * 0.2, h - 3.5, 0.2]} pos={[w * 0.37, y0 + h / 2, d / 2 + 0.1]} mat={M.blackGlass()} />
      <Pull spec={{ dir: 'v', x: w * 0.22, y: y0 + h / 2, len: h - 6 }} z={d / 2} mat={M.steel()} />
      <Cyl r={1} h={0.2} pos={[0, y0 - 0.05, 2]} mat={M.bulb()} cast={false} />
    </group>
  );
}

function ShelfModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const y0 = product.elevationIn;
  const rng = mulberry32(hashString(r.item.id));
  const decor: JSX.Element[] = [];
  let x = -w / 2 + 3;
  const top = y0 + 2;
  const ceramic = cached('shelfCeramic', () => new THREE.MeshPhysicalMaterial({ color: '#efe9dd', roughness: 0.3, clearcoat: 0.6 }));
  const terracotta = cached('shelfTerracotta', () => new THREE.MeshStandardMaterial({ color: '#b9694a', roughness: 0.8 }));
  const leaf = cached('shelfLeaf', () => new THREE.MeshStandardMaterial({ color: '#4f7a45', roughness: 0.7, flatShading: true }));
  while (x < w / 2 - 4) {
    const pick = rng();
    if (pick < 0.3) {
      decor.push(<group key={x}>{[0, 1, 2, 3, 4].map((p) => <Cyl key={p} r={4} h={0.35} pos={[x + 4, top + 0.2 + p * 0.38, -0.5]} mat={ceramic} seg={20} />)}</group>);
      x += 9;
    } else if (pick < 0.6) {
      decor.push(<Cyl key={x} r={1.8} h={6} pos={[x + 2, top + 3, 0]} mat={M.clearGlass()} seg={14} />);
      decor.push(<Cyl key={`${x}l`} r={1.9} h={0.8} pos={[x + 2, top + 6.4, 0]} mat={M.bark()} seg={14} />);
      x += 5;
    } else if (pick < 0.8) {
      decor.push(
        <group key={x}>
          <Cyl r={2.2} rb={1.7} h={3.5} pos={[x + 2.5, top + 1.75, 0]} mat={terracotta} seg={14} />
          <mesh position={[x + 2.5, top + 5.5, 0]} material={leaf} castShadow>
            <icosahedronGeometry args={[3, 0]} />
          </mesh>
        </group>,
      );
      x += 7;
    } else {
      const spine = ['#8a3b2b', '#2f4b5e', '#cdb892'][Math.floor(rng() * 3)];
      decor.push(<Box key={x} size={[1.4, 9, 6.5]} pos={[x + 1, top + 4.5, -0.8]} mat={cached(`book${spine}`, () => new THREE.MeshStandardMaterial({ color: spine, roughness: 0.8 }))} />);
      x += 3;
    }
    x += 2;
  }
  return (
    <group>
      <Box size={[w, 2, d]} pos={[0, y0 + 1, 0]} mat={finishMaterial(finish)} />
      {decor}
    </group>
  );
}

function StoolModel({ r, finish }: ModelProps) {
  const { product } = r;
  const seatMat = finishMaterial(finish);
  const legMat = finish.material === 'wood' ? seatMat : M.castIron();
  if (product.variant === 'backed') {
    return (
      <group>
        {[45, 135, 225, 315].map((a) => {
          const rad = (a * Math.PI) / 180;
          return <Cyl key={a} r={0.45} h={24} pos={[Math.cos(rad) * 6, 12, Math.sin(rad) * 6]} mat={M.castIron()} seg={8} />;
        })}
        <mesh position={[0, 9, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.castIron()} castShadow>
          <torusGeometry args={[6, 0.3, 6, 32]} />
        </mesh>
        <RoundedBox args={[17, 3.2, 16]} radius={1.4} smoothness={3} position={[0, 25.4, 0.5]} material={seatMat} castShadow receiveShadow />
        <mesh geometry={stoolShell} position={[0, 32, 0]} material={doubleSided(finish)} castShadow dispose={null} />
      </group>
    );
  }
  return (
    <group>
      {[45, 135, 225, 315].map((a) => {
        const rad = (a * Math.PI) / 180;
        return <Cyl key={a} r={0.6} rb={0.5} h={24.5} pos={[Math.cos(rad) * 5.3, 12.25, Math.sin(rad) * 5.3]} mat={legMat} seg={10} />;
      })}
      <mesh position={[0, 9, 0]} rotation={[Math.PI / 2, 0, 0]} material={legMat} castShadow>
        <torusGeometry args={[5.4, 0.35, 6, 32]} />
      </mesh>
      <Cyl r={7.4} h={1.6} pos={[0, 25.2, 0]} mat={seatMat} seg={28} />
    </group>
  );
}

function ChairModel({ r, finish }: ModelProps) {
  const { w, d } = r;
  const mat = finishMaterial(finish);
  return (
    <group>
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.7} h={17} pos={[sx * (w / 2 - 2), 8.5, sz * (d / 2 - 2.5)]} mat={mat} seg={10} />))}
      <RoundedBox args={[w - 1, 1.6, d - 3]} radius={0.7} smoothness={3} position={[0, 17.6, 1]} material={mat} castShadow receiveShadow />
      {Array.from({ length: 5 }).map((_, i) => (
        <Cyl key={i} r={0.35} h={13} pos={[-w / 2 + 3 + ((w - 6) / 4) * i, 24.8, -d / 2 + 1.6]} mat={mat} seg={8} />
      ))}
      <Box size={[w - 1, 2.4, 1.3]} pos={[0, 31.6, -d / 2 + 1.6]} mat={mat} />
    </group>
  );
}

function TableModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const mat = finishMaterial(finish);
  if (product.variant === 'round') {
    return (
      <group>
        <Cyl r={w / 2} h={1.5} pos={[0, 29.25, 0]} mat={mat} seg={48} />
        <Cyl r={2.6} rb={3.4} h={26} pos={[0, 15.5, 0]} mat={mat} seg={20} />
        <Cyl r={9} rb={10} h={2.5} pos={[0, 1.25, 0]} mat={mat} seg={32} />
      </group>
    );
  }
  return (
    <group>
      <Box size={[w, 1.6, d]} pos={[0, 29.2, 0]} mat={mat} />
      <Box size={[w - 8, 3.5, d - 8]} pos={[0, 26.6, 0]} mat={mat} />
      {[-1, 1].map((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={1.4} rb={1} h={28.4} pos={[sx * (w / 2 - 4), 14.2, sz * (d / 2 - 4)]} mat={mat} seg={12} />))}
    </group>
  );
}

const stoolShell = new THREE.CylinderGeometry(8.5, 8.5, 9, 24, 1, true, Math.PI - 1, 2);
const domeGeo = new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
const coneGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);

function PendantModel({ r, finish, ctx, lightOn }: ModelProps) {
  const { w, product } = r;
  const y0 = product.elevationIn;
  const h = product.heightIn;
  const v = product.variant;
  const top = y0 + h;
  const cord = Math.max(0, ctx.ceiling - top);
  const shadeMat = finishMaterial(finish);
  const canopyMat = finish.material === 'metal' ? shadeMat : M.brass();
  const woven = useMemo(() => {
    if (v !== 'woven') return null;
    return cached(`woven:${finish.hex}`, () => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      for (let i = -64; i < 128; i += 12) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 64, 64);
        g.moveTo(i + 64, 0);
        g.lineTo(i, 64);
        g.stroke();
      }
      const alpha = new THREE.CanvasTexture(c);
      alpha.wrapS = alpha.wrapT = THREE.RepeatWrapping;
      alpha.repeat.set(10, 4);
      return new THREE.MeshStandardMaterial({ color: finish.hex, alphaMap: alpha, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    });
  }, [v, finish.hex]);

  const light = lightOn ? <pointLight position={[0, y0 - 1, 0]} intensity={v === 'linear' ? 26 : 16} distance={16} decay={2} color="#ffcf8f" /> : null;

  if (v === 'linear') {
    return (
      <group>
        {[-1, 1].map((s) => (
          <group key={s}>
            <Cyl r={0.12} h={cord} pos={[s * (w / 2 - 5), top + cord / 2, 0]} mat={M.cord()} seg={6} cast={false} />
            <Cyl r={1.8} h={0.6} pos={[s * (w / 2 - 5), ctx.ceiling - 0.3, 0]} mat={canopyMat} seg={16} />
          </group>
        ))}
        <Box size={[w, h - 0.6, 4]} pos={[0, y0 + (h - 0.6) / 2 + 0.6, 0]} mat={shadeMat} />
        <Box size={[w - 2, 0.6, 3]} pos={[0, y0 + 0.3, 0]} mat={M.led()} cast={false} />
        {light}
      </group>
    );
  }

  const rad = w / 2;
  let shade: JSX.Element;
  if (v === 'globe') {
    shade = (
      <mesh position={[0, y0 + rad, 0]} material={shadeMat} castShadow={false}>
        <sphereGeometry args={[rad, 32, 20]} />
      </mesh>
    );
  } else if (v === 'cone') {
    shade = (
      <group position={[0, y0 + h / 2, 0]}>
        <mesh geometry={coneGeo} scale={[rad, h, rad]} material={shadeMat} castShadow dispose={null} />
        <mesh geometry={coneGeo} scale={[rad * 0.97, h * 0.99, rad * 0.97]} material={M.shadeInner()} dispose={null} />
      </group>
    );
  } else {
    shade = (
      <group position={[0, y0, 0]}>
        <mesh geometry={domeGeo} scale={[rad, h, rad]} material={woven ?? shadeMat} castShadow dispose={null} />
        {!woven && <mesh geometry={domeGeo} scale={[rad * 0.97, h * 0.97, rad * 0.97]} material={M.shadeInner()} dispose={null} />}
      </group>
    );
  }
  return (
    <group>
      <Cyl r={0.14} h={cord} pos={[0, top + cord / 2, 0]} mat={M.cord()} seg={6} cast={false} />
      <Cyl r={2.4} h={0.7} pos={[0, ctx.ceiling - 0.35, 0]} mat={canopyMat} seg={20} />
      <Cyl r={0.9} h={1.8} pos={[0, top - 0.9, 0]} mat={canopyMat} seg={12} />
      {shade}
      <mesh position={[0, v === 'globe' ? y0 + rad : y0 + Math.min(2.5, h * 0.3), 0]} material={M.bulb()}>
        <sphereGeometry args={[v === 'globe' ? 1.4 : 1.6, 16, 12]} />
      </mesh>
      {light}
    </group>
  );
}

function RugModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  return <mesh geometry={boxGeo(w, 0.35, d)} position={[0, 0.18, 0]} material={rugMaterial(finish.hex, product.variant ?? 'runner', r.item.id)} receiveShadow dispose={null} />;
}

function PlantModel({ r, finish }: ModelProps) {
  const { w, product } = r;
  const olive = product.variant === 'olive';
  const rng = useMemo(() => mulberry32(hashString(r.item.id)), [r.item.id]);
  const potMat = finishMaterial(finish);
  const potR = w * 0.3;
  const potH = olive ? 15 : 14;
  const leafMat = olive
    ? cached('olive', () => new THREE.MeshStandardMaterial({ color: '#8b9a74', roughness: 0.75, flatShading: true }))
    : cached('fig', () => new THREE.MeshPhysicalMaterial({ color: '#335f2e', roughness: 0.35, clearcoat: 0.4 }));
  const parts = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; rot: [number, number, number] }[] = [];
    if (olive) {
      for (let i = 0; i < 16; i++) {
        const a = rng() * Math.PI * 2;
        const rr = rng() * (w / 2 - 4);
        out.push({ p: [Math.cos(a) * rr, 40 + rng() * 20, Math.sin(a) * rr], s: [4 + rng() * 3.5, 3 + rng() * 3, 4 + rng() * 3.5], rot: [rng(), rng(), rng()] });
      }
    } else {
      for (let i = 0; i < 18; i++) {
        const a = i * 2.4;
        const y = 20 + (i / 18) * 30;
        const rr = 3 + rng() * 4;
        out.push({ p: [Math.cos(a) * rr, y, Math.sin(a) * rr], s: [3.4, 0.35, 5.2], rot: [0.5 + rng() * 0.4, -a + Math.PI / 2, 0] });
      }
    }
    return out;
  }, [olive, w, rng]);
  return (
    <group>
      <Cyl r={potR} rb={potR * 0.78} h={potH} pos={[0, potH / 2, 0]} mat={potMat} seg={24} />
      <Cyl r={potR * 0.92} h={0.3} pos={[0, potH - 0.6, 0]} mat={M.soil()} seg={20} cast={false} />
      <Cyl r={olive ? 0.9 : 0.6} rb={olive ? 1.3 : 0.8} h={olive ? 32 : 36} pos={[0, potH + (olive ? 16 : 18), 0]} mat={M.bark()} seg={8} />
      {parts.map((pt, i) => (
        <mesh key={i} position={pt.p} scale={pt.s} rotation={pt.rot} material={leafMat} castShadow>
          {olive ? <icosahedronGeometry args={[1, 1]} /> : <sphereGeometry args={[1, 12, 8]} />}
        </mesh>
      ))}
    </group>
  );
}

/** A product that isn't available (unpublished, or not loaded yet): a translucent box that holds its place. */
function MissingModel({ r }: ModelProps) {
  const h = Math.max(1, r.z1 - r.z0);
  const mat = cached('missing-product', () => new THREE.MeshStandardMaterial({ color: '#d9d4cb', roughness: 0.9, transparent: true, opacity: 0.6 }));
  return <Box size={[r.w, h, r.d]} pos={[0, r.z0 + h / 2, 0]} mat={mat} />;
}

export function renderModel(p: ModelProps): JSX.Element | null {
  if (p.r.product.source === 'missing') return <MissingModel {...p} />;
  switch (p.r.product.kind) {
    case 'base':
      return <BaseModel {...p} />;
    case 'corner':
      return <CornerModel {...p} />;
    case 'wall':
      return <WallCabModel {...p} />;
    case 'tall':
      return <TallModel {...p} />;
    case 'oven-tower':
      return <OvenTowerModel {...p} />;
    case 'island':
      return <IslandModel {...p} />;
    case 'sink':
      return <SinkModel {...p} />;
    case 'dishwasher':
      return <DishwasherModel {...p} />;
    case 'wine':
      return <WineModel {...p} />;
    case 'range':
      return <RangeModel {...p} />;
    case 'fridge':
      return <FridgeModel {...p} />;
    case 'hood':
      return <HoodModel {...p} />;
    case 'microwave':
      return <MicrowaveModel {...p} />;
    case 'shelf':
      return <ShelfModel {...p} />;
    case 'stool':
      return <StoolModel {...p} />;
    case 'chair':
      return <ChairModel {...p} />;
    case 'table':
      return <TableModel {...p} />;
    case 'pendant':
      return <PendantModel {...p} />;
    case 'rug':
      return <RugModel {...p} />;
    case 'plant':
      return <PlantModel {...p} />;
    default:
      return null;
  }
}
