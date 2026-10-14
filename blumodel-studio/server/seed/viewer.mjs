// Viewer demo data (package A): one fictional demo brand with two published GLB products that
// show off the realistic viewer: a 30″ range and a dome pendant, each built from real geometry
// (not a single box) with `blumodel_*` material slots, so finishes switch the model live and the
// hardware follows the kitchen. Idempotent: running it again changes nothing.
//
//   export async function seed(ctx)   ctx = { db, config, services, now, forceDemo? }
//
// Every name here is fictional and labelled "(Demo)". No real company is named.

import { packGlb } from '../lib/synth.mjs';
import { randomId } from '../lib/ids.mjs';

export const VIEWER_DEMO_BRAND = { slug: 'ashgrove-studio-demo', name: 'Ashgrove Studio (Demo)' };

// ─── A tiny GLB builder: boxes and lathed solids, one primitive per material ─────────────

function meshBuilder() {
  /** @type {Map<string, { pos: number[], nrm: number[], idx: number[] }>} */
  const byMat = new Map();
  const bucket = (m) => {
    let b = byMat.get(m);
    if (!b) byMat.set(m, (b = { pos: [], nrm: [], idx: [] }));
    return b;
  };
  const quad = (b, corners, n) => {
    const base = b.pos.length / 3;
    for (const c of corners) {
      b.pos.push(...c);
      b.nrm.push(...n);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  return {
    /** An axis-aligned box from `min` to `max` (metres). */
    box(min, max, material) {
      const b = bucket(material);
      const [x0, y0, z0] = min;
      const [x1, y1, z1] = max;
      quad(b, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
      quad(b, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
      quad(b, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
      quad(b, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
      quad(b, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
      quad(b, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
    },
    /**
     * A solid of revolution: `profile` is [radius, along] pairs, revolved around an axis through
     * (cx, cy, cz) along `axis`: 'y' (default, upright), 'z' (a knob facing the front) or 'x'
     * (a horizontal bar).
     */
    lathe(profile, material, { cx = 0, cy = 0, cz = 0, seg = 32, axis = 'y' } = {}) {
      const b = bucket(material);
      for (let i = 0; i < profile.length - 1; i++) {
        const [r0, y0] = profile[i];
        const [r1, y1] = profile[i + 1];
        // Slope normal of this band (outward), in the profile plane.
        const dy = y1 - y0;
        const dr = r1 - r0;
        const len = Math.hypot(dy, dr) || 1;
        const nr = dy / len;
        const ny = -dr / len;
        for (let s = 0; s < seg; s++) {
          const a0 = (s / seg) * Math.PI * 2;
          const a1 = ((s + 1) / seg) * Math.PI * 2;
          const pt = (r, y, a) => {
            const u = Math.cos(a) * r;
            const v = Math.sin(a) * r;
            return axis === 'z' ? [cx + u, cy + v, cz + y] : axis === 'x' ? [cx + y, cy + u, cz + v] : [cx + u, cy + y, cz + v];
          };
          const nm = (a) => {
            const u = Math.cos(a) * nr;
            const v = Math.sin(a) * nr;
            return axis === 'z' ? [u, v, ny] : axis === 'x' ? [ny, u, v] : [u, ny, v];
          };
          const base = b.pos.length / 3;
          for (const [p, n] of [
            [pt(r0, y0, a0), nm(a0)],
            [pt(r0, y0, a1), nm(a1)],
            [pt(r1, y1, a1), nm(a1)],
            [pt(r1, y1, a0), nm(a0)],
          ]) {
            b.pos.push(...p);
            b.nrm.push(...n);
          }
          // Counter-clockwise seen from the side the normal points to (the z and x mappings are mirrored).
          if (axis === 'z' || axis === 'x') b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
    },
    /** Packs everything into a GLB. `materials` gives each material's PBR look. */
    toGlb(materials) {
      const names = [...byMat.keys()];
      const chunks = [];
      const bufferViews = [];
      const accessors = [];
      const primitives = [];
      let offset = 0;
      const push = (buf, target) => {
        const pad = (4 - (buf.length % 4)) % 4;
        const padded = pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf;
        bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
        chunks.push(padded);
        offset += padded.length;
        return bufferViews.length - 1;
      };
      names.forEach((name, k) => {
        const b = byMat.get(name);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < b.pos.length; i += 3)
          for (let j = 0; j < 3; j++) {
            min[j] = Math.min(min[j], b.pos[i + j]);
            max[j] = Math.max(max[j], b.pos[i + j]);
          }
        const count = b.pos.length / 3;
        const pv = push(Buffer.from(new Float32Array(b.pos).buffer), 34962);
        accessors.push({ bufferView: pv, componentType: 5126, count, type: 'VEC3', min, max });
        const nv = push(Buffer.from(new Float32Array(b.nrm).buffer), 34962);
        accessors.push({ bufferView: nv, componentType: 5126, count, type: 'VEC3' });
        const big = count > 65535;
        const iv = push(Buffer.from((big ? new Uint32Array(b.idx) : new Uint16Array(b.idx)).buffer), 34963);
        accessors.push({ bufferView: iv, componentType: big ? 5125 : 5123, count: b.idx.length, type: 'SCALAR' });
        primitives.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: k });
      });
      const bin = Buffer.concat(chunks);
      const gltf = {
        asset: { version: '2.0', generator: 'blumodel viewer seed' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'product' }],
        meshes: [{ name: 'product', primitives }],
        materials: names.map((name) => {
          const m = materials[name] ?? {};
          return {
            name,
            pbrMetallicRoughness: { baseColorFactor: m.color ?? [0.8, 0.8, 0.8, 1], metallicFactor: m.metallic ?? 0, roughnessFactor: m.roughness ?? 0.6 },
            ...(m.doubleSided ? { doubleSided: true } : {}),
            ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
          };
        }),
        accessors,
        bufferViews,
        buffers: [{ byteLength: bin.length }],
      };
      return packGlb(gltf, bin);
    },
  };
}

const IN = 0.0254;
/** Inches → metres for a point. */
const P = (x, y, z) => [x * IN, y * IN, z * IN];

/**
 * A 30″ pro-style range, 30 W × 37 H × 29 D in overall (carcass 26″ deep, door, knobs and
 * handle in front of it). Body, door and control panel are the finish slot; knobs and the
 * handle are the hardware slot.
 */
export function rangeGlb() {
  const m = meshBuilder();
  const zb = -14.5; // back
  const zf = 11.5; // front of the carcass
  m.box(P(-14.6, 0, zb + 0.5), P(14.6, 4, zf - 2), 'plinth');
  m.box(P(-15, 4, zb), P(15, 35, zf), 'blumodel_finish'); // carcass
  m.box(P(-14.85, 5.5, zf), P(14.85, 29.6, zf + 1), 'blumodel_finish'); // oven door
  m.box(P(-10, 11, zf + 1), P(10, 22, zf + 1.05), 'oven_glass');
  m.box(P(-14.85, 30, zf), P(14.85, 35, zf + 1), 'blumodel_finish'); // control panel
  m.box(P(-15, 35, zb), P(15, 36, zf + 1), 'cooktop');
  // Handle: a bar on two posts, across the top of the door.
  m.lathe([[0.45 * IN, -12.5 * IN], [0.45 * IN, 12.5 * IN]], 'blumodel_hardware', { cx: 0, cy: 27.6 * IN, cz: (zf + 2.6) * IN, axis: 'x', seg: 20 });
  for (const x of [-11.5, 11.5]) m.box(P(x - 0.3, 27.3, zf + 1), P(x + 0.3, 27.9, zf + 2.6), 'blumodel_hardware');
  // Five knobs on the control panel, facing the front.
  for (let i = 0; i < 5; i++) {
    const cx = -15 + 6 * (i + 0.5);
    m.lathe([[0.9 * IN, 0], [0.95 * IN, 0.5 * IN], [0.85 * IN, 1.1 * IN], [0.01 * IN, 1.15 * IN]], 'blumodel_hardware', { cx: cx * IN, cy: 32.5 * IN, cz: (zf + 1) * IN, axis: 'z', seg: 24 });
  }
  // Four sealed burners with cast-iron grates.
  for (const [bx, bz] of [[-7, -8], [7, -8], [-7, 4], [7, 4]]) {
    m.lathe([[2.6 * IN, 0], [2.6 * IN, 0.35 * IN], [1.2 * IN, 0.45 * IN], [0.01 * IN, 0.5 * IN]], 'burner', { cx: bx * IN, cy: 36 * IN, cz: bz * IN, seg: 28 });
    m.box(P(bx - 5.5, 36.4, bz - 0.3), P(bx + 5.5, 37, bz + 0.3), 'grate');
    m.box(P(bx - 0.3, 36.4, bz - 5), P(bx + 0.3, 37, bz + 5), 'grate');
  }
  return m.toGlb({
    plinth: { color: [0.08, 0.08, 0.085, 1], roughness: 0.8 },
    blumodel_finish: { color: [0.76, 0.77, 0.78, 1], metallic: 0.9, roughness: 0.3 },
    blumodel_hardware: { color: [0.8, 0.8, 0.82, 1], metallic: 1, roughness: 0.25 },
    oven_glass: { color: [0.03, 0.035, 0.04, 1], metallic: 0.2, roughness: 0.08 },
    cooktop: { color: [0.06, 0.06, 0.065, 1], metallic: 0.3, roughness: 0.5 },
    burner: { color: [0.12, 0.12, 0.13, 1], metallic: 0.6, roughness: 0.45 },
    grate: { color: [0.05, 0.05, 0.05, 1], metallic: 0.3, roughness: 0.75 },
  });
}

/**
 * A dome pendant, 14″ across and 50″ from the shade's rim to the ceiling canopy (it hangs at
 * 58″ under a 9′ ceiling). The shade is the finish slot; the socket cup and canopy are the
 * hardware slot.
 */
export function pendantGlb() {
  const m = meshBuilder();
  const R = 7 * IN;
  const H = 8 * IN;
  const top = 50 * IN;
  // Dome: a quarter ellipse from the rim up to the crown.
  const dome = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * (Math.PI / 2);
    dome.push([Math.max(0.0002, R * Math.cos(t)), H * Math.sin(t)]);
  }
  m.lathe(dome, 'blumodel_finish', { seg: 48 });
  m.lathe(dome.map(([r, y]) => [r * 0.97, y * 0.97]).reverse(), 'shade_inner', { seg: 48 });
  m.lathe([[0.0002, 1.8 * IN], [1.4 * IN, 2 * IN], [1.6 * IN, 2.8 * IN], [1.1 * IN, 3.8 * IN], [0.0002, 3.9 * IN]], 'bulb', { seg: 20 });
  m.lathe([[0.9 * IN, H - 0.2 * IN], [0.9 * IN, H + 1.6 * IN], [0.0002, H + 1.7 * IN]], 'blumodel_hardware', { seg: 20 }); // socket cup
  m.lathe([[0.12 * IN, H + 1.7 * IN], [0.12 * IN, top - 0.7 * IN]], 'cord', { seg: 8 });
  m.lathe([[0.0002, top - 0.75 * IN], [2.4 * IN, top - 0.7 * IN], [2.4 * IN, top]], 'blumodel_hardware', { seg: 28 }); // canopy
  return m.toGlb({
    blumodel_finish: { color: [0.16, 0.25, 0.21, 1], roughness: 0.45 },
    shade_inner: { color: [1, 0.97, 0.9, 1], roughness: 0.6, doubleSided: true, emissive: [0.9, 0.75, 0.5] },
    bulb: { color: [1, 0.95, 0.85, 1], roughness: 0.2, emissive: [1, 0.85, 0.6] },
    blumodel_hardware: { color: [0.78, 0.63, 0.36, 1], metallic: 1, roughness: 0.3 },
    cord: { color: [0.08, 0.08, 0.08, 1], roughness: 0.7 },
  });
}

const PRODUCTS = [
  {
    key: 'range',
    glb: rangeGlb,
    spec: {
      kind: 'range',
      variant: 'gas-4',
      category: 'appliances',
      name: 'Ashgrove 30″ Pro Range (Demo)',
      blurb:
        'A demo product for the realistic viewer: four sealed burners on a matte cooktop, a full-width oven window and pro knobs. Switch the finish to see the 3D model change. Fictional brand, illustrative price.',
      sku: 'ASH-PR30',
      widthIn: 30,
      depthIn: 29,
      heightIn: 37,
      elevationIn: 0,
      price: 3299,
      finishes: [
        { id: 'stainless', name: 'Stainless', hex: '#c3c6ca', material: 'metal' },
        { id: 'matte-black', name: 'Matte Black', hex: '#2b2c2e', material: 'metal' },
        { id: 'sage', name: 'Sage', hex: '#8a9a7b', material: 'paint' },
        { id: 'cream', name: 'Cream', hex: '#efe6d2', material: 'paint' },
      ],
      imageFileIds: [],
      buyUrl: 'https://example.com/ashgrove/pro-range-30',
    },
  },
  {
    key: 'pendant',
    glb: pendantGlb,
    spec: {
      kind: 'pendant',
      variant: 'dome',
      category: 'lighting',
      name: 'Ashgrove Dome Pendant (Demo)',
      blurb: 'A demo dome pendant with a brass canopy and socket that follow the kitchen’s hardware. Fictional brand, illustrative price.',
      sku: 'ASH-DP14',
      widthIn: 14,
      depthIn: 14,
      heightIn: 50,
      elevationIn: 58,
      price: 289,
      finishes: [
        { id: 'forest', name: 'Forest', hex: '#2f4a3c', material: 'paint' },
        { id: 'chalk', name: 'Chalk', hex: '#ece6da', material: 'paint' },
        { id: 'black', name: 'Black', hex: '#1d1d1f', material: 'metal' },
      ],
      imageFileIds: [],
      buyUrl: 'https://example.com/ashgrove/dome-pendant',
    },
  },
];

/** @param {{ db: import('node:sqlite').DatabaseSync, config: any, services: any, now?: () => number, forceDemo?: boolean }} ctx */
export async function seed(ctx) {
  const { db, config, services } = ctx;
  // The seed runner (server/seed/index.mjs) refuses production itself unless --force-demo, and
  // then calls every module with `demo` (what the core seed made) but no `forceDemo`. Called any
  // other way in production, this seed needs `forceDemo`.
  if (config?.PROD && !ctx.forceDemo && !ctx.demo) return { skipped: 'production (pass --force-demo)' };
  const now = ctx.now ?? Date.now;
  const created = [];

  let brand = services.brands.bySlug(VIEWER_DEMO_BRAND.slug);
  if (!brand) {
    const t = now();
    const id = randomId('b_');
    const owner = db.prepare("SELECT id FROM users WHERE email = 'demo-brand@blumodel.test'").get();
    db.prepare(
      `INSERT INTO brands (id, slug, name, tagline, description, website, status, verified_at, is_demo, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 'active', NULL, 1, ?, ?, ?)`,
    ).run(
      id,
      VIEWER_DEMO_BRAND.slug,
      VIEWER_DEMO_BRAND.name,
      'Demo products for the realistic viewer',
      'A fictional brand that shows how GLB products look on their product pages and in a kitchen. Not a real company.',
      owner?.id ?? null,
      t,
      t,
    );
    if (owner) db.prepare("INSERT OR IGNORE INTO brand_members (brand_id, user_id, member_role, created_at) VALUES (?, ?, 'owner', ?)").run(id, owner.id, t);
    brand = services.brands.get(id);
    created.push(`brand ${brand.slug}`);
  }

  for (const p of PRODUCTS) {
    const exists = db.prepare('SELECT id FROM products WHERE brand_id = ? AND name = ?').get(brand.id, p.spec.name);
    if (exists) continue;
    const file = services.files.saveBuffer(p.glb(), { kind: 'model', visibility: 'public', brandId: brand.id, originalName: `${p.key}.glb` });
    const checked = services.products.validateSpec({ ...p.spec, modelFileId: file.id });
    if (!checked.ok) throw new Error(`viewer seed: ${p.spec.name}: ${JSON.stringify(checked.errors)}`);
    const row = services.products.create({ source: 'brand', brandId: brand.id, visibility: 'public', spec: checked.spec });
    services.products.publish(row.id);
    created.push(`product ${row.id} (${p.spec.name})`);
  }
  return { created };
}
