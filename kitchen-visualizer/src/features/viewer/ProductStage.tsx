/**
 * The product stage (BUILD_PLAN A-T6, PRODUCT_SPEC §5.4): one product, colour-true, on its own
 * demand-driven canvas.
 *
 *  - Light: three's `RoomEnvironment` through PMREM (generated here, zero bytes, no network;
 *    disposed on unmount) plus a soft key and fill. Tone mapping is Khronos PBR Neutral, which
 *    keeps a brand's colours what the brand says they are.
 *  - Ground: `ContactShadows` rendered once (`frames={1}`), again only when the model or the
 *    width changes.
 *  - Camera: framed on the product's bounding sphere (stageMath.ts), so the turntable never
 *    turns any of it out of the picture. Auto-rotation stops for good at the first drag, pinch
 *    or wheel; it never starts for people who prefer reduced motion. Zoom is limited; no pan.
 *  - Models: built-ins draw through the same procedural models as the room (a synthetic
 *    `Resolved` + the default kitchen's scene context); GLB products through `GltfModel` with
 *    the procedural model as the loading and error fallback.
 *  - Glass: transparent glass materials are swapped for physical transmission here (only here;
 *    the room keeps cheap transparent glass).
 *  - Dimensions: W, D and H lines with ft-in and cm labels, on a layer the contact shadow
 *    doesn't see.
 *  - No drei `<Stage>`, no environment presets, nothing fetched from another host.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { ContactShadows, Html, Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Finish, PlacedItem, Product } from '../../types';
import type { Resolved } from '../../lib/geometry';
import type { ProductStageProps } from './index';
import { defaultFinishIndex, finishAt, finishById, resolveFinish } from '../../lib/finish';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { isOpening } from '../../data/catalog';
import { feetInches } from '../../lib/format';
import { QA } from '../../lib/qa';
import { makeSceneCtx } from '../../components/three/sceneCtx';
import { proceduralModel } from '../../components/three/models';
import { OpeningModel } from '../../components/three/Room3D';
import { GltfModel, slotMaterials } from '../../components/three/gltf';
import type { SceneCtx } from '../../components/three/parts';
import { QaStats, qaSet } from '../../components/three/qaStats';
import { dimOffsets, dimText, fitDistance, framedForDims, stageCamera, stageFrame, type StageFrame } from './stageMath';
import './viewer.css';

const FOV = 30;
/** Dimension lines live on this layer: the main camera sees it, the contact shadow camera doesn't. */
const DIM_LAYER = 1;
const BACKDROP = { inner: '#fbf9f5', outer: '#e8e1d5' };

/** Renders the stage offscreen at `size` × `size` px (square) without the dimension lines. */
export type StageStill = (size: number) => Promise<HTMLCanvasElement>;

export interface StageViewProps extends ProductStageProps {
  /** The width option to draw (inches); the product's default width when left out. */
  widthIn?: number;
  /** Receives the offscreen still renderer once the stage is up (null when it goes). */
  onStill?: (render: StageStill | null) => void;
  className?: string;
}

/** The placed item and resolved geometry a model needs, for a product shown on its own. */
export function stageItem(product: Product, finishId: string | undefined, widthIn: number | undefined): { r: Resolved; finish: Finish } {
  const w = widthIn ?? product.widthIn;
  const d = product.depthIn;
  const at = finishId ? finishById(product, finishId) : finishAt(product, defaultFinishIndex(product, DEFAULT_SURFACES));
  const item: PlacedItem = { id: 'stage', productId: product.id, x: 0, y: 0, rotation: 0, ...at, widthIn: w };
  const r: Resolved = {
    item,
    product,
    w,
    d,
    box: { minX: -w / 2, minY: -d / 2, maxX: w / 2, maxY: d / 2 },
    z0: product.elevationIn,
    z1: product.elevationIn + product.heightIn,
  };
  return { r, finish: resolveFinish(item, product, DEFAULT_SURFACES) };
}

function prefersReducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ── light ────────────────────────────────────────────────────────────────

function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = target.texture;
    invalidate();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

// ── glass ────────────────────────────────────────────────────────────────

/**
 * Swaps the room's cheap transparent glass for physical transmission on this stage's meshes.
 * Runs before each (on-demand) frame, so a re-render that puts the shared material back is
 * corrected before it is drawn. Shared materials are never changed; the stage's own copies are
 * disposed with it.
 */
function GlassUpgrade({ root }: { root: RefObject<THREE.Object3D> }) {
  const made = useMemo(() => new Map<THREE.Material, THREE.MeshPhysicalMaterial>(), []);
  useEffect(
    () => () => {
      made.forEach((m) => m.dispose());
      made.clear();
    },
    [made],
  );
  useFrame(() => {
    root.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const src = mesh.material as THREE.MeshPhysicalMaterial;
      if (!src?.isMeshPhysicalMaterial || !src.transparent || src.transmission > 0 || src.opacity >= 0.97) return;
      let glass = made.get(src);
      if (!glass) {
        glass = new THREE.MeshPhysicalMaterial({
          color: src.color.clone().lerp(new THREE.Color('#ffffff'), src.opacity < 0.5 ? 0.6 : 0),
          roughness: Math.min(src.roughness, 0.06),
          metalness: 0,
          transmission: 1,
          thickness: 0.25,
          ior: 1.5,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          side: src.side,
        });
        made.set(src, glass);
      }
      mesh.material = glass;
    });
  }, -2);
  return null;
}

// ── the product ──────────────────────────────────────────────────────────

function StageModel({ r, finish, ctx, onModel }: { r: Resolved; finish: Finish; ctx: SceneCtx; onModel: (ok: boolean) => void }) {
  const { product } = r;
  const url = product.source !== 'missing' ? product.model?.url : undefined;
  const procedural = isOpening(product) ? <OpeningModel r={r} surfaces={DEFAULT_SURFACES} ctx={ctx} bare /> : proceduralModel({ r, finish, ctx });
  const target = useMemo(() => ({ w: r.w, h: product.heightIn, d: product.depthIn }), [r.w, product.heightIn, product.depthIn]);
  const slots = useMemo(() => slotMaterials(finish, ctx), [finish.id, finish.hex, finish.material, ctx]);
  useEffect(() => {
    if (!url) onModel(true);
  }, [url]);
  if (!url) return procedural;
  return (
    <group position={[0, product.elevationIn, 0]}>
      <GltfModel url={url} target={target} slots={slots} onReady={onModel} fallback={<group position={[0, -product.elevationIn, 0]}>{procedural}</group>} />
    </group>
  );
}

// ── dimensions ───────────────────────────────────────────────────────────

type P3 = [number, number, number];

function Dimensions({ frame, w, d, h }: { frame: StageFrame; w: number; d: number; h: number }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const { off, tick } = dimOffsets(w, d);
  const y = frame.bottom + 0.3;
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  const zf = z1 + off; // the width line, in front
  const xr = x1 + off; // the depth line, on the right
  const xl = x0 - off; // the height line, front left
  const yb = frame.bottom;
  const yt = frame.bottom + h;
  const segs: P3[] = useMemo(
    () => [
      // W: across the front, with end ticks
      [x0, y, zf], [x1, y, zf],
      [x0, y, zf - tick], [x0, y, zf + tick],
      [x1, y, zf - tick], [x1, y, zf + tick],
      // D: along the right side
      [xr, y, z0], [xr, y, z1],
      [xr - tick, y, z0], [xr + tick, y, z0],
      [xr - tick, y, z1], [xr + tick, y, z1],
      // H: up the front left corner
      [xl, yb, z1], [xl, yt, z1],
      [xl - tick, yb, z1], [xl + tick, yb, z1],
      [xl - tick, yt, z1], [xl + tick, yt, z1],
    ],
    [x0, x1, z0, z1, zf, xr, xl, y, yb, yt, tick],
  );
  useEffect(() => {
    camera.layers.enable(DIM_LAYER);
    group.current?.traverse((o) => o.layers.set(DIM_LAYER));
    invalidate();
  }, [camera, invalidate, segs]);
  return (
    <group ref={group} name="stage-dims">
      <Line points={segs} segments color="#c2542d" lineWidth={1.6} depthTest={false} renderOrder={10} />
      <Html position={[0, y, zf + tick * 1.6]} center className="stage-dim" zIndexRange={[5, 0]}>
        <b>W</b> {dimText(w, feetInches)}
      </Html>
      <Html position={[xr + tick * 1.6, y, 0]} center className="stage-dim" zIndexRange={[5, 0]}>
        <b>D</b> {dimText(d, feetInches)}
      </Html>
      <Html position={[xl - tick * 1.6, (yb + yt) / 2, z1]} center className="stage-dim" zIndexRange={[5, 0]}>
        <b>H</b> {dimText(h, feetInches)}
      </Html>
    </group>
  );
}

// ── camera ───────────────────────────────────────────────────────────────

function CameraRig({ frame, autoRotate, onInteract }: { frame: StageFrame; autoRotate: boolean; onInteract: () => void }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = size.width / Math.max(1, size.height);
  const aspectKey = Math.round(aspect * 20);
  const cam = useMemo(() => stageCamera(frame, FOV, aspectKey / 20), [frame, aspectKey]);

  useLayoutEffect(() => {
    camera.fov = FOV;
    camera.near = Math.max(0.02, cam.radius / 50);
    camera.far = cam.distance * 8 + 10;
    camera.position.set(...cam.position);
    camera.updateProjectionMatrix();
    const c = controls.current;
    if (c) {
      c.target.set(...cam.target);
      c.update();
    }
    invalidate();
  }, [cam, camera, invalidate]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.09}
      autoRotate={autoRotate}
      autoRotateSpeed={1.1}
      minDistance={cam.minDistance}
      maxDistance={cam.maxDistance}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI / 2 - 0.03}
      onStart={onInteract}
    />
  );
}

// ── stills ───────────────────────────────────────────────────────────────

function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.75);
  g.addColorStop(0, BACKDROP.inner);
  g.addColorStop(1, BACKDROP.outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * A square still at `size` px from the current turntable angle, framed for a square: the drawing
 * buffer is resized (CSS untouched), rendered once, copied in the same task (the buffer isn't
 * preserved), then everything is put back.
 */
function renderStageStill(get: () => RootState, radius: number, size: number): HTMLCanvasElement {
  const state = get();
  const { gl, scene, invalidate } = state;
  const camera = state.camera as THREE.PerspectiveCamera;
  const controls = state.controls as unknown as OrbitControlsImpl | null;
  const target = controls?.target.clone() ?? new THREE.Vector3();
  const dims = scene.getObjectByName('stage-dims');
  const max = Math.min(4096, gl.capabilities.maxTextureSize);
  const px = Math.max(64, Math.min(Math.round(size), max));
  const saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), aspect: camera.aspect, pr: gl.getPixelRatio(), dims: dims?.visible ?? false };
  const out = document.createElement('canvas');
  out.width = out.height = px;
  try {
    if (dims) dims.visible = false;
    const dir = camera.position.clone().sub(target).normalize();
    camera.aspect = 1;
    camera.position.copy(target).addScaledVector(dir, fitDistance(radius, camera.fov, 1, 1.02));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    gl.setPixelRatio(1);
    gl.setSize(px, px, false);
    gl.render(scene, camera);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('This browser can’t make the image.');
    paintBackdrop(ctx, px, px);
    ctx.drawImage(gl.domElement, 0, 0, px, px);
  } finally {
    if (dims) dims.visible = saved.dims;
    camera.position.copy(saved.pos);
    camera.quaternion.copy(saved.quat);
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    gl.setPixelRatio(saved.pr);
    gl.setSize(state.size.width, state.size.height, false);
    invalidate();
  }
  return out;
}

function StillHook({ radius, onStill }: { radius: number; onStill?: (r: StageStill | null) => void }) {
  const get = useThree((s) => s.get);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  useEffect(() => {
    const render: StageStill = async (size) => renderStageStill(get, radiusRef.current, size);
    onStill?.(render);
    qaSet({
      stage: {
        get,
        renderStill: async (size: number) => {
          const c = await render(size);
          return { width: c.width, height: c.height };
        },
      },
    });
    return () => onStill?.(null);
  }, [get, onStill]);
  return null;
}

/** Calls `onReady` after the first frame drawn with the model in place (or its fallback). */
function ReadySignal({ ready, onReady }: { ready: boolean; onReady: () => void }) {
  const fired = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (ready) invalidate();
  }, [ready, invalidate]);
  useFrame(() => {
    if (!ready || fired.current) return;
    fired.current = true;
    requestAnimationFrame(() => onReady());
  });
  return null;
}

// ── the stage ────────────────────────────────────────────────────────────

interface SceneProps {
  product: Product;
  finishId?: string;
  widthIn?: number;
  showDims: boolean;
  autoRotate: boolean;
  onReady: () => void;
  onStill?: (r: StageStill | null) => void;
}

function StageScene({ product, finishId, widthIn, showDims, autoRotate, onReady, onStill }: SceneProps) {
  const { r, finish } = useMemo(() => stageItem(product, finishId, widthIn), [product, finishId, widthIn]);
  const frame = useMemo(
    () => stageFrame({ w: r.w, d: product.depthIn, h: product.heightIn, elevationIn: product.elevationIn, kind: product.kind }),
    [r.w, product.depthIn, product.heightIn, product.elevationIn, product.kind],
  );
  const camFrame = useMemo(() => framedForDims(frame, r.w, product.depthIn), [frame, r.w, product.depthIn]);
  const ctx = useMemo(() => makeSceneCtx(DEFAULT_SURFACES, { ceilingIn: frame.ceilingIn }), [frame.ceilingIn]);
  const url = (product.source !== 'missing' && product.model?.url) || null;
  const [model, setModel] = useState<{ url: string | null; ok: boolean } | null>(null);
  const modelReady = model !== null && model.url === url;
  const [spin, setSpin] = useState(() => autoRotate && !prefersReducedMotion());
  const content = useRef<THREE.Group>(null);
  // Stills leave the dimension lines out, so they frame the product alone (tighter).
  const { min, max } = frame.box;
  const stillRadius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 24;
  const span = Math.max(r.w, product.depthIn) / 12;

  useEffect(() => setSpin(autoRotate && !prefersReducedMotion()), [autoRotate]);

  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={0.12} />
      <directionalLight position={[3.5, 7, 5]} intensity={1.15} color="#fff6ea" />
      <directionalLight position={[-5, 3, -2]} intensity={0.35} color="#e8eef8" />
      <group scale={1 / 12}>
        <group ref={content} position={[0, frame.lift, 0]}>
          <StageModel r={r} finish={finish} ctx={ctx} onModel={(ok) => setModel({ url, ok })} />
        </group>
        {showDims && <Dimensions frame={frame} w={r.w} d={product.depthIn} h={product.heightIn} />}
      </group>
      <ContactShadows
        // Drawn once; again when the model arrives or the size changes.
        key={`${product.id}:${r.w}:${modelReady ? String(model?.ok) : 'loading'}`}
        frames={1}
        // Just under the floor: drei blurs on a plane at y = 0 seen from the shadow camera, so the
        // camera must sit below it (at +0.002 the blur pass was clipped and the shadow came out empty).
        position={[0, -0.02, 0]}
        scale={Math.max(2, span * 2.4)}
        far={Math.max(1, (frame.top + 4) / 12)}
        blur={2.6}
        opacity={0.5}
        resolution={1024}
        color="#3a3127"
      />
      <GlassUpgrade root={content} />
      <CameraRig frame={camFrame} autoRotate={spin} onInteract={() => setSpin(false)} />
      <StillHook radius={stillRadius} onStill={onStill} />
      <ReadySignal key={url ?? product.id} ready={modelReady} onReady={onReady} />
      {QA && <QaStats name="stage" />}
    </>
  );
}

/** The stage with the page-only extras (the chosen width, the still for Download image). */
export function StageView({ product, finishId, widthIn, autoRotate = true, showDims = false, height = 360, onReady, onStill, className = '' }: StageViewProps) {
  const [ready, setReady] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => setReady(false), [product.id, product.model?.url]);
  return (
    <div
      className={`product-stage ${className}`}
      style={{ height }}
      data-ready={ready ? '1' : undefined}
      role="img"
      aria-label={`3D view of ${product.name}. Drag to turn it; scroll or pinch to zoom.`}
    >
      <Canvas
        // Renders only when something changes (the turntable, a drag, a finish): idle is free.
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
        camera={{ fov: FOV, near: 0.05, far: 100, position: [3, 2.5, 5] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Suspense fallback={null}>
          <StageScene
            product={product}
            finishId={finishId}
            widthIn={widthIn}
            showDims={showDims}
            autoRotate={autoRotate}
            onStill={onStill}
            onReady={() => {
              setReady(true);
              readyRef.current?.();
            }}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** The public stage (BUILD_PLAN §3.8): other packages embed it (brand and contractor previews). */
export default function ProductStage(props: ProductStageProps) {
  return <StageView {...props} />;
}
