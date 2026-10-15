import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initials, isExportToast, placePopover, siteLabel } from '../logic';
import { hrefFor, parseRoute } from '../../../lib/router';

test('isExportToast: the editor export successes, nothing else', () => {
  for (const t of ['Shopping list saved as CSV.', 'Floor plan saved as PNG.', '3D view saved as PNG.', 'North wall elevation saved as SVG.', 'Project saved. Open it later with Import.']) {
    assert.equal(isExportToast(t, 'ok'), true, t);
  }
  // A warning, an unrelated success, and a capture failure never count.
  assert.equal(isExportToast('Shopping list saved as CSV.', 'warn'), false);
  assert.equal(isExportToast('Layout applied. Press Ctrl+Z to go back.', 'ok'), false);
  assert.equal(isExportToast('Could not capture that view. Try again in a moment.', 'warn'), false);
  assert.equal(isExportToast('“Maple” is in your kitchens. Changes you make are yours alone.', 'ok'), false);
});

test('initials: two letters from the business name, demo suffix and ampersands ignored', () => {
  assert.equal(initials('Alder & Pine Cabinetry (Demo)'), 'AP');
  assert.equal(initials('birchline kitchens'), 'BK');
  assert.equal(initials('Northgate'), 'N');
  assert.equal(initials('  '), '·');
});

test('siteLabel: a website without its scheme or trailing slash', () => {
  assert.equal(siteLabel('https://birchline.example/'), 'birchline.example');
  assert.equal(siteLabel('http://a.example/path'), 'a.example/path');
  assert.equal(siteLabel('plain.example'), 'plain.example');
});

test('placePopover: above a link near the bottom, below one near the top, always on screen', () => {
  const view = { width: 1440, height: 900 };
  const size = { width: 340, height: 260 };
  // The bottom of the editor's right panel: room above, so it opens upwards, right-aligned.
  const low = placePopover({ left: 1150, top: 840, right: 1280, bottom: 860 }, size, view);
  assert.equal(low.above, true);
  assert.equal(low.top, 840 - 8 - 260);
  assert.equal(low.left, 1280 - 340);
  assert.equal(low.width, 340);
  // The shared kitchen's fine print, at the top of the page: it opens downwards.
  const high = placePopover({ left: 200, top: 30, right: 320, bottom: 46 }, size, view);
  assert.equal(high.above, false);
  assert.equal(high.top, 46 + 8);
  // A link at the left edge never pushes the popover off the left of the screen.
  assert.equal(placePopover({ left: 0, top: 600, right: 60, bottom: 620 }, size, view).left, 8);
  // Taller than either side: it still stays inside the viewport.
  const tall = placePopover({ left: 600, top: 400, right: 700, bottom: 420 }, { width: 340, height: 880 }, view);
  assert.ok(tall.top >= 8);
});

test('placePopover: a phone gets the full width less 12px gutters', () => {
  const p = placePopover({ left: 20, top: 700, right: 150, bottom: 720 }, { width: 340, height: 300 }, { width: 390, height: 844 });
  assert.equal(p.left, 12);
  assert.equal(p.width, 390 - 24);
  assert.equal(p.above, true);
});

test('the #/contractors route: near and kitchen round-trip; a bad kitchen id is dropped', () => {
  const kitchen = '0b7c3f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
  assert.deepEqual(parseRoute('#/contractors'), { name: 'contractors' });
  const href = hrefFor({ name: 'contractors', near: 'Hamilton ON', kitchen });
  assert.deepEqual(parseRoute(href), { name: 'contractors', near: 'Hamilton ON', kitchen });
  assert.deepEqual(parseRoute('#/contractors?kitchen=not-a-kitchen&near=L8P'), { name: 'contractors', near: 'L8P' });
  // A search is capped at 60 characters, like the server's.
  const long = parseRoute(`#/contractors?near=${'x'.repeat(200)}`);
  assert.equal(long.name === 'contractors' ? long.near?.length : -1, 60);
  assert.equal(parseRoute('#/contractors/extra').name, 'notFound');
});
