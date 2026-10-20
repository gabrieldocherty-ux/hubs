import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeOfWork } from './scope';
import { buildEstimate } from './estimate';
import { DEFAULT_SURFACES } from '../data/defaults';
import type { DesignDoc, PlacedItem } from '../types';

const it = (id: string, productId: string, x: number, y: number, extra: Partial<PlacedItem> = {}): PlacedItem => ({ id, productId, x, y, rotation: 0, finishIndex: 0, ...extra });

test('the scope of work follows the design: trades in site order, quantities from the estimate', () => {
  const doc = {
    name: 'T',
    room: { widthIn: 240, lengthIn: 168, ceilingIn: 108 },
    surfaces: { ...DEFAULT_SURFACES, underCabinet: 'led' },
    items: [it('b0', 'base', 15, 12, { widthIn: 30 }), it('s', 'sink-farm', 60, 12), it('dw', 'dishwasher', 100, 12), it('w0', 'wall', 15, 6, { widthIn: 30 }), it('r', 'range-30', 150, 14), it('o', 'outlet-gfci', 40, 0.25), it('p', 'pot-light', 120, 84)],
  } as unknown as DesignDoc;
  const est = buildEstimate(doc);
  const scope = scopeOfWork(doc, est);
  const ids = scope.map((t) => t.id);
  assert.deepEqual(ids, ['prep', 'framing', 'plumbing', 'electrical', 'drywall', 'flooring', 'cabinets', 'counters', 'tile', 'finish', 'appliances'].filter((x) => ids.includes(x as never)));
  const text = JSON.stringify(scope);
  assert.match(text, /Gas line to the range/);
  assert.match(text, /GFCI outlets near the sinks/);
  assert.match(text, /pot lights/);
  assert.match(text, /Under-cabinet LED strips/);
  const floor = scope.find((t) => t.id === 'flooring')!;
  assert.equal(floor.tasks[0].qty, `${est.lines.find((l) => l.key === 'floor')!.qty} sq ft`);
  assert.ok(!scope.some((t) => t.tasks.length === 0));
});
