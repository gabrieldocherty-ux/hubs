import type { OrderStatus } from '../../types/platform';
import { money } from '../../lib/money';
import { normalizeUpc } from './upc';

/**
 * Pure helpers for the orders screens: labels, money, dates, the timeline wording and the request
 * form's checks. No DOM and no React, so `__tests__/model.test.ts` can run them under Node.
 */

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Not paid yet',
  pending_payment: 'Awaiting payment',
  payment_failed: 'Payment declined',
  paid: 'Paid · in the queue',
  in_progress: 'In progress',
  delivered: 'Delivered',
  revision_requested: 'Revision requested',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  expired: 'Expired',
};

/** Studio-facing names are shorter. */
export const STUDIO_STATUS_LABEL: Record<OrderStatus, string> = {
  ...STATUS_LABEL,
  paid: 'Paid',
};

/**
 * An order's status as its buyer reads it. A request included in the Contractor plan was never
 * paid for, so its queued state is "Submitted", not "Paid".
 */
export function statusLabel(o: { status: OrderStatus; pricing?: string }, studio = false): string {
  if (o.pricing === 'plan' && o.status === 'paid') return studio ? 'Submitted' : 'Submitted · in the queue';
  return (studio ? STUDIO_STATUS_LABEL : STATUS_LABEL)[o.status];
}

export type Tone = 'neutral' | 'active' | 'ok' | 'warn' | 'bad';

/** The colour family of a status pill. The pill always carries the label too (never colour alone). */
export function statusTone(s: OrderStatus): Tone {
  switch (s) {
    case 'paid':
    case 'in_progress':
    case 'revision_requested':
      return 'active';
    case 'delivered':
    case 'completed':
      return 'ok';
    case 'draft':
    case 'pending_payment':
      return 'warn';
    case 'payment_failed':
      return 'bad';
    default:
      return 'neutral';
  }
}

/** Unpaid orders can still be paid or cancelled. */
export const isUnpaid = (s: OrderStatus) => s === 'draft' || s === 'pending_payment' || s === 'payment_failed';

/** The list's filter chips. */
export type ListFilter = 'all' | 'open' | 'unpaid' | 'done' | 'closed';
export const LIST_FILTERS: { id: ListFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'In the studio' },
  { id: 'unpaid', label: 'Not paid' },
  { id: 'done', label: 'Delivered' },
  { id: 'closed', label: 'Closed' },
];

export function inFilter(s: OrderStatus, f: ListFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'open':
      return s === 'paid' || s === 'in_progress' || s === 'revision_requested';
    case 'unpaid':
      return isUnpaid(s);
    case 'done':
      return s === 'delivered' || s === 'completed';
    case 'closed':
      return s === 'cancelled' || s === 'refunded' || s === 'expired';
  }
}

/** $129, $1,234.50: whole dollars stay whole (no currency code; see orderPrice for an order's). */
export function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/**
 * What an order cost: "Included" for a plan request ("Not counted" once cancelled, since a plan
 * request can only be cancelled before work starts and its models go back to the allowance), else
 * its stored amount in its own currency ("$279 USD").
 */
export function orderPrice(o: { pricing?: string; status?: string; amountCents: number; currency?: string | null }): string {
  if (o.pricing === 'plan') return o.status === 'cancelled' ? 'Not counted' : 'Included';
  return money(o.amountCents, o.currency || 'usd');
}

export function shortDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "in 3 h", "in 2 days", "3 days ago". */
export function relative(ms: number, now: number = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  const span = abs < 3_600_000 ? `${Math.max(1, Math.round(abs / 60_000))} min` : abs < 36 * 3_600_000 ? `${h} h` : `${d} day${d === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

/** 33 → 2′ 9″ (33″); small sizes stay in inches. */
export function sizeText(w: number, d: number, h: number): string {
  const f = (n: number) => `${Math.round(n * 100) / 100}″`;
  return `${f(w)} W × ${f(d)} D × ${f(h)} H`;
}

export interface TimelineEvent {
  type: string;
  toStatus: OrderStatus | null;
  note: string;
  by: string;
}

/** What a timeline row says. Notes are shown separately, under the title. */
export function eventTitle(e: TimelineEvent): string {
  const who = e.by === 'you' ? 'You' : e.by === 'studio' || e.by === 'admin' ? 'BluModel 3D studio' : e.by === 'customer' ? 'The customer' : 'BluModel Studio';
  switch (e.type) {
    case 'created':
      return `${who} sent the request`;
    case 'checkout':
      return 'Checkout started';
    case 'paid':
      return 'Payment received';
    case 'payment_failed':
      return 'Payment declined';
    case 'payment_mismatch':
      return 'Payment held for review';
    case 'expired':
      return 'Expired without payment';
    case 'cancelled':
      return `${who} cancelled the request`;
    case 'started':
      return 'The studio started modelling';
    case 'note':
      return `Note from ${e.by === 'you' ? 'you' : e.by === 'customer' ? 'the customer' : 'the studio'}`;
    case 'item_delivered':
      return 'A model was delivered';
    case 'delivered':
      return 'Model delivered';
    case 'revision_requested':
      return `${who} asked for a revision`;
    case 'completed':
      return `${who} accepted the model`;
    case 'refunded':
      return 'Refunded';
    case 'partial_refund':
      return 'Partly refunded';
    default:
      return e.type.replace(/_/g, ' ');
  }
}

// ─── The request form ───────────────────────────────────────────────────

export const MAX_REFERENCES = 8;
export const MAX_NOTES = 4000;
export const NAME_MAX = 80;
export const BRAND_MAX = 60;

/** One product on the request form (Make custom models: one model per product, from the plan's allowance). */
export interface DraftItem {
  productTypeId: string;
  name: string;
  brand: string;
  /** As typed, pasted or scanned; normalised (and checked again) by the server. */
  upc: string;
  /** A private reference photo of the barcode, when it couldn't be typed or scanned. */
  barcodeFileId?: string;
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
  notes: string;
  referenceFileIds: string[];
  refProductId?: string;
}

export type ItemField = 'productTypeId' | 'name' | 'brand' | 'upc' | 'widthIn' | 'depthIn' | 'heightIn' | 'referenceFileIds' | 'notes';

export type Step = 'products' | 'review';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'review', label: 'Review & send' },
];

const LIMITS = { widthIn: [1, 240], depthIn: [1, 120], heightIn: [0.25, 144] } as const;
const DIM_LABEL = { widthIn: 'Width', depthIn: 'Depth', heightIn: 'Height' } as const;

/**
 * Every problem with a product, by field (empty when it can be sent). Mirrors the server's checks;
 * the server checks again. The size is optional, but a size that is given must be in range.
 */
export function itemProblems(item: DraftItem): Partial<Record<ItemField, string>> {
  const out: Partial<Record<ItemField, string>> = {};
  if (!item.productTypeId) out.productTypeId = 'Choose what kind of product it is.';
  const name = item.name.trim();
  if (!name) out.name = 'Name the product.';
  else if (name.length > NAME_MAX) out.name = `Keep the name to ${NAME_MAX} characters or fewer.`;
  if (item.brand.trim().length > BRAND_MAX) out.brand = `Keep the brand to ${BRAND_MAX} characters or fewer.`;
  const upc = item.upc.trim() ? normalizeUpc(item.upc) : null;
  if (upc && !upc.ok) out.upc = upc.message;
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = item[k];
    const [lo, hi] = LIMITS[k];
    if (v != null && (!Number.isFinite(v) || v < lo || v > hi)) out[k] = `${DIM_LABEL[k]} must be between ${lo} and ${hi} inches.`;
  }
  if (item.referenceFileIds.length > MAX_REFERENCES) out.referenceFileIds = `Add up to ${MAX_REFERENCES} photos.`;
  else if (!item.referenceFileIds.length && !item.refProductId && !upc?.ok && !item.barcodeFileId && !out.upc) {
    out.referenceFileIds = 'Add a photo or the UPC, so the studio can identify it.';
  }
  if (item.notes.length > MAX_NOTES) out.notes = `Keep notes to ${MAX_NOTES.toLocaleString('en-US')} characters or fewer.`;
  return out;
}

/** The first problem with a product, or null. */
export function itemProblem(item: DraftItem): string | null {
  return Object.values(itemProblems(item))[0] ?? null;
}

/** Where a server field error (`items[3].brief.upc`) points: the product and the field. */
export function errorTarget(field: string): { item: number; field: string } | null {
  const m = field.match(/^items\[(\d+)\](?:\.brief)?\.?(\w*)/);
  return m ? { item: Number(m[1]), field: m[2] || 'name' } : null;
}

/** "November 15": the day an allowance resets (UTC, as the server counts it). */
export function resetDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** "2 of 3 models left this month", "No models left this month". */
export function modelsLeftText(a: { left: number; total: number }): string {
  if (a.left <= 0) return 'No models left this month';
  return `${a.left} of ${a.total} model${a.total === 1 ? '' : 's'} left this month`;
}

/**
 * What the request form says about a product count against the allowance: whether it can be sent,
 * and if not, why (one model per product).
 */
export function allowanceCheck(products: number, a: { active: boolean; left: number; resetsAt: number } | null): { ok: boolean; message: string | null } {
  if (!a) return { ok: false, message: null };
  if (!a.active) return { ok: false, message: 'New custom models are no longer sold here.' };
  if (a.left <= 0) return { ok: false, message: `You’ve used this month’s models. Your allowance resets on ${resetDay(a.resetsAt)}.` };
  if (products > a.left) {
    const extra = products - a.left;
    return { ok: false, message: `This request has ${products} products and you have ${a.left} model${a.left === 1 ? '' : 's'} left this month. Remove ${extra}, or send ${extra === 1 ? 'it' : 'them'} after ${resetDay(a.resetsAt)}.` };
  }
  return { ok: true, message: null };
}

/** "33″ W × 22″ D", "Size not given": a brief's size, whatever of it was given. */
export function briefSize(b: { widthIn?: number | null; depthIn?: number | null; heightIn?: number | null }): string {
  const parts = [
    b.widthIn != null ? `${Math.round(b.widthIn * 100) / 100}″ W` : null,
    b.depthIn != null ? `${Math.round(b.depthIn * 100) / 100}″ D` : null,
    b.heightIn != null ? `${Math.round(b.heightIn * 100) / 100}″ H` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' × ') : 'Size not given';
}

const LEGACY_TIER_NAME: Record<string, string> = { simple: 'Simple', standard: 'Standard', complex: 'Complex' };

/**
 * What an order's terms are called: "Included in your plan" for a Contractor-plan request, or what
 * an order paid for before 2026-10-15 was sold as ("Model pack", "Standard model").
 */
export function pricingLabel(o: { tier: string; packs?: number; pricing?: string }): string {
  if (o.pricing === 'plan' || o.tier === 'plan') return 'Included in your plan';
  if (o.pricing === 'pack' || o.tier === 'pack') return (o.packs ?? 1) > 1 ? `${o.packs} Model packs` : 'Model pack';
  return `${LEGACY_TIER_NAME[o.tier] ?? 'Custom'} model`;
}

/** Parses a typed inch value: "33", "33.5", "2' 9" or 2'9". Null when it isn't a size. */
export function parseInches(raw: string): number | null {
  const s = raw.trim().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (!s) return null;
  const ft = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/);
  if (ft) return Math.round((parseFloat(ft[1]) * 12 + (ft[2] ? parseFloat(ft[2]) : 0)) * 100) / 100;
  const inch = s.match(/^(\d+(?:\.\d+)?)\s*"?$/);
  return inch ? Math.round(parseFloat(inch[1]) * 100) / 100 : null;
}
