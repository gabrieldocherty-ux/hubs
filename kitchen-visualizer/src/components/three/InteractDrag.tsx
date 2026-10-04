/**
 * Moving things directly in the 3D view, with a mouse or a finger.
 *
 *  - Press on a piece and drag: it slides under the pointer through the same store
 *    drag protocol (dragStart / dragMove / dragEnd) and snapping as the 2D plan, so
 *    it is one undo step. A press that doesn't travel past a few pixels is a click and
 *    only selects (Item3D / Room3D handle that through r3f as before).
 *  - Press on empty space still orbits; right-drag still pans; on touch, two fingers
 *    still pinch-zoom and pan, even when the first finger landed on a piece.
 *  - With a product armed for tap-to-place (usePlacement), a tap places it there.
 *  - Registers this view as the '3d' drop target for the catalog.
 *
 * Why a capture-phase listener: OrbitControls and r3f both listen on the canvas
 * wrapper. A pointerdown listener in the CAPTURE phase on the `.scene-view` ancestor
 * runs before either of them, raycasts, and switches the camera controls off before
 * they ever see a press that landed on a piece.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { PlacedItem, Product } from '../../types';
import { useDesignStore } from '../../store/useDesignStore';
import { getProduct, isOpening, snapsToWall } from '../../data/catalog';
import { boxesOverlap, overlap1D, resolve, resolveAll, type Resolved, type Wall } from '../../lib/geometry';
import { placeAt, registerDropTarget, useOverlay, usePlacement, worldToRoom, type RoomPoint } from '../../lib/interaction';
import { dragPlaneHeight, rayFromClient, rayToHorizontalPlane, roomPointUnderRay, toItemLocal } from './InteractMath';
import { markActiveView } from './InteractOverlay';
import { qaExpose } from '../../lib/qa';

const ACCENT = '#c2542d';
const BAD = '#d8412f';
/** Room3D's wall thickness, inches. */
const WALL_T = 5;
/** How far (client px) a press must travel before it becomes a drag rather than a click. */
const THRESHOLD = { mouse: 4, touch: 9 } as const;
/** Kinds the overlap check ignores, as in lib/geometry findOverlaps. */
const SOFT = new Set(['rug', 'stool', 'chair']);

type Mode = { kind: 'plane'; h: number } | { kind: 'surface' };

interface Press {
  pointerId: number;
  pointerType: string;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** The piece under the press, or null for empty space (the camera's press). */
  itemId: string | null;
  /** World point (feet) where the piece was grabbed. */
  grab: THREE.Vector3 | null;
  /**
   * pending: down, not moved yet (a click/tap so far). dragging: moving a piece.
   * camera: the press belongs to the camera (orbit / pinch), so it can't be a tap.
   */
  state: 'pending' | 'dragging' | 'camera' | 'done';
  armed: string | null;
  mode: Mode;
  offset: RoomPoint;
  captured: HTMLElement | null;
}

const rayHelper = new THREE.Raycaster();
const ndcHelper = new THREE.Vector2();

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

function taggedItem(o: THREE.Object3D | null): string | null {
  for (let n = o; n; n = n.parent) {
    const id = n.userData?.itemId;
    if (typeof id === 'string') return id;
  }
  return null;
}

/**
 * Doors and windows live in Room3D, untagged; find the one whose frame contains a
 * hit point. The box is the casing (w + 7), sill and apron, through the wall; a
 * door's open leaf also reaches into the room above the floor.
 */
function openingAt(world: THREE.Vector3, items: PlacedItem[]): string | null {
  for (const it of items) {
    const p = getProduct(it.productId);
    if (!p || !isOpening(p)) continue;
    const r = resolve(it);
    if (!r) continue;
    const l = toItemLocal(world, it);
    if (Math.abs(l.x) > r.w / 2 + 4.5) continue;
    if (l.y < r.z0 - 4.5 || l.y > r.z1 + 4.5) continue;
    const inFrame = l.z >= -WALL_T - 1 && l.z <= 4.5;
    const inSwing = p.kind === 'door' && l.z > 0 && l.z < r.w + 2 && l.y > 0.5;
    if (inFrame || inSwing) return it.id;
  }
  return null;
}

/** Wall-hung pieces and openings follow the wall/floor surface under the pointer; everything else a horizontal plane. */
function wallHung(p: Product): boolean {
  return isOpening(p) || (snapsToWall(p) && p.elevationIn >= 30);
}

export function overlapsOthers(r: Resolved, all: Resolved[]): boolean {
  if (SOFT.has(r.product.kind) || isOpening(r.product)) return false;
  return all.some(
    (o) =>
      o.item.id !== r.item.id &&
      !SOFT.has(o.product.kind) &&
      !isOpening(o.product) &&
      boxesOverlap(o.box, r.box) &&
      overlap1D(r.z0, r.z1, o.z0, o.z1) > 0.25,
  );
}

export function InteractDrag({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const get = useThree((s) => s.get);
  const [drag, setDrag] = useState<{ id: string; wall: Wall | null } | null>(null);
  const press = useRef<Press | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let replaying = false;
    let suppressClickUntil = 0;

    const controls = () => (get().controls as OrbitControlsImpl | null) ?? null;
    /** The element r3f and OrbitControls listen on (the canvas wrapper). */
    const wrap = (): HTMLElement => (get().events.connected as HTMLElement | undefined) ?? get().gl.domElement;

    /** Camera controls are off while a press holds a piece, or while any view is dragging one. */
    const syncControls = () => {
      const c = controls();
      if (!c) return;
      const p = press.current;
      const holding = !!p && !!p.itemId && (p.state === 'pending' || p.state === 'dragging');
      c.enabled = !holding && !useDesignStore.getState().dragging;
    };

    const canvasRect = () => get().gl.domElement.getBoundingClientRect();
    const rayAt = (cx: number, cy: number) => rayFromClient(get().camera, cx, cy, canvasRect());

    /** The room point under a client position for drops and taps: floor or the wall in view. */
    const toRoom = (cx: number, cy: number): RoomPoint | null => {
      const ray = rayAt(cx, cy);
      return ray ? roomPointUnderRay(ray, useDesignStore.getState().doc.room) : null;
    };

    const mapPoint = (mode: Mode, cx: number, cy: number): RoomPoint | null => {
      const ray = rayAt(cx, cy);
      if (!ray) return null;
      if (mode.kind === 'surface') return roomPointUnderRay(ray, useDesignStore.getState().doc.room, Infinity);
      const hit = rayToHorizontalPlane(ray, mode.h);
      return hit ? worldToRoom(hit.x, hit.z) : null;
    };

    /** The piece (and the point on it) under a client position: the nearest visible surface decides. */
    const pick = (cx: number, cy: number): { id: string; point: THREE.Vector3 } | null => {
      const { camera, scene } = get();
      const r = canvasRect();
      if (!(r.width > 0 && r.height > 0)) return null;
      ndcHelper.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      rayHelper.setFromCamera(ndcHelper, camera);
      const hits = rayHelper.intersectObjects(scene.children, true);
      const items = useDesignStore.getState().doc.items;
      for (const h of hits) {
        if (!(h.object as THREE.Mesh).isMesh || h.object.userData?.interactIgnore || !visibleChain(h.object)) continue;
        const id = taggedItem(h.object) ?? openingAt(h.point, items);
        return id && items.some((i) => i.id === id) ? { id, point: h.point.clone() } : null;
      }
      return null;
    };

    const applyMove = () => {
      raf = 0;
      const p = press.current;
      if (!p || p.state !== 'dragging' || !p.itemId) return;
      const q = mapPoint(p.mode, p.x, p.y);
      if (!q) return;
      const res = useDesignStore.getState().dragMove(p.itemId, q.x + p.offset.x, q.y + p.offset.y);
      if (res) setDrag((d) => (d && d.id === p.itemId && d.wall === res.wall ? d : { id: p.itemId!, wall: res.wall }));
    };

    const beginDrag = (p: Press) => {
      const s = useDesignStore.getState();
      const it = p.itemId ? s.doc.items.find((i) => i.id === p.itemId) : null;
      const product = it && getProduct(it.productId);
      if (!it || !product || !s.dragStart(it.id)) {
        p.state = 'camera';
        syncControls();
        return;
      }
      s.setUI({ rightTab: 'details' });
      const cam = get().camera;
      p.mode = wallHung(product) ? { kind: 'surface' } : { kind: 'plane', h: dragPlaneHeight(p.grab?.y ?? 0, cam.position.y) };
      // Keep the grab offset so the piece doesn't jump to put its centre under the pointer.
      const p0 = mapPoint(p.mode, p.x0, p.y0);
      p.offset = p0 ? { x: it.x - p0.x, y: it.y - p0.y } : { x: 0, y: 0 };
      p.state = 'dragging';
      const w = wrap();
      try {
        w.setPointerCapture(p.pointerId);
        p.captured = w;
        w.addEventListener('lostpointercapture', onLostCapture);
      } catch {
        p.captured = null;
      }
      document.body.style.cursor = 'grabbing';
      useOverlay.getState().set({ source: '3d', dragging: true });
      setDrag({ id: it.id, wall: null });
    };

    const removeWindowListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
    };

    /** Ends the press locally. Idempotent; the store side is the caller's job. */
    const finishPress = () => {
      const p = press.current;
      if (!p) return;
      const wasDragging = p.state === 'dragging' || p.state === 'done';
      p.state = 'done';
      press.current = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      removeWindowListeners();
      if (p.captured) {
        p.captured.removeEventListener('lostpointercapture', onLostCapture);
        try {
          if (p.captured.hasPointerCapture(p.pointerId)) p.captured.releasePointerCapture(p.pointerId);
        } catch {
          /* already released */
        }
      }
      if (wasDragging) {
        document.body.style.cursor = '';
        useOverlay.getState().set({ dragging: false });
      }
      setDrag(null);
      syncControls();
    };

    const endDrag = (commit: boolean) => {
      const p = press.current;
      if (!p) return;
      if (p.state === 'dragging') {
        if (commit) {
          if (raf) applyMove();
          p.state = 'done';
          useDesignStore.getState().dragEnd(p.itemId ?? undefined);
        } else {
          p.state = 'done';
          useDesignStore.getState().dragCancel();
        }
        suppressClickUntil = performance.now() + 600;
      }
      finishPress();
    };

    function onMove(e: PointerEvent) {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (p.state === 'pending') {
        const limit = p.pointerType === 'touch' ? THRESHOLD.touch : THRESHOLD.mouse;
        if (Math.hypot(p.x - p.x0, p.y - p.y0) < limit) return;
        if (!p.itemId) {
          p.state = 'camera';
          return;
        }
        beginDrag(p);
      }
      if (p.state === 'dragging') {
        if (e.cancelable) e.preventDefault();
        if (!raf) raf = requestAnimationFrame(applyMove);
      }
    }

    function onUp(e: PointerEvent) {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (p.state === 'dragging') {
        endDrag(true);
        return;
      }
      const armed = usePlacement.getState().armedProductId;
      if (p.state === 'pending' && p.armed && armed === p.armed) {
        const pt = toRoom(e.clientX, e.clientY);
        if (pt && placeAt(armed, pt.x, pt.y)) suppressClickUntil = performance.now() + 600;
      }
      finishPress();
    }

    function onCancel(e: PointerEvent) {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      endDrag(false);
    }

    function onLostCapture(e: PointerEvent) {
      const p = press.current;
      // A normal release ends the press before capture goes; anything else ends the drag where it is.
      if (p && e.pointerId === p.pointerId && p.state === 'dragging') endDrag(true);
    }

    function onBlur() {
      endDrag(true);
    }

    /** Hands a finger that was resting on a piece to OrbitControls, so a two-finger pinch still works. */
    const replayToControls = (p: Press) => {
      const target = (controls()?.domElement as HTMLElement | undefined) ?? wrap();
      replaying = true;
      try {
        target.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: p.pointerId,
            pointerType: p.pointerType,
            isPrimary: true,
            clientX: p.x,
            clientY: p.y,
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      } finally {
        replaying = false;
      }
    };

    const onDownCapture = (e: PointerEvent) => {
      if (replaying) return;
      const w = wrap();
      if (!(e.target instanceof Node) || !w.contains(e.target)) return; // HUD buttons etc.
      markActiveView('3d');
      // A primary pointer going down means no other pointer is down: any press still open
      // lost its pointerup (released outside the window, say). Close it before starting anew.
      if (press.current && (e.isPrimary || e.pointerId === press.current.pointerId)) endDrag(true);
      const p = press.current;
      if (p) {
        if (p.state === 'pending') {
          // A second finger: this is a pinch/pan, not a drag. Give the first finger to the camera too.
          const heldPiece = !!p.itemId;
          p.state = 'camera';
          syncControls();
          if (heldPiece) replayToControls(p);
        }
        return; // while dragging a piece, extra fingers are ignored
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return; // right/middle drag: camera pan
      if (!e.isPrimary) return;
      const hit = pick(e.clientX, e.clientY);
      press.current = {
        pointerId: e.pointerId,
        pointerType: e.pointerType === 'touch' ? 'touch' : 'mouse',
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        itemId: hit?.id ?? null,
        grab: hit?.point ?? null,
        state: 'pending',
        armed: usePlacement.getState().armedProductId,
        mode: { kind: 'plane', h: 0 },
        offset: { x: 0, y: 0 },
        captured: null,
      };
      // Before OrbitControls sees this event: a press on a piece must not orbit.
      if (hit) syncControls();
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onBlur);
    };

    /** Swallows the click that follows a drag or a placement, so r3f doesn't treat it as select / deselect. */
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        suppressClickUntil = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (press.current?.state === 'dragging') {
        e.stopPropagation();
        e.preventDefault();
        endDrag(false);
      }
    };

    container.addEventListener('pointerdown', onDownCapture, true);
    container.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKey, true);
    const unsub = useDesignStore.subscribe((s, prev) => {
      if (s.dragging === prev.dragging) return;
      // Undo or opening another kitchen mid-drag closes the store's drag; follow it.
      if (!s.dragging && press.current?.state === 'dragging') finishPress();
      syncControls();
    });
    const unregister = registerDropTarget('3d', container, toRoom);
    syncControls();
    // Headless checks (only with ?qa): read the camera / controls, and the 3D toRoom.
    qaExpose({ scene3d: { get, toRoom, pick } });

    return () => {
      if (press.current?.state === 'dragging') endDrag(true);
      else finishPress();
      container.removeEventListener('pointerdown', onDownCapture, true);
      container.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKey, true);
      unsub();
      unregister();
      const c = controls();
      if (c) c.enabled = true;
    };
  }, [containerRef, get]);

  return drag ? <DragFootprint id={drag.id} wall={drag.wall} /> : null;
}

/**
 * The floor footprint of the piece being dragged, a little larger than the piece so a
 * rim shows around it, with a bar along the wall it has snapped to. Red when it
 * overlaps another piece at the same height.
 */
function DragFootprint({ id, wall }: { id: string; wall: Wall | null }) {
  const items = useDesignStore((s) => s.doc.items);
  const all = useMemo(() => resolveAll(items), [items]);
  const r = all.find((o) => o.item.id === id);
  const loop = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
    return g;
  }, []);
  useEffect(() => () => loop.dispose(), [loop]);
  if (!r || isOpening(r.product)) return null;
  const bad = overlapsOthers(r, all);
  const color = bad ? BAD : ACCENT;
  const pad = 1.5;
  const b = r.box;
  const w = b.maxX - b.minX + pad * 2;
  const d = b.maxY - b.minY + pad * 2;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minY + b.maxY) / 2;
  const bar = 2.5;
  let barPos: [number, number, number] | null = null;
  let barSize: [number, number] = [0, 0];
  if (wall === 'north') (barPos = [cx, 0.3, b.minY + bar / 2]), (barSize = [b.maxX - b.minX, bar]);
  if (wall === 'south') (barPos = [cx, 0.3, b.maxY - bar / 2]), (barSize = [b.maxX - b.minX, bar]);
  if (wall === 'west') (barPos = [b.minX + bar / 2, 0.3, cz]), (barSize = [bar, b.maxY - b.minY]);
  if (wall === 'east') (barPos = [b.maxX - bar / 2, 0.3, cz]), (barSize = [bar, b.maxY - b.minY]);
  return (
    <group scale={1 / 12}>
      <mesh position={[cx, 0.15, cz]} rotation-x={-Math.PI / 2} scale={[w, d, 1]} renderOrder={8} userData={{ interactIgnore: true }} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} transparent opacity={bad ? 0.34 : 0.2} depthWrite={false} polygonOffset polygonOffsetFactor={-4} toneMapped={false} />
      </mesh>
      <lineLoop geometry={loop} position={[cx, 0.25, cz]} scale={[w, 1, d]} renderOrder={9} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
      </lineLoop>
      {barPos && (
        <mesh position={barPos} rotation-x={-Math.PI / 2} scale={[barSize[0], barSize[1], 1]} renderOrder={9} userData={{ interactIgnore: true }} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={color} depthWrite={false} polygonOffset polygonOffsetFactor={-6} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
