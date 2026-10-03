import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { PlacedItem, Room, Surfaces } from '../../types';
import { useDesignStore, type CameraPreset } from '../../store/useDesignStore';
import { useReport, useResolvedItems } from '../../store/derived';
import { COUNTERTOPS, HARDWARE, PAINTS, byId, resolveBacksplash } from '../../data/finishes';
import { getProduct, isOpening } from '../../data/catalog';
import { resolve } from '../../lib/geometry';
import { resolveFinish, cabinetFinish } from '../../lib/finish';
import { registerExporter } from '../../lib/exporters';
import { hardwareMaterial, surfaceMaterial } from './materials';
import { renderModel } from './models';
import { Room3D } from './Room3D';
import { SelectionEdges } from './SelectionEdges';
import type { SceneCtx } from './parts';

const MAX_LIGHTS = 6;
const BG = '#efe8dc';

function useSceneCtx(surfaces: Surfaces, room: Room): SceneCtx {
  return useMemo(() => {
    const ct = byId(COUNTERTOPS, surfaces.countertopId);
    const counter = surfaceMaterial(`counter:${ct.id}`, ct.pattern, ct.gloss);
    const bs = resolveBacksplash(surfaces.backsplashId, surfaces.countertopId);
    const splash = surfaceMaterial(`splash:${bs.id}:${ct.id}`, bs.pattern, bs.gloss);
    const hw = byId(HARDWARE, surfaces.hardwareId);
    return {
      counterMat: counter.mat,
      counterTile: counter.tileIn,
      counterIsStone: ct.pattern.type !== 'wood',
      splashMat: splash.mat,
      splashTile: splash.tileIn,
      cabinet: cabinetFinish(surfaces),
      doorStyle: surfaces.doorStyle,
      hwMat: hardwareMaterial(hw.hex, hw.roughness),
      ceiling: room.ceilingIn,
      paintHex: byId(PAINTS, surfaces.paintId).hex,
    };
  }, [surfaces, room.ceilingIn]);
}

interface ItemProps {
  item: PlacedItem;
  surfaces: Surfaces;
  ctx: SceneCtx;
  selected: boolean;
  problem: boolean;
  lightOn: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

const Item3D = memo(function Item3D({ item, surfaces, ctx, selected, problem, lightOn, onSelect, onHover }: ItemProps) {
  const r = useMemo(() => resolve(item), [item]);
  if (!r) return null;
  const finish = resolveFinish(item, r.product, surfaces);
  return (
    <group
      position={[item.x, 0, item.y]}
      rotation={[0, (-item.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(item.id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = '';
      }}
    >
      {renderModel({ r, finish, ctx, lightOn })}
      {(selected || problem) && <SelectionEdges w={r.w} d={r.d} y0={r.z0} h={Math.max(1, r.z1 - r.z0)} problem={problem} />}
    </group>
  );
});

const FOV = 38;

/** Pulls the camera back along `dir` until a sphere of `radius` fits the narrower of the two fields of view. */
function fitDistance(radius: number, aspect: number): number {
  const v = THREE.MathUtils.degToRad(FOV) / 2;
  const h = Math.atan(Math.tan(v) * aspect);
  return (radius / Math.sin(Math.min(v, h))) * 0.92;
}

function presetFor(preset: CameraPreset, room: Room, aspect: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const W = room.widthIn / 12;
  const L = room.lengthIn / 12;
  const H = room.ceilingIn / 12;
  const cx = W / 2;
  const cz = L / 2;
  switch (preset) {
    case 'eye':
      return { pos: new THREE.Vector3(W - 1.2, 4.9, L - 1.2), target: new THREE.Vector3(W * 0.3, 3.2, L * 0.18) };
    case 'top': {
      const target = new THREE.Vector3(cx, 0, cz);
      const d = fitDistance(Math.hypot(W, L) / 2, aspect);
      return { pos: target.clone().add(new THREE.Vector3(0, d, 0.01)), target };
    }
    case 'front': {
      const target = new THREE.Vector3(cx, H * 0.45, 0);
      const d = fitDistance(Math.hypot(W, H) / 2 + 1, aspect);
      return { pos: new THREE.Vector3(cx, H * 0.5, d), target };
    }
    case 'overview':
    default: {
      const target = new THREE.Vector3(cx, 2.4, cz);
      const dir = new THREE.Vector3(0.55, 0.78, 0.9).normalize();
      const d = fitDistance(Math.hypot(W, L, H * 0.6) / 2, aspect);
      return { pos: target.clone().addScaledVector(dir, d), target };
    }
  }
}

function CameraRig({ room }: { room: Room }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const request = useDesignStore((s) => s.cameraRequest);
  const anim = useRef<{ p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; t: number } | null>(null);
  const first = useRef(true);
  const aspect = size.width / Math.max(1, size.height);

  const go = (preset: CameraPreset, instant = false) => {
    const c = controls.current;
    if (!c) return;
    const { pos, target } = presetFor(preset, room, aspect);
    if (instant) {
      camera.position.copy(pos);
      c.target.copy(target);
      c.update();
      anim.current = null;
      return;
    }
    anim.current = { p0: camera.position.clone(), p1: pos, t0: c.target.clone(), t1: target, t: 0 };
  };

  useEffect(() => {
    go('overview', first.current);
    first.current = false;
  }, [room.widthIn, room.lengthIn, room.ceilingIn, Math.round(aspect * 10)]);

  useEffect(() => {
    if (request) go(request.preset);
  }, [request?.nonce]);

  useFrame((_, dt) => {
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    a.t = Math.min(1, a.t + dt / 0.95);
    const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
    camera.position.lerpVectors(a.p0, a.p1, e);
    c.target.lerpVectors(a.t0, a.t1, e);
    c.update();
    if (a.t >= 1) anim.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2 - 0.03}
      minDistance={2}
      maxDistance={120}
      onStart={() => (anim.current = null)}
    />
  );
}

function Lights({ room }: { room: Room }) {
  const W = room.widthIn / 12;
  const L = room.lengthIn / 12;
  const H = room.ceilingIn / 12;
  const span = Math.max(W, L);
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    s.target.position.set(W / 2, 0, L / 2);
    s.target.updateMatrixWorld();
    const cam = s.shadow.camera;
    cam.left = cam.bottom = -span * 0.95;
    cam.right = cam.top = span * 0.95;
    cam.near = 1;
    cam.far = span * 5;
    cam.updateProjectionMatrix();
  }, [W, L, span]);
  return (
    <>
      <hemisphereLight args={['#fff4e6', '#b7a58c', 0.6]} />
      <ambientLight intensity={0.14} />
      <directionalLight
        ref={sun}
        position={[W / 2 - span * 0.35, H + span * 1.1, L / 2 + span * 0.75]}
        intensity={2.3}
        color="#fff1dd"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[W / 2 + span, H * 0.6, L / 2 - span * 0.2]} intensity={0.45} color="#dfe9f5" />
      <pointLight position={[W / 2, H - 0.8, L / 2]} intensity={14} distance={span * 2.2} decay={1.6} color="#ffe6c4" />
    </>
  );
}

function Exporter() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    registerExporter('scene', async () => {
      gl.render(scene, camera);
      const src = gl.domElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(c.width / 2, c.height * 0.45, 0, c.width / 2, c.height * 0.45, Math.max(c.width, c.height) * 0.75);
      g.addColorStop(0, '#f7f2ea');
      g.addColorStop(1, BG);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, 0, 0);
      return c.toDataURL('image/png');
    });
    return () => registerExporter('scene', undefined);
  }, [gl, scene, camera]);
  return null;
}

function Scene() {
  const room = useDesignStore((s) => s.doc.room);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const items = useDesignStore((s) => s.doc.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const select = useDesignStore((s) => s.select);
  const hover = useDesignStore((s) => s.hover);
  const setUI = useDesignStore((s) => s.setUI);
  const all = useResolvedItems();
  const report = useReport();
  const ctx = useSceneCtx(surfaces, room);
  const onSelect = useMemo(
    () => (id: string) => {
      select(id);
      setUI({ rightTab: 'details' });
    },
    [select, setUI],
  );

  let lights = 0;
  return (
    <>
      <Lights room={room} />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#b9b0a3']} />
        <Lightformer form="rect" intensity={2.2} position={[0, 6, 9]} scale={[14, 5, 1]} color="#fff3e2" />
        <Lightformer form="rect" intensity={1.2} position={[-9, 4, 0]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} color="#e9f0ff" />
        <Lightformer form="rect" intensity={1.4} position={[9, 4, -2]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} color="#fff" />
        <Lightformer form="circle" intensity={2.5} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={6} color="#fff8ee" />
      </Environment>
      <group scale={1 / 12}>
        <Room3D room={room} all={all} surfaces={surfaces} ctx={ctx} selectedId={selectedId} problemIds={report.problemIds} onSelect={onSelect} onHover={hover} />
        {items.map((it) => {
          const p = getProduct(it.productId);
          if (!p || isOpening(p)) return null;
          const lightOn = p.kind === 'pendant' && lights++ < MAX_LIGHTS;
          return (
            <Item3D
              key={it.id}
              item={it}
              surfaces={surfaces}
              ctx={ctx}
              selected={it.id === selectedId}
              problem={report.problemIds.has(it.id)}
              lightOn={lightOn}
              onSelect={onSelect}
              onHover={hover}
            />
          );
        })}
      </group>
      <CameraRig room={room} />
      <Exporter />
    </>
  );
}

export function SceneView() {
  const select = useDesignStore((s) => s.select);
  const requestCamera = useDesignStore((s) => s.requestCamera);
  return (
    <div className="scene-view">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.02 }}
        camera={{ fov: FOV, near: 0.2, far: 600, position: [20, 18, 30] }}
        onPointerMissed={(e) => {
          if (e.type === 'click') select(null);
        }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <div className="scene-hud scene-hud--tl">
        <div className="seg">
          {(
            [
              ['overview', 'Overview'],
              ['eye', 'Eye level'],
              ['front', 'Elevation'],
              ['top', 'Top'],
            ] as [CameraPreset, string][]
          ).map(([id, label]) => (
            <button key={id} onClick={() => requestCamera(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="scene-hud scene-hud--bl">Drag to orbit · Scroll to zoom · Right-drag to pan · Click to select</div>
    </div>
  );
}
