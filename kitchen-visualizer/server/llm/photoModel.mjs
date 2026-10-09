// The photo model's limits and its validator, shared by the server (which checks what the
// photo analyser returns) and the browser (which checks what the "Check the space" form holds).
// Pure: no Node or DOM imports, so Vite bundles it for the client as-is. Types live in
// src/lib/generate/photoModel.ts; photoModel.d.mts declares this module for TypeScript.
//
// The finish choices mirror src/data/finishes.ts (ids, names, colours); a unit test keeps the
// two in step. Every value is clamped to the editor's own ranges, so a model can always be built.

export const WALLS = ['north', 'east', 'south', 'west'];
export const APPLIANCE_KINDS = ['sink', 'range', 'cooktop', 'wall-oven', 'fridge', 'dishwasher', 'hood', 'microwave'];
export const CABINET_DOORS = ['shaker', 'slab', 'fluted', 'glass'];

/** Width range and default (inches) per appliance kind. */
export const APPLIANCE_WIDTHS = {
  sink: { min: 15, max: 48, def: 33 },
  range: { min: 24, max: 60, def: 30 },
  cooktop: { min: 24, max: 48, def: 30 },
  'wall-oven': { min: 24, max: 36, def: 30 },
  fridge: { min: 24, max: 48, def: 36 },
  dishwasher: { min: 18, max: 24, def: 24 },
  hood: { min: 24, max: 60, def: 30 },
  microwave: { min: 24, max: 36, def: 30 },
};

export const LIMITS = {
  room: { widthIn: [72, 480], lengthIn: [72, 480], ceilingIn: [90, 144] },
  maxOpenings: 12,
  maxRuns: 8,
  maxAppliances: 16,
  window: { widthIn: [18, 96], heightIn: [12, 96], sillIn: [0, 72] },
  door: { widthIn: [24, 96], heightIn: [72, 96] },
  minRunIn: 12,
  island: { widthIn: [48, 120], depthIn: [24, 60], seats: [0, 6] },
  maxNotes: 6,
};

export const DEFAULT_ROOM = { widthIn: 168, lengthIn: 144, ceilingIn: 108 };

/** The finishes a photo can be matched to (src/data/finishes.ts). */
export const FINISH_CHOICES = {
  cabinet: [
    { id: 'white-oak', name: 'Rift White Oak', hex: '#c9a57a' },
    { id: 'walnut', name: 'American Walnut', hex: '#6b4630' },
    { id: 'warm-white', name: 'Warm Linen', hex: '#efe9dd' },
    { id: 'greige', name: 'Stone Greige', hex: '#c8bfae' },
    { id: 'sage', name: 'Sage Leaf', hex: '#9aa88c' },
    { id: 'forest', name: 'Deep Forest', hex: '#3e5244' },
    { id: 'navy', name: 'Harbor Navy', hex: '#2f3c52' },
    { id: 'charcoal', name: 'Smoked Charcoal', hex: '#393835' },
    { id: 'clay', name: 'Fired Clay', hex: '#b86a4b' },
  ],
  countertop: [
    { id: 'calacatta', name: 'Calacatta Luxe Quartz', hex: '#efebe4' },
    { id: 'carrara', name: 'Carrara Mist Quartz', hex: '#e9e9e7' },
    { id: 'nero', name: 'Nero Marquina', hex: '#232221' },
    { id: 'soapstone', name: 'Honed Soapstone', hex: '#4a4d4c' },
    { id: 'terrazzo', name: 'Venetian Terrazzo', hex: '#ece6dc' },
    { id: 'concrete', name: 'Cast Concrete', hex: '#a8a39b' },
    { id: 'butcher', name: 'Maple Butcher Block', hex: '#d2a86e' },
  ],
  backsplash: [
    { id: 'subway-white', name: 'Gloss Subway 3×6', hex: '#f3f1ec' },
    { id: 'zellige-sage', name: 'Zellige, Sage', hex: '#a3b29a' },
    { id: 'zellige-white', name: 'Zellige, Chalk', hex: '#efeae0' },
    { id: 'stack-terracotta', name: 'Vertical Stack, Terracotta', hex: '#c07353' },
    { id: 'stack-ink', name: 'Vertical Stack, Ink', hex: '#2e3440' },
    { id: 'slab-match', name: 'Full Slab (matches counter)', hex: '#efebe4' },
  ],
  flooring: [
    { id: 'oak-natural', name: 'Wide Plank, Natural Oak', hex: '#caa27a' },
    { id: 'oak-smoked', name: 'Wide Plank, Smoked Oak', hex: '#7b5d45' },
    { id: 'herringbone', name: 'Herringbone, Honey Oak', hex: '#c39062' },
    { id: 'checker', name: 'Checkerboard Marble', hex: '#bdb6aa' },
    { id: 'terracotta', name: 'Terracotta Square', hex: '#b8694a' },
    { id: 'porcelain', name: 'Large Format, Limestone', hex: '#d8d1c4' },
    { id: 'concrete-floor', name: 'Polished Concrete', hex: '#9d9993' },
  ],
  hardware: [
    { id: 'brass', name: 'Brushed Brass', hex: '#c6a15b' },
    { id: 'black', name: 'Matte Black', hex: '#1d1d1d' },
    { id: 'nickel', name: 'Polished Nickel', hex: '#d7d7d2' },
    { id: 'bronze', name: 'Oil-Rubbed Bronze', hex: '#4a3527' },
  ],
  paint: [
    { id: 'chalk', name: 'Chalk White', hex: '#f1ece3' },
    { id: 'bone', name: 'Bone Greige', hex: '#ddd4c4' },
    { id: 'butter', name: 'Soft Butter', hex: '#eee0b8' },
    { id: 'sage-wall', name: 'Garden Sage', hex: '#b9c2ad' },
    { id: 'blush', name: 'Plaster Blush', hex: '#e6cdbf' },
    { id: 'fog', name: 'Harbor Fog', hex: '#c3cacd' },
    { id: 'olive', name: 'Olive Grove', hex: '#7d7c5a' },
    { id: 'ink', name: 'Night Ink', hex: '#353a43' },
  ],
};

export const DEFAULT_STYLE = {
  cabinetHex: '#efe9dd',
  cabinetDoor: 'shaker',
  counter: 'calacatta',
  backsplash: 'subway-white',
  floor: 'oak-natural',
  hardware: 'brass',
  wall: 'chalk',
};

const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Perceptual-ish colour distance (weighted RGB, "redmean"). */
export function colorDistance(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

/** The finish in `list` closest in colour to `hex`. */
export function closestFinish(list, hex) {
  let best = list[0];
  let bestD = Infinity;
  for (const f of list) {
    const d = colorDistance(f.hex, hex);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const half = (n) => Math.round(n * 2) / 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wallLen = (wall, room) => (wall === 'north' || wall === 'south' ? room.widthIn : room.lengthIn);
const ft = (n) => `${Math.floor(n / 12)}′${n % 12 ? ` ${Math.round(n % 12)}″` : ''}`;

function confidenceOf(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(clamp(n, 0, 1) * 100) / 100 : undefined;
}

/**
 * Validates and clamps a photo model, from the photo analyser or from the browser's form.
 * Accepts per-item `confidence` fields (the analyser's shape) or a `confidence` map (the
 * stored shape) and always returns the map. Returns null only when there is no usable room.
 * @param {unknown} raw
 * @returns {{ model: import('../../src/lib/generate/photoModel').PhotoModel, warnings: string[] } | null}
 */
export function clampPhotoModel(raw) {
  if (!isObj(raw) || !isObj(raw.room)) return null;
  const warnings = [];
  const confidence = {};
  const setConf = (key, v) => {
    const c = confidenceOf(v);
    if (c !== undefined) confidence[key] = c;
  };
  if (isObj(raw.confidence)) for (const [k, v] of Object.entries(raw.confidence)) if (typeof k === 'string' && k.length <= 40) setConf(k, v);

  const dim = (v, [lo, hi], def, label) => {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return def;
    const c = half(clamp(n, lo, hi));
    if (Math.abs(c - n) > 0.5 && label) warnings.push(`${label} ${Math.round(n)}″ is outside ${ft(lo)}–${ft(hi)}; set to ${ft(c)}.`);
    return c;
  };

  const room = {
    widthIn: dim(raw.room.widthIn, LIMITS.room.widthIn, DEFAULT_ROOM.widthIn, 'Room width'),
    lengthIn: dim(raw.room.lengthIn, LIMITS.room.lengthIn, DEFAULT_ROOM.lengthIn, 'Room length'),
    ceilingIn: dim(raw.room.ceilingIn, LIMITS.room.ceilingIn, DEFAULT_ROOM.ceilingIn, 'Ceiling height'),
  };
  setConf('room', raw.room.confidence);

  const openings = [];
  for (const o of Array.isArray(raw.openings) ? raw.openings : []) {
    if (openings.length >= LIMITS.maxOpenings) {
      warnings.push(`Only the first ${LIMITS.maxOpenings} windows and doors were kept.`);
      break;
    }
    if (!isObj(o) || (o.type !== 'window' && o.type !== 'door') || !WALLS.includes(o.wall)) continue;
    const len = wallLen(o.wall, room);
    const lim = o.type === 'window' ? LIMITS.window : LIMITS.door;
    const widthIn = Math.min(dim(o.widthIn, lim.widthIn, o.type === 'window' ? 36 : 32), len);
    const out = { type: o.type, wall: o.wall, offsetIn: half(clamp(dim(o.offsetIn, [0, 480], 0), 0, len - widthIn)), widthIn };
    out.heightIn = dim(o.heightIn, lim.heightIn, o.type === 'window' ? 42 : 80);
    if (o.type === 'window') out.sillIn = dim(o.sillIn, LIMITS.window.sillIn, 42);
    setConf(`openings.${openings.length}`, o.confidence);
    openings.push(out);
  }

  const runs = [];
  for (const r of Array.isArray(raw.runs) ? raw.runs : []) {
    if (runs.length >= LIMITS.maxRuns) break;
    if (!isObj(r) || !WALLS.includes(r.wall)) continue;
    const len = wallLen(r.wall, room);
    const startIn = half(clamp(dim(r.startIn, [0, 480], 0), 0, len));
    const endIn = half(clamp(dim(r.endIn, [0, 480], len), 0, len));
    const [a, b] = startIn <= endIn ? [startIn, endIn] : [endIn, startIn];
    if (b - a < LIMITS.minRunIn) {
      warnings.push(`A cabinet run on the ${r.wall} wall was shorter than a foot and was left out.`);
      continue;
    }
    setConf(`runs.${runs.length}`, r.confidence);
    runs.push({ wall: r.wall, startIn: a, endIn: b, upper: r.upper !== false });
  }

  let island = null;
  if (isObj(raw.island)) {
    island = {
      widthIn: dim(raw.island.widthIn, LIMITS.island.widthIn, 84, 'Island length'),
      depthIn: dim(raw.island.depthIn, LIMITS.island.depthIn, 42, 'Island depth'),
      seats: Math.round(clamp(Number(raw.island.seats) || 0, ...LIMITS.island.seats)),
      pendants: raw.island.pendants === true,
    };
    setConf('island', raw.island.confidence);
  }

  const appliances = [];
  for (const a of Array.isArray(raw.appliances) ? raw.appliances : []) {
    if (appliances.length >= LIMITS.maxAppliances) break;
    if (!isObj(a) || !APPLIANCE_KINDS.includes(a.kind)) continue;
    const onIsland = a.wall === 'island';
    if (!onIsland && !WALLS.includes(a.wall)) continue;
    if (onIsland && !island) continue;
    const w = APPLIANCE_WIDTHS[a.kind];
    const len = onIsland ? island.widthIn : wallLen(a.wall, room);
    const widthIn = Math.min(dim(a.widthIn, [w.min, w.max], w.def), len);
    setConf(`appliances.${appliances.length}`, a.confidence);
    appliances.push({ kind: a.kind, wall: a.wall, offsetIn: half(clamp(dim(a.offsetIn, [0, 480], 0), 0, len - widthIn)), widthIn });
  }

  const s = isObj(raw.style) ? raw.style : {};
  const pick = (list, v, def) => {
    if (typeof v === 'string') {
      const byId = list.find((f) => f.id === v);
      if (byId) return byId.id;
      if (HEX.test(v)) return closestFinish(list, v.toLowerCase()).id;
    }
    return def;
  };
  const style = {
    cabinetHex: typeof s.cabinetHex === 'string' && HEX.test(s.cabinetHex) ? s.cabinetHex.toLowerCase() : DEFAULT_STYLE.cabinetHex,
    cabinetDoor: CABINET_DOORS.includes(s.cabinetDoor) ? s.cabinetDoor : DEFAULT_STYLE.cabinetDoor,
    counter: pick(FINISH_CHOICES.countertop, s.counter, DEFAULT_STYLE.counter),
    backsplash: pick(FINISH_CHOICES.backsplash, s.backsplash, DEFAULT_STYLE.backsplash),
    floor: pick(FINISH_CHOICES.flooring, s.floor, DEFAULT_STYLE.floor),
    hardware: pick(FINISH_CHOICES.hardware, s.hardware, DEFAULT_STYLE.hardware),
    wall: pick(FINISH_CHOICES.paint, s.wall, DEFAULT_STYLE.wall),
  };
  setConf('style', s.confidence);

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter((n) => typeof n === 'string' && n.trim())
    .slice(0, LIMITS.maxNotes)
    .map((n) => n.trim().slice(0, 200));

  return { model: { version: 1, room, openings, runs, appliances, island, style, confidence, notes }, warnings };
}

const num = { type: 'number' };
const conf = { type: 'number', description: '0 (a guess) to 1 (clearly visible and measurable).' };
const wall = { type: 'string', enum: WALLS };
const ids = (list) => ({ type: 'string', enum: list.map((f) => f.id) });

/** JSON Schema for the analyser's answer (structured outputs: every object closed, no numeric bounds). */
export function photoModelJsonSchema() {
  const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  return obj({
    room: obj({ widthIn: num, lengthIn: num, ceilingIn: num, confidence: conf }),
    openings: {
      type: 'array',
      items: obj({ type: { type: 'string', enum: ['window', 'door'] }, wall, offsetIn: num, widthIn: num, heightIn: num, sillIn: num, confidence: conf }),
    },
    runs: { type: 'array', items: obj({ wall, startIn: num, endIn: num, upper: { type: 'boolean' }, confidence: conf }) },
    appliances: {
      type: 'array',
      items: obj({ kind: { type: 'string', enum: APPLIANCE_KINDS }, wall: { type: 'string', enum: [...WALLS, 'island'] }, offsetIn: num, widthIn: num, confidence: conf }),
    },
    island: { anyOf: [obj({ widthIn: num, depthIn: num, seats: { type: 'integer' }, pendants: { type: 'boolean' }, confidence: conf }), { type: 'null' }] },
    style: obj({
      cabinetHex: { type: 'string', description: 'Main cabinet colour as #rrggbb.' },
      cabinetDoor: { type: 'string', enum: CABINET_DOORS },
      counter: ids(FINISH_CHOICES.countertop),
      backsplash: ids(FINISH_CHOICES.backsplash),
      floor: ids(FINISH_CHOICES.flooring),
      hardware: ids(FINISH_CHOICES.hardware),
      wall: ids(FINISH_CHOICES.paint),
      confidence: conf,
    }),
    notes: { type: 'array', items: { type: 'string' } },
  });
}
