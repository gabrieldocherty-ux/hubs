import type { Room } from '../../types';
import { APPLIANCE_WIDTHS, LIMITS, clampPhotoModel } from '../../../server/llm/photoModel.mjs';
import {
  LOW_CONFIDENCE,
  wallLen,
  type ApplianceKind,
  type PhotoAppliance,
  type PhotoIsland,
  type PhotoModel,
  type PhotoOpening,
  type PhotoRun,
  type PhotoStyle,
  type PhotoWall,
} from './photoModel';

/**
 * Edits on "Check the space" (package D). Pure: every function returns a new, clamped model.
 *
 * Confidence keys follow the item they describe (`openings.2`, `runs.0`, …). Editing a field
 * means the person checked it, so its key is dropped (missing = "entered by hand"); removing an
 * item shifts the keys after it down so they stay attached to the right item.
 */

export type ListKey = 'openings' | 'runs' | 'appliances';
type ItemOf<K extends ListKey> = K extends 'openings' ? PhotoOpening : K extends 'runs' ? PhotoRun : PhotoAppliance;

const clampModel = (m: PhotoModel): PhotoModel => clampPhotoModel(m)?.model ?? m;

function withoutKey(conf: Record<string, number>, key: string): Record<string, number> {
  if (!(key in conf)) return conf;
  const out = { ...conf };
  delete out[key];
  return out;
}

/** True when the analyser was unsure about this field and nobody has checked it yet. */
export function needsCheck(model: PhotoModel, key: string): boolean {
  const c = model.confidence[key];
  return typeof c === 'number' && c < LOW_CONFIDENCE;
}

/** Every field still marked "Check this", in form order. */
export function uncheckedKeys(model: PhotoModel): string[] {
  const order = (k: string) => {
    const [head, n] = k.split('.');
    const rank = ['room', 'runs', 'appliances', 'openings', 'island', 'style'].indexOf(head);
    return (rank < 0 ? 9 : rank) * 1000 + (Number(n) || 0);
  };
  return Object.keys(model.confidence)
    .filter((k) => needsCheck(model, k))
    .sort((a, b) => order(a) - order(b));
}

/** Marks a field as checked without changing it ("Looks right"). */
export function confirmField(model: PhotoModel, key: string): PhotoModel {
  return { ...model, confidence: withoutKey(model.confidence, key) };
}

export function setRoom(model: PhotoModel, patch: Partial<Room>): PhotoModel {
  return clampModel({ ...model, room: { ...model.room, ...patch }, confidence: withoutKey(model.confidence, 'room') });
}

/**
 * Keeps a run at least a foot long while one end is being edited, by moving the other end
 * (so a run never disappears under someone's fingers).
 */
function keepRunLength(run: PhotoRun, patch: Partial<PhotoRun>, len: number): PhotoRun {
  const next = { ...run, ...patch };
  const min = LIMITS.minRunIn;
  next.startIn = Math.max(0, Math.min(next.startIn, len - min));
  next.endIn = Math.max(min, Math.min(next.endIn, len));
  if (next.endIn - next.startIn < min) {
    if ('endIn' in patch && !('startIn' in patch)) next.startIn = Math.max(0, next.endIn - min);
    else next.endIn = Math.min(len, next.startIn + min);
  }
  return next;
}

export function updateItem<K extends ListKey>(model: PhotoModel, list: K, index: number, patch: Partial<ItemOf<K>>): PhotoModel {
  const items = model[list] as ItemOf<K>[];
  const current = items[index];
  if (!current) return model;
  let next = { ...current, ...patch } as ItemOf<K>;
  if (list === 'runs') {
    const run = current as PhotoRun;
    const p = patch as Partial<PhotoRun>;
    const wall = p.wall ?? run.wall;
    const len = wallLen(wall, model.room);
    // A run moved to a shorter wall keeps its length where it can.
    const moved = wall !== run.wall ? { wall, startIn: Math.min(run.startIn, Math.max(0, len - (run.endIn - run.startIn))), endIn: Math.min(len, run.endIn) } : {};
    next = keepRunLength(run, { ...moved, ...p }, len) as ItemOf<K>;
  }
  if (list === 'appliances') {
    const p = patch as Partial<PhotoAppliance>;
    // A new kind starts at its standard width.
    if (p.kind && p.kind !== (current as PhotoAppliance).kind && p.widthIn === undefined) (next as PhotoAppliance).widthIn = APPLIANCE_WIDTHS[p.kind].def;
  }
  const copy = items.slice();
  copy[index] = next;
  return clampModel({ ...model, [list]: copy, confidence: withoutKey(model.confidence, `${list}.${index}`) });
}

export function removeItem(model: PhotoModel, list: ListKey, index: number): PhotoModel {
  const items = model[list] as unknown[];
  if (index < 0 || index >= items.length) return model;
  const confidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(model.confidence)) {
    const m = /^([a-z]+)\.(\d+)$/.exec(k);
    if (!m || m[1] !== list) {
      confidence[k] = v;
      continue;
    }
    const n = Number(m[2]);
    if (n < index) confidence[k] = v;
    else if (n > index) confidence[`${list}.${n - 1}`] = v;
  }
  return clampModel({ ...model, [list]: items.filter((_, i) => i !== index), confidence });
}

/** Where something `width` wide fits best along a wall: centred in the longest free stretch. */
export function freeSpot(len: number, taken: [number, number][], width: number): number {
  const spans = taken.slice().sort((a, b) => a[0] - b[0]);
  let best = { at: Math.max(0, (len - width) / 2), room: -1 };
  let cursor = 0;
  for (const [s, e] of [...spans, [len, len] as [number, number]]) {
    const gap = s - cursor;
    if (gap > best.room) best = { at: cursor + Math.max(0, (gap - width) / 2), room: gap };
    cursor = Math.max(cursor, e);
  }
  return Math.round(Math.min(Math.max(0, best.at), Math.max(0, len - width)));
}

export function addOpening(model: PhotoModel, type: 'window' | 'door', wall: PhotoWall = type === 'window' ? 'north' : 'south'): PhotoModel {
  if (model.openings.length >= LIMITS.maxOpenings) return model;
  const widthIn = type === 'window' ? 36 : 32;
  const taken = model.openings.filter((o) => o.wall === wall).map((o) => [o.offsetIn, o.offsetIn + o.widthIn] as [number, number]);
  const offsetIn = freeSpot(wallLen(wall, model.room), taken, widthIn);
  const o: PhotoOpening = type === 'window' ? { type, wall, offsetIn, widthIn, heightIn: 42, sillIn: 42 } : { type, wall, offsetIn, widthIn, heightIn: 80 };
  return clampModel({ ...model, openings: [...model.openings, o] });
}

export function addRun(model: PhotoModel, wall?: PhotoWall): PhotoModel {
  if (model.runs.length >= LIMITS.maxRuns) return model;
  const used = new Set(model.runs.map((r) => r.wall));
  const w = wall ?? (['north', 'west', 'east', 'south'] as PhotoWall[]).find((x) => !used.has(x)) ?? 'north';
  return clampModel({ ...model, runs: [...model.runs, { wall: w, startIn: 0, endIn: wallLen(w, model.room), upper: true }] });
}

const overhead = (k: ApplianceKind) => k === 'hood' || k === 'microwave';

export function addAppliance(model: PhotoModel, kind: ApplianceKind, wall?: PhotoWall | 'island'): PhotoModel {
  if (model.appliances.length >= LIMITS.maxAppliances) return model;
  const w = wall ?? model.runs[0]?.wall ?? 'north';
  if (w === 'island' && !model.island) return model;
  const widthIn = APPLIANCE_WIDTHS[kind].def;
  const len = w === 'island' ? model.island!.widthIn : wallLen(w, model.room);
  const taken = model.appliances
    .filter((a) => a.wall === w && overhead(a.kind) === overhead(kind))
    .map((a) => [a.offsetIn, a.offsetIn + (a.widthIn ?? APPLIANCE_WIDTHS[a.kind].def)] as [number, number]);
  // A hood goes over the range on its wall when there is one.
  const cook = kind === 'hood' ? model.appliances.find((a) => a.wall === w && (a.kind === 'range' || a.kind === 'cooktop')) : undefined;
  const offsetIn = cook ? cook.offsetIn + ((cook.widthIn ?? 30) - widthIn) / 2 : freeSpot(len, taken, widthIn);
  return clampModel({ ...model, appliances: [...model.appliances, { kind, wall: w, offsetIn, widthIn }] });
}

export function setIsland(model: PhotoModel, island: PhotoIsland | null): PhotoModel {
  const appliances = island ? model.appliances : model.appliances.filter((a) => a.wall !== 'island');
  return clampModel({ ...model, island, appliances, confidence: withoutKey(model.confidence, 'island') });
}

export function setStyle(model: PhotoModel, patch: Partial<PhotoStyle>): PhotoModel {
  return clampModel({ ...model, style: { ...model.style, ...patch }, confidence: withoutKey(model.confidence, 'style') });
}

// ─── Units ───────────────────────────────────────────────────────────────

export type Units = 'ftin' | 'cm';
export const CM_PER_IN = 2.54;
export const toCm = (inches: number) => Math.round(inches * CM_PER_IN);
/** Centimetres to inches, to the half inch the model keeps. */
export const fromCm = (cm: number) => Math.round((cm / CM_PER_IN) * 2) / 2;

/** A length for labels: 5′ 6″ or 168 cm. */
export function formatLength(inches: number, units: Units): string {
  if (units === 'cm') return `${toCm(inches)} cm`;
  let ft = Math.floor(inches / 12);
  let rest = Math.round((inches - ft * 12) * 2) / 2;
  if (rest >= 12) {
    ft += 1;
    rest = 0;
  }
  if (!ft) return `${rest}″`;
  return rest ? `${ft}′ ${rest}″` : `${ft}′`;
}
