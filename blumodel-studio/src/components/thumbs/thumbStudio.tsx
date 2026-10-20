/**
 * Catalog card pictures drawn from the product's own 3D model: the same procedural model the room
 * draws, in the kitchen's finishes, lit like the product page's stage (RoomEnvironment through
 * PMREM, Khronos PBR Neutral tone mapping, a warm key and a cool fill), on a soft contact shadow.
 *
 * One offscreen canvas and one WebGL context for the whole app (a detached react-three-fiber
 * root, frameloop 'never'), one product at a time from a queue, each result cached as an image
 * URL keyed on the product, its width and the finishes that change how it looks. A card asks only
 * once it is on screen (ProductThumb). Products with their own GLB keep their picture or drawing
 * (a GLB would have to download first), and anything this can't draw (no WebGL, an opening, a
 * model that throws) keeps the flat drawing: `thumbFor` resolves to null and is never retried.
 */
import { useLayoutEffect } from 'react';
import { createRoot, extend, useThree, type ReconcilerRoot } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PlacedItem, Product, Surfaces } from '../../types';
import type { Resolved } from '../../lib/geometry';
import { defaultFinishIndex, finishAt, resolveFinish } from '../../lib/finish';
import { isOpening } from '../../data/catalog';
import { makeSceneCtx } from '../three/sceneCtx';
import { proceduralModel } from '../three/models';
import { fitDistance, stageFrame } from '../../features/viewer/stageMath';

/** The card is 4:3; drawn at 2x a desktop card so it stays sharp on a phone's screen. */
export const THUMB_W = 320;
export const THUMB_H = 240;
const FOV = 26;
/** From the front, a little to the right and above: the three-quarter view a brand's own photos use. */
const VIEW = new THREE.Vector3(0.62, 0.48, 1).normalize();

/** Kinds this draws. Openings, lights and the like keep their drawing (a lone door frame or a pot light reads worse in 3D). */
const SKIP = new Set(['door', 'window', 'opening', 'walkway', 'pendant', 'recessed', 'outlet', 'switch']);

/** Only the finishes that change how a product looks: a new floor or paint doesn't redraw the catalog. */
function surfacesKey(s: Surfaces): string {
  return [s.cabinetFinishId, s.doorStyle, s.hardwareId, s.faucetId ?? '', s.countertopId, s.crown ?? ''].join('|');
}

export function canThumb(p: Product): boolean {
  if (p.thumbnailUrl || p.source === 'missing' || isOpening(p) || SKIP.has(p.kind)) return false;
  return !(p.model?.url);
}

interface Job {
  key: string;
  product: Product;
  surfaces: Surfaces;
  widthIn?: number;
  resolve: (url: string | null) => void;
}

const done = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
const queue: Job[] = [];
let broken = false;
let busy = false;
let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
let canvas: HTMLCanvasElement | null = null;
let three: { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
let envTarget: THREE.WebGLRenderTarget | null = null;

/** A cached picture for this product in these finishes, if one was already drawn. */
export function cachedThumb(product: Product, surfaces: Surfaces, widthIn?: number): string | null | undefined {
  return done.get(keyOf(product, surfaces, widthIn));
}

function keyOf(product: Product, surfaces: Surfaces, widthIn?: number) {
  return `${product.id}@${product.widthIn}x${product.depthIn}x${product.heightIn}|${widthIn ?? ''}|${Array.isArray(product.finishes) ? product.finishes.map((f) => f.hex).join(',') : product.finishes}|${surfacesKey(surfaces)}`;
}

/** The product drawn in 3D as an image URL, or null when it can't be. */
export function thumbFor(product: Product, surfaces: Surfaces, widthIn?: number): Promise<string | null> {
  if (broken || !canThumb(product)) return Promise.resolve(null);
  const key = keyOf(product, surfaces, widthIn);
  if (done.has(key)) return Promise.resolve(done.get(key) ?? null);
  const p = pending.get(key);
  if (p) return p;
  const promise = new Promise<string | null>((resolve) => {
    queue.push({ key, product, surfaces, widthIn, resolve });
  });
  pending.set(key, promise);
  void pump();
  return promise;
}

/** Puts a waiting request at the front (a card that just came on screen). */
export function hurryThumb(product: Product, surfaces: Surfaces, widthIn?: number) {
  const key = keyOf(product, surfaces, widthIn);
  const i = queue.findIndex((j) => j.key === key);
  if (i > 0) queue.unshift(...queue.splice(i, 1));
}

/** Drops waiting requests whose card has gone (the list was filtered or scrolled far away). */
export function forgetThumb(product: Product, surfaces: Surfaces, widthIn?: number) {
  const key = keyOf(product, surfaces, widthIn);
  const i = queue.findIndex((j) => j.key === key);
  if (i < 0) return;
  const [job] = queue.splice(i, 1);
  pending.delete(key);
  job.resolve(null);
}

function Capture() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    three = { gl, scene, camera };
  }, [gl, scene, camera]);
  return null;
}

function ThumbScene({ job, onMounted }: { job: Job; onMounted: () => void }) {
  const { product, surfaces, widthIn } = job;
  const w = widthIn ?? product.widthIn;
  const frame = stageFrame({ w, d: product.depthIn, h: product.heightIn, elevationIn: product.elevationIn, kind: product.kind });
  const at = finishAt(product, defaultFinishIndex(product, surfaces));
  const item: PlacedItem = { id: 'thumb', productId: product.id, x: 0, y: 0, rotation: 0, ...at, widthIn: w };
  const r: Resolved = { item, product, w, d: product.depthIn, box: { minX: -w / 2, minY: -product.depthIn / 2, maxX: w / 2, maxY: product.depthIn / 2 }, z0: product.elevationIn, z1: product.elevationIn + product.heightIn };
  const finish = resolveFinish(item, product, surfaces);
  const ctx = makeSceneCtx(surfaces, { ceilingIn: frame.ceilingIn });
  // Children mount before a parent's layout effect: the model is in the scene when this runs.
  useLayoutEffect(onMounted, [job.key]);
  return (
    <>
      <Capture />
      <ambientLight intensity={0.12} />
      <directionalLight position={[3.5, 7, 5]} intensity={1.15} color="#fff6ea" />
      <directionalLight position={[-5, 3, -2]} intensity={0.35} color="#e8eef8" />
      <group scale={1 / 12}>
        <group position={[0, frame.lift, 0]}>{proceduralModel({ r, finish, ctx })}</group>
      </group>
    </>
  );
}

function setUp(): boolean {
  if (root) return true;
  try {
    // <Canvas> registers three's classes for JSX; a bare root has to do it itself.
    extend(THREE as unknown as Parameters<typeof extend>[0]);
    canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    root = createRoot(canvas);
    root.configure({
      frameloop: 'never',
      dpr: 1,
      size: { width: THUMB_W, height: THUMB_H, top: 0, left: 0 },
      gl: { antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' },
      camera: { fov: FOV, near: 0.05, far: 100, position: [3, 2.5, 5] },
      events: undefined,
      onCreated: ({ gl, scene }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1;
        gl.setClearColor(0x000000, 0);
        const pmrem = new THREE.PMREMGenerator(gl);
        const room = new RoomEnvironment();
        envTarget = pmrem.fromScene(room, 0.04);
        room.dispose();
        pmrem.dispose();
        scene.environment = envTarget.texture;
      },
    });
    return true;
  } catch {
    broken = true;
    return false;
  }
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Draws the mounted product: framed on its bounding sphere, shadow first, then the render on top. */
function shoot(job: Job): string | null {
  if (!three) return null;
  const { gl, scene, camera } = three;
  const { product, widthIn } = job;
  const w = widthIn ?? product.widthIn;
  const f = stageFrame({ w, d: product.depthIn, h: product.heightIn, elevationIn: product.elevationIn, kind: product.kind });
  const { min, max } = f.box;
  const target = new THREE.Vector3((min[0] + max[0]) / 24, (min[1] + max[1]) / 24, (min[2] + max[2]) / 24);
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 24;
  camera.fov = FOV;
  camera.aspect = THUMB_W / THUMB_H;
  camera.position.copy(target).addScaledVector(VIEW, fitDistance(radius, FOV, THUMB_W / THUMB_H, 0.94));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  gl.setSize(THUMB_W, THUMB_H, false);
  gl.render(scene, camera);

  const out = document.createElement('canvas');
  out.width = THUMB_W;
  out.height = THUMB_H;
  const c = out.getContext('2d');
  if (!c) return null;
  // A soft shadow where the product meets the floor: the floor point under its centre, projected.
  const foot = new THREE.Vector3(target.x, (f.bottom - 0.2) / 12, target.z).project(camera);
  const edge = new THREE.Vector3(target.x + (max[0] - min[0]) / 24, (f.bottom - 0.2) / 12, target.z).project(camera);
  const cx = ((foot.x + 1) / 2) * THUMB_W;
  const cy = ((1 - foot.y) / 2) * THUMB_H;
  const rx = Math.max(12, Math.abs(((edge.x - foot.x) / 2) * THUMB_W) * 1.25);
  const ry = Math.max(4, rx * 0.22);
  c.save();
  c.translate(cx, cy);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(40, 32, 24, 0.32)');
  g.addColorStop(0.6, 'rgba(40, 32, 24, 0.12)');
  g.addColorStop(1, 'rgba(40, 32, 24, 0)');
  c.fillStyle = g;
  c.fillRect(-rx, -rx, rx * 2, rx * 2);
  c.restore();
  c.drawImage(gl.domElement, 0, 0);
  const webp = out.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      let url: string | null = null;
      if (!broken && setUp()) {
        try {
          let mounted!: () => void;
          const ready = new Promise<void>((r) => (mounted = r));
          root!.render(<ThumbScene key={job.key} job={job} onMounted={() => mounted()} />);
          await Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
          await frame();
          url = shoot(job);
        } catch {
          url = null;
        }
      }
      done.set(job.key, url);
      pending.delete(job.key);
      job.resolve(url);
      // Give the page a frame between pictures, so scrolling the catalog stays smooth.
      await frame();
    }
  } finally {
    busy = false;
  }
}
