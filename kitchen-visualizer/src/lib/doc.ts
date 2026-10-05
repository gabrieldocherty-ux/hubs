import type { DesignDoc, EstimateExtra, PlacedItem, Product, Room, Rotation, Surfaces } from '../types';
import { DEFAULT_KITCHEN_NAME, DEFAULT_ROOM, DEFAULT_SURFACES } from '../data/defaults';
import { getProduct, isBuiltin, isProductIdShape, missingProduct } from '../data/catalog';
import { useCatalog } from '../store/useCatalog';
import { finishAt, finishList } from './finish';

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
    widthIn: clamp(Math.round(num(r.widthIn, DEFAULT_ROOM.widthIn)), 72, 480),
    lengthIn: clamp(Math.round(num(r.lengthIn, DEFAULT_ROOM.lengthIn)), 72, 480),
    ceilingIn: clamp(Math.round(num(r.ceilingIn, DEFAULT_ROOM.ceilingIn)), 90, 144),
  };
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
 * - fills room and surfaces from `src/data/defaults.ts` (never builds a template).
 * The returned doc is `version: 2` and carries no `products`; `prepareDocForSave` re-embeds them.
 */
export function sanitizeDoc(doc: DesignDoc): DesignDoc {
  const d = (doc && typeof doc === 'object' ? doc : {}) as Partial<DesignDoc>;
  const catalog = useCatalog.getState();
  if (d.products && typeof d.products === 'object') catalog.registerSnapshots(d.products);
  const items = cleanItems(d.items);
  const unknown = [...new Set(items.map((i) => i.productId).filter((id) => !getProduct(id)))];
  if (unknown.length) catalog.registerMissing(unknown.map(missingProduct));
  const extras = cleanExtras(d.extras);
  return {
    name: typeof d.name === 'string' && d.name.trim() ? d.name : DEFAULT_KITCHEN_NAME,
    room: cleanRoom(d.room),
    surfaces: cleanSurfaces(d.surfaces),
    items: withFinishIds(items),
    version: 2,
    ...(extras.length ? { extras } : {}),
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
  const { products: _previous, ...rest } = doc;
  return n ? { ...rest, version: 2, products } : { ...rest, version: 2 };
}
