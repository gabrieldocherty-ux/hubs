// The structured description sent with a render (docs/SHOWROOM_PIVOT.md §7): the room, its
// finishes and the products, as the client built it from the design. Cleaned here, because it goes
// to an outside service and is stored: short strings, bounded lists, finite numbers, nothing else.
//
//   Scene = {
//     room: { kind: 'kitchen' | 'bathroom', widthIn, lengthIn, ceilingIn, shape? },
//     style: string,                       // the design's style or preset name, if any
//     finishes: { cabinets, doorStyle, hardware, countertop, backsplash, flooring, walls },
//     products: [{ name, brand, category, finish, count }],   // at most 60
//     camera: { view: 'current' | 'overview' | 'eye', widthPx, heightPx },
//     showroom: string,                    // the company's name (set by the server)
//   }

const FINISH_KEYS = ['cabinets', 'doorStyle', 'hardware', 'countertop', 'backsplash', 'flooring', 'walls'];
const MAX_PRODUCTS = 60;

const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
};

/**
 * @param {unknown} raw  the client's scene (any shape)
 * @param {{ showroom?: string, designName?: string }} [o]
 */
export function cleanScene(raw, { showroom = '', designName = '' } = {}) {
  const r = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
  const room = r.room && typeof r.room === 'object' ? r.room : {};
  const finishes = r.finishes && typeof r.finishes === 'object' ? r.finishes : {};
  const camera = r.camera && typeof r.camera === 'object' ? r.camera : {};
  const products = [];
  if (Array.isArray(r.products)) {
    for (const p of r.products.slice(0, MAX_PRODUCTS * 2)) {
      if (!p || typeof p !== 'object') continue;
      const name = str(p.name);
      if (!name) continue;
      const count = num(p.count, 1, 999);
      products.push({ name, brand: str(p.brand, 80), category: str(p.category, 40), finish: str(p.finish, 80), count: count ? Math.round(count) : 1 });
      if (products.length >= MAX_PRODUCTS) break;
    }
  }
  /** @type {Record<string, string>} */
  const fin = {};
  for (const k of FINISH_KEYS) {
    const v = str(finishes[k], 80);
    if (v) fin[k] = v;
  }
  return {
    room: {
      kind: room.kind === 'bathroom' ? 'bathroom' : 'kitchen',
      widthIn: num(room.widthIn, 12, 2400),
      lengthIn: num(room.lengthIn, 12, 2400),
      ceilingIn: num(room.ceilingIn, 60, 400),
      ...(str(room.shape, 80) ? { shape: str(room.shape, 80) } : {}),
    },
    name: str(designName, 120),
    style: str(r.style, 80),
    finishes: fin,
    products,
    camera: {
      view: ['current', 'overview', 'eye'].includes(camera.view) ? camera.view : 'current',
      widthPx: num(camera.widthPx, 1, 8192),
      heightPx: num(camera.heightPx, 1, 8192),
    },
    showroom: str(showroom, 120),
  };
}

const feet = (inches) => {
  if (!inches) return null;
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return inch ? `${ft}′${inch}″` : `${ft}′`;
};

/**
 * A plain-language prompt for the AI, from a cleaned scene: what the image is, the finishes and
 * the products to keep. The image stays the authority on layout; this says what things are.
 */
export function scenePrompt(scene) {
  const parts = [];
  const shape = scene.room.shape ? ` (${scene.room.shape})` : '';
  const size = scene.room.widthIn && scene.room.lengthIn ? ` about ${feet(scene.room.widthIn)} by ${feet(scene.room.lengthIn)}${scene.room.shape ? ' at its widest' : ''}${shape}` : '';
  parts.push(`A photorealistic interior photograph of this ${scene.room.kind}${size}, from exactly the camera position, layout and proportions of the attached 3D view. Keep every cabinet, appliance and fixture where it is; do not add, remove or move anything.`);
  if (scene.style) parts.push(`Style: ${scene.style}.`);
  const f = scene.finishes;
  const fin = [
    f.cabinets && `cabinets in ${f.cabinets}${f.doorStyle ? ` (${f.doorStyle} doors)` : ''}`,
    f.hardware && `${f.hardware} hardware`,
    f.countertop && `${f.countertop} countertops`,
    f.backsplash && `${f.backsplash} backsplash`,
    f.flooring && `${f.flooring} flooring`,
    f.walls && `${f.walls} walls`,
  ].filter(Boolean);
  if (fin.length) parts.push(`Finishes: ${fin.join(', ')}.`);
  if (scene.products.length) {
    const list = scene.products.map((p) => `${p.count > 1 ? `${p.count} × ` : ''}${p.name}${p.finish ? ` (${p.finish})` : ''}`);
    parts.push(`Products in the room: ${list.join('; ')}.`);
  }
  parts.push('Natural daylight, realistic materials and soft shadows. No people, no text, no logos, no watermarks.');
  return parts.join(' ');
}
