import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  dragPlaneHeight,
  projectBoxToClient,
  rayExitRoom,
  rayFromClient,
  rayToHorizontalPlane,
  roomPointUnderRay,
  toItemLocal,
} from './InteractMath';

const ROOM = { widthIn: 240, lengthIn: 180, ceilingIn: 108 }; // 20 x 15 ft, 9 ft ceiling

function ray(o: [number, number, number], target: [number, number, number]): THREE.Ray {
  const origin = new THREE.Vector3(...o);
  return new THREE.Ray(origin, new THREE.Vector3(...target).sub(origin).normalize());
}

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

describe('rays into the room', () => {
  test('a ray straight down lands on the floor plane', () => {
    const hit = rayToHorizontalPlane(ray([5, 10, 6], [5, 0, 6]), 0)!;
    near(hit.x, 5);
    near(hit.y, 0);
    near(hit.z, 6);
  });

  test('parallel or upward rays miss a plane below them', () => {
    assert.equal(rayToHorizontalPlane(ray([0, 5, 0], [10, 5, 0]), 0), null);
    assert.equal(rayToHorizontalPlane(ray([0, 5, 0], [10, 8, 0]), 0), null);
  });

  test('from above the room, looking down at the middle, the visible surface is the floor', () => {
    const exit = rayExitRoom(ray([10, 30, 7.5], [10, 0, 7.5]), ROOM)!;
    assert.equal(exit.face, 'floor');
    assert.deepEqual(roomPointUnderRay(ray([10, 30, 7.5], [10, 0, 7.5]), ROOM), { x: 120, y: 90 });
  });

  test('from outside the south-east corner, a ray at the far north wall lands ON that wall', () => {
    // Camera outside (south of the room, high up) aimed at a point 4 ft up the north wall, 5 ft from the west corner.
    const r = ray([25, 12, 30], [5, 4, 0]);
    const exit = rayExitRoom(r, ROOM)!;
    assert.equal(exit.face, 'north');
    const p = roomPointUnderRay(r, ROOM)!;
    near(p.x, 60, 1e-6);
    near(p.y, 0, 1e-6);
  });

  test('from inside the room (eye level), a ray at the east wall lands on it', () => {
    const r = ray([10, 5, 7.5], [20, 4, 3]);
    const exit = rayExitRoom(r, ROOM)!;
    assert.equal(exit.face, 'east');
    const p = roomPointUnderRay(r, ROOM)!;
    near(p.x, 240, 1e-6);
    near(p.y, 36, 1e-6);
  });

  test('a ray that misses the room falls back to the floor, but not far away and never the sky', () => {
    // Lands on the floor 2 ft west of the room.
    const close = roomPointUnderRay(ray([-2, 30, 7.5], [-2, 0, 7.5]), ROOM)!;
    near(close.x, -24);
    // Lands 30 ft away: no drop target there.
    assert.equal(roomPointUnderRay(ray([-30, 30, 7.5], [-30, 0, 7.5]), ROOM), null);
    // With an unbounded margin the far floor point is still returned (drags clamp it themselves).
    near(roomPointUnderRay(ray([-30, 30, 7.5], [-30, 0, 7.5]), ROOM, Infinity)!.x, -360);
    // Pointing at the sky.
    assert.equal(roomPointUnderRay(ray([-30, 30, 7.5], [-60, 40, 7.5]), ROOM), null);
  });
});

describe('the plane a grabbed piece slides on', () => {
  test('is the grab height when the camera is well above it', () => {
    assert.equal(dragPlaneHeight(3, 15), 3);
  });
  test('stays at least 1.5 ft under the camera so it is never seen edge-on', () => {
    assert.equal(dragPlaneHeight(6, 4.9), 4.9 - 1.5);
  });
  test('never goes below the floor', () => {
    assert.equal(dragPlaneHeight(-1, 10), 0);
    assert.equal(dragPlaneHeight(3, 1), 0);
  });
});

describe('client px <-> camera', () => {
  const camera = new THREE.PerspectiveCamera(38, 800 / 600, 0.2, 600);
  camera.position.set(10, 25, 7.5);
  camera.up.set(0, 0, -1); // looking straight down: north is up on screen
  camera.lookAt(10, 0, 7.5);
  camera.updateProjectionMatrix();
  const rect = { left: 300, top: 50, width: 800, height: 600 };

  test('the canvas centre looks straight down at the room centre', () => {
    const r = rayFromClient(camera, 700, 350, rect)!;
    const p = roomPointUnderRay(r, ROOM)!;
    near(p.x, 120, 1e-6);
    near(p.y, 90, 1e-6);
  });

  test("a box's projected rect contains its centre's projection and is clipped to the canvas", () => {
    const box = { minX: 108, maxX: 132, minY: 78, maxY: 102 };
    const r = projectBoxToClient(camera, rect, box, 0, 36)!;
    assert.ok(r.left < 700 && r.left + r.width > 700, JSON.stringify(r));
    assert.ok(r.top < 350 && r.top + r.height > 350, JSON.stringify(r));
    // The top face (36 in up) is closer to the camera, so it covers more than the 24 in footprint alone.
    const flat = projectBoxToClient(camera, rect, box, 0, 0.01)!;
    assert.ok(r.width > flat.width);
    // Huge box: clipped to the canvas.
    const big = projectBoxToClient(camera, rect, { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 }, 0, 1)!;
    assert.deepEqual(big, rect);
  });

  test('a box behind the camera or off-canvas has no rect', () => {
    const cam = new THREE.PerspectiveCamera(38, 4 / 3, 0.2, 600);
    cam.position.set(0, 5, 0);
    cam.lookAt(10, 5, 0); // looking east
    cam.updateProjectionMatrix();
    assert.equal(projectBoxToClient(cam, rect, { minX: -240, maxX: -200, minY: -10, maxY: 10 }, 0, 36), null);
    assert.equal(projectBoxToClient(cam, rect, { minX: 120, maxX: 130, minY: 2000, maxY: 2010 }, 0, 36), null);
  });
});

describe('item-local frame', () => {
  test('a point in front of an item on the east wall (facing west) has positive local z', () => {
    // Item centre at (228, 60) in, rotation 90: its front faces west (-x).
    const l = toItemLocal(new THREE.Vector3(200 / 12, 1, 60 / 12), { x: 228, y: 60, rotation: 90 });
    near(l.z, 28, 1e-9);
    near(l.x, 0, 1e-9);
    near(l.y, 12, 1e-9);
  });
  test('unrotated: local = world offset', () => {
    const l = toItemLocal(new THREE.Vector3(10, 0, 2), { x: 100, y: 20, rotation: 0 });
    near(l.x, 20, 1e-9);
    near(l.z, 4, 1e-9);
  });
});
