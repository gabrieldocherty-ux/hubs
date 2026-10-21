import type { DesignDoc, Product } from '../../types';
import { BACKSPLASHES, CABINET_FINISHES, COUNTERTOPS, DOOR_STYLES, FLOORING, HARDWARE, PAINTS, byId } from '../../data/finishes';
import { resolveFinish } from '../../lib/finish';
import plansJson from '../../data/plans.json';
import type { CreditEntry, RenderReason, RenderScene, RendersStatus } from './api';

/**
 * Pure helpers for photoreal renders: money, the copy for each "why not", the ledger's labels and
 * the scene description built from a design. No DOM, no stores: tested in __tests__/.
 */

/** Cents of CAD as "$24.75". */
export function cents(c: number): string {
  const n = Math.round(Number(c) || 0);
  const sign = n < 0 ? '−' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

/** How many renders a balance pays for. */
export const rendersLeft = (balanceCents: number, costCents: number): number => (costCents > 0 ? Math.max(0, Math.floor(balanceCents / costCents)) : 0);

/** "1 render" / "12 renders". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The credits each paid month adds (plans.json showroom_monthly, the render_credits line). */
export const MONTHLY_CREDIT_CENTS: number = (plansJson as { id: string; breakdown?: { id: string; cents: number }[] }[]).find((x) => x.id === 'showroom_monthly')?.breakdown?.find((b) => b.id === 'render_credits')?.cents ?? 2500;

export const SETTING_UP = 'Photoreal renders are being set up';

/** Why this person can't render right now, in plain words (null when they can). */
export function reasonCopy(reason: RenderReason | null, s: Pick<RendersStatus, 'costCents' | 'balanceCents'> | null = null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'not_configured':
      return `${SETTING_UP}. Nothing is charged until they’re ready.`;
    case 'sign_in':
      return 'Sign in to make a photoreal render.';
    case 'visitor_off':
      return 'Photoreal renders aren’t switched on for this showroom.';
    case 'daily_cap':
      return 'Today’s photoreal renders are used up. Try again tomorrow.';
    case 'no_credits':
      return `There aren’t enough render credits left${s?.balanceCents != null ? ` (${cents(s.balanceCents)}; one render is ${cents(s.costCents)})` : ''}. Ask BluModel to add more.`;
    case 'unavailable':
      return 'Photoreal renders aren’t available right now.';
    default:
      return 'Photoreal renders aren’t available right now.';
  }
}

/**
 * Whether the editor shows the button at all: on a showroom, signed in, for the team always and
 * for a visitor when the company switched visitor renders on or their account has free renders left.
 */
export function showButton({ onShowroom, signedIn, team, visitorRenders, hasDesign, freeLeft = 0 }: { onShowroom: boolean; signedIn: boolean; team: boolean; visitorRenders: boolean; hasDesign: boolean; freeLeft?: number }): boolean {
  return onShowroom && signedIn && hasDesign && (team || visitorRenders || freeLeft > 0);
}

/** "Free: 2 of 3 free photoreal renders left on your account." (null when none are left). */
export function freeLine(free: { total: number; left: number } | undefined): string | null {
  if (!free || free.left <= 0) return null;
  return `Free: ${free.left} of ${free.total} free photoreal ${free.total === 1 ? 'render' : 'renders'} left on your account. No credits are used.`;
}

/** The team role the server sends on a showroom (`user.showroom.role`), or null. */
export function showroomRole(user: unknown): 'owner' | 'staff' | null {
  const r = (user as { showroom?: { role?: unknown } | null } | null)?.showroom?.role;
  return r === 'owner' || r === 'staff' ? r : null;
}

const ENTRY_LABEL: Record<CreditEntry['kind'], string> = {
  grant: 'Monthly credits',
  expire: 'Expired',
  reserve: 'Render started',
  charge: 'Render finished',
  release: 'Render failed: returned',
  refund: 'Refunded',
  adjust: 'Adjusted by BluModel',
};
export const entryLabel = (k: CreditEntry['kind']): string => ENTRY_LABEL[k] ?? k;

/** A ledger date: "Oct 17, 2026". */
export const day = (t: number): string => new Date(t).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
/** "Oct 17, 2:05 p.m." */
export const when = (t: number): string => new Date(t).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const BATH_KINDS = /vanity|toilet|tub|shower|bath/i;

/**
 * The structured description of a design for the AI (server/renders/scene.mjs cleans it again):
 * the room, the kitchen-wide finishes and the products with their finishes, grouped and counted.
 * Openings (windows, doors) are left out: they're in the picture.
 */
export function buildScene(doc: DesignDoc, productOf: (id: string) => Product | undefined, size: { width: number; height: number }): RenderScene {
  const s = doc.surfaces;
  const groups = new Map<string, RenderScene['products'][number]>();
  let bath = false;
  for (const item of doc.items) {
    const p = productOf(item.productId) ?? doc.products?.[item.productId];
    if (!p || p.kind === 'window' || p.kind === 'door') continue;
    if (BATH_KINDS.test(p.kind) || BATH_KINDS.test(p.name)) bath = true;
    let finish = '';
    try {
      finish = resolveFinish(item, p, s).name;
    } catch {
      finish = '';
    }
    const key = `${p.id}|${finish}`;
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { name: p.name, brand: p.brand ?? '', category: p.category ?? '', finish, count: 1 });
  }
  const hardware = s.hardwareId && doc.fixtures?.[s.hardwareId] ? doc.fixtures[s.hardwareId].name : byId(HARDWARE, s.hardwareId).name;
  return {
    room: { kind: bath ? 'bathroom' : 'kitchen', widthIn: doc.room.widthIn, lengthIn: doc.room.lengthIn, ceilingIn: doc.room.ceilingIn, ...(doc.room.extra?.length ? { shape: `${doc.room.extra.length + 1} connected rooms` } : doc.room.outline ? { shape: `a room with ${doc.room.outline.length} corners, not a plain rectangle` } : {}) },
    finishes: {
      cabinets: byId(CABINET_FINISHES, s.cabinetFinishId).name,
      doorStyle: byId(DOOR_STYLES, s.doorStyle).name,
      hardware,
      countertop: byId(COUNTERTOPS, s.countertopId).name,
      backsplash: byId(BACKSPLASHES, s.backsplashId).name,
      flooring: byId(FLOORING, s.flooringId).name,
      walls: byId(PAINTS, s.paintId).name,
    },
    products: [...groups.values()].slice(0, 60),
    camera: { view: 'current', widthPx: size.width, heightPx: size.height },
  };
}

/** The capture size for a render: the long side at most `long` px, 16:9 unless the view is portrait. */
export function captureSize(viewW: number, viewH: number, long = 1600): { width: number; height: number } {
  const portrait = viewH > viewW * 1.05;
  return portrait ? { width: Math.round((long * 9) / 16), height: long } : { width: long, height: Math.round((long * 9) / 16) };
}
