/**
 * Shared platform types (BUILD_PLAN §3.8). Owned by the foundation and frozen for the
 * feature packages: add package-local types in your own directory, never redefine these.
 */
import type { CategoryId, DesignDoc, Kind, MaterialKind, Product, Room } from '../types';

// ─── Accounts ────────────────────────────────────────────────────────────

export type Role = 'customer' | 'studio' | 'admin';

export type BrandStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export interface BrandMembership {
  id: string;
  slug: string;
  name: string;
  status: BrandStatus;
  memberRole: 'owner' | 'editor';
}

/** `GET /api/auth/me` → `{ user: SessionUser | null }`. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  brands: BrandMembership[];
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
  /** Material names that start with `mise_` (finish, cabinet, hardware, counter). */
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
}

/** `GET /api/catalog` → products (wire `Product`), brands and a version string. */
export interface CatalogWire {
  products: Product[];
  brands: BrandSummary[];
  version: string;
}

// ─── Config ──────────────────────────────────────────────────────────────

/** `GET /api/config`. */
export interface AppConfig {
  payments: 'demo' | 'stripe';
  demoPayments: boolean;
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
  currency: 'usd';
  provider: 'demo' | 'stripe';
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

/** `GET /api/share/:token`. Never carries `client`, emails or user ids. */
export interface SharedKitchenWire {
  kitchen: { name: string; doc: DesignDoc; updatedAt: number; sharedBy: string };
  products: Product[];
  showPrices: boolean;
}

// ─── Generate (package D) ────────────────────────────────────────────────

export type LayoutType = 'one-wall' | 'galley' | 'l-shape' | 'u-shape' | 'l-island';
export type WallSide = 'north' | 'east' | 'south' | 'west';

/** The structured brief behind "Describe your kitchen" (PRODUCT_SPEC §5.2). */
export interface GenerateBrief {
  room: Room;
  /** Allowed layout types; `'auto'` means every type that fits. */
  layouts: LayoutType[] | 'auto';
  range: { widthIn: 30 | 36 | 48; fuel: 'gas' | 'induction' | 'dual-fuel' };
  fridge: 'column-30' | 'french-36' | 'retro-24';
  dishwasher: boolean;
  wallOven: boolean;
  microwave: boolean;
  wine: boolean;
  pantry: boolean;
  sink: { type: 'farmhouse' | 'undermount' | 'double'; prep: boolean };
  island: 'yes' | 'no' | 'auto';
  seats: number;
  windowWall: WallSide | 'none';
  /** A style preset id from `src/data/styles.ts`. */
  style: string;
  budget?: { min?: number; max?: number };
}

export interface LayoutOption {
  id: string;
  layout: LayoutType;
  name: string;
  doc: DesignDoc;
  score: number;
  checksPassed: number;
  checksTotal: number;
  /** Work-triangle total in inches, or null when there is no triangle. */
  triangleTotal: number | null;
  estimateTotal: number;
  /** 2–4 short "why" chips, e.g. "Island seats 3". */
  reasons: string[];
  /** Which walls hold the sink, range and fridge; options are diverse on this. */
  signature: string;
}

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
