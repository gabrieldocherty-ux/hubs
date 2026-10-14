import type { OrderStatus } from '../../types/platform';

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

/** $129, $1,234.50: whole dollars stay whole. */
export function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
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
      return `${who} cancelled the order`;
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

export interface DraftItem {
  productTypeId: string;
  name: string;
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
  notes: string;
  referenceFileIds: string[];
  refProductId?: string;
  tier: 'simple' | 'standard' | 'complex' | null;
  extraFinishes: number;
}

export type Step = 'what' | 'size' | 'photos' | 'notes' | 'tier' | 'review';
export const STEPS: { id: Step; label: string }[] = [
  { id: 'what', label: 'What' },
  { id: 'size', label: 'Size' },
  { id: 'photos', label: 'Photos' },
  { id: 'notes', label: 'Notes' },
  { id: 'tier', label: 'Tier' },
  { id: 'review', label: 'Review & pay' },
];

const LIMITS = { widthIn: [1, 240], depthIn: [1, 120], heightIn: [0.25, 144] } as const;

/** The first problem with an item at a given step, or null. Mirrors the server's checks. */
export function stepProblem(item: DraftItem, step: Step): string | null {
  switch (step) {
    case 'what':
      if (!item.productTypeId) return 'Choose a product type.';
      if (!item.name.trim()) return 'Name the product.';
      if (item.name.trim().length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters or fewer.`;
      return null;
    case 'size':
      for (const [k, [lo, hi]] of Object.entries(LIMITS) as [keyof typeof LIMITS, readonly [number, number]][]) {
        const v = item[k];
        const label = k === 'widthIn' ? 'Width' : k === 'depthIn' ? 'Depth' : 'Height';
        if (v == null || !Number.isFinite(v)) return `Enter the ${label.toLowerCase()}.`;
        if (v < lo || v > hi) return `${label} must be between ${lo} and ${hi} inches.`;
      }
      return null;
    case 'photos':
      if (item.referenceFileIds.length > MAX_REFERENCES) return `Add up to ${MAX_REFERENCES} photos.`;
      if (!item.referenceFileIds.length && !item.refProductId) return 'Add at least one reference photo.';
      return null;
    case 'notes':
      return item.notes.length > MAX_NOTES ? `Keep notes to ${MAX_NOTES.toLocaleString('en-US')} characters or fewer.` : null;
    case 'tier':
      return item.tier ? null : 'Choose a tier.';
    case 'review':
      for (const s of ['what', 'size', 'photos', 'notes', 'tier'] as Step[]) {
        const p = stepProblem(item, s);
        if (p) return p;
      }
      return null;
  }
}

/** The tier a product type most likely needs (a starting point; the buyer can change it). */
export function suggestedTier(kind: string | undefined): 'simple' | 'standard' | 'complex' {
  switch (kind) {
    case 'pendant':
    case 'plant':
    case 'rug':
    case 'shelf':
    case 'chair':
    case 'stool':
      return 'simple';
    case 'island':
    case 'corner':
    case 'oven-tower':
      return 'complex';
    default:
      return 'standard';
  }
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
