/**
 * Publishes where the selected piece is on screen (client px) to useOverlay, so a
 * floating toolbar can sit next to it in the 3D view.
 *
 * Only the view the user is working in publishes: the 3D view does when it is the
 * only view, or when the last press in the stage landed in it. A press in the plan
 * hands the overlay back to the plan (we withdraw ours).
 */
import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useDesignStore } from '../../store/useDesignStore';
import { isOpening } from '../../data/catalog';
import { flushWall, resolve, type Resolved } from '../../lib/geometry';
import { INCHES_PER_WORLD_UNIT, useOverlay, type ViewId } from '../../lib/interaction';
import { projectBoxToClient } from './InteractMath';
import type * as THREE from 'three';
import type { Room } from '../../types';

let activeView: ViewId | null = null;

/** Records which view the user is working in (a press, a drop). */
export function markActiveView(view: ViewId) {
  activeView = view;
}

/** Room3D hides the walls between the camera and the room, and the doors/windows on them. */
function hiddenOpening(r: Resolved, camera: THREE.Camera, room: Room): boolean {
  if (!isOpening(r.product)) return false;
  const wall = flushWall(r, room);
  const x = camera.position.x * INCHES_PER_WORLD_UNIT;
  const z = camera.position.z * INCHES_PER_WORLD_UNIT;
  if (wall === 'north') return !(z > 0);
  if (wall === 'south') return !(z < room.lengthIn);
  if (wall === 'west') return !(x > 0);
  if (wall === 'east') return !(x < room.widthIn);
  return false;
}

export function InteractOverlay() {
  const get = useThree((s) => s.get);

  useEffect(() => {
    if (useDesignStore.getState().ui.viewMode === '3d') activeView = '3d';
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      if (t.closest('.scene-view')) activeView = '3d';
      else if (t.closest('.plan-view')) {
        activeView = 'plan';
        useOverlay.getState().clear('3d');
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      useOverlay.getState().clear('3d');
    };
  }, []);

  useFrame(() => {
    const s = useDesignStore.getState();
    const ov = useOverlay.getState();
    if (s.ui.viewMode !== '3d' && activeView !== '3d') return;
    const it = s.selectedId ? s.doc.items.find((i) => i.id === s.selectedId) : undefined;
    const r = it ? resolve(it) : null;
    const { camera, gl } = get();
    const rect = r && !hiddenOpening(r, camera, s.doc.room) ? projectBoxToClient(camera, gl.domElement.getBoundingClientRect(), r.box, r.z0, r.z1) : null;
    if (rect) ov.set({ rect, source: '3d' });
    else if (ov.source === '3d' && ov.dragging) ov.set({ rect: null });
    else ov.clear('3d');
  });

  return null;
}
