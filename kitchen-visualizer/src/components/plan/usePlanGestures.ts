/**
 * Every pointer gesture on the 2D plan, for mouse, pen and touch, in one state machine.
 *
 * Konva's built-in dragging is gone from the plan: a draggable Stage turned a two-finger
 * pinch into a pan, item hit-testing picked whatever was drawn on top (the pendant over
 * the island), and taps nudged items because there was no per-input threshold. Here:
 *
 *   press on an item, move past the threshold   drags it through the store's drag
 *                                                protocol (same snapping as before)
 *   press on empty space (or an unselected rug)  pans
 *   middle / right mouse button                  pans, anywhere
 *   two fingers                                  pinch-zoom around their midpoint and pan
 *                                                together; a second finger landing during
 *                                                an item drag cancels that drag
 *   tap                                          selects (again on a stack: the next piece
 *                                                down), tap empty space deselects, and with a
 *                                                product armed for tap-to-place, places it
 *   wheel                                        zooms at the pointer
 *   Escape during a drag                         puts the piece back
 *
 * Thresholds: 4px for a mouse, 8px for touch, 6px for a pen, so a tap never moves anything.
 */
import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type Konva from 'konva';
import type { Resolved } from '../../lib/geometry';
import { clamp } from '../../lib/geometry';
import { placeAt, planClientToRoom, useOverlay, usePlacement } from '../../lib/interaction';
import { useDesignStore } from '../../store/useDesignStore';
import { pickAt, touchPad, type Pick } from './planHit';

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 30;

const THRESHOLD: Record<string, number> = { mouse: 4, pen: 6, touch: 8 };
/** Pointer this close (px) to the pane's edge during an item drag scrolls the plan. */
const EDGE = 28;
const EDGE_SPEED = 9;

interface Pt {
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; pointerId: number; type: string; start: Pt; startRoom: Pt; pick: Pick; button: number }
  | { kind: 'item'; pointerId: number; id: string; offset: Pt; last: Pt }
  | { kind: 'pan'; pointerId: number; start: Pt; startView: View }
  | { kind: 'pinch'; ids: [number, number]; startDist: number; startMid: Pt; startView: View };

export interface PlanGestureOptions {
  wrapRef: RefObject<HTMLDivElement>;
  stageRef: RefObject<Konva.Stage>;
  /** The live stage transform; updated synchronously by `applyView`. */
  viewRef: MutableRefObject<View>;
  applyView: (v: View, byUser?: boolean) => void;
  /** Latest resolved items (read at event time, never stale). */
  itemsRef: MutableRefObject<Resolved[]>;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function usePlanGestures({ wrapRef, stageRef, viewRef, applyView, itemsRef }: PlanGestureOptions): void {
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const applyRef = useRef(applyView);
  applyRef.current = applyView;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pointers = new Map<number, Pt & { type: string }>();
    let raf = 0;
    let hovered: string | null = null;

    const store = () => useDesignStore.getState();
    const container = (): HTMLElement | null => stageRef.current?.container() ?? null;
    const onCanvas = (t: EventTarget | null) => {
      const c = container();
      return !!c && t instanceof Node && c.contains(t);
    };
    /** Client px -> px inside the stage container. */
    const local = (p: Pt): Pt => {
      const r = container()?.getBoundingClientRect();
      return r ? { x: p.x - r.left, y: p.y - r.top } : p;
    };
    const toRoom = (p: Pt): Pt => {
      const r = container()?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return planClientToRoom(p.x, p.y, r, viewRef.current);
    };
    const padFor = (type: string) => {
      const s = viewRef.current.scale;
      return type === 'mouse' ? () => 2 / s : (r: Resolved) => touchPad(r, s);
    };
    const setCursor = (c: string) => {
      if (wrap.style.cursor !== c) wrap.style.cursor = c;
    };
    const setHover = (id: string | null) => {
      if (hovered === id) return;
      hovered = id;
      store().hover(id);
    };

    // ── item drag ──
    const moveItem = (client: Pt) => {
      const g = gesture.current;
      if (g.kind !== 'item') return;
      g.last = client;
      const p = toRoom(client);
      store().dragMove(g.id, p.x + g.offset.x, p.y + g.offset.y);
    };
    const beginItem = (id: string, pointerId: number, startRoom: Pt, client: Pt) => {
      const it = store().doc.items.find((i) => i.id === id);
      if (!it || !store().dragStart(id)) {
        gesture.current = { kind: 'idle' };
        return;
      }
      store().setUI({ rightTab: 'details' });
      useOverlay.getState().set({ dragging: true, source: 'plan' });
      setHover(null);
      setCursor('grabbing');
      gesture.current = { kind: 'item', pointerId, id, offset: { x: it.x - startRoom.x, y: it.y - startRoom.y }, last: client };
      moveItem(client);
      startEdgeScroll();
    };
    const endItem = (commit: boolean) => {
      const g = gesture.current;
      if (g.kind !== 'item') return;
      if (commit) store().dragEnd(g.id);
      else store().dragCancel();
      useOverlay.getState().set({ dragging: false });
      cancelAnimationFrame(raf);
      raf = 0;
      gesture.current = { kind: 'idle' };
      setCursor('');
    };

    /** While an item is dragged near the pane's edge, scroll the plan so it can travel further. */
    const startEdgeScroll = () => {
      cancelAnimationFrame(raf);
      const tick = () => {
        const g = gesture.current;
        if (g.kind !== 'item') return;
        const c = container();
        const room = store().doc.room;
        if (c) {
          const w = c.clientWidth;
          const h = c.clientHeight;
          const p = local(g.last);
          const v = viewRef.current;
          const push = (d: number) => (d < EDGE ? ((EDGE - Math.max(0, d)) / EDGE) * EDGE_SPEED : 0);
          let dx = push(p.x) - push(w - p.x);
          let dy = push(p.y) - push(h - p.y);
          // Only scroll while there is more room to reveal in that direction.
          const margin = 24;
          if (dx > 0) dx = Math.min(dx, Math.max(0, margin - v.x));
          if (dx < 0) dx = Math.max(dx, Math.min(0, w - margin - (v.x + room.widthIn * v.scale)));
          if (dy > 0) dy = Math.min(dy, Math.max(0, margin - v.y));
          if (dy < 0) dy = Math.max(dy, Math.min(0, h - margin - (v.y + room.lengthIn * v.scale)));
          if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            applyRef.current({ ...v, x: v.x + dx, y: v.y + dy }, true);
            moveItem(g.last);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    // ── pinch ──
    const startPinch = () => {
      const touches = [...pointers.entries()].filter(([, p]) => p.type === 'touch').slice(0, 2);
      if (touches.length < 2) return;
      const g = gesture.current;
      // A second finger means "zoom", never "drop the piece here": put it back.
      if (g.kind === 'item') endItem(false);
      const [[ia, a], [ib, b]] = touches;
      const la = local(a);
      const lb = local(b);
      gesture.current = {
        kind: 'pinch',
        ids: [ia, ib],
        startDist: Math.max(1, dist(la, lb)),
        startMid: { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 },
        startView: { ...viewRef.current },
      };
    };
    const movePinch = () => {
      const g = gesture.current;
      if (g.kind !== 'pinch') return;
      const a = pointers.get(g.ids[0]);
      const b = pointers.get(g.ids[1]);
      if (!a || !b) return;
      const la = local(a);
      const lb = local(b);
      const mid = { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 };
      const sv = g.startView;
      const scale = clamp((sv.scale * dist(la, lb)) / g.startDist, MIN_SCALE, MAX_SCALE);
      // The room point that was under the fingers' midpoint stays under it.
      const wx = (g.startMid.x - sv.x) / sv.scale;
      const wy = (g.startMid.y - sv.y) / sv.scale;
      applyRef.current({ scale, x: mid.x - wx * scale, y: mid.y - wy * scale }, true);
    };
    const startPan = (pointerId: number, start: Pt) => {
      gesture.current = { kind: 'pan', pointerId, start, startView: { ...viewRef.current } };
      setCursor('grabbing');
    };

    // ── tap ──
    const tap = (g: Extract<Gesture, { kind: 'pending' }>) => {
      if (g.type === 'mouse' && g.button !== 0) return;
      const armed = usePlacement.getState().armedProductId;
      if (armed) {
        // Tap-to-place: the next tap puts the armed product here (snapped like a drag).
        // Taps over existing pieces place too: uppers go over the base run, lights over the island.
        placeAt(armed, g.startRoom.x, g.startRoom.y);
        return;
      }
      if (g.pick.tapId) {
        store().select(g.pick.tapId);
        store().setUI({ rightTab: 'details' });
      } else store().select(null);
    };

    // ── DOM events ──
    const onDown = (e: PointerEvent) => {
      if (!onCanvas(e.target)) return;
      if (e.pointerType === 'mouse' && e.button > 2) return;
      // Typing in a panel field? Let it commit, and put the phone keyboard away.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
      const client = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, { ...client, type: e.pointerType });
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointer: window listeners still see it.
      }
      if (e.pointerType === 'touch' && [...pointers.values()].filter((p) => p.type === 'touch').length >= 2) {
        startPinch();
        return;
      }
      if (gesture.current.kind !== 'idle') return;
      if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
        e.preventDefault();
        startPan(e.pointerId, client);
        return;
      }
      const startRoom = toRoom(client);
      const pick = pickAt(itemsRef.current, startRoom.x, startRoom.y, padFor(e.pointerType), store().selectedId);
      gesture.current = { kind: 'pending', pointerId: e.pointerId, type: e.pointerType, start: client, startRoom, pick, button: e.button };
    };

    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        // Mouse hover: highlight what a press would grab.
        if (e.pointerType === 'mouse' && gesture.current.kind === 'idle' && e.buttons === 0) {
          if (!onCanvas(e.target)) {
            setHover(null);
            setCursor('');
            return;
          }
          const r = toRoom({ x: e.clientX, y: e.clientY });
          const pick = pickAt(itemsRef.current, r.x, r.y, padFor('mouse'), store().selectedId);
          setHover(pick.hits[0]?.id ?? null);
          setCursor(usePlacement.getState().armedProductId ? 'crosshair' : pick.dragId ? 'grab' : '');
        }
        return;
      }
      const client = { x: e.clientX, y: e.clientY };
      p.x = client.x;
      p.y = client.y;
      const g = gesture.current;
      switch (g.kind) {
        case 'pending':
          if (g.pointerId !== e.pointerId) return;
          if (dist(client, g.start) <= (THRESHOLD[g.type] ?? 6)) return;
          if (g.pick.dragId) beginItem(g.pick.dragId, g.pointerId, g.startRoom, client);
          else {
            startPan(g.pointerId, g.start);
            onMove(e);
          }
          return;
        case 'item':
          if (g.pointerId === e.pointerId) moveItem(client);
          return;
        case 'pan':
          if (g.pointerId !== e.pointerId) return;
          applyRef.current({ ...g.startView, x: g.startView.x + client.x - g.start.x, y: g.startView.y + client.y - g.start.y }, true);
          return;
        case 'pinch':
          if (g.ids.includes(e.pointerId)) movePinch();
          return;
      }
    };

    const onUp = (e: PointerEvent, cancelled: boolean) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try {
        if (wrap.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId);
      } catch {
        // Nothing to release.
      }
      const g = gesture.current;
      switch (g.kind) {
        case 'pending':
          if (g.pointerId !== e.pointerId) break;
          gesture.current = { kind: 'idle' };
          if (!cancelled) tap(g);
          break;
        case 'item':
          if (g.pointerId === e.pointerId) endItem(!cancelled);
          break;
        case 'pan':
          if (g.pointerId === e.pointerId) {
            gesture.current = { kind: 'idle' };
            setCursor('');
          }
          break;
        case 'pinch': {
          if (!g.ids.includes(e.pointerId)) break;
          const touches = [...pointers.entries()].filter(([, q]) => q.type === 'touch');
          if (touches.length >= 2) startPinch();
          else if (touches.length === 1) startPan(touches[0][0], { x: touches[0][1].x, y: touches[0][1].y });
          else gesture.current = { kind: 'idle' };
          break;
        }
      }
      if (!pointers.size && gesture.current.kind !== 'item') {
        gesture.current = { kind: 'idle' };
        setCursor('');
      }
    };
    const onPointerUp = (e: PointerEvent) => onUp(e, false);
    const onPointerCancel = (e: PointerEvent) => onUp(e, true);

    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && gesture.current.kind === 'idle') {
        setHover(null);
        setCursor('');
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const p = local({ x: e.clientX, y: e.clientY });
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const wx = (p.x - v.x) / v.scale;
      const wy = (p.y - v.y) / v.scale;
      applyRef.current({ scale, x: p.x - wx * scale, y: p.y - wy * scale }, true);
    };

    const onContextMenu = (e: MouseEvent) => {
      if (onCanvas(e.target)) e.preventDefault();
    };
    // Belt and braces with `touch-action: none`: older iOS still scrolls/zooms the page otherwise.
    const onTouch = (e: TouchEvent) => {
      if (onCanvas(e.target) && e.cancelable) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (gesture.current.kind === 'item') {
        endItem(false);
        e.preventDefault();
        e.stopPropagation();
      } else if (usePlacement.getState().armedProductId) {
        usePlacement.getState().disarm();
        e.preventDefault();
        e.stopPropagation();
      }
    };

    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointerleave', onLeave);
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('contextmenu', onContextMenu);
    wrap.addEventListener('touchstart', onTouch, { passive: false });
    wrap.addEventListener('touchmove', onTouch, { passive: false });
    wrap.addEventListener('gesturestart', onGesture);
    wrap.addEventListener('gesturechange', onGesture);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      // Unmounting mid-drag (view switch): don't leave the store's drag open.
      if (gesture.current.kind === 'item') endItem(true);
      gesture.current = { kind: 'idle' };
      cancelAnimationFrame(raf);
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointerleave', onLeave);
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('contextmenu', onContextMenu);
      wrap.removeEventListener('touchstart', onTouch);
      wrap.removeEventListener('touchmove', onTouch);
      wrap.removeEventListener('gesturestart', onGesture);
      wrap.removeEventListener('gesturechange', onGesture);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [wrapRef, stageRef, viewRef, itemsRef]);
}
