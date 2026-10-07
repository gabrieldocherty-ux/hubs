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
