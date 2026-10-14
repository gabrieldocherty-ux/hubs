import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DesignDoc } from '../../types';
import { buildEstimate } from '../estimate';
import { estimateCsv } from '../csv';
import { sanitizeDoc } from '../doc';

// The shopping list the editor produces for the server tests' sample kitchen. The server's
// paid export (server/test/billing.test.mjs) must match this same file byte for byte.
// Regenerate deliberately with MISE_UPDATE_GOLDEN=1 npm run test:ts -- exportGolden.
const GOLDEN = path.join(process.cwd(), 'server/test/fixtures/golden/sample-shopping-list.csv');

const sample: DesignDoc = {
  name: 'Test Kitchen',
  room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
  surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
  items: [{ id: 'it-1', productId: 'range-30', x: 60, y: 14, rotation: 0, finishIndex: 0 }],
};

test('the editor’s shopping list for the sample kitchen matches the golden file', () => {
  const doc = sanitizeDoc(sample);
  const csv = estimateCsv(doc, buildEstimate(doc));
  if (process.env.MISE_UPDATE_GOLDEN === '1') fs.writeFileSync(GOLDEN, csv + '\n');
  assert.equal(csv, fs.readFileSync(GOLDEN, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, ''));
});
