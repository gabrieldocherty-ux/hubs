/**
 * GLB products (BUILD_PLAN A-T2, PRODUCT_SPEC §5.4).
 *
 *  - Loading: one GLTFLoader with Draco decoders served from /draco/ (never the gstatic CDN)
 *    and Meshopt inline. KTX2 is deliberately not wired. Each URL loads once; every placed
 *    instance gets its own `clone(true)`. When the last instance of a model unmounts, the
 *    cached scene's geometries, materials and textures are disposed after a short grace.
 *  - Failure: a load error never throws into React. The item simply keeps drawing its
 *    procedural model (also the Suspense fallback while loading), so a broken upload can't blank
 *    the scene. `ModelBoundary` additionally catches anything that throws while building the
 *    clone, and clears that URL from the cache so a later mount retries.
 *  - Fit: `fitTransform` (fit.ts) scales uniformly to the declared footprint, centres x/z and
 *    puts the lowest point on y = 0; the caller adds the elevation.
 *  - Slots: meshes whose material is named `mise_finish`, `mise_cabinet`, `mise_hardware` or
 *    `mise_counter` wear the chosen finish, the kitchen's cabinet finish, hardware or counter.
 *  - Shadows: only meshes larger than ~8″ cast; everything receives.
 */
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { DRACOLoader, GLTFLoader, MeshoptDecoder, type GLTF } from 'three-stdlib';
import * as THREE from 'three';
import type { Finish } from '../../types';
import { castsShadow, fitTransform, slotOf, type Dims, type Fit, type SlotName } from './fit';
import { finishMaterial } from './materials';
import type { SceneCtx } from './parts';

export const DRACO_PATH = '/draco/';

// Anything else in the app that uses drei's useGLTF also decodes locally.
useGLTF.setDecoderPath(DRACO_PATH);

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    loader.setDRACOLoader(draco);
    const meshopt = MeshoptDecoder as unknown;
    loader.setMeshoptDecoder(typeof meshopt === 'function' ? (meshopt as () => typeof MeshoptDecoder)() : MeshoptDecoder);
  }
  return loader;
}

interface Entry {
  status: 'loading' | 'ready' | 'error';
  promise: Promise<void>;
  gltf: GLTF | null;
  users: number;
  disposeTimer: number;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let cacheVersion = 0;
const emit = () => {
  cacheVersion++;
  listeners.forEach((l) => l());
};

/** Starts (or reuses) the load of a model URL. Never rejects. */
export function loadModel(url: string): Entry {
  let e = cache.get(url);
  if (e) return e;
  const entry: Entry = { status: 'loading', promise: Promise.resolve(), gltf: null, users: 0, disposeTimer: 0 };
  entry.promise = gltfLoader()
    .loadAsync(url)
    .then((g) => {
      entry.gltf = g;
      entry.status = 'ready';
    })
    .catch(() => {
      entry.status = 'error';
    })
    .finally(emit);
  cache.set(url, entry);
  e = entry;
  return e;
}

/** Resolves once no model is loading (a studio render waits for the GLBs before it draws). Never rejects. */
export async function modelsSettled(): Promise<void> {
  for (;;) {
    const pending = [...cache.values()].filter((e) => e.status === 'loading').map((e) => e.promise);
    if (!pending.length) return;
    await Promise.all(pending);
  }
}

function disposeScene(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      m.dispose();
    }
  });
}

/** Drops a URL from the cache (a failed load, or a boundary reset), so the next mount refetches. */
export function clearModel(url: string) {
  const e = cache.get(url);
  if (!e) return;
  window.clearTimeout(e.disposeTimer);
  cache.delete(url);
  if (e.gltf && e.users <= 0) disposeScene(e.gltf.scene);
  useGLTF.clear(url);
  emit();
}

function retain(url: string) {
  const e = cache.get(url);
  if (!e) return () => undefined;
  e.users++;
  window.clearTimeout(e.disposeTimer);
  return () => {
    e.users--;
    if (e.users > 0) return;
    // A short grace so a finish change or a re-mount (view switch) doesn't refetch.
    e.disposeTimer = window.setTimeout(() => {
      if (e.users > 0 || cache.get(url) !== e) return;
      cache.delete(url);
      if (e.gltf) disposeScene(e.gltf.scene);
    }, 30_000);
  };
}

/**
 * The loaded model for `url`: suspends while loading, returns null if it failed.
 * Subscribes to the cache so a retry elsewhere re-renders this one.
 */
export function useModel(url: string): GLTF | null {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cacheVersion,
  );
  const e = loadModel(url);
  useEffect(() => retain(url), [url]);
  if (e.status === 'loading') throw e.promise;
  return e.status === 'ready' ? e.gltf : null;
}

/** What the mise_* slots wear. Any slot left out keeps the model's own material. */
export type SlotMaterials = Partial<Record<SlotName, THREE.Material>>;

export function slotMaterials(finish: Finish, ctx: SceneCtx): SlotMaterials {
  return { finish: finishMaterial(finish), cabinet: finishMaterial(ctx.cabinet), hardware: ctx.hwMat, counter: ctx.counterMat };
}

interface Built {
  root: THREE.Object3D;
  fit: Fit;
  /** Meshes with a slot, and their original materials (per array index). */
  slotted: { mesh: THREE.Mesh; slots: (SlotName | null)[]; original: THREE.Material | THREE.Material[] }[];
}

function build(gltf: GLTF, target: Dims, shadowMinIn: number): Built {
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const fit = box.isEmpty()
    ? fitTransform({ min: [0, 0, 0], max: [0, 0, 0] }, target)
    : fitTransform({ min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] }, target);
  const slotted: Built['slotted'] = [];
  const mb = new THREE.Box3();
  const size = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mb.setFromObject(mesh).getSize(size).multiplyScalar(fit.scale);
    mesh.castShadow = castsShadow({ w: size.x, h: size.y, d: size.z }, shadowMinIn);
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slots = mats.map((m) => slotOf(m?.name));
    if (slots.some(Boolean)) slotted.push({ mesh, slots, original: mesh.material });
  });
  return { root, fit, slotted };
}

export interface GltfModelProps {
  url: string;
  /** The declared footprint the model is fitted to, inches. */
  target: Dims;
  slots: SlotMaterials;
  /** Drawn instead when the model can't load. */
  fallback: ReactNode;
  /** Meshes smaller than this (largest side, inches) don't cast shadows. */
  shadowMinIn?: number;
  /** Called once the model is in the scene (or has fallen back). */
  onReady?: (ok: boolean) => void;
}

/** The fitted, slot-mapped clone. Suspends while loading (wrap it in Suspense + ModelBoundary). */
function GltfInner({ url, target, slots, fallback, shadowMinIn = 8, onReady }: GltfModelProps) {
  const gltf = useModel(url);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const built = useMemo(() => (gltf ? build(gltf, target, shadowMinIn) : null), [gltf, target.w, target.h, target.d, shadowMinIn]);

  useLayoutEffect(() => {
    if (!built) return;
    for (const s of built.slotted) {
      const orig = Array.isArray(s.original) ? s.original : [s.original];
      const next = orig.map((m, i) => (s.slots[i] && slots[s.slots[i]!]) || m);
      s.mesh.material = Array.isArray(s.original) ? next : next[0];
    }
    invalidate();
  }, [built, slots.finish, slots.cabinet, slots.hardware, slots.counter, invalidate]);

  useEffect(() => {
    // A new mesh changes what casts shadows; the room's shadow map only updates on demand.
    gl.shadowMap.needsUpdate = true;
    invalidate();
    onReady?.(!!built);
  }, [built]);

  if (!built) return <>{fallback}</>;
  return (
    <group position={built.fit.offset} scale={built.fit.scale}>
      <primitive object={built.root} />
    </group>
  );
}

interface BoundaryProps {
  url: string;
  fallback: ReactNode;
  children: ReactNode;
  onReady?: (ok: boolean) => void;
}

/** Catches anything that throws while a model is built, shows the procedural fallback instead. */
export class ModelBoundary extends Component<BoundaryProps, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };

  static getDerivedStateFromError(): Partial<{ failed: string | null }> {
    return { failed: '__pending__' };
  }

  componentDidCatch() {
    clearModel(this.props.url);
    this.setState({ failed: this.props.url });
    this.props.onReady?.(false);
  }

  componentDidUpdate(prev: BoundaryProps) {
    // A different model (a new upload, another product): try again.
    if (prev.url !== this.props.url && this.state.failed) this.setState({ failed: null });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A GLB model with its procedural stand-in while it loads and if it fails. */
export function GltfModel(props: GltfModelProps) {
  return (
    <ModelBoundary url={props.url} fallback={props.fallback} onReady={props.onReady}>
      <Suspense fallback={props.fallback}>
        <GltfInner {...props} />
      </Suspense>
    </ModelBoundary>
  );
}
