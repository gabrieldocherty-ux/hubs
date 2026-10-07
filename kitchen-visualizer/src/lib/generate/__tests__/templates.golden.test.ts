import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PlacedItem, Room, Surfaces } from '../../../types';
import { buildTemplate, TEMPLATES } from '../../../data/templates';
import { DEFAULT_SURFACES } from '../../../data/defaults';
import { STYLE_PRESETS } from '../../../data/styles';

// The exact output of the five starting templates, recorded from the foundation commit (b78193a)
// BEFORE the declarative refactor. The refactored builder must reproduce it item for item: same
// products, positions, rotations, widths, finishes, order and notes. Only the random item ids are
// left out. Regenerate only on purpose: MISE_UPDATE_GOLDEN=1 npm run test:ts -- templates.golden
const GOLDEN = path.join(process.cwd(), 'src/lib/generate/__tests__/fixtures/templates.golden.json');

const ROOMS: Room[] = [
  { widthIn: 96, lengthIn: 96, ceilingIn: 90 }, // the galley's minimum; most templates refuse
  { widthIn: 120, lengthIn: 120, ceilingIn: 96 }, // compact: only some templates fit
  { widthIn: 132, lengthIn: 96, ceilingIn: 96 }, // the U-shape's minimum
  { widthIn: 156, lengthIn: 150, ceilingIn: 108 }, // the L + island's minimum
  { widthIn: 168, lengthIn: 144, ceilingIn: 108 }, // the wizard's "standard"
  { widthIn: 200, lengthIn: 156, ceilingIn: 108 }, // DEFAULT_ROOM
  { widthIn: 240, lengthIn: 192, ceilingIn: 120 }, // open plan: long west run, olive tree
  { widthIn: 301, lengthIn: 233, ceilingIn: 120 }, // odd sizes exercise fill()'s remainders
];

const SURFACES: { name: string; surfaces: Surfaces }[] = [
  { name: 'default', surfaces: DEFAULT_SURFACES },
  { name: 'moody', surfaces: STYLE_PRESETS.find((p) => p.id === 'moody')!.surfaces },
];

type Snapshot = Record<string, { items: Omit<PlacedItem, 'id'>[]; note: string | null }>;

function capture(): Snapshot {
  const out: Snapshot = {};
  for (const s of SURFACES) {
    for (const room of ROOMS) {
      for (const t of TEMPLATES) {
        const { items, note } = buildTemplate(t.id, room, s.surfaces);
        out[`${s.name} ${room.widthIn}x${room.lengthIn}x${room.ceilingIn} ${t.id}`] = {
          items: items.map(({ id: _id, ...rest }) => rest),
          note: note ?? null,
        };
      }
    }
  }
  return out;
}

test('the five templates build exactly what they built before the declarative refactor', () => {
  const now = capture();
  if (process.env.MISE_UPDATE_GOLDEN === '1') {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Snapshot;
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  for (const key of Object.keys(golden)) assert.deepEqual(now[key], golden[key], key);
});

test('item ids stay unique within a template', () => {
  for (const t of TEMPLATES) {
    const { items } = buildTemplate(t.id, { widthIn: 240, lengthIn: 192, ceilingIn: 120 }, DEFAULT_SURFACES);
    assert.equal(new Set(items.map((i) => i.id)).size, items.length, t.id);
  }
});
