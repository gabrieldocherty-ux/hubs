import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlacedItem, Room, Rotation } from '../../types';
import { backsplashSegments, resolve, type Resolved } from '../geometry';

const ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };

function make(id: string, productId: string, x: number, y: number, rotation: Rotation = 0, widthIn?: number): Resolved {
  const item: PlacedItem = { id, productId, x, y, rotation, finishIndex: 0, ...(widthIn ? { widthIn } : {}) };
  const r = resolve(item);
  assert.ok(r, `unknown product ${productId}`);
  return r;
}

const walls = (all: Resolved[]) => backsplashSegments(all, ROOM).map((s) => `${s.wall} ${s.start}-${s.end}`).sort();

describe('backsplash', () => {
  // Gabe, 2026-10-16: a Lazy Susan corner showed tile on one wall of its corner only.
  test('a corner cabinet gets tile on both walls of its corner, whichever way it faces', () => {
    for (const rot of [0, 270] as Rotation[]) {
      assert.deepEqual(walls([make('c', 'corner', 18, 18, rot)]), ['north 0-36', 'west 0-36'], `north-west corner at ${rot}`);
    }
    assert.deepEqual(walls([make('c', 'corner', ROOM.widthIn - 18, ROOM.lengthIn - 18, 180)]), ['east 120-156', 'south 164-200']);
  });

  test('an ordinary base that butts a side wall gets tile on its back wall only', () => {
    assert.deepEqual(walls([make('b', 'base', 15, 12, 0, 30)]), ['north 0-30']);
  });

  test('a corner cabinet out in the room along one wall keeps a single run', () => {
    assert.deepEqual(walls([make('c', 'corner', 100, 18, 0)]), ['north 82-118']);
  });
});
