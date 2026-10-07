import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capSize, DEFAULT_STUDIO_PREFS, parsePrefs, renderFilename, stillOptionsFor, STUDIO_SIZES, useStudioPrefs } from '../studio';
import { previewSize, watermarkGrid } from '../watermark';

test('the three studio sizes are 1080p, 1440p and 4K', () => {
  assert.deepEqual(
    STUDIO_SIZES.map((s) => [s.width, s.height]),
    [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ],
  );
});

test('capSize keeps sizes under the cap and scales larger ones by the long side, keeping the aspect', () => {
  assert.deepEqual(capSize(3840, 2160, 4096), { width: 3840, height: 2160, capped: false });
  assert.deepEqual(capSize(3840, 2160, 2048), { width: 2048, height: 1152, capped: true });
  assert.deepEqual(capSize(1080, 1920, 1024), { width: 576, height: 1024, capped: true });
});

test('parsePrefs keeps known values and falls back for anything else', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_STUDIO_PREFS);
  assert.deepEqual(parsePrefs('not json'), DEFAULT_STUDIO_PREFS);
  assert.deepEqual(parsePrefs('[1,2]'), DEFAULT_STUDIO_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ camera: 'eye', size: '4k', quality: 'fast', toneMap: 'agx' })), {
    camera: 'eye',
    size: '4k',
    quality: 'fast',
    toneMap: 'agx',
  });
  // ACES is only for the A/B comparison, never a studio choice; unknown sizes fall back.
  assert.deepEqual(parsePrefs(JSON.stringify({ camera: 'top', size: '8k', quality: 'ultra', toneMap: 'aces' })), DEFAULT_STUDIO_PREFS);
});

test('stillOptionsFor maps prefs to the exact pixel size', () => {
  assert.deepEqual(stillOptionsFor({ camera: 'front', size: '4k', quality: 'high', toneMap: 'neutral' }), {
    width: 3840,
    height: 2160,
    camera: 'front',
    quality: 'high',
    toneMap: 'neutral',
  });
});

test('setPrefs remembers the choice on this device', () => {
  useStudioPrefs.getState().setPrefs({ size: '1440', camera: 'overview' });
  assert.equal(useStudioPrefs.getState().prefs.size, '1440');
  assert.deepEqual(parsePrefs(localStorage.getItem('mise.studio.prefs')), { ...DEFAULT_STUDIO_PREFS, size: '1440', camera: 'overview' });
});

test('renderFilename is <kitchen>-render-<w>x<h>.png', () => {
  assert.equal(renderFilename('smith-kitchen', 3840, 2160), 'smith-kitchen-render-3840x2160.png');
  assert.equal(renderFilename('', 1920, 1080), 'kitchen-render-1920x1080.png');
});

test('previewSize scales down by the long side and never up', () => {
  assert.deepEqual(previewSize(3840, 2160, 1600), { width: 1600, height: 900 });
  assert.deepEqual(previewSize(800, 450, 1600), { width: 800, height: 450 });
});

test('the watermark grid covers every corner of the image whatever the rotation', () => {
  const w = 1600;
  const h = 900;
  const font = 38;
  const pts = watermarkGrid(w, h, font);
  assert.ok(pts.length > 20);
  // Rotating the image corners into the grid's frame (by +π/7) must land inside the grid's span.
  const a = Math.PI / 7;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  for (const [cx, cy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [-w / 2, h / 2],
    [w / 2, h / 2],
  ]) {
    const rx = cx * Math.cos(a) - cy * Math.sin(a);
    const ry = cx * Math.sin(a) + cy * Math.cos(a);
    assert.ok(rx >= Math.min(...xs) && rx <= Math.max(...xs), `corner x ${rx}`);
    assert.ok(ry >= Math.min(...ys) && ry <= Math.max(...ys), `corner y ${ry}`);
  }
});
