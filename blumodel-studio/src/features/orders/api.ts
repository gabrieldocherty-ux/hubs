import { call, upload } from '../../lib/api';
import type { Product } from '../../types';
import type { FileWire, ModelTierId, Order, OrderBrief, OrderEvent, OrderStatus } from '../../types/platform';

/**
 * Package C's calls (BUILD_PLAN §7 C-T4). Every amount comes from the server: the client only
 * sends the products and the rush flag, and shows what the server quotes back.
 */

export type OrderTarget = 'customer' | 'brand' | 'contractor';
export type PaymentsProvider = 'demo' | 'stripe';
/** 'pack' since Model packs; the retired per-product tiers on orders placed before them. */
export type ItemTier = 'pack' | ModelTierId;
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
  /** Which Model pack the product is in (1-based); absent on orders from before packs. */
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
  pricing?: 'pack' | 'tiers';
  amountCents: number;
  currency: 'usd';
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
export interface OrderWire extends Omit<Order, 'target' | 'brief' | 'tier'> {
  target: OrderTarget;
  tier: ItemTier;
  /** 'pack' for a Model-pack order, 'tiers' for one placed before packs (kept at its own price). */
  pricing: 'pack' | 'tiers';
  packs: number;
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
  assignee: string | null;
  payments: PaymentsProvider;
  demo: boolean;
}

/** The Model pack as the server publishes it. */
export interface PackWire {
  id: 'pack';
  name: string;
  priceCents: number;
  productsPerPack: number;
  finishesPerModel: number;
  revisions: number;
  businessDays: number;
  extraPackBusinessDays: number;
}

/** `GET /api/orders/tiers`: the one offer (a Model pack) and the request limits. */
export interface TiersWire {
  pricing: 'pack';
  pack: PackWire;
  rushPct: number;
  maxItems: number;
  maxPacks: number;
  currency: 'usd';
  payments: PaymentsProvider;
  demo: boolean;
}

export interface RequestItem {
  brief: OrderBriefWire;
}

export interface OrderRequest {
  target: OrderTarget;
  brandId?: string;
  line?: string;
  rush: boolean;
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
  quote: (body: { rush: boolean; products: number }, signal?: AbortSignal) =>
    call<{ quote: QuoteWire }>('POST', '/api/orders/quote', body, { signal }),
  create: (body: OrderRequest) => call<{ order: OrderWire; quote: QuoteWire }>('POST', '/api/orders', body),
  list: () => call<{ orders: OrderWire[]; payments: PaymentsProvider; demo: boolean }>('GET', '/api/orders'),
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
  note: (id: string, note: string) => call<OrderDetail>('POST', `/api/studio/orders/${enc(id)}/note`, { note }),
  report: (id: string, item: number, modelFileId: string) =>
    call<{ report: GlbReport }>('GET', `/api/studio/orders/${enc(id)}/report?item=${item}&modelFileId=${enc(modelFileId)}`),
  deliver: (id: string, body: DeliverBody) =>
    call<OrderDetail & { product: Product; report: GlbReport; complete: boolean }>('POST', `/api/studio/orders/${enc(id)}/deliver`, body),

  // admin
  refund: (id: string, note: string) => call<OrderDetail>('POST', `/api/admin/orders/${enc(id)}/refund`, { note }),
  revenue: (days: number) => call<RevenueWire>('GET', `/api/admin/revenue?days=${days}`),

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
