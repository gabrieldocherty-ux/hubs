/**
 * Pure maths behind moving things in the 3D view: client pixels -> rays -> room
 * inches, and a 3D box -> the client-pixel rect it covers on screen. No React, no
 * DOM, so it can be unit-tested under Node.
 *
 * Units: the scene is drawn in FEET (one world unit = 12 room inches) with +Y up,
 * world x = room x / 12, world z = room y / 12. See lib/interaction.ts.
 */
import * as THREE from 'three';
import type { Room } from '../../types';
import type { AABB, Wall } from '../../lib/geometry';
import { INCHES_PER_WORLD_UNIT, worldToRoom, type RoomPoint, type ScreenRect } from '../../lib/interaction';

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ndc = new THREE.Vector2();
const caster = new THREE.Raycaster();

/** The world-space ray (feet) under a client-pixel position over the canvas, or null for an empty canvas. */
export function rayFromClient(camera: THREE.Camera, clientX: number, clientY: number, rect: CanvasRect): THREE.Ray | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  camera.updateMatrixWorld();
  caster.setFromCamera(ndc, camera);
  return caster.ray.clone();
}

/** Where a ray crosses the horizontal plane y = h (feet); null when it runs parallel or the plane is behind it. */
export function rayToHorizontalPlane(ray: THREE.Ray, h: number): THREE.Vector3 | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (h - ray.origin.y) / dy;
  if (!(t > 0) || !Number.isFinite(t)) return null;
  return ray.origin.clone().addScaledVector(ray.direction, t);
}

export type RoomFace = Wall | 'floor' | 'ceiling';

/**
 * Where a ray LEAVES the room's interior box (floor, four walls, ceiling). From any
 * camera position that is the room surface the viewer actually sees under the
 * pointer (Room3D hides the walls between the camera and the room), ignoring
 * furniture. Null when the ray misses the room entirely.
 */
export function rayExitRoom(ray: THREE.Ray, room: Room): { point: THREE.Vector3; face: RoomFace } | null {
  const o = [ray.origin.x, ray.origin.y, ray.origin.z];
  const d = [ray.direction.x, ray.direction.y, ray.direction.z];
  const hi = [room.widthIn / INCHES_PER_WORLD_UNIT, room.ceilingIn / INCHES_PER_WORLD_UNIT, room.lengthIn / INCHES_PER_WORLD_UNIT];
  let tNear = -Infinity;
  let tFar = Infinity;
  let axis = -1;
  let sign = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < 0 || o[a] > hi[a]) return null;
      continue;
    }
    const t0 = (0 - o[a]) / d[a];
    const t1 = (hi[a] - o[a]) / d[a];
    const near = Math.min(t0, t1);
    const far = Math.max(t0, t1);
    if (near > tNear) tNear = near;
    if (far < tFar) {
      tFar = far;
      axis = a;
      sign = d[a] > 0 ? 1 : -1;
    }
  }
  if (axis < 0 || !(tFar > 0) || tFar < tNear) return null;
  const point = ray.origin.clone().addScaledVector(ray.direction, tFar);
  const face: RoomFace =
    axis === 0 ? (sign > 0 ? 'east' : 'west') : axis === 1 ? (sign > 0 ? 'ceiling' : 'floor') : sign > 0 ? 'south' : 'north';
  return { point, face };
}

/**
 * The room point (inches) under a ray, for drops and tap-to-place: the floor or wall
 * the user is looking at, so a window dropped on a wall lands on that wall. When the
 * ray misses the room it falls back to the floor plane y = 0, accepted up to `margin`
 * inches outside the room (pass Infinity to accept any floor hit). Null for sky.
 */
export function roomPointUnderRay(ray: THREE.Ray, room: Room, margin = 48): RoomPoint | null {
  const exit = rayExitRoom(ray, room);
  if (exit) {
    const p = worldToRoom(exit.point.x, exit.point.z);
    return { x: Math.min(Math.max(p.x, 0), room.widthIn), y: Math.min(Math.max(p.y, 0), room.lengthIn) };
  }
  const floor = rayToHorizontalPlane(ray, 0);
  if (!floor) return null;
  const p = worldToRoom(floor.x, floor.z);
  if (p.x < -margin || p.y < -margin || p.x > room.widthIn + margin || p.y > room.lengthIn + margin) return null;
  return p;
}

/**
 * The height (feet) of the horizontal plane a grabbed piece slides on. It is the
 * height where the user grabbed it, so the piece stays under the finger, but kept at
 * least `minDrop` feet below the camera: a plane near eye height is seen edge-on and
 * a tiny pointer move would throw the piece across the room.
 */
export function dragPlaneHeight(grabY: number, cameraY: number, minDrop = 1.5): number {
  const h = Math.min(Math.max(0, grabY), cameraY - minDrop);
  return h > 0 ? h : 0;
}

const corner = new THREE.Vector3();

/**
 * The client-pixel rect covered by an item's box (footprint `box` in room inches, from
 * height z0 to z1 inches) as `camera` sees it, clipped to the canvas. Null when the
 * box is wholly behind the camera or off the canvas.
 */
export function projectBoxToClient(camera: THREE.Camera, rect: CanvasRect, box: AABB, z0: number, z1: number): ScreenRect | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  camera.updateMatrixWorld();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let front = 0;
  for (const x of [box.minX, box.maxX])
    for (const y of [z0, z1])
      for (const z of [box.minY, box.maxY]) {
        corner.set(x / INCHES_PER_WORLD_UNIT, y / INCHES_PER_WORLD_UNIT, z / INCHES_PER_WORLD_UNIT);
        // Corners behind the camera project mirrored; leave them out.
        corner.applyMatrix4(camera.matrixWorldInverse);
        if (corner.z >= 0) continue;
        corner.applyMatrix4(camera.projectionMatrix);
        front++;
        const px = rect.left + ((corner.x + 1) / 2) * rect.width;
        const py = rect.top + ((1 - corner.y) / 2) * rect.height;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
  if (!front) return null;
  const left = Math.max(minX, rect.left);
  const top = Math.max(minY, rect.top);
  const right = Math.min(maxX, rect.left + rect.width);
  const bottom = Math.min(maxY, rect.top + rect.height);
  if (!(right > left && bottom > top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * A world point (feet) in an item's own frame, in inches: x along its width, y up,
 * z toward its front. Inverse of Item3D's `position={[x, 0, y]}` + `rotation-y = -rotation`.
 */
export function toItemLocal(world: THREE.Vector3, item: { x: number; y: number; rotation: number }): { x: number; y: number; z: number } {
  const wx = world.x * INCHES_PER_WORLD_UNIT - item.x;
  const wz = world.z * INCHES_PER_WORLD_UNIT - item.y;
  const phi = (item.rotation * Math.PI) / 180;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return { x: wx * c + wz * s, y: world.y * INCHES_PER_WORLD_UNIT, z: -wx * s + wz * c };
}
