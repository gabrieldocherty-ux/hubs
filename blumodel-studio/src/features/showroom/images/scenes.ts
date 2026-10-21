import type { BrandPrefs, DesignDoc, DoorStyle, PlacedItem, Product, Room, Surfaces } from '../../../types';
import { getProduct, isOpening } from '../../../data/catalog';
import { buildFromSpec, type LayoutSpec, type RunSpec } from '../../../lib/generate/layout';
import { cleanBrandPrefs } from '../../../lib/generate/brands';
import { finishList } from '../../../lib/finish';
import { withFinishIds } from '../../../lib/doc';
import { resolveAll, type Resolved } from '../../../lib/geometry';
import { runChecks } from '../../../lib/checks';
import { luminance } from '../../../lib/color';
import { CABINET_FINISHES } from '../../../data/finishes';
import type { ShowroomLine } from '../lines';
import { addRoom, bumpWall, connectNewRoom, isError, layoutPotLights, type Draft } from '../../../lib/roomEdit';
import { wallSegs } from '../../../lib/outline';
import { bathLayoutItems } from '../../../data/bathLayouts';

/**
 * The showroom's pictures as scenes (docs/handoff/showroom-images.md): finished kitchens built by
 * the app's own layout builder from the company's lines, staged with finishes that suit each line,
 * and the camera shots to render of each. Pure apart from the catalog registry, so the generator
 * page (ShowroomImagesPage) renders them and a test can check every layout.
 *
 * Coordinates: a doc is in room inches (x east from the west wall, y south from the north wall);
 * a camera is in the 3D view's feet (x east, y up, z south).
 */

export type Vec3 = [number, number, number];
export interface CameraView {
  pos: Vec3;
  target: Vec3;
  fov: number;
}

/** One image to make: where it goes and its size. */
export interface Shot {
  slot: 'hero' | 'heroTall' | 'line' | 'gallery' | 'dream' | 'promo';
  width: number;
  height: number;
  view: CameraView;
  line?: string;
  index?: number;
  title?: string;
}

export interface Scene {
  id: string;
  /** What the generator says while it renders. */
  label: string;
  doc: DesignDoc;
  shots: Shot[];
  /** The layout's problems (the editor's design checks); a scene with any is not rendered. */
  problems: string[];
}

export const HERO_SIZE = { width: 2400, height: 1350 } as const;
export const HERO_TALL_SIZE = { width: 1080, height: 1440 } as const;
export const LINE_SIZE = { width: 1200, height: 900 } as const;
export const GALLERY_SIZE = { width: 1600, height: 1000 } as const;
export const DREAM_SIZE = { width: 1600, height: 1000 } as const;
/** The sales page's slideshow (its stage is 3:2). */
export const PROMO_SIZE = { width: 1500, height: 1000 } as const;

const ROOM_KITCHEN: Room = { widthIn: 228, lengthIn: 192, ceilingIn: 108 };

// ─── the company's lines ─────────────────────────────────────────────────

/** A line made for bathrooms: its sinks are vanities (shallow), it has no kitchen cabinets. */
export function isBathLine(l: ShowroomLine): boolean {
  const sinks = l.products.filter((p) => p.kind === 'sink');
  return sinks.length > 0 && sinks.every((p) => p.depthIn <= 22) && !l.products.some((p) => p.kind === 'base' && p.depthIn >= 23);
}

const hasKind = (l: ShowroomLine, ...kinds: string[]) => l.products.some((p) => kinds.includes(p.kind));
const isCabinetLine = (l: ShowroomLine) => !isBathLine(l) && hasKind(l, 'base', 'wall', 'tall', 'island');

/** Kitchen preferences: every line in its categories (bath lines never fill a kitchen), `first` first. */
function kitchenPrefs(lines: ShowroomLine[], first?: ShowroomLine): BrandPrefs | undefined {
  const out: BrandPrefs = {};
  const kitchen = lines.filter((l) => !isBathLine(l));
  for (const l of [...(first && !isBathLine(first) ? [first] : []), ...kitchen.filter((k) => k !== first)]) {
    for (const c of l.categories) {
      // A second cabinet line would mix door styles in one kitchen: one cabinet line per kitchen.
      if (c === 'cabinets' && out.cabinets?.length) continue;
      (out[c] ??= []).push(l.name);
    }
  }
  return cleanBrandPrefs(out);
}

/**
 * A finish of the line with character, the way the company lists them: its first colour or wood
 * that is neither the plainest white nor near-black (Sage before Navy, Rift Oak before Walnut).
 */
export function signatureFinish(l: ShowroomLine, avoid: string[] = []): string | undefined {
  const all: { id: string; hex: string }[] = [];
  for (const p of [...l.products].sort((a, b) => (b.kind === 'base' ? 1 : 0) - (a.kind === 'base' ? 1 : 0)))
    for (const f of finishList(p)) if (!all.some((x) => x.id === f.id)) all.push({ id: f.id, hex: f.hex });
  const list = all.filter((f) => !avoid.includes(f.id));
  return (list.find((f) => luminance(f.hex) > 0.1 && luminance(f.hex) < 0.7) ?? list[0])?.id;
}

/** The line's whitest finish (a classic white kitchen), or its first. */
function whiteFinish(l: ShowroomLine): string | undefined {
  const all = l.products.flatMap((p) => finishList(p));
  return [...all].sort((a, b) => luminance(b.hex) - luminance(a.hex))[0]?.id;
}

function doorStyleOf(l: ShowroomLine | undefined): DoorStyle {
  return (l?.products.find((p) => p.doorStyle)?.doorStyle as DoorStyle | undefined) ?? 'shaker';
}

/** Surfaces that suit a door style: warm marble and brass for shaker, calmer stone and black for slab. */
function stagingFor(style: DoorStyle, mood: 'warm' | 'calm' | 'classic' = 'warm'): Surfaces {
  if (style === 'slab')
    return mood === 'classic'
      ? { cabinetFinishId: 'white-oak', doorStyle: 'slab', hardwareId: 'black', countertopId: 'carrara', backsplashId: 'slab-match', flooringId: 'oak-natural', paintId: 'chalk' }
      : { cabinetFinishId: 'white-oak', doorStyle: 'slab', hardwareId: 'black', countertopId: 'concrete', backsplashId: 'zellige-white', flooringId: 'oak-natural', paintId: 'bone' };
  if (mood === 'calm') return { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'nickel', countertopId: 'carrara', backsplashId: 'zellige-white', flooringId: 'oak-natural', paintId: 'chalk' };
  if (mood === 'classic') return { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'subway-white', flooringId: 'oak-natural', paintId: 'chalk' };
  return { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' };
}

/** Puts every piece of `line` in `finishId` (where it has it), and the island in `islandFinish`. */
function dress(items: PlacedItem[], line: ShowroomLine | undefined, finishId: string | undefined, islandFinish?: string): PlacedItem[] {
  return items.map((it) => {
    const p = getProduct(it.productId);
    if (!p) return it;
    const want = p.kind === 'island' && islandFinish ? islandFinish : line && p.line === line.name ? finishId : undefined;
    if (!want) return it;
    const list = finishList(p);
    const at = list.findIndex((f) => f.id === want);
    return at >= 0 ? { ...it, finishIndex: at, finishId: want } : it;
  });
}

/** The kitchen-wide cabinet finish nearest a line's finish, so built-in pieces (a sink base, a filler) match it. */
function nearestCabinetFinish(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = fallback;
  let bestD = Infinity;
  for (const f of CABINET_FINISHES) {
    const [r2, g2, b2] = rgb(f.hex);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f.id;
    }
  }
  return best;
}

function finishHex(line: ShowroomLine | undefined, id: string | undefined): string | undefined {
  if (!line || !id) return undefined;
  for (const p of line.products) for (const f of finishList(p)) if (f.id === id) return f.hex;
  return undefined;
}

/** Surfaces with the kitchen-wide cabinet finish set to match the line's. */
function matched(s: Surfaces, line: ShowroomLine | undefined, finishId: string | undefined): Surfaces {
  return { ...s, cabinetFinishId: nearestCabinetFinish(finishHex(line, finishId), s.cabinetFinishId) };
}

/**
 * Seats the company's own stools where the layout put BluModel Basics ones (seating isn't one of
 * the layout builder's brand categories), the same kind of stool where it sells one.
 */
function ownStools(items: PlacedItem[], lines: ShowroomLine[], prefer?: string): PlacedItem[] {
  const stools = lines.flatMap((l) => l.products.filter((p) => p.kind === 'stool'));
  if (!stools.length) return items;
  return items.map((it) => {
    const p = getProduct(it.productId);
    if (!p || p.kind !== 'stool' || p.source === 'tenant') return it;
    const own = stools.find((s) => s.variant === (prefer ?? p.variant)) ?? stools[0];
    return { ...it, productId: own.id, finishIndex: 0, finishId: undefined, widthIn: undefined };
  });
}

function makeDoc(name: string, room: Room, spec: LayoutSpec, surfaces: Surfaces, prefs: BrandPrefs | undefined, keepBasics: boolean, lines: ShowroomLine[], stool?: string): DesignDoc {
  const { items } = buildFromSpec(spec, room, surfaces, prefs);
  // Built-in pieces where the company sells nothing are left out unless it fills the gaps; the
  // room's doors, windows and staging (plants, rugs) stay.
  const kept = ownStools(items, lines, stool).filter((i) => {
    if (keepBasics) return true;
    const p = getProduct(i.productId);
    return !p || p.source === 'tenant' || isOpening(p) || p.category === 'decor';
  });
  return { name, room, surfaces, items: withFinishIds(kept), ...(prefs ? { brandPrefs: prefs } : {}), version: 2 };
}

/** The width of the company's range (30, 36 or 48), so the layout asks for the size it sells. */
function rangeWidth(lines: ShowroomLine[]): number {
  const ws = lines.flatMap((l) => l.products.filter((p) => p.kind === 'range').flatMap((p) => p.widthOptions ?? [p.widthIn]));
  return [36, 30, 48].find((w) => ws.includes(w)) ?? 30;
}

/** The editor's design checks, as plain titles of what is wrong ('bad' only). */
export function layoutProblems(doc: DesignDoc): string[] {
  return runChecks(resolveAll(doc.items), doc.room)
    .checks.filter((c) => c.level === 'bad' || c.level === 'warn')
    .map((c) => c.title);
}

// ─── cameras ─────────────────────────────────────────────────────────────

const ft = (inches: number) => inches / 12;

/** The box (feet) around the pieces `pick` chooses, or null. */
function boxOf(doc: DesignDoc, pick: (r: Resolved) => boolean): { min: Vec3; max: Vec3; center: Vec3 } | null {
  const rs = resolveAll(doc.items).filter(pick);
  if (!rs.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const r of rs) {
    min[0] = Math.min(min[0], ft(r.box.minX));
    max[0] = Math.max(max[0], ft(r.box.maxX));
    min[2] = Math.min(min[2], ft(r.box.minY));
    max[2] = Math.max(max[2], ft(r.box.maxY));
    min[1] = Math.min(min[1], ft(r.z0));
    max[1] = Math.max(max[1], ft(r.z1));
  }
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/** A camera in front of the north wall's pieces chosen by `pick`, a little to one side, at eye level. */
function northView(doc: DesignDoc, pick: (r: Resolved) => boolean, o: { aspect: number; side?: number; height?: number; fov?: number; pad?: number; lookY?: number; minDist?: number }): CameraView {
  const b = boxOf(doc, pick) ?? { min: [0, 0, 0] as Vec3, max: [ft(doc.room.widthIn), 8, 2] as Vec3, center: [ft(doc.room.widthIn) / 2, 3, 1] as Vec3 };
  const fov = o.fov ?? 48;
  const v = (fov * Math.PI) / 180 / 2;
  const h = Math.atan(Math.tan(v) * o.aspect);
  const halfW = (b.max[0] - b.min[0]) / 2 + (o.pad ?? 1);
  const halfH = (b.max[1] - b.min[1]) / 2 + (o.pad ?? 1) * 0.6;
  const dist = Math.max(o.minDist ?? 4, halfW / Math.tan(h), halfH / Math.tan(v)) + (b.max[2] - b.min[2]) / 2;
  const L = ft(doc.room.lengthIn);
  // The camera stays inside the room (under its ceiling, never looking over a cut-away wall): when
  // the room is too short to stand back far enough, the lens widens instead.
  const z = Math.min(b.center[2] + dist, L - 0.7);
  const room = z - b.center[2] + (b.max[2] - b.min[2]) / 2;
  const needH = Math.atan(halfW / Math.max(1, room));
  const needV = (2 * Math.atan(Math.tan(needH) / o.aspect) * 180) / Math.PI;
  const lens = Math.min(68, Math.max(fov, needV));
  const lookY = o.lookY ?? Math.min(4.0, Math.max(3.4, b.center[1]));
  return { pos: [b.center[0] + (o.side ?? 0), o.height ?? 5.2, z], target: [b.center[0] + (o.side ?? 0) * 0.35, lookY, b.center[2]], fov: lens };
}

const isKind = (...kinds: string[]) => (r: Resolved) => kinds.includes(r.product.kind);

// ─── the scenes ──────────────────────────────────────────────────────────

/** The hero kitchen: the long wall with the range and hood, tall storage, glass uppers, a window, an island with pendants and stools. */
function heroSpec(room: Room, range = 36): LayoutSpec {
  const W = room.widthIn;
  const L = room.lengthIn;
  return {
    runs: [
      { wall: 'north', start: 0, end: W, slots: [{ role: 'pantry' }, { role: 'fridge', variant: 'french' }, { gap: 30 }, { role: 'range', widthIn: range }, 'flex', { role: 'pantry', optional: true }], opts: { uppers: true, hood: 'auto', glassUppers: true } },
      { wall: 'west', start: 24, end: L - 54, slots: [{ gap: 39 }, { role: 'sink', variant: 'farmhouse' }, { role: 'dishwasher' }, 'flex'], opts: { window: true, uppers: false } },
    ],
    island: { x: W / 2 + 16, y: 24 + 48 + 21, widthIn: 96, seats: 3, seatSide: 'south', pendants: 3 },
    openings: [{ productId: 'opening', wall: 'east', along: L - 36, widthIn: 42 }],
  };
}

function heroScene(lines: ShowroomLine[], keepBasics: boolean): Scene | null {
  const cab = lines.find(isCabinetLine);
  // `lines` comes featured-first (showroomScenes), so the hero is the company's own first choice.
  const room = ROOM_KITCHEN;
  const style = doorStyleOf(cab);
  const finish = cab ? signatureFinish(cab) : undefined;
  // A two-tone kitchen: the island in a deeper finish of the same line when it has one.
  const island = cab ? signatureFinish(cab, finish ? [finish, whiteFinish(cab) ?? ''] : []) : undefined;
  const doc0 = makeDoc('Showroom kitchen', room, heroSpec(room, rangeWidth(lines)), matched(stagingFor(style, 'warm'), cab, finish), kitchenPrefs(lines, cab), keepBasics, lines);
  const doc = { ...doc0, items: dress(doc0.items, cab, finish, island) };
  const W = ft(room.widthIn);
  const L = ft(room.lengthIn);
  return {
    id: 'hero',
    label: 'The main picture',
    doc,
    problems: layoutProblems(doc),
    shots: [
      { slot: 'hero', ...HERO_SIZE, view: { pos: [W - 1.1, 5.2, L - 0.9], target: [W * 0.4, 3.3, 2.4], fov: 52 } },
      { slot: 'heroTall', ...HERO_TALL_SIZE, view: { pos: [W * 0.64, 5.4, L - 0.35], target: [W * 0.47, 3.3, 1.5], fov: 66 } },
    ],
  };
}

/** A run of the line on one wall, staged for its own picture. */
function lineScene(line: ShowroomLine, lines: ShowroomLine[], keepBasics: boolean): Scene | null {
  const rw = rangeWidth(lines);
  const id = `line:${line.key}`;
  const label = line.name;
  const shot = (view: CameraView): Shot[] => [{ slot: 'line', line: line.name, ...LINE_SIZE, view }];
  const aspect = LINE_SIZE.width / LINE_SIZE.height;

  if (isBathLine(line)) {
    const room: Room = { widthIn: 108, lengthIn: 120, ceilingIn: 96 };
    const vanity = line.products.filter((p) => p.kind === 'sink').sort((a, b) => b.widthIn - a.widthIn)[0];
    const tall = line.products.find((p) => p.kind === 'tall');
    const items: PlacedItem[] = [];
    let x = 6;
    if (tall) {
      items.push({ id: 'b1', productId: tall.id, x: x + tall.widthIn / 2, y: tall.depthIn / 2, rotation: 0, finishIndex: 0 });
      x += tall.widthIn + 6;
    }
    if (vanity) items.push({ id: 'b2', productId: vanity.id, x: x + vanity.widthIn / 2, y: vanity.depthIn / 2, rotation: 0, finishIndex: 0, widthIn: vanity.widthIn });
    items.push({ id: 'b3', productId: 'window', x: x + (vanity?.widthIn ?? 36) / 2, y: 0, rotation: 0, finishIndex: 0, widthIn: 30 });
    // A vanity's finishes are its basin's; its cabinet wears the kitchen-wide cabinet finish, so that
    // is set to match the line's wood (or first colour), which the tall pieces wear too.
    const woody = line.products.flatMap((p) => (p.kind === 'sink' ? [] : finishList(p))).find((f) => f.material === 'wood') ?? line.products.flatMap((p) => (p.kind === 'sink' ? [] : finishList(p)))[0];
    const finish = woody?.id;
    const s = { ...stagingFor(doorStyleOf(line), 'calm'), cabinetFinishId: nearestCabinetFinish(woody?.hex, 'white-oak'), backsplashId: 'zellige-white', flooringId: 'porcelain', paintId: 'fog' };
    const doc: DesignDoc = { name: `${line.name} bathroom`, room, surfaces: s, items: withFinishIds(dress(items, line, finish)), version: 2 };
    const view = northView(doc, (r) => r.product.source === 'tenant', { aspect, side: 2.2, height: 5.0, fov: 46, pad: 1.4, lookY: 3.4 });
    return { id, label, doc, shots: shot(view), problems: layoutProblems(doc) };
  }

  const room: Room = { widthIn: 204, lengthIn: 168, ceilingIn: 108 };
  const style = doorStyleOf(isCabinetLine(line) ? line : lines.find(isCabinetLine));
  const W = room.widthIn;
  let spec: LayoutSpec;
  let pick: (r: Resolved) => boolean;
  let cam: Parameters<typeof northView>[2] = { aspect };
  const north = (slots: RunSpec['slots'], opts: RunSpec['opts'] = {}): RunSpec => ({ wall: 'north', start: 0, end: W, slots, opts: { uppers: true, hood: 'auto', ...opts } });

  if (isCabinetLine(line)) {
    spec = { runs: [north([{ role: 'pantry' }, 'flex', { role: 'sink', variant: 'farmhouse' }, { role: 'dishwasher' }, 'flex', { role: 'range', widthIn: rw }, 'flex'], { window: true, glassUppers: true })] };
    pick = (r) => r.item.y < 30 && r.product.kind !== 'window';
    cam = { aspect, side: -1.5, height: 5.0, fov: 50, pad: 0.4 };
  } else if (hasKind(line, 'sink')) {
    const sinks = line.products.filter((p) => p.kind === 'sink');
    const hero = sinks.find((p) => p.variant === 'farmhouse') ?? sinks[0];
    spec = { runs: [north(['flex', { role: 'sink', variant: hero?.variant ?? 'farmhouse' }, { role: 'dishwasher' }, 'flex'], { window: true, uppers: true })] };
    pick = isKind('sink');
    cam = { aspect, side: 2.2, height: 5.5, fov: 44, pad: 2.6, lookY: 3.2, minDist: 6.5 };
  } else if (hasKind(line, 'range', 'hood', 'fridge', 'dishwasher')) {
    spec = { runs: [north([{ role: 'fridge', variant: 'french' }, 'flex', { role: 'range', widthIn: rw }, 'flex', { role: 'dishwasher' }, 'flex'], { uppers: true, hood: 'auto' })] };
    pick = isKind('range', 'hood', 'fridge');
    cam = { aspect, side: 1.8, height: 5.2, fov: 46, pad: 0.8 };
  } else if (hasKind(line, 'pendant', 'stool')) {
    spec = {
      runs: [north(['flex', { role: 'sink', variant: 'farmhouse' }, { role: 'dishwasher' }, 'flex', { role: 'range', widthIn: rw }, 'flex'], { uppers: true, hood: 'auto', window: true })],
      island: { x: W / 2, y: 24 + 48 + 21, widthIn: 96, seats: 3, seatSide: 'south', pendants: 3 },
    };
    pick = isKind(hasKind(line, 'pendant') ? 'pendant' : 'stool', 'island');
    cam = hasKind(line, 'pendant') ? { aspect, side: 2.6, height: 5.0, fov: 50, pad: 1.6, lookY: 4.0, minDist: 6 } : { aspect, side: 2.5, height: 4.4, fov: 48, pad: 0.6, lookY: 2.6 };
  } else return null;

  const cabLine = isCabinetLine(line) ? line : lines.find(isCabinetLine);
  const lineFinish = signatureFinish(line);
  const cabFinish = isCabinetLine(line) ? lineFinish : cabLine ? whiteFinish(cabLine) : undefined;
  const doc0 = makeDoc(`${line.name} kitchen`, room, spec, matched(stagingFor(style, isCabinetLine(line) ? 'classic' : 'calm'), cabLine, cabFinish), kitchenPrefs(lines, isCabinetLine(line) ? line : cabLine), keepBasics, lines);
  // The line in its signature finish; the rest of the kitchen in the cabinet line's white, so the line stands out.
  const items = dress(isCabinetLine(line) ? doc0.items : dress(doc0.items, cabLine, cabLine ? whiteFinish(cabLine) : undefined), line, lineFinish);
  const doc = { ...doc0, items };
  if (isCabinetLine(line)) {
    // The stretch from the sink to the range: doors, drawers, glass uppers and the hood, close up.
    const xs = doc.items.filter((i) => ['sink', 'range'].includes(getProduct(i.productId)?.kind ?? '')).map((i) => i.x);
    if (xs.length) {
      const lo = Math.min(...xs) - 42;
      const hi = Math.max(...xs) + 42;
      pick = (r) => r.item.y < 30 && r.item.x >= lo && r.item.x <= hi && r.product.kind !== 'window';
    }
  }
  return { id, label, doc, shots: shot(northView(doc, pick, cam)), problems: layoutProblems(doc) };
}

/** Finished sample kitchens for the gallery: different layouts, lines and finishes. */
function galleryScenes(lines: ShowroomLine[], keepBasics: boolean): Scene[] {
  const rw = rangeWidth(lines);
  const cabs = lines.filter(isCabinetLine);
  if (!cabs.length) return [];
  const aspect = GALLERY_SIZE.width / GALLERY_SIZE.height;
  const out: Scene[] = [];
  const plans: { title: string; line: ShowroomLine; finish?: string; island?: string; stool?: string; mood: 'warm' | 'calm' | 'classic'; room: Room; spec: (r: Room) => LayoutSpec; view: (d: DesignDoc) => CameraView }[] = [];
  const a = cabs[1] ?? cabs[0];
  const b = cabs[0];
  plans.push({
    title: 'galley with an island',
    line: a,
    finish: signatureFinish(a, [signatureFinish(a) ?? '']),
    island: signatureFinish(a),
    stool: 'counter',
    mood: 'calm',
    room: { widthIn: 192, lengthIn: 180, ceilingIn: 108 },
    spec: (r) => ({
      runs: [{ wall: 'north', start: 0, end: r.widthIn, slots: [{ role: 'pantry' }, { role: 'fridge', variant: 'french' }, 'flex', { role: 'sink', variant: 'undermount' }, { role: 'dishwasher' }, 'flex', { role: 'pantry', optional: true }], opts: { window: true, uppers: true } }],
      island: { x: r.widthIn / 2, y: 30 + 44 + 21, widthIn: 96, seats: 3, seatSide: 'south', pendants: 2 },
      openings: [{ productId: 'door-french', wall: 'west', along: r.lengthIn - 54, widthIn: 60 }],
    }),
    view: (d) => ({ pos: [ft(d.room.widthIn) - 1.4, 5.3, ft(d.room.lengthIn) - 0.8], target: [ft(d.room.widthIn) * 0.42, 3.3, 1.8], fov: 52 }),
  });
  plans.push({
    title: 'U-shaped kitchen',
    line: b,
    finish: whiteFinish(b),
    mood: 'classic',
    room: { widthIn: 144, lengthIn: 156, ceilingIn: 108 },
    spec: (r) => ({
      runs: [
        { wall: 'north', start: 0, end: r.widthIn, slots: [{ role: 'corner' }, 'flex', { role: 'sink', variant: 'farmhouse' }, { role: 'dishwasher' }, 'flex', { role: 'corner' }], opts: { window: true, uppers: true, glassUppers: true } },
        { wall: 'west', start: 36, end: r.lengthIn - 30, slots: ['flex', { role: 'range', widthIn: rw }, 'flex'], opts: { uppers: true, hood: 'auto' } },
        { wall: 'east', start: 36, end: r.lengthIn - 30, slots: [{ role: 'fridge', variant: 'french' }, 'flex'], opts: { uppers: true } },
      ],
    }),
    view: (d) => ({ pos: [ft(d.room.widthIn) / 2 + 0.5, 5.3, ft(d.room.lengthIn) - 0.6], target: [ft(d.room.widthIn) / 2, 3.5, 2.2], fov: 66 }),
  });
  const c = cabs[0];
  // The line's deepest painted colour (a navy, a forest green), for a moodier kitchen.
  const deep = c.products.flatMap((p) => finishList(p)).filter((f) => f.material === 'paint' && luminance(f.hex) > 0.02).sort((x, y) => luminance(x.hex) - luminance(y.hex))[0]?.id;
  plans.push({
    title: 'L-shaped kitchen with an island',
    line: c,
    finish: deep ?? signatureFinish(c),
    island: whiteFinish(c),
    stool: 'counter',
    mood: 'warm',
    room: { widthIn: 216, lengthIn: 180, ceilingIn: 108 },
    spec: (r) => ({
      runs: [
        { wall: 'north', start: 0, end: r.widthIn, slots: [{ role: 'corner' }, { gap: 24 }, { role: 'sink', variant: 'farmhouse' }, { role: 'dishwasher' }, 'flex', { role: 'pantry', optional: true }], opts: { window: true, uppers: true } },
        { wall: 'west', start: 36, end: r.lengthIn - 30, slots: [{ role: 'fridge', variant: 'french' }, { gap: 12 }, { role: 'range', widthIn: rw }, 'flex'], opts: { uppers: true, hood: 'auto' } },
      ],
      island: { x: r.widthIn / 2 + 18, y: 24 + 46 + 21, widthIn: 84, seats: 3, seatSide: 'south', pendants: 2 },
    }),
    view: (d) => ({ pos: [ft(d.room.widthIn) - 1.0, 5.2, ft(d.room.lengthIn) - 0.8], target: [ft(d.room.widthIn) * 0.3, 3.2, ft(d.room.lengthIn) * 0.32], fov: 54 }),
  });
  plans.forEach((p0, i) => {
    // "Smoked Walnut galley with an island": the finish by its name, then the layout.
    const fname = p0.line.products.flatMap((x) => finishList(x)).find((f) => f.id === p0.finish)?.name;
    const p = { ...p0, title: fname ? `${fname} ${p0.title}` : `${p0.line.name} ${p0.title}` };
    const doc0 = makeDoc(p.title, p.room, p.spec(p.room), matched(stagingFor(doorStyleOf(p.line), p.mood), p.line, p.finish), kitchenPrefs(lines, p.line), keepBasics, lines, p.stool);
    const doc = { ...doc0, items: dress(doc0.items, p.line, p.finish, p.island) };
    const promo = i === 0 ? 5 : i === 2 ? 6 : 0;
    out.push({
      id: `gallery:${i + 1}`,
      label: p.title,
      doc,
      problems: layoutProblems(doc),
      shots: [
        { slot: 'gallery', index: i + 1, title: p.title, ...GALLERY_SIZE, view: p.view(doc) },
        // The sales page's slideshow takes the walnut galley and the navy L too.
        ...(promo ? [{ slot: 'promo' as const, index: promo, title: p.title, ...PROMO_SIZE, view: p.view(doc) }] : []),
      ],
    });
  });
  void aspect;
  return out;
}

/**
 * Every scene for a showroom: the hero, one per featured line (the lines it features, else its
 * biggest few) and the gallery. `keepBasics`: the company fills the gaps with BluModel Basics.
 */
export function showroomScenes(lines: ShowroomLine[], featured: ShowroomLine[], { keepBasics = false }: { keepBasics?: boolean } = {}): Scene[] {
  if (!lines.length) return [];
  const out: Scene[] = [];
  // The company's featured lines first: the hero and the gallery follow its own order.
  const ordered = [...featured, ...lines.filter((l) => !featured.includes(l))];
  lines = ordered;
  const hero = heroScene(lines, keepBasics);
  if (hero) out.push(hero);
  const seen = new Set<string>();
  for (const l of [...featured, ...lines]) {
    if (seen.has(l.key) || seen.size >= 8) continue;
    seen.add(l.key);
    const s = lineScene(l, lines, keepBasics);
    if (s) out.push(s);
  }
  out.push(...galleryScenes(lines, keepBasics));
  out.push(...dreamScenes(lines, keepBasics));
  const bath = bathPromo(lines, keepBasics);
  if (bath) out.push(bath);
  const tubBath = tubPromo(lines, keepBasics);
  if (tubBath) out.push(tubBath);
  return out;
}

/** A bump-out (a bay) `depth` inches out of the main room's `wall`, from `from` to `to` along it. Unchanged if it can't. */
function bay(d: Draft, wall: 'north' | 'south' | 'east' | 'west', from: number, to: number, depth: number): Draft {
  const seg = wallSegs(d.room).find((q) => q.room === 0 && q.wall === wall);
  if (!seg) return d;
  const out = bumpWall(d, seg.id, from, to, depth);
  return isError(out) ? d : out;
}

/** Another room beside the kitchen (corners in plan inches), joined to it through the wall they share. */
function side(d: Draft, pts: [number, number][], name: string, link: 'walkway' | 'opening' | 'door', widthIn: number): Draft {
  const out = addRoom(d, pts, name);
  if (isError(out) || !out.id) return d;
  return connectNewRoom(out, out.id, link, widthIn);
}

/** A dining table with six chairs round it, centred at (x, y). */
function furnish(d: Draft, x: number, y: number): Draft {
  const items = [...d.items, { id: 'dream-table', productId: 'table-rect', x, y, rotation: 90 as const, finishIndex: 0 }];
  const seats: [number, number, 0 | 90 | 180 | 270][] = [
    [x - 30, y - 22, 90], [x - 30, y + 22, 90], [x + 30, y - 22, 270], [x + 30, y + 22, 270], [x, y - 50, 0], [x, y + 50, 180],
  ];
  seats.forEach(([cx, cy, r], i) => items.push({ id: `dream-chair-${i}`, productId: 'chair', x: cx, y: cy, rotation: r, finishIndex: 0 }));
  return { ...d, items };
}

/**
 * Two dream kitchens, the showroom's advert: everything the designer does at its best (a big island
 * with seating, tall pantries, glass uppers, crown, under-cabinet lights, pot lights, a laid floor),
 * in two moods: a warm classic in the company's painted shaker and a calm modern in its slab line.
 * A visitor can look around either one, or start their own design from it.
 */
function dreamScenes(lines: ShowroomLine[], keepBasics: boolean): Scene[] {
  const cabs = lines.filter(isCabinetLine);
  if (!cabs.length) return [];
  const rw = rangeWidth(lines);
  const shaker = cabs.find((l) => doorStyleOf(l) === 'shaker') ?? cabs[0];
  const slab = cabs.find((l) => doorStyleOf(l) === 'slab') ?? cabs[cabs.length - 1];
  const deep = (l: ShowroomLine) => l.products.flatMap((p) => finishList(p)).filter((f) => f.material === 'paint' && luminance(f.hex) > 0.02).sort((x, y) => luminance(x.hex) - luminance(y.hex))[0]?.id;
  const plans: { title: string; line: ShowroomLine; finish?: string; island?: string; surfaces: Surfaces; room: Room; spec: (r: Room) => LayoutSpec; shape: (d: Draft) => Draft; view: (d: DesignDoc) => CameraView; angle: (d: DesignDoc) => CameraView }[] = [
    {
      title: 'The Entertainer’s Kitchen',
      line: shaker,
      finish: whiteFinish(shaker),
      island: deep(shaker) ?? signatureFinish(shaker),
      surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'chevron-oak', paintId: 'chalk', crown: 'cove', underCabinet: 'led' },
      room: { widthIn: 264, lengthIn: 204, ceilingIn: 108 },
      spec: (r) => ({
        runs: [
          { wall: 'north', start: 0, end: r.widthIn, slots: [{ role: 'pantry' }, { role: 'fridge', variant: 'french' }, { gap: 36 }, { role: 'range', widthIn: rw }, 'flex', { role: 'pantry', optional: true }], opts: { uppers: true, hood: 'auto', glassUppers: true } },
          { wall: 'west', start: 24, end: r.lengthIn - 54, slots: [{ gap: 39 }, { role: 'sink', variant: 'farmhouse' }, { role: 'dishwasher' }, 'flex'], opts: { window: true, uppers: false } },
        ],
        island: { x: r.widthIn / 2 + 18, y: 24 + 54 + 21, widthIn: 120, seats: 4, seatSide: 'south', pendants: 3 },
      }),
      // A breakfast bay out of the south wall, and a dining room through a wide walkway to the east.
      shape: (d) => {
        const W = d.room.widthIn;
        const L = d.room.lengthIn;
        let out = bay(d, 'south', W * 0.3, W * 0.62, 30);
        out = side(out, [[W, 60], [W + 156, 60], [W + 156, L], [W, L]], 'Dining room', 'walkway', 84);
        return keepBasics ? furnish(out, W + 78, (60 + L) / 2) : out;
      },
      // Framed on the kitchen itself (the bay makes the plan deeper than the kitchen).
      view: (d) => ({ pos: [ft(d.room.widthIn) - 1.1, 5.3, ft(d.room.lengthIn) - 0.9], target: [ft(d.room.widthIn) * 0.4, 3.3, 2.5], fov: 54 }),
      angle: (d) => ({ pos: [ft(d.room.widthIn) - 1.1, 5.3, ft(d.room.lengthIn) - 0.9], target: [ft(d.room.widthIn) * 0.4, 3.3, 2.5], fov: 54 }),
    },
    {
      // A different kitchen altogether: a U wrapped round the cook, no island, dark slab doors and
      // black stone against a bright large-format tile floor.
      title: 'The Modern Retreat',
      line: slab,
      finish: deep(slab) ?? signatureFinish(slab),
      surfaces: { cabinetFinishId: 'charcoal', doorStyle: 'slab', hardwareId: 'brass', countertopId: 'nero', backsplashId: 'zellige-white', flooringId: 'porcelain-white-24', paintId: 'fog', underCabinet: 'led' },
      room: { widthIn: 156, lengthIn: 168, ceilingIn: 108 },
      spec: (r) => ({
        runs: [
          { wall: 'north', start: 0, end: r.widthIn, slots: [{ role: 'corner' }, 'flex', { role: 'sink', variant: 'undermount' }, { role: 'dishwasher' }, 'flex', { role: 'corner' }], opts: { window: true, uppers: true, cornerUppers: true } },
          { wall: 'west', start: 36, end: r.lengthIn - 30, slots: ['flex', { role: 'range', widthIn: rw }, 'flex'], opts: { uppers: true, hood: 'auto' } },
          { wall: 'east', start: 36, end: r.lengthIn - 30, slots: [{ role: 'fridge', variant: 'french' }, 'flex', { role: 'pantry', optional: true }], opts: { uppers: true } },
        ],
      }),
      // The U opens into a living room to the south, wider than the kitchen: the whole plan is an L.
      shape: (d) => {
        const W = d.room.widthIn;
        const L = d.room.lengthIn;
        return side(d, [[0, L], [W + 120, L], [W + 120, L + 180], [0, L + 180]], 'Living room', 'walkway', 108);
      },
      // Hero shots from inside the U: a step in from each side of the walkway, a little above eye
      // level, diagonally across the whole kitchen (the aisle is 9', so nothing tall is in the way).
      view: (d) => ({ pos: [3.0, 5.7, ft(d.room.lengthIn) - 0.3], target: [ft(d.room.widthIn) - 2.2, 3.0, 2.2], fov: 66 }),
      angle: (d) => ({ pos: [ft(d.room.widthIn) - 3.0, 5.7, ft(d.room.lengthIn) - 0.3], target: [2.2, 3.0, 2.2], fov: 66 }),
    },
  ];
  return plans.map((p, i) => {
    const doc0 = makeDoc(p.title, p.room, p.spec(p.room), matched(p.surfaces, p.line, p.finish), kitchenPrefs(lines, p.line), keepBasics, lines, 'counter');
    const dressed0 = { ...doc0, items: dress(doc0.items, p.line, p.finish, p.island) };
    const shaped = p.shape({ room: dressed0.room, items: dressed0.items });
    const dressed = { ...dressed0, room: shaped.room, items: withFinishIds(shaped.items) };
    // Pot lights over the whole room, as the editor lays them (they are BluModel Basics, so only
    // for a company that fills the gaps with them).
    const doc = keepBasics ? { ...dressed, items: withFinishIds(layoutPotLights({ room: dressed.room, items: dressed.items }).items) } : dressed;
    // The sales page's slideshow (scripts/make-showroom-images.mjs puts these in public/marketing/,
    // not on the demo): the white kitchen (1) and the dark one toward its range (4); 2 is bathPromo.
    return { id: `dream:${i + 1}`, label: p.title, doc, problems: layoutProblems(doc), shots: [
        { slot: 'dream' as const, index: i + 1, title: p.title, ...DREAM_SIZE, view: p.view({ ...doc, room: p.room }) },
        i === 0
          ? { slot: 'promo' as const, index: 1, title: p.title, ...PROMO_SIZE, view: p.view({ ...doc, room: p.room }) }
          : { slot: 'promo' as const, index: 4, title: p.title, ...PROMO_SIZE, view: p.angle({ ...doc, room: p.room }) },
      ] };
  });
}

/** A product's display name in a scene (for the generator's list). */
export const productName = (p: Product | undefined) => p?.name ?? '';

/**
 * The sales page's bathroom (slide 2, not on the demo): a shower ensuite laid out the way the editor's
 * bathroom starter does it (a walk-in shower across the end, the vanity and the toilet at code
 * clearances), with the company's double vanity in its wood. The shower, toilet and mirror are
 * BluModel Basics, so they're only there when the company fills the gaps with them.
 */
function bathPromo(lines: ShowroomLine[], keepBasics: boolean): Scene | null {
  const line = lines.find(isBathLine);
  if (!line) return null;
  const room: Room = { widthIn: 144, lengthIn: 108, ceilingIn: 96 };
  const double = line.products.find((p) => p.kind === 'sink' && p.variant === 'double');
  const single = line.products.filter((p) => p.kind === 'sink').sort((a, b) => b.widthIn - a.widthIn)[0];
  // No door: it's a picture taken from the doorway's corner, and an open door would fill it.
  let items = bathLayoutItems('shower-ensuite', room).filter((it) => it.productId !== 'door').map((it) => {
    if (it.productId === 'vanity-double' && double) return { ...it, productId: double.id, widthIn: 60 };
    if (it.productId === 'vanity' && single) return { ...it, productId: single.id };
    // The walk-in, curbless, behind one fixed glass panel from floor to ceiling.
    if (it.productId === 'shower-walkin') return { ...it, productId: 'shower-wetroom', widthIn: 60 };
    return it;
  });
  if (!keepBasics) items = items.filter((it) => {
    const p = getProduct(it.productId);
    return !!p && (p.source === 'tenant' || isOpening(p) || p.category === 'decor');
  });
  const woody = line.products.flatMap((p) => (p.kind === 'sink' ? [] : finishList(p))).find((f) => f.material === 'wood') ?? line.products.flatMap((p) => finishList(p))[0];
  const surfaces: Surfaces = { cabinetFinishId: nearestCabinetFinish(woody?.hex, 'white-oak'), doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'carrara', backsplashId: 'zellige-white', flooringId: 'hex-white', paintId: 'fog' };
  // The shower recessed into the end wall: an alcove built out of it, the shower set back into it
  // (walls on three sides, its glass facing the room), centred on the room.
  const shower = items.find((it) => getProduct(it.productId)?.kind === 'shower');
  let plan: Draft = { room, items };
  if (shower) {
    const sw = shower.widthIn ?? getProduct(shower.productId)?.widthIn ?? 60;
    // Exactly the shower's size, so it tiles all three walls and sits flush with the room's wall.
    const from = Math.round((room.lengthIn - sw) / 2);
    const to = from + sw;
    const deep = getProduct(shower.productId)?.depthIn ?? 36;
    const bumped = bay(plan, 'east', from, to, deep);
    if (bumped !== plan) plan = { room: bumped.room, items: items.map((it) => (it === shower ? { ...it, x: room.widthIn + deep - 18, y: (from + to) / 2 } : it)) };
  }
  // Lived in, like a house: a window in the long wall and the company's linen tower beside it.
  const tower = line.products.find((p) => p.kind === 'tall');
  const extras: PlacedItem[] = [{ id: 'bath-window', productId: 'window', x: room.widthIn * 0.46, y: room.lengthIn, rotation: 180, finishIndex: 0, widthIn: 36 }];
  // The tower in the far corner, beside the shower alcove (clear of the camera at the near end).
  if (tower) extras.push({ id: 'bath-tower', productId: tower.id, x: room.widthIn - tower.widthIn / 2 - 2, y: room.lengthIn - tower.depthIn / 2, rotation: 180, finishIndex: 0 });
  plan = { room: plan.room, items: [...plan.items, ...extras] };
  const doc: DesignDoc = { name: 'Shower ensuite', room: plan.room, surfaces, items: withFinishIds(dress(plan.items, line, woody?.id)), version: 2 };
  // From the doorway's corner: the vanity and its mirror at an angle (never head on), the toilet,
  // and the shower alcove at the end of the room.
  const view: CameraView = { pos: [0.9, 5.3, ft(room.lengthIn) - 0.8], target: [ft(room.widthIn) * 0.9, 3.5, ft(room.lengthIn) * 0.38], fov: 64 };
  return { id: 'promo:bath', label: 'Shower ensuite', doc, problems: layoutProblems(doc), shots: [{ slot: 'promo', index: 2, title: 'Shower ensuite', ...PROMO_SIZE, view }] };
}

/**
 * The sales page's primary bathroom (slide 7, not on the demo): a freestanding soaking tub under a
 * picture window at the far end, the company's double vanity along one wall, a plant by the tub.
 * The tub, window and plant are BluModel Basics or decor; without "fill the gaps" it's the vanity.
 */
function tubPromo(lines: ShowroomLine[], keepBasics: boolean): Scene | null {
  const line = lines.find(isBathLine);
  if (!line) return null;
  const room: Room = { widthIn: 168, lengthIn: 132, ceilingIn: 102 };
  const W = room.widthIn;
  const L = room.lengthIn;
  const double = line.products.find((p) => p.kind === 'sink' && p.variant === 'double');
  const tower = line.products.find((p) => p.kind === 'tall');
  let items: PlacedItem[] = [
    { id: 'pb-window', productId: 'window-picture', x: W, y: L / 2, rotation: 90, finishIndex: 0, widthIn: 60 },
    { id: 'pb-tub', productId: 'tub-free', x: W - 26, y: L / 2, rotation: 90, finishIndex: 0 },
    { id: 'pb-plant', productId: 'fig', x: W - 14, y: L - 16, rotation: 0, finishIndex: 0 },
    { id: 'pb-mirror', productId: 'mirror', x: 54, y: 0.75, rotation: 0, finishIndex: 0, widthIn: 48 },
  ];
  if (double) items.push({ id: 'pb-vanity', productId: double.id, x: 54, y: double.depthIn / 2, rotation: 0, finishIndex: 0, widthIn: 72 });
  if (tower) items.push({ id: 'pb-tower', productId: tower.id, x: 108, y: tower.depthIn / 2, rotation: 0, finishIndex: 0 });
  if (!keepBasics) items = items.filter((it) => {
    const p = getProduct(it.productId);
    return !!p && (p.source === 'tenant' || isOpening(p) || p.category === 'decor');
  });
  const woody = line.products.flatMap((p) => (p.kind === 'sink' ? [] : finishList(p))).find((f) => f.material === 'wood') ?? line.products.flatMap((p) => finishList(p))[0];
  const surfaces: Surfaces = { cabinetFinishId: nearestCabinetFinish(woody?.hex, 'white-oak'), doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'carrara', backsplashId: 'zellige-white', flooringId: 'marble-floor', paintId: 'bone' };
  const doc: DesignDoc = { name: 'Primary bathroom', room, surfaces, items: withFinishIds(dress(items, line, woody?.id)), version: 2 };
  // From the near corner: the tub under its window ahead, the vanity along the left at an angle.
  const view: CameraView = { pos: [1.2, 5.2, ft(L) - 1.0], target: [ft(W), 3.0, ft(L) * 0.45], fov: 62 };
  return { id: 'promo:tub', label: 'Primary bathroom', doc, problems: layoutProblems(doc), shots: [{ slot: 'promo', index: 7, title: 'Primary bathroom', ...PROMO_SIZE, view }] };
}
