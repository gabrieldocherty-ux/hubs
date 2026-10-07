import { memo, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { PlacedItem, Room, Surfaces } from '../../types';
import { useDesignStore, type CameraPreset } from '../../store/useDesignStore';
import { useReport, useResolvedItems } from '../../store/derived';
import { useCatalogVersion } from '../../store/useCatalog';
import { getProduct, isOpening } from '../../data/catalog';
import { placeAtClient, usePlacement } from '../../lib/interaction';
import { resolve } from '../../lib/geometry';
import { resolveFinish } from '../../lib/finish';
import { registerExporter } from '../../lib/exporters';
import { QA, qaExpose } from '../../lib/qa';
import { renderModel } from './models';
import { Room3D } from './Room3D';
import { SelectionEdges } from './SelectionEdges';
import type { SceneCtx } from './parts';
import { useSceneCtx } from './sceneCtx';
import { assignPendantLights, MAX_LIGHTS } from './lightPool';
import { FrameGovernor, QaStats, RoomEffects, qaSet } from './roomEffects';
import { renderRoomStill, roomMaxSide, studioBusy } from './roomStill';
import { modelsSettled } from './gltf';
import { presetFor, FOV } from './cameraPresets';
import { InteractDrag } from './InteractDrag';
import { InteractOverlay, markActiveView } from './InteractOverlay';
import { registerStillRenderer, useRoomQuality, type StillOptions } from '../../features/viewer/studio';
import '../../features/viewer/viewer.css';

export { MAX_LIGHTS };
const BG = '#efe8dc';

interface ItemProps {
  item: PlacedItem;
  surfaces: Surfaces;
  ctx: SceneCtx;
  selected: boolean;
  problem: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Bumps when the catalog registry changes, so `resolve` re-runs for the same item. */
  catalogVersion: number;
}

const Item3D = memo(function Item3D({ item, surfaces, ctx, selected, problem, onSelect, onHover, catalogVersion }: ItemProps) {
  const r = useMemo(() => resolve(item), [item, catalogVersion]);
  if (!r) return null;
  const finish = resolveFinish(item, r.product, surfaces);
  return (
    <group
      position={[item.x, 0, item.y]}
      rotation={[0, (-item.rotation * Math.PI) / 180, 0]}
      // InteractDrag finds the piece under a press by this tag.
      userData={{ itemId: item.id }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(item.id);
        if (!useDesignStore.getState().dragging) document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        onHover(null);
        if (!useDesignStore.getState().dragging) document.body.style.cursor = '';
      }}
    >
      {renderModel({ r, finish, ctx })}
      {(selected || problem) && <SelectionEdges w={r.w} d={r.d} y0={r.z0} h={Math.max(1, r.z1 - r.z0)} problem={problem} />}
    </group>
  );
});

function CameraRig({ room }: { room: Room }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, gl, invalidate } = useThree();
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
      invalidate();
      return;
    }
    anim.current = { p0: camera.position.clone(), p1: pos, t0: c.target.clone(), t1: target, t: 0 };
    // The canvas only renders on demand: start the tween's frames.
    invalidate();
  };

  useEffect(() => {
    go('overview', first.current);
    first.current = false;
  }, [room.widthIn, room.lengthIn, room.ceilingIn, Math.round(aspect * 10)]);

  useEffect(() => {
    if (request) go(request.preset);
  }, [request?.nonce]);

  useEffect(() => qaExpose({ camera, controls: controls.current, gl }), [camera, gl]);

  useFrame((_, dt) => {
    const a = anim.current;
    const c = controls.current;
    if (!a || !c) return;
    // The first frame after an idle gap reports a long dt; cap the step so the tween still eases.
    a.t = Math.min(1, a.t + Math.min(dt, 1 / 20) / 0.95);
    const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
    camera.position.lerpVectors(a.p0, a.p1, e);
    c.target.lerpVectors(a.t0, a.t1, e);
    c.update();
    if (a.t >= 1) anim.current = null;
    else invalidate();
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
  const gl = useThree((s) => s.gl);
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
    gl.shadowMap.needsUpdate = true;
  }, [W, L, span, gl]);
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

/**
 * The pendant lights: a fixed pool of MAX_LIGHTS point lights, mounted once. Pendants get a
 * light in the kitchen's item order; spare lights sit at intensity 0. Adding or removing a
 * pendant only moves a light or changes its intensity, so no material ever recompiles.
 * Lives inside the room's inch-scaled group, like the pendants themselves.
 */
function PendantLightPool({ items, catalogVersion }: { items: PlacedItem[]; catalogVersion: number }) {
  const slots = useMemo(() => {
    const pendants = [];
    for (const it of items) {
      const p = getProduct(it.productId);
      if (p?.kind === 'pendant' && p.source !== 'missing') pendants.push({ id: it.id, x: it.x, y: it.y, elevationIn: p.elevationIn, variant: p.variant });
    }
    return assignPendantLights(pendants, MAX_LIGHTS);
  }, [items, catalogVersion]);
  return (
    <>
      {slots.map((s, i) => (
        <pointLight key={i} position={s.pos} intensity={s.intensity} distance={16} decay={2} color="#ffcf8f" />
      ))}
    </>
  );
}

/** The shadow map renders only when something that casts or receives shadows changes. */
function ShadowSync({ deps }: { deps: unknown[] }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, deps);
  return null;
}

/**
 * Registers the offscreen still renderer (the Studio render dialog) and the TopBar's 3D PNG
 * export, which now uses the same path: a fixed 1920 × 1080 landscape image whatever the size of
 * the canvas on screen (it used to be half width from split view).
 */
function Stills({ room }: { room: Room }) {
  const get = useThree((s) => s.get);
  const roomRef = useRef(room);
  roomRef.current = room;
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
  });
  useEffect(() => {
    // Waits until the view has drawn `n` more frames (each step also gives up after 100 ms, so a
    // background tab, where requestAnimationFrame pauses, can't hang a render).
    const drawn = async (n: number) => {
      const target = frames.current + n;
      for (let i = 0; i < 40 && frames.current < target; i++) {
        get().invalidate();
        await new Promise((r) => {
          requestAnimationFrame(() => r(null));
          setTimeout(r, 100);
        });
      }
    };
    const render = async (o: StillOptions) => {
      // GLBs still loading show their procedural stand-in: wait for them (up to 8 s), then let the
      // view draw twice so the swap (and, on a fresh mount, the environment map) is in the frame.
      await Promise.race([modelsSettled(), new Promise((r) => setTimeout(r, 8000))]);
      await drawn(2);
      return renderRoomStill(get, o, roomRef.current, BG);
    };
    const maxSide = roomMaxSide(get().gl);
    registerStillRenderer({ render, maxSide });
    registerExporter('scene', async () => {
      const c = await render({ width: 1920, height: 1080, camera: 'current', quality: 'high', toneMap: useRoomQuality.getState().toneMap });
      return c.toDataURL('image/png');
    });
    const q = useRoomQuality.getState();
    qaSet({ viewer: { renderStill: render, maxSide, setToneMap: q.setToneMap, setQuality: q.setQuality } });
    return () => {
      registerStillRenderer(null);
      registerExporter('scene', undefined);
    };
  }, [get]);
  return null;
}

function Scene({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const room = useDesignStore((s) => s.doc.room);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const items = useDesignStore((s) => s.doc.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const select = useDesignStore((s) => s.select);
  const hover = useDesignStore((s) => s.hover);
  const setUI = useDesignStore((s) => s.setUI);
  const all = useResolvedItems();
  const report = useReport();
  const catalogVersion = useCatalogVersion();
  const ctx = useSceneCtx(surfaces, room);
  const onSelect = useMemo(
    () => (id: string) => {
      select(id);
      setUI({ rightTab: 'details' });
    },
    [select, setUI],
  );

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
          return (
            <Item3D
              key={it.id}
              item={it}
              surfaces={surfaces}
              ctx={ctx}
              selected={it.id === selectedId}
              problem={report.problemIds.has(it.id)}
              onSelect={onSelect}
              onHover={hover}
              catalogVersion={catalogVersion}
            />
          );
        })}
        <PendantLightPool items={items} catalogVersion={catalogVersion} />
      </group>
      <ShadowSync deps={[items, surfaces, room, catalogVersion]} />
      <CameraRig room={room} />
      <InteractDrag containerRef={containerRef} />
      <InteractOverlay />
      <Stills room={room} />
      <RoomEffects />
      <FrameGovernor busy={studioBusy} />
      {QA && <QaStats name="room" />}
    </>
  );
}

const PRODUCT_MIME = 'application/x-kitchen-product';

/** True on phones and tablets (no mouse), so the hint talks about fingers. */
function useCoarsePointer(): boolean {
  const query = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setCoarse(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return coarse;
}

function Hint({ coarse }: { coarse: boolean }) {
  const armedId = usePlacement((s) => s.armedProductId);
  const disarm = usePlacement((s) => s.disarm);
  const dragging = useDesignStore((s) => s.dragging);
  const armed = armedId ? getProduct(armedId) : undefined;
  if (armed) {
    return (
      <div className="scene-hud scene-hud--bl" role="status" style={{ maxWidth: 'calc(100% - 28px)', pointerEvents: 'auto' }}>
        <span>
          {coarse ? 'Tap' : 'Click'} the floor or a wall to place <strong>{armed.name}</strong>
        </span>
        <button className="btn" style={{ marginLeft: 8, padding: '3px 10px', fontSize: 12 }} onClick={disarm}>
          Cancel
        </button>
      </div>
    );
  }
  const text = dragging
    ? coarse
      ? 'Lift to drop it here'
      : 'Release to drop · Esc puts it back'
    : coarse
      ? 'Drag an item to move it · Drag to orbit · Pinch or two fingers to zoom and pan · Tap to select'
      : 'Drag an item to move it · Drag empty space to orbit · Scroll to zoom · Right-drag to pan · Click to select';
  return (
    <div className="scene-hud scene-hud--bl" style={{ maxWidth: 'calc(100% - 28px)' }}>
      {text}
    </div>
  );
}

/** Fast / High room quality (ambient occlusion off or on), remembered on this device. */
function QualityToggle() {
  const quality = useRoomQuality((s) => s.quality);
  const setQuality = useRoomQuality((s) => s.setQuality);
  const degraded = useRoomQuality((s) => s.degraded);
  return (
    <div className="scene-hud viewer-hud--tr">
      <div className="seg" role="group" aria-label="3D quality">
        {(
          [
            ['fast', 'Fast'],
            ['high', 'High'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={quality === id ? 'on' : ''}
            aria-pressed={quality === id}
            onClick={() => setQuality(id)}
            title={id === 'high' ? 'Soft contact shadows between everything (slower on older laptops)' : 'Quicker on older laptops'}
          >
            {label}
          </button>
        ))}
      </div>
      {degraded > 0 && quality === 'high' && <span className="viewer-hud-note">Lowered for speed</span>}
    </div>
  );
}

export function SceneView() {
  const select = useDesignStore((s) => s.select);
  const requestCamera = useDesignStore((s) => s.requestCamera);
  const armed = usePlacement((s) => s.armedProductId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();

  // Desktop catalog drags (HTML5 drag and drop) can land in 3D too, on the floor or a wall.
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(PRODUCT_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const productId = e.dataTransfer.getData(PRODUCT_MIME);
    if (!productId || !getProduct(productId)) return;
    e.preventDefault();
    markActiveView('3d');
    placeAtClient(productId, e.clientX, e.clientY);
  };

  return (
    <div className="scene-view" ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop} style={armed ? { cursor: 'copy' } : undefined}>
      <Canvas
        shadows
        // Renders only when something changes (a store update, the camera, a tween): idle costs nothing.
        frameloop="demand"
        dpr={[1, 1.5]}
        // Antialiasing comes from the composer's MSAA. The drawing buffer isn't preserved: stills
        // copy the canvas in the same task that renders it.
        gl={{ antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
        camera={{ fov: FOV, near: 0.2, far: 600, position: [20, 18, 30] }}
        onCreated={({ gl }) => {
          gl.shadowMap.autoUpdate = false;
          gl.shadowMap.needsUpdate = true;
        }}
        onPointerMissed={(e) => {
          if (e.type === 'click') select(null);
        }}
      >
        <Suspense fallback={null}>
          <Scene containerRef={wrapRef} />
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
      <QualityToggle />
      <Hint coarse={coarse} />
    </div>
  );
}
