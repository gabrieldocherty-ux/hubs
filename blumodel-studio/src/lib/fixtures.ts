/**
 * Real faucets, pulls and knobs (the retail catalog's `fixtures`) as kitchen-wide choices.
 *
 * A kitchen picks one pull or knob for every door and drawer (`surfaces.hardwareId`, which is
 * otherwise a built-in finish such as `brass`) and optionally one faucet for every sink
 * (`surfaces.faucetId`). They are not placed items: they work like the built-in hardware
 * finishes, so a layout never changes because of them. The 3D models draw them from `style` and
 * `sizeIn` (src/components/three/parts.tsx), the estimate prices them.
 *
 * Like `doc.products`, the saved kitchen keeps a snapshot of each one it uses (`doc.fixtures`):
 * `sanitizeDoc` registers the snapshots here and `prepareDocForSave` embeds them again, so a
 * kitchen draws and prices its fixtures before the retail chunk loads, and on the server.
 *
 * Framework-free (no zustand, no React): the server's export kit bundles this file through
 * estimate.ts. Components re-render on a registry change with `useFixtureVersion` (useFixtures.ts).
 */
import type { DesignDoc, Fixture, FixtureKind, FixtureStyle, Surfaces } from '../types';
import { HARDWARE, byId } from '../data/finishes';

export const FIXTURE_ID_RE = /^r-[a-z0-9][a-z0-9-]{0,38}$/;

/** A price to estimate with when no store price was checked (per piece, CAD), like the Basics price a retail product borrows. */
export const TYPICAL_FIXTURE_PRICE: Record<FixtureKind, number> = { faucet: 249, pull: 8, knob: 6 };

/** The retail catalog's wire shape (src/data/retail.json `fixtures`). */
export interface FixtureWire {
  id: string;
  kind: FixtureKind;
  style: FixtureStyle;
  brand: string;
  name: string;
  code: string;
  finish: { id: string; name: string; hex: string };
  roughness: number;
  sizeIn: Fixture['sizeIn'];
  /** Pieces per store listing (a 10-pack is 10). */
  pack: number;
  /** Per piece, the lowest checked store price; null when none was checked. */
  price: number | null;
  extras?: Fixture['extras'];
}

/** A wire fixture as the snapshot a kitchen keeps. */
export function fixtureFromWire(w: FixtureWire): Fixture {
  return {
    id: w.id,
    kind: w.kind,
    style: w.style,
    brand: w.brand,
    name: w.name,
    code: w.code,
    finish: { ...w.finish },
    roughness: w.roughness,
    sizeIn: { ...w.sizeIn },
    price: w.price ?? TYPICAL_FIXTURE_PRICE[w.kind],
    priceKnown: w.price !== null,
    ...(w.extras ? { extras: { ...w.extras } } : {}),
  };
}

const KINDS = new Set<FixtureKind>(['faucet', 'pull', 'knob']);
const STYLES = new Set<FixtureStyle>(['pulldown', 'pullout', 'single', 'side-spray', 'spring', 'bar', 'arch', 'rect', 'finger', 'mushroom', 'disc']);
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A snapshot as the server keeps it (server/lib/doc.mjs `cleanFixture` has the same rules), or null. */
export function cleanFixture(raw: unknown, id: string): Fixture | null {
  const f = raw as Partial<Fixture> | null;
  if (!f || typeof f !== 'object' || !FIXTURE_ID_RE.test(id) || f.id !== id) return null;
  if (!KINDS.has(f.kind as FixtureKind) || !STYLES.has(f.style as FixtureStyle)) return null;
  if (!str(f.brand, 80) || !str(f.name, 120) || typeof f.code !== 'string' || f.code.length > 60) return null;
  const fin = f.finish;
  if (!fin || !str(fin.id, 40) || !str(fin.name, 60) || !HEX.test(fin.hex ?? '')) return null;
  if (!num(f.roughness, 0, 1) || !num(f.price, 0, 100_000)) return null;
  const sizeIn: Fixture['sizeIn'] = {};
  for (const k of ['length', 'cc', 'dia', 'height'] as const) if (f.sizeIn && num(f.sizeIn[k], 0.2, 40)) sizeIn[k] = f.sizeIn[k];
  const extras = f.extras && typeof f.extras === 'object' ? { ...(f.extras.soap === true ? { soap: true } : {}), ...(f.extras.sideSpray === true ? { sideSpray: true } : {}) } : {};
  return {
    id,
    kind: f.kind as FixtureKind,
    style: f.style as FixtureStyle,
    brand: f.brand as string,
    name: f.name as string,
    code: f.code,
    finish: { id: fin.id, name: fin.name, hex: fin.hex.toLowerCase() },
    roughness: f.roughness as number,
    sizeIn,
    price: Math.round((f.price as number) * 100) / 100,
    priceKnown: f.priceKnown === true,
    ...(Object.keys(extras).length ? { extras } : {}),
  };
}

// ── the registry (the retail chunk and every opened kitchen fill it) ──

let registry = new Map<string, Fixture>();
let version = 0;
const listeners = new Set<() => void>();

/** The registry's change counter (for useSyncExternalStore). */
export const fixturesVersion = (): number => version;
export function subscribeFixtures(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function commit(next: Map<string, Fixture>) {
  registry = next;
  version++;
  for (const fn of listeners) fn();
}
/** Forgets every fixture (tests: a fresh device). */
export function resetFixtures(): void {
  commit(new Map());
}

/** Adds fixtures (a live catalog copy replaces a kitchen's snapshot of the same id). */
export function registerFixtures(list: Fixture[] | Record<string, Fixture> | undefined, { replace = true } = {}): void {
  if (!list) return;
  const entries = Array.isArray(list) ? list.map((f) => [f?.id, f] as const) : Object.entries(list);
  const next = new Map(registry);
  let changed = false;
  for (const [id, raw] of entries) {
    if (typeof id !== 'string') continue;
    const f = cleanFixture(raw, id);
    if (!f || (!replace && next.has(id))) continue;
    next.set(id, f);
    changed = true;
  }
  if (changed) commit(next);
}

export function getFixture(id: string | undefined): Fixture | undefined {
  return id ? registry.get(id) : undefined;
}

// ── what a kitchen draws and prices ──

/** The pull or knob every door and drawer wears. */
export interface HardwareLook {
  id: string;
  brand: string;
  name: string;
  hex: string;
  roughness: number;
  price: number;
  priceKnown: boolean;
  /** Null for a built-in finish: the bar pull sized to each front, as before. */
  fixture: Fixture | null;
}

/** The faucet every sink draws: null keeps each sink's own faucet in the hardware finish. */
export interface FaucetLook {
  fixture: Fixture;
  hex: string;
  roughness: number;
}

/** The kitchen's hardware: a retail pull or knob when `hardwareId` names one that is known, else the built-in finish. */
export function resolveHardware(surfaces: Pick<Surfaces, 'hardwareId'>, fixtures?: DesignDoc['fixtures']): HardwareLook {
  const f = fixtures?.[surfaces.hardwareId] ?? getFixture(surfaces.hardwareId);
  if (f && (f.kind === 'pull' || f.kind === 'knob')) return { id: f.id, brand: f.brand, name: f.name, hex: f.finish.hex, roughness: f.roughness, price: f.price, priceKnown: f.priceKnown, fixture: f };
  // An unknown `r-…` id (the catalog dropped it, the snapshot is gone) draws as the default finish.
  const hw = byId(HARDWARE, surfaces.hardwareId);
  return { id: hw.id, brand: hw.brand, name: hw.name, hex: hw.hex, roughness: hw.roughness, price: hw.price, priceKnown: true, fixture: null };
}

export function resolveFaucet(surfaces: Pick<Surfaces, 'faucetId'>, fixtures?: DesignDoc['fixtures']): FaucetLook | null {
  const f = surfaces.faucetId ? (fixtures?.[surfaces.faucetId] ?? getFixture(surfaces.faucetId)) : undefined;
  return f && f.kind === 'faucet' ? { fixture: f, hex: f.finish.hex, roughness: f.roughness } : null;
}

/** The snapshots a saved kitchen keeps: the retail fixtures its surfaces name, and only those. */
export function fixturesForSave(doc: Pick<DesignDoc, 'surfaces' | 'fixtures'>): Record<string, Fixture> | undefined {
  const out: Record<string, Fixture> = {};
  for (const id of [doc.surfaces.hardwareId, doc.surfaces.faucetId]) {
    if (!id || !FIXTURE_ID_RE.test(id)) continue;
    const f = getFixture(id) ?? doc.fixtures?.[id];
    if (f) out[id] = f;
  }
  return Object.keys(out).length ? out : undefined;
}

/** "128 mm (5 1/16″) centres, 5.5″ long" and the like, for the picker. */
export function fixtureSize(f: Fixture): string {
  const inch = (n: number) => `${Math.round(n * 100) / 100}″`;
  if (f.kind === 'pull' && f.sizeIn.cc) return `${Math.round(f.sizeIn.cc * 25.4)} mm centres${f.sizeIn.length ? `, ${inch(f.sizeIn.length)} long` : ''}`;
  if (f.kind === 'knob' && f.sizeIn.dia) return `${Math.round(f.sizeIn.dia * 25.4)} mm across`;
  if (f.kind === 'faucet' && f.sizeIn.height) return `${inch(f.sizeIn.height)} tall`;
  return '';
}
