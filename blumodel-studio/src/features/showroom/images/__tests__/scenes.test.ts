import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DesignDoc, Product } from '../../../../types';
import { useCatalog } from '../../../../store/useCatalog';
import { getProduct } from '../../../../data/catalog';
import { featuredLines, showroomLines } from '../../lines';
import { layoutProblems, showroomScenes } from '../scenes';
import { pointInRoom } from '../../../../lib/outline';

// The demo showroom's real catalog (server/tenancy/demo.mjs), as the showroom's client sees it.
type DemoProduct = Omit<Product, 'id' | 'code' | 'brand' | 'source'> & { sku: string; line: string };
const root = process.cwd();
const demo = (await import(pathToFileURL(path.join(root, 'server', 'tenancy', 'demo.mjs')).href)) as { DEMO_PRODUCTS: DemoProduct[] };
const idOf = (sku: string) => `p_demo_${sku.replace(/[^A-Za-z0-9]/g, '')}`;
const products: Product[] = demo.DEMO_PRODUCTS.map((p) => ({ ...p, id: idOf(p.sku), code: p.sku, brand: 'Northline Kitchen & Bath (Demo)', source: 'tenant', elevationIn: p.elevationIn ?? 0 }) as Product);
useCatalog.getState().register(products);
const FEATURED = ['Lakeshore Shaker', 'Harbourfront Slab', 'Northline Sinks', 'Chef’s Appliance Suite', 'Bay Lighting', 'Bayview Bath'];

test('every showroom scene is a clean layout made of the company’s own products', () => {
  const lines = showroomLines(products);
  const scenes = showroomScenes(lines, featuredLines(lines, FEATURED), { keepBasics: false });
  assert.ok(scenes.find((s) => s.id === 'hero')?.shots.some((x) => x.slot === 'heroTall'), 'a hero with a tall picture for phones');
  assert.equal(scenes.filter((s) => s.id.startsWith('gallery:')).length, 3);
  for (const l of FEATURED) assert.ok(scenes.some((s) => s.shots.some((x) => x.slot === 'line' && x.line === l)), `a picture of ${l}`);
  for (const s of scenes) {
    assert.deepEqual(s.problems, [], `${s.label}: ${s.problems.join('; ')}`);
    const own = s.doc.items.filter((i) => getProduct(i.productId)?.source === 'tenant').length;
    const sold = s.doc.items.filter((i) => !['openings', 'decor'].includes(getProduct(i.productId)?.category ?? '')).length;
    assert.equal(own, sold, `${s.label}: only the company's products (no BluModel Basics without "fill the gaps")`);
    for (const shot of s.shots) {
      // Inside one of the plan's rooms (a picture may look in from the room next door).
      const [x, y, z] = shot.view.pos;
      assert.ok(pointInRoom(s.doc.room, x * 12, z * 12) && y < s.doc.room.ceilingIn / 12, `${s.label}: the camera stands inside the room`);
    }
  }
  // The gallery is three different kitchens.
  assert.equal(new Set(scenes.filter((s) => s.id.startsWith('gallery:')).map((s) => s.shots[0].title)).size, 3);
});

test('with "fill the gaps" on (how the demo pictures are made), every scene is still a clean layout', () => {
  const lines = showroomLines(products);
  for (const s of showroomScenes(lines, featuredLines(lines, FEATURED), { keepBasics: true })) assert.deepEqual(s.problems, [], `${s.label}: ${s.problems.join('; ')}`);
});

test('the committed demo kitchens (server/tenancy/demo-images/manifest.json) pass the editor’s design checks', () => {
  const file = path.join(root, 'server', 'tenancy', 'demo-images', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { images: { file: string; w: number; h: number }[]; designs: { key: string; title: string; doc: DesignDoc }[] };
  assert.ok(manifest.designs.length >= 4);
  for (const d of manifest.designs) {
    const doc = { ...d.doc, items: d.doc.items.map((it) => (it.productId.startsWith('sku:') ? { ...it, productId: idOf(it.productId.slice(4)) } : it)) };
    for (const it of doc.items) assert.ok(getProduct(it.productId), `${d.title}: ${it.productId} exists`);
    assert.deepEqual(layoutProblems(doc), [], d.title);
  }
  for (const im of manifest.images) {
    assert.ok(fs.existsSync(path.join(path.dirname(file), im.file)), im.file);
    assert.ok(im.w >= 1000 && im.h >= 675, `${im.file} is a sensible size`);
    assert.ok(fs.statSync(path.join(path.dirname(file), im.file)).size < 400_000, `${im.file} is compressed`);
  }
});
