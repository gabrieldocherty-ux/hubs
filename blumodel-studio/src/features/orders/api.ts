import { call, upload } from '../../lib/api';
import type { Product } from '../../types';
import type { FileWire, ModelTierId, Order, OrderBrief, OrderEvent, OrderStatus } from '../../types/platform';

/**
 * Package C's calls (BUILD_PLAN §7 C-T4). Since 2026-10-15 custom models aren't sold: the
 * Contractor plan includes 3 a month, made by our studio, and a request is submitted against that
 * allowance (the server checks it). Orders paid for before then keep their stored price and
 * currency, and every amount shown comes from the server.
 */

export type OrderTarget = 'customer' | 'brand' | 'contractor';
export type PaymentsProvider = 'demo' | 'stripe';
/** 'plan' for a request included in the Contractor plan; 'pack' and the retired tiers on orders paid for before. */
export type ItemTier = 'plan' | 'pack' | ModelTierId;
/** 'plan': included in the Contractor plan (nothing paid); 'pack' / 'tiers': paid for before 2026-10-15. */
export type OrderPricing = 'plan' | 'pack' | 'tiers';
/** The order's provider: 'plan' when nothing was paid. */
export type OrderProvider = PaymentsProvider | 'plan';
export type UpcFormat = 'upc_a' | 'ean_13' | 'ean_8';

/**
 * The server's brief: the platform `OrderBrief` plus the kind it maps onto (BUILD_PLAN §3.4), the
 * product's brand and UPC, and a photo of its barcode. The size is optional since Model packs.
 */
export interface OrderBriefWire extends Omit<OrderBrief, 'widthIn' | 'depthIn' | 'heightIn'> {
  kind?: string;
  variant?: string;
  category?: string;
  widthIn?: number;
  depthIn?: number;
  heightIn?: number;
  elevationIn?: number;
  brand?: string;
  /** Digits only: 12 (UPC-A), 13 (EAN-13) or 8 (EAN-8), check digit verified. */
  upc?: string;
  upcFormat?: UpcFormat;
  /** A private reference photo of the barcode, when it couldn't be typed or scanned. */
  barcodeFileId?: string;
}

export interface OrderItemWire {
  idx: number;
  brief: OrderBriefWire;
  tier: ItemTier;
  extraFinishes: number;
  amountCents: number;
  /** Which Model pack the product was in (1-based), on the few pack orders only. */
  pack?: number;
  deliverableProductId: string | null;
  deliveredAt: number | null;
}

export interface QuoteLine {
  label: string;
  amountCents: number;
  item?: number;
  pack?: number;
}

export interface QuoteWire {
  pricing?: OrderPricing;
  amountCents: number;
  /** The order's own currency: 'cad' since 2026-10-15, 'usd' before. */
  currency: string;
  dueBusinessDays: number;
  lines: QuoteLine[];
  rush?: boolean;
  products?: number;
  packs?: number;
}

/**
 * An order as `GET /api/orders` returns it: the platform `Order` widened with the §13.3 fields
 * (contractor target, multi-item lines) and a few derived ones the server computes.
 */
export interface OrderWire extends Omit<Order, 'target' | 'brief' | 'tier' | 'provider' | 'currency'> {
  target: OrderTarget;
  tier: ItemTier;
  provider: OrderProvider;
  currency: string;
  /** 'plan' when included in the Contractor plan; 'pack' / 'tiers' for one paid for before (at its own price). */
  pricing: OrderPricing;
  packs: number;
  /** The allowance period a plan request counted against. */
  planPeriod: { start: number; end: number } | null;
  /** Whether the buyer can still withdraw it (a plan request not started) or cancel it (unpaid). */
  cancellable: boolean;
  finishesPerModel: number | null;
  brief: OrderBriefWire;
  brandName: string | null;
  revisionsAllowed: number;
  line: string | null;
  title: string;
  items: OrderItemWire[];
  quote: QuoteWire;
  /** When an unpaid order expires (24 h after checkout started); null once paid. */
  expiresAt: number | null;
  completedAt: number | null;
  refundedAt: number | null;
}

/** One timeline row; `by` is who did it, from the viewer's point of view. */
export interface OrderEventWire extends OrderEvent {
  by: 'you' | 'customer' | 'studio' | 'admin' | 'system';
}

/** `GET /api/orders/:id` (and every action on an order) → everything the order page shows. */
export interface OrderDetail {
  order: OrderWire;
  events: OrderEventWire[];
  references: FileWire[];
  deliverables: Product[];
  /** Staff only. */
  buyer?: { id: string; name: string; email: string } | null;
  /** Staff only, on a plan request: where the contractor stands this period. */
  buyerAllowance?: (Allowance & { grants: ModelGrant[] }) | null;
  assignee: string | null;
  payments: PaymentsProvider;
  demo: boolean;
}

/** What every model included in the Contractor plan comes with. */
export interface ModelTerms {
  /** Custom 3D models a month on the Contractor plan; unused ones don't roll over. */
  perMonth: number;
  finishesPerModel: number;
  revisions: number;
  /** Turnaround in business days after the request is submitted. */
  businessDays: number;
}

/** `GET /api/orders/tiers`: the included models' terms and the request limits. Nothing has a price. */
export interface TiersWire {
  pricing: 'plan';
  plan: 'contractor';
  models: ModelTerms;
  maxItems: number;
  currency: string;
  payments: PaymentsProvider;
  demo: boolean;
}

/** Where a user stands this period (`active` is false without the Contractor plan). */
export interface Allowance {
  active: boolean;
  plan: string;
  included: number;
  granted: number;
  used: number;
  total: number;
  left: number;
  periodStart: number;
  periodEnd: number;
  /** When unused models lapse and the allowance starts again. */
  resetsAt: number;
  supportEmail: string | null;
}

/** Extra models an admin gave a contractor for one period. */
export interface ModelGrant {
  id: string;
  userId: string;
  models: number;
  periodStart: number;
  periodEnd: number;
  note: string;
  grantedBy: string | null;
  createdAt: number;
}

export interface RequestItem {
  brief: OrderBriefWire;
}

export interface OrderRequest {
  target: OrderTarget;
  brandId?: string;
  line?: string;
  items: RequestItem[];
}

/** A row of the studio queue. */
export interface QueueOrder extends OrderWire {
  buyer: { name: string; email: string } | null;
  assignee: string | null;
  /** How many of its items have a deliverable. */
  delivered: number;
}

export interface GlbReport {
  sizeBytes: number;
  triangles: number | null;
  slots: string[];
  materials: string[];
  bboxIn: { w: number; h: number; d: number } | null;
  axes: { axis: 'width' | 'height' | 'depth'; modelIn: number; declaredIn: number; offPct: number }[];
  warnings: string[];
}

export interface RevenueSlice {
  gross: number;
  refunds: number;
  net: number;
  count: number;
  refundCount: number;
  byTier: { tier: ItemTier; items: number; gross: number }[];
  byDay: { day: string; gross: number; refunds: number; count: number }[];
  avgTurnaroundDays: number | null;
}

export interface RevenueWire extends RevenueSlice {
  provider: PaymentsProvider;
  days: number;
  currency: 'usd';
  byProvider: Record<PaymentsProvider, RevenueSlice>;
}

export interface DeliverBody {
  item: number;
  modelFileId: string;
  thumbFileId: string;
  name?: string;
  /** Any size left out comes from the request, then from the model's measured size. */
  dims?: { widthIn?: number; depthIn?: number; heightIn?: number; elevationIn?: number };
  finishes?: { id: string; name: string; hex: string; material: string }[];
  price?: number;
}

export type StudioFilter = 'active' | 'all' | OrderStatus;

const enc = encodeURIComponent;

export const ordersApi = {
  tiers: () => call<TiersWire>('GET', '/api/orders/tiers'),
  allowance: () => call<{ allowance: Allowance; terms: ModelTerms }>('GET', '/api/orders/allowance'),
  /** Submits a request against the allowance: 403 without the plan, 409 past it (both carry `allowance`). */
  create: (body: OrderRequest) => call<{ order: OrderWire; quote: QuoteWire; allowance: Allowance }>('POST', '/api/orders', body),
  list: () => call<{ orders: OrderWire[]; allowance: Allowance; payments: PaymentsProvider; demo: boolean }>('GET', '/api/orders'),
  get: (id: string, sync?: { sessionId?: string | null }) => {
    const q = new URLSearchParams();
    if (sync) {
      q.set('sync', '1');
      if (sync.sessionId) q.set('session_id', sync.sessionId);
    }
    const qs = q.toString();
    return call<OrderDetail>('GET', `/api/orders/${enc(id)}${qs ? `?${qs}` : ''}`);
  },
  checkout: (id: string) => call<{ url: string; provider: PaymentsProvider }>('POST', `/api/orders/${enc(id)}/checkout`),
  cancel: (id: string) => call<OrderDetail>('POST', `/api/orders/${enc(id)}/cancel`),
  revision: (id: string, note: string) => call<OrderDetail>('POST', `/api/orders/${enc(id)}/revision`, { note }),
  accept: (id: string) => call<OrderDetail>('POST', `/api/orders/${enc(id)}/accept`),
  demoComplete: (id: string, outcome: 'success' | 'decline') => call<OrderDetail>('POST', `/api/payments/demo/${enc(id)}/complete`, { outcome }),

  // studio
  queue: (status: StudioFilter = 'active') =>
    call<{ orders: QueueOrder[]; counts: Partial<Record<OrderStatus, number>>; filter: StudioFilter }>('GET', `/api/studio/orders?status=${enc(status)}`),
  start: (id: string) => call<OrderDetail>('POST', `/api/studio/orders/${enc(id)}/start`),
  /** Cancels a plan request before work starts: its models go back to the contractor's allowance. */
  studioCancel: (id: string, note: string) => call<OrderDetail>('POST', `/api/studio/orders/${enc(id)}/cancel`, { note }),
  note: (id: string, note: string) => call<OrderDetail>('POST', `/api/studio/orders/${enc(id)}/note`, { note }),
  report: (id: string, item: number, modelFileId: string) =>
    call<{ report: GlbReport }>('GET', `/api/studio/orders/${enc(id)}/report?item=${item}&modelFileId=${enc(modelFileId)}`),
  deliver: (id: string, body: DeliverBody) =>
    call<OrderDetail & { product: Product; report: GlbReport; complete: boolean }>('POST', `/api/studio/orders/${enc(id)}/deliver`, body),

  // admin
  refund: (id: string, note: string) => call<OrderDetail>('POST', `/api/admin/orders/${enc(id)}/refund`, { note }),
  revenue: (days: number) => call<RevenueWire>('GET', `/api/admin/revenue?days=${days}`),
  modelAllowance: (who: { email?: string; userId?: string }) =>
    call<{ user: { id: string; email: string; name: string }; allowance: Allowance; grants: ModelGrant[] }>(
      'GET',
      `/api/admin/model-allowance?${who.userId ? `userId=${enc(who.userId)}` : `email=${enc(who.email ?? '')}`}`,
    ),
  grantModels: (body: { userId?: string; email?: string; models: number; note: string }) =>
    call<{ grant: ModelGrant; allowance: Allowance; grants: ModelGrant[] }>('POST', '/api/admin/model-grants', body),

  // files
  uploadFile: (file: Blob, kind: 'reference' | 'model' | 'image', name: string) => upload<{ file: FileWire }>('/api/files', file, { kind, name }),
};

/** Goes to a checkout URL: an in-app hash (DEMO) or Stripe's hosted page. */
export function goToCheckout(url: string) {
  if (url.startsWith('#/')) {
    history.pushState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.assign(url);
}
