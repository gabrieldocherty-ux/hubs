import { bounds, outlineOf, planSize, pointInOutline } from '../../lib/outline';
import * as THREE from 'three';
import type { Room } from '../../types';
import type { CameraPreset } from '../../store/useDesignStore';

/** The room camera's vertical field of view, degrees. */
export const FOV = 38;

/** Pulls the camera back until a sphere of `radius` fits the narrower of the two fields of view. */
export function fitDistance(radius: number, aspect: number, fov = FOV): number {
  const v = THREE.MathUtils.degToRad(fov) / 2;
  const h = Math.atan(Math.tan(v) * aspect);
  return (radius / Math.sin(Math.min(v, h))) * 0.92;
}

/** Camera position and target (feet) for a preset view of the room at an aspect ratio. */
export function presetFor(preset: CameraPreset, room: Room, aspect: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const W = planSize(room).W / 12;
  const L = planSize(room).L / 12;
  const H = room.ceilingIn / 12;
  const cx = W / 2;
  const cz = L / 2;
  switch (preset) {
    case 'eye': {
      if (!room.outline && !room.extra?.length) return { pos: new THREE.Vector3(W - 1.2, 4.9, L - 1.2), target: new THREE.Vector3(W * 0.3, 3.2, L * 0.18) };
      // A drawn room: stand in the main room's corner farthest from its middle (14″ off the walls)
      // and look back across it, so the eye-level view never starts outside an L or a notch.
      const o = outlineOf(room);
      const b = bounds(o);
      const mx = (b.minX + b.maxX) / 2;
      const my = (b.minY + b.maxY) / 2;
      const m = 14;
      const fits = (x: number, y: number) => [[-m, -m], [m, -m], [m, m], [-m, m]].every(([dx, dy]) => pointInOutline(o, x + dx, y + dy));
      let best: [number, number] | null = null;
      let far = -1;
      for (let y = b.minY + m; y <= b.maxY - m; y += 6) {
        for (let x = b.minX + m; x <= b.maxX - m; x += 6) {
          if (!fits(x, y)) continue;
          const dd = Math.hypot(x - mx, y - my) + (x > mx && y > my ? 1 : 0);
          if (dd > far) {
            far = dd;
            best = [x, y];
          }
        }
      }
      const [px, py] = best ?? [mx, my];
      const tx = mx + (mx - px) * 0.6;
      const ty = my + (my - py) * 0.6;
      return { pos: new THREE.Vector3(px / 12, 4.9, py / 12), target: new THREE.Vector3(tx / 12, 3.2, ty / 12) };
    }
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

/**
 * The vertical field of view (degrees) for a still of the *current* view at another aspect ratio.
 * Whatever spanned the narrower side of the view on screen spans the narrower side of the image:
 * a landscape view rendered landscape keeps its FOV, but a tall, narrow pane (split view, a phone)
 * rendered at 16:9 zooms in instead of shrinking the kitchen into the middle of a wide frame.
 */
export function stillFov(fovDeg: number, screenAspect: number, imageAspect: number): number {
  const v0 = THREE.MathUtils.degToRad(fovDeg);
  const h0 = 2 * Math.atan(Math.tan(v0 / 2) * screenAspect);
  const lim = Math.min(v0, h0);
  const v1 = imageAspect >= 1 ? lim : 2 * Math.atan(Math.tan(lim / 2) / imageAspect);
  return THREE.MathUtils.radToDeg(v1);
}
