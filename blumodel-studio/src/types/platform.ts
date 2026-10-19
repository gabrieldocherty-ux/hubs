/**
 * Shared platform types (BUILD_PLAN §3.8). Owned by the foundation and frozen for the
 * feature packages: add package-local types in your own directory, never redefine these.
 */
import type { CategoryId, DesignDoc, Kind, MaterialKind, Product } from '../types';

// ─── Accounts ────────────────────────────────────────────────────────────

export type Role = 'customer' | 'studio' | 'admin';

export type BrandStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export interface BrandMembership {
  id: string;
  slug: string;
  name: string;
  status: BrandStatus;
  memberRole: 'owner' | 'editor';
  /** `contractor`: the brand page of a Contractor account. `partner`: a curated brand run by BluModel Studio admins. */
  kind?: 'contractor' | 'partner';
}

/** `GET /api/auth/me` → `{ user: SessionUser | null }`. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  brands: BrandMembership[];
  /** The account's plan right now (Free when it has none or it has lapsed). */
  plan: PlanState;
  /** Set once the user has set up a contractor company; `active` is false while the plan has lapsed. */
  contractor: ContractorSummary | null;
  /** Two-factor sign-in: on for the account, required (an admin's), passed by this session. */
  mfa?: { enabled: boolean; required: boolean; verified: boolean };
}

// ─── Plans and billing (packages G and H; PLANS_AND_CONTRACTORS.md) ─────

/** Plan ids in `src/data/plans.json`. `kitchen_unlock` is a one-time purchase, not a plan anyone is "on". */
export type PlanId = 'free' | 'kitchen_unlock' | 'unlimited' | 'contractor';
/** What an account can be on. */
export type AccountPlanId = 'free' | 'unlimited' | 'contractor';

/** One entry of `src/data/plans.json`. Every price is in Canadian dollars since 2026-10-15. */
export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  currency: 'cad';
  interval: null | 'month';
  tagline: string;
  bullets: string[];
  /** Contractor: custom 3D models a month, made by the BluModel studio. */
  includedModels?: number;
}

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

/** `SessionUser.plan`: the plan in force now. `status: 'none'` means never subscribed. */
export interface PlanState {
  id: AccountPlanId;
  status: SubscriptionStatus | 'none';
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  /** Set while a failed renewal is being retried; the plan stays on until then. */
  graceUntil: number | null;
  /** `comp`: a complimentary plan an admin gave (POST /api/admin/billing/grant); nothing to pay or cancel. */
  provider: 'demo' | 'stripe' | 'comp' | null;
}

/** A subscription as the Billing page shows it (`GET /api/billing/me`). */
export interface Subscription {
  plan: 'unlimited' | 'contractor';
  status: SubscriptionStatus;
  provider: 'demo' | 'stripe' | 'comp';
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  graceUntil: number | null;
  createdAt: number;
  /** What it renews at, in its own currency (a plan started before CAD stays in USD); null for a complimentary plan. */
  amountCents?: number | null;
  currency?: string | null;
}

/** What the editor needs to decide whether an export runs or the Unlock dialog opens. */
export interface Entitlements {
  plan: AccountPlanId;
  /** Kitchens unlocked with a one-time payment. */
  unlockedProjectIds: string[];
}

/** Every export the paywall covers (PLANS_AND_CONTRACTORS §1). */
export type ExportKind = 'plan_png' | 'scene_png' | 'csv' | 'json' | 'render' | 'quote';

/** A contractor's branding on what their clients see. */
export interface PreparedBy {
  company: string;
  logoUrl?: string;
  phone?: string;
  email?: string;
  website?: string;
}

/** `SessionUser.contractor`. */
export interface ContractorSummary {
  company: string;
  /** False while the Contractor plan has lapsed: the workspace is then read-only. */
  active: boolean;
}

/** A contractor's company profile (`GET /api/pro/profile`). */
export interface ContractorProfile {
  company: string;
  logoFileId: string | null;
  logoUrl: string | null;
  phone: string;
  email: string;
  website: string;
  serviceArea: string;
  defaultMarkupPct: number;
  taxPct: number;
  createdAt: number;
  updatedAt: number;
}

/** Brand-level price settings, keyed by 'builtin', a brand id, 'own', or 'line:<name>'. */
export interface PriceBookBrand {
  enabled: boolean;
  /** For public brands: the contractor's discount off list, used as their cost. */
  pctOffList: number | null;
  markupPct: number | null;
}

/** Product-level price settings. Costs are in cents. */
export interface PriceBookEntry {
  costCents: number | null;
  costByWidth: Record<string, number> | null;
  markupPct: number | null;
}

/** Everything needed to price a kitchen for its contractor. Never sent to anyone else. */
export interface PriceBookData {
  defaultMarkupPct: number;
  taxPct: number;
  brands: Record<string, PriceBookBrand>;
  rows: Record<string, PriceBookEntry>;
}

/** A price at a width: what the client pays, and (for the contractor) what it costs them. */
export interface PriceQuote {
  sell: number;
  list: number;
  cost?: number;
  markupPct?: number;
  /** No cost entered: the list price is used as the sell price. */
  noCost?: boolean;
}

/** One row of the price book table (`GET /api/pro/price-book`). */
export interface PriceBookRow {
  productId: string;
  name: string;
  brand: string;
  brandKey: string;
  line: string | null;
  sku: string;
  category: string;
  source: 'builtin' | 'brand' | 'contractor' | 'custom';
  widthIn: number;
  widthOptions: number[] | null;
  /** List price at the default width (0 when a contractor product has none). */
  list: number;
  costCents: number | null;
  costByWidth: Record<string, number> | null;
  markupPct: number | null;
}

// ─── Brands ──────────────────────────────────────────────────────────────

/** Public brand card: `GET /api/catalog/brands`, `GET /api/catalog`. */
export interface BrandSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string | null;
  website: string;
  verified: boolean;
  isDemo: boolean;
}

/** The full brand profile a member or admin sees. */
export interface Brand extends BrandSummary {
  description: string;
  status: BrandStatus;
  statusNote: string;
  logoFileId: string | null;
  verifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Files ───────────────────────────────────────────────────────────────

export type FileKind = 'model' | 'image' | 'reference';
export type FileVisibility = 'public' | 'private';

export interface ImageMeta {
  width: number;
  height: number;
}

export interface GlbMeta {
  bboxM: { x: number; y: number; z: number };
  bboxIn: { w: number; h: number; d: number };
  triangles: number;
  materials: string[];
  /** Material names that start with `blumodel_` (finish, cabinet, hardware, counter), or the legacy `mise_`. */
  slots: string[];
  images: { mime: string; width: number; height: number }[];
  extensions: string[];
  warnings: string[];
}

/** `PUT /api/files` → `201 { file: FileWire }`; `GET /api/files/:id` → `{ file }`. */
export interface FileWire {
  id: string;
  sha256: string;
  ext: 'glb' | 'png' | 'jpg' | 'webp';
  mime: string;
  sizeBytes: number;
  kind: FileKind;
  visibility: FileVisibility;
  ownerUserId: string | null;
  brandId: string | null;
  originalName: string;
  meta: GlbMeta | ImageMeta | Record<string, never>;
  createdAt: number;
  /** `/files/<sha>.<ext>` for public files, `/api/files/<id>/content` for private ones. */
  url: string;
}

// ─── Products ────────────────────────────────────────────────────────────

export type ProductStatus = 'draft' | 'submitted' | 'published' | 'rejected' | 'archived';
export type ProductEventType = 'view' | 'add' | 'buy_click' | 'render';

export interface ProductFinishInput {
  id: string;
  name: string;
  hex: string;
  material: MaterialKind;
  swatchFileId?: string;
}

/** ProductSpec as brands and the studio send it (BUILD_PLAN §3.4). The server validates and enforces limits. */
export interface ProductSpecInput {
  kind: Kind;
  variant?: string;
  category: CategoryId;
  name: string;
  blurb: string;
  sku: string;
  skuByWidth?: Record<string, string>;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  elevationIn: number;
  widthOptions?: number[];
  price: number;
  priceByWidth?: Record<string, number>;
  finishes: 'cabinet' | ProductFinishInput[];
  imageFileIds: string[];
  modelFileId?: string;
  buyUrl?: string;
  specSheetUrl?: string;
  flags?: { trim?: 'brass' | 'steel'; backguard?: boolean };
  /** A product line or collection (contractor catalogs group by it). */
  line?: string;
  /** The door style a cabinet line is sold in. */
  doorStyle?: 'shaker' | 'slab' | 'fluted';
}

/**
 * `GET /api/catalog` → products (wire `Product`), brands and a version string. One page of at most
 * 100 products; `next` is the offset of the next page (`?offset=`), null on the last. The brands
 * come with the first page; `version` covers the whole catalog. `api.catalog()` reads every page.
 */
export interface CatalogWire {
  products: Product[];
  brands: BrandSummary[];
  version: string;
  total?: number;
  offset?: number;
  next?: number | null;
}

// ─── Config ──────────────────────────────────────────────────────────────

/** Who runs this site, for the Terms, Privacy and Refund pages (`GET /api/config` → `legal`). */
export interface LegalConfig {
  /** True once the operator has set the business name and support email. */
  ready: boolean;
  businessName: string | null;
  supportEmail: string | null;
  jurisdiction: string | null;
}

/**
 * `GET /api/config`. `payments`: `stripe` (real money through Stripe Checkout), `demo` (the labelled
 * simulation) or `none` (payments not open yet: billing, checkout and order-payment endpoints answer
 * 503 `{ code: 'payments_unavailable' }`). Older servers send no `publicUrl` or `legal`; read it
 * through `src/lib/config.ts`, which fills them in.
 */
export interface AppConfig {
  payments: 'demo' | 'stripe' | 'none';
  demoPayments: boolean;
  publicUrl?: string;
  legal?: LegalConfig;
  llm: boolean;
  limits: { glbMb: number; imageMb: number; brandProducts: number };
  version: string;
}

// ─── Orders (package C) ──────────────────────────────────────────────────

export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'payment_failed'
  | 'paid'
  | 'in_progress'
  | 'delivered'
  | 'revision_requested'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'expired';

export type ModelTierId = 'simple' | 'standard' | 'complex';

export interface ModelTier {
  id: ModelTierId;
  name: string;
  /** Who the tier is for, e.g. "Hardware, faucets, decor, simple lights". */
  for: string;
  priceCents: number;
  businessDays: number;
  revisions: number;
}

export interface OrderBrief {
  productTypeId: string;
  name: string;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  notes: string;
  referenceFileIds: string[];
  refProductId?: string;
}

export interface Order {
  id: string;
  userId: string;
  target: 'customer' | 'brand';
  brandId: string | null;
  status: OrderStatus;
  tier: ModelTierId;
  extras: { extraFinishes: number; rush: boolean };
  amountCents: number;
  /** The order's own currency: 'usd' for every order placed before 2026-10-15. */
  currency: string;
  provider: 'demo' | 'stripe' | 'plan';
  brief: OrderBrief;
  refProductId: string | null;
  deliverableProductId: string | null;
  assignedTo: string | null;
  revisionsUsed: number;
  dueAt: number | null;
  paidAt: number | null;
  deliveredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OrderEvent {
  id: number;
  orderId: string;
  type: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  byUserId: string | null;
  note: string;
  data: Record<string, unknown> | null;
  createdAt: number;
}

// ─── Share links (package E) ─────────────────────────────────────────────

export interface ShareLink {
  id: string;
  projectId: string;
  token: string;
  label: string;
  showPrices: boolean;
  expiresAt: number | null;
  revokedAt: number | null;
  viewCount: number;
  lastViewedAt: number | null;
  createdAt: number;
}

/** `GET /api/share/:token`. Never carries `client`, emails, user ids, costs or margins. */
export interface SharedKitchenWire {
  kitchen: { name: string; doc: DesignDoc; updatedAt: number; sharedBy: string };
  products: Product[];
  showPrices: boolean;
  /** A contractor's branding ("Prepared by Smith Kitchens"). */
  preparedBy?: PreparedBy;
  /** True for contractor shares: clients stay with the contractor. */
  hideDuplicate?: boolean;
  /**
   * The contractor's sell prices for every product in the kitchen, built-ins included (they are
   * priced in the browser). Absent for non-contractor shares, which use list prices.
   */
  prices?: Record<string, { price: number; priceByWidth?: Record<string, number> }>;
  /** When the link stops working (epoch ms); null or absent = never. */
  expiresAt?: number | null;
}

// ─── Generate (package D) ────────────────────────────────────────────────

export type LayoutType = 'one-wall' | 'galley' | 'l-shape' | 'u-shape' | 'l-island';
export type WallSide = 'north' | 'east' | 'south' | 'west';

// The text brief ("Describe your kitchen") and its scored layout options were dropped: kitchens
// start from a photo (src/lib/generate/photoModel.ts), not from a typed description.

// ─── Admin ───────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number;
  projects?: number;
}

/** `GET /api/admin/overview`. */
export interface AdminOverview {
  users: { total: number; byRole: Partial<Record<Role, number>> };
  projects: { total: number };
  brands: Partial<Record<BrandStatus, number>>;
  products: Partial<Record<ProductStatus, number>>;
  latestUsers: AdminUser[];
}
