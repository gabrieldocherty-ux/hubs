import type { DesignDoc, EdgeStyle, EstimateExtra, ExtraRoom, OutlinePt, PlacedItem, Product, Room, Rotation, Surfaces, WallFinish } from '../types';
import { DEFAULT_KITCHEN_NAME, DEFAULT_ROOM, DEFAULT_SURFACES } from '../data/defaults';
import { getProduct, isBuiltin, isProductIdShape, missingProduct } from '../data/catalog';
import { useCatalog } from '../store/useCatalog';
import { finishAt, finishList } from './finish';
import { cleanBrandPrefs } from './generate/brands';
import { isEdgeStyle, normalizeStyled, outlineProblem } from './outline';
import { isPanel } from './wallFinish';
import { FIXTURE_ID_RE, fixturesForSave, registerFixtures } from './fixtures';

/**
 * Kitchen-document hygiene shared by every load and save path. Pure apart from the catalog
 * registry: loading registers snapshots and placeholders there, saving reads from it.
 */

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Same limits as the editor's room inputs and the server's `validDoc`. */
export function cleanRoom(raw: Partial<Room> | undefined): Room {
  const r = raw ?? {};
  return {
    widthIn: clamp(Math.round(num(r.widthIn, DEFAULT_ROOM.widthIn)), 72, 1200),
    lengthIn: clamp(Math.round(num(r.lengthIn, DEFAULT_ROOM.lengthIn)), 72, 1200),
    ceilingIn: clamp(Math.round(num(r.ceilingIn, DEFAULT_ROOM.ceilingIn)), 90, 144),
    ...cleanShape(r),
  };
}

/** Edge styles kept only when there is one per corner and every one is known; otherwise the defaults apply. */
function cleanStyles(raw: unknown, n: number): EdgeStyle[] | undefined {
  if (!Array.isArray(raw) || raw.length !== n || !raw.every(isEdgeStyle)) return undefined;
  return raw as EdgeStyle[];
}

/** Drawn walls, edge styles, extra rooms and open areas, kept only when valid: a bad outline falls back to the plain rectangle. */
function cleanShape(r: Partial<Room>): Pick<Room, 'outline' | 'styles' | 'extra' | 'wallFinishes'> {
  const out: Pick<Room, 'outline' | 'styles' | 'extra' | 'wallFinishes'> = {};
  const read = (raw: unknown, styles: unknown, fallback: EdgeStyle): { pts: OutlinePt[]; styles: EdgeStyle[] } | null => {
    if (!Array.isArray(raw) || raw.length < 4 || raw.length > 64) return null;
    const p: OutlinePt[] = [];
    for (const q of raw) {
      if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) return null;
      p.push([Math.round(q[0] * 4) / 4, Math.round(q[1] * 4) / 4]);
    }
    const n = normalizeStyled(p, cleanStyles(styles, p.length), fallback);
    return outlineProblem(n.pts) ? null : { pts: n.pts, styles: n.styles };
  };
  const main = read(r.outline, r.styles, 'wall');
  if (main) {
    out.outline = main.pts;
    if (main.styles.some((x) => x !== 'wall')) out.styles = main.styles;
  } else if (!r.outline && cleanStyles(r.styles, 4)) {
    // A plain rectangle can still have styled walls.
    const st = cleanStyles(r.styles, 4)!;
    if (st.some((x) => x !== 'wall')) out.styles = st;
  }
  if (Array.isArray(r.extra)) {
    const extra = r.extra.flatMap((e): ExtraRoom[] => {
      if (!e || typeof e !== 'object') return [];
      const x = e as ExtraRoom;
      const zone = x.kind === 'zone';
      const o = read(x.outline, x.styles, zone ? 'open' : 'wall');
      if (!o) return [];
      const base = zone ? 'open' : 'wall';
      return [
        {
          id: String(x.id ?? '').slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '') || `r${Math.random().toString(36).slice(2, 8)}`,
          name: String(x.name ?? 'Room').slice(0, 40),
          outline: o.pts,
          ...(zone ? { kind: 'zone' as const } : {}),
          ...(o.styles.some((v) => v !== base) ? { styles: o.styles } : {}),
          ...(Number.isFinite(x.ceilingIn) ? { ceilingIn: clamp(Math.round(x.ceilingIn as number), 90, 144) } : {}),
          ...(!zone && typeof x.flooringId === 'string' && /^[a-z0-9-]{1,40}$/.test(x.flooringId) ? { flooringId: x.flooringId } : {}),
        },
      ];
    });
    if (extra.length) out.extra = extra.slice(0, 8);
  }
  const walls = cleanWallFinishes(r.wallFinishes);
  if (walls) out.wallFinishes = walls;
  return out;
}

const ID_RE = /^[a-z0-9-]{1,40}$/;

/** Feature-wall finishes with known keys and fields only (lib/wallFinish.ts). */
export function cleanWallFinishes(raw: unknown): Record<string, WallFinish> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, WallFinish> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (!/^[A-Za-z0-9_-]{1,32}:\d{1,3}$/.test(k) || !v || typeof v !== 'object') continue;
    const f = v as WallFinish;
    const c: WallFinish = {};
    if (typeof f.paintId === 'string' && ID_RE.test(f.paintId)) c.paintId = f.paintId;
    if (isPanel(f.panel)) {
      c.panel = f.panel;
      if ((f.panel === 'wainscot' || f.panel === 'board-batten') && Number.isFinite(f.panelHeightIn)) c.panelHeightIn = clamp(Math.round(f.panelHeightIn as number), 12, 138);
      if (f.panel === 'tile' && typeof f.tileId === 'string' && ID_RE.test(f.tileId)) c.tileId = f.tileId;
    }
    if (Object.keys(c).length) out[k] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

const DOOR_STYLES = ['shaker', 'slab', 'fluted'];

function cleanSurfaces(raw: Partial<Surfaces> | undefined): Surfaces {
  const out = { ...DEFAULT_SURFACES };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as (keyof Surfaces)[]) {
      const v = raw[k];
      if (typeof v !== 'string' || !v || v.length > 64) continue;
      if (k === 'doorStyle' && !DOOR_STYLES.includes(v)) continue;
      (out as Record<string, string>)[k] = v;
    }
    if (raw.crown === 'flat' || raw.crown === 'cove') out.crown = raw.crown;
    if (raw.underCabinet === 'led') out.underCabinet = 'led';
    // Optional: a retail faucet. Without one, every sink draws its own.
    if (typeof raw.faucetId === 'string' && FIXTURE_ID_RE.test(raw.faucetId)) out.faucetId = raw.faucetId;
  }
  return out;
}

/** Same limits as the server's `normalizeDoc` (server/lib/doc.mjs), so a cleaned doc always saves. */
const MAX_ITEMS = 400;
const MAX_COORD = 2000;

/**
 * Drops only items that can't be placed or stored at all: no position, or a product id that is
 * neither a built-in nor a server id (the server would refuse the whole save). Unknown but
 * well-formed products (`p_…`) are kept.
 */
function cleanItems(raw: unknown): PlacedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacedItem[] = [];
  for (const it of raw as Partial<PlacedItem>[]) {
    if (out.length >= MAX_ITEMS) break;
    if (!it || typeof it !== 'object' || !isProductIdShape(it.productId)) continue;
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
    const item: PlacedItem = {
      id: typeof it.id === 'string' && it.id && it.id.length <= 64 ? it.id : `it-${out.length}-${Math.random().toString(36).slice(2, 8)}`,
      productId: it.productId,
      x: clamp(it.x as number, -MAX_COORD, MAX_COORD),
      y: clamp(it.y as number, -MAX_COORD, MAX_COORD),
      rotation: ROTATIONS.includes(it.rotation as Rotation) ? (it.rotation as Rotation) : 0,
      finishIndex: Number.isInteger(it.finishIndex) && (it.finishIndex as number) >= 0 && (it.finishIndex as number) <= 1000 ? (it.finishIndex as number) : 0,
    };
    if (typeof it.finishId === 'string' && it.finishId && it.finishId.length <= 64) item.finishId = it.finishId;
    if (typeof it.widthIn === 'number' && it.widthIn >= 1 && it.widthIn <= 240) item.widthIn = it.widthIn;
    if (typeof it.mirrored === 'boolean') item.mirrored = it.mirrored;
    out.push(item);
  }
  return out;
}

/** Same limits as the server's `normalizeExtra` (server/lib/doc.mjs). Invalid lines are dropped. */
export function cleanExtras(raw: unknown): EstimateExtra[] {
  if (!Array.isArray(raw)) return [];
  const out: EstimateExtra[] = [];
  for (const x of raw as Partial<EstimateExtra>[]) {
    if (out.length >= 50) break;
    if (!x || typeof x !== 'object') continue;
    const label = typeof x.label === 'string' ? x.label.trim().slice(0, 80) : '';
    if (!label || typeof x.amount !== 'number' || !Number.isFinite(x.amount) || x.amount < 0 || x.amount > 10_000_000) continue;
    const line: EstimateExtra = {
      id: typeof x.id === 'string' && x.id && x.id.length <= 64 ? x.id : `x-${out.length}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      amount: Math.round(x.amount * 100) / 100,
    };
    if (typeof x.cost === 'number' && Number.isFinite(x.cost) && x.cost >= 0 && x.cost <= 10_000_000) line.cost = Math.round(x.cost * 100) / 100;
    out.push(line);
  }
  return out;
}

/**
 * Gives every item a stable `finishId` (filled from the legacy `finishIndex` on old docs) and
 * re-syncs `finishIndex` to wherever that id sits now. Items whose product is unknown or only a
 * placeholder are left untouched, so their finish comes back when the product does.
 */
export function withFinishIds(items: PlacedItem[]): PlacedItem[] {
  let changed = false;
  const out = items.map((it) => {
    const p = getProduct(it.productId);
    if (!p || p.source === 'missing') return it;
    const list = finishList(p);
    let next: { finishIndex: number; finishId?: string };
    if (it.finishId) {
      const at = list.findIndex((f) => f.id === it.finishId);
      if (at < 0) return it; // The brand dropped that finish; keep the id, fall back on the index.
      next = { finishIndex: at, finishId: it.finishId };
    } else {
      next = finishAt(p, it.finishIndex);
    }
    if (next.finishIndex === it.finishIndex && next.finishId === it.finishId) return it;
    changed = true;
    return { ...it, ...next };
  });
  return changed ? out : items;
}

/**
 * Normalises a kitchen as it is opened (server, device draft, import, share link):
 * - registers the doc's embedded product snapshots (`doc.products`) in the catalog registry;
 * - keeps items whose product is unknown and registers a `missingProduct` placeholder for them,
 *   so autosave never turns a not-yet-loaded or unpublished product into a deletion;
 * - fills `finishId` from `finishIndex`;
 * - fills room and surfaces from `src/data/defaults.ts` (never builds a template);
 * - keeps the brands chosen in the setup wizard (`brandPrefs`), cleaned.
 * The returned doc is `version: 2` and carries no `products`; `prepareDocForSave` re-embeds them.
 */
export function sanitizeDoc(doc: DesignDoc): DesignDoc {
  const d = (doc && typeof doc === 'object' ? doc : {}) as Partial<DesignDoc>;
  const catalog = useCatalog.getState();
  if (d.products && typeof d.products === 'object') catalog.registerSnapshots(d.products);
  // The retail faucet and hardware it names; a live catalog copy already loaded wins.
  if (d.fixtures && typeof d.fixtures === 'object') registerFixtures(d.fixtures, { replace: false });
  const items = cleanItems(d.items);
  const unknown = [...new Set(items.map((i) => i.productId).filter((id) => !getProduct(id)))];
  if (unknown.length) catalog.registerMissing(unknown.map(missingProduct));
  const extras = cleanExtras(d.extras);
  const brandPrefs = cleanBrandPrefs(d.brandPrefs);
  return {
    name: typeof d.name === 'string' && d.name.trim() ? d.name : DEFAULT_KITCHEN_NAME,
    room: cleanRoom(d.room),
    surfaces: cleanSurfaces(d.surfaces),
    items: withFinishIds(items),
    version: 2,
    ...(extras.length ? { extras } : {}),
    ...(brandPrefs ? { brandPrefs } : {}),
  };
}

/** Server limits on embedded snapshots (BUILD_PLAN F-T8). */
export const MAX_SNAPSHOTS = 100;
export const MAX_SNAPSHOT_BYTES = 8000;

/** The parts of a product a kitchen needs to render, price and link it after it is unpublished. */
export function snapshotOf(p: Product): Product {
  const snap: Product = {
    id: p.id,
    kind: p.kind,
    ...(p.variant ? { variant: p.variant } : {}),
    category: p.category,
    brand: p.brand,
    name: p.name,
    code: p.code,
    widthIn: p.widthIn,
    depthIn: p.depthIn,
    heightIn: p.heightIn,
    elevationIn: p.elevationIn,
    ...(p.widthOptions ? { widthOptions: p.widthOptions } : {}),
    price: p.price,
    finishes: p.finishes,
    blurb: p.blurb,
    source: p.source,
    ...(p.brandId ? { brandId: p.brandId } : {}),
    ...(p.brandSlug ? { brandSlug: p.brandSlug } : {}),
    ...(p.isDemo ? { isDemo: true } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.skuByWidth ? { skuByWidth: p.skuByWidth } : {}),
    ...(p.priceByWidth ? { priceByWidth: p.priceByWidth } : {}),
    ...(p.thumbnailUrl ? { thumbnailUrl: p.thumbnailUrl } : {}),
    ...(p.buyUrl ? { buyUrl: p.buyUrl } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(p.flags ? { flags: p.flags } : {}),
    ...(p.productBrand ? { productBrand: p.productBrand } : {}),
    ...(p.upc ? { upc: p.upc } : {}),
  };
  if (JSON.stringify(snap).length <= MAX_SNAPSHOT_BYTES) return snap;
  // Oversized (very long copy or many finishes): drop what a render doesn't need.
  const slim: Product = { ...snap, blurb: snap.blurb.slice(0, 200) };
  if (Array.isArray(slim.finishes)) slim.finishes = slim.finishes.slice(0, 24).map(({ swatchUrl: _s, ...f }) => f);
  delete slim.skuByWidth;
  return slim;
}

/**
 * The doc as it should be stored (server autosave, project create, device draft, JSON export):
 * `version: 2`, with a snapshot of every non-built-in product in use. Placeholders for missing
 * products aren't snapshots, so they are never embedded.
 */
export function prepareDocForSave(doc: DesignDoc): DesignDoc {
  const products: Record<string, Product> = {};
  let n = 0;
  for (const it of doc.items) {
    const id = it.productId;
    if (isBuiltin(id) || products[id]) continue;
    const p = getProduct(id) ?? doc.products?.[id];
    if (!p || p.source === 'missing') continue;
    if (n >= MAX_SNAPSHOTS) break;
    products[id] = snapshotOf(p);
    n++;
  }
  const { products: _previous, fixtures: _fixtures, ...rest } = doc;
  const fixtures = fixturesForSave(doc);
  return { ...rest, version: 2, ...(n ? { products } : {}), ...(fixtures ? { fixtures } : {}) };
}
