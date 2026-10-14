import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_FAR_PX, FIT_MAX_SHRINK, FIT_NEAR_PX, fitMargin, fitView } from './planFit';
import { WALL_T } from './planStyle';

// The starter kitchen: 16' 8" x 13' 0".
const W = 200;
const L = 156;

const byMargin = (w: number, h: number) => {
  const m = fitMargin(w, h);
  return Math.min((w - m * 2) / (W + 20), (h - m * 2) / (L + 20));
};

test('Fit draws the room at its margin size, or at most 15% smaller to keep the dimension strings in view', () => {
  for (const [w, h] of [[397, 842], [1100, 842], [390, 700], [360, 640], [390, 244], [820, 600]]) {
    const s = fitView(w, h, W, L, 0.3, 30).scale;
    assert.ok(s <= byMargin(w, h) + 1e-9 && s >= byMargin(w, h) * FIT_MAX_SHRINK - 1e-9, `${w}x${h}: ${s} vs ${byMargin(w, h)}`);
  }
  // Where the margin already leaves room for the strings, the size is exactly what it always was.
  assert.equal(fitView(1100, 842, W, L, 0.3, 30).scale, byMargin(1100, 842));
  assert.equal(fitView(397, 842, W, L, 0.3, 30).scale, byMargin(397, 842));
});

test('the overall dimension strings fit inside the pane on the split view, a full plan and a phone plan', () => {
  // 397x842 is the desktop split view's plan pane and 360/390 the phone editor's plan, where the
  // 13' 0" label used to be cut in half.
  for (const [w, h] of [[397, 842], [1100, 842], [390, 700], [360, 640], [820, 1000]]) {
    const v = fitView(w, h, W, L, 0.3, 30);
    const need = (px: number) => WALL_T * v.scale + px - 0.5;
    const west = v.x;
    const north = v.y;
    const east = w - v.x - W * v.scale;
    const south = h - v.y - L * v.scale;
    assert.ok(west >= need(FIT_NEAR_PX), `${w}x${h}: west ${west.toFixed(1)}px < ${need(FIT_NEAR_PX).toFixed(1)}px`);
    assert.ok(north >= need(FIT_NEAR_PX), `${w}x${h}: north ${north.toFixed(1)}px < ${need(FIT_NEAR_PX).toFixed(1)}px`);
    assert.ok(east >= need(FIT_FAR_PX), `${w}x${h}: east ${east.toFixed(1)}px`);
    assert.ok(south >= need(FIT_FAR_PX), `${w}x${h}: south ${south.toFixed(1)}px`);
  }
});

test('a pane far too short for the strings (a phone split view) keeps the room size and centres it, nudged as before', () => {
  const v = fitView(390, 244, W, L, 0.3, 30);
  assert.equal(v.scale, byMargin(390, 244));
  const roomPx = L * v.scale;
  assert.ok(Math.abs(v.y - ((244 - roomPx) / 2 + 14 * (12 / 72))) < 1e-9);
  assert.ok(v.y > 0 && v.y + roomPx < 244, 'the room itself is fully visible');
});
