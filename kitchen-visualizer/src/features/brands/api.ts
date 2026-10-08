import { call, upload } from '../../lib/api';
import type { Product } from '../../types';
import type { FileWire, GlbMeta } from '../../types/platform';

/**
 * Package B2's calls (BRAND_PAGE.md): the contractor's Brand page tab (`/api/pro/brand/…`), the
 * public page and its lead form (`/api/brands/by-slug/…`), and admin moderation. Wire shapes are
 * package-local; nothing here redefines a shared type.
 */

export type PriceDisplay = 'from' | 'show' | 'on_request';
export type PageStatus = 'none' | 'draft' | 'in_review' | 'live' | 'rejected' | 'hidden' | 'suspended';
export type LeadStatus = 'new' | 'contacted' | 'won' | 'lost';
export type BrandKind = 'contractor' | 'partner';

/** What anyone may know about a brand: the public page header. */
export interface PublicBrand {
  id: string;
  slug: string;
  kind: BrandKind;
  name: string;
  tagline: string;
  about: string;
  logoUrl: string | null;
  coverUrl: string | null;
  website: string;
  verified: boolean;
  isDemo: boolean;
  priceDisplay: PriceDisplay;
  leadForm: boolean;
  serviceArea: string;
  phone?: string;
  email?: string;
}

/** The page as its owner (and admins) manage it. */
export interface OwnerBrand extends PublicBrand {
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  pageStatus: PageStatus;
  statusNote: string;
  coverFileId: string | null;
  showPhone: boolean;
  showEmail: boolean;
  submittedAt: number | null;
  liveAt: number | null;
  verifiedAt: number | null;
  hiddenReason: 'lapsed' | null;
  slugLocked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Check {
  id: string;
  label: string;
  ok: boolean;
}

export interface LeadCounts {
  total: number;
  byStatus: Partial<Record<LeadStatus, number>>;
  unread: number;
}

export interface BrandState {
  brand: OwnerBrand | null;
  defaults: { name: string; slug: string; website: string; phone: string; email: string; serviceArea: string; logoUrl: string | null };
  checks: Check[];
  readOnly: boolean;
  limit: number;
  liveCount: number;
  leads: LeadCounts;
  history: { action: string; note: string; at: number }[];
}

export interface BrandSettingsInput {
  name?: string;
  slug?: string;
  tagline?: string;
  about?: string;
  priceDisplay?: PriceDisplay;
  leadForm?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  coverFileId?: string | null;
}

/** A public product (catalog wire) with the page's price display. */
export type PublicProduct = Product & { priceDisplay?: PriceDisplay };

export interface Listing {
  copyId: string;
  status: 'draft' | 'submitted' | 'published' | 'rejected' | 'archived';
  hasLive: boolean;
  live: boolean;
  pendingEdit: boolean;
  reviewNote: string;
  submittedAt: number | null;
  publishedAt: number | null;
}

export interface ProductEntry {
  id: string;
  name: string;
  line: string | null;
  sku: string;
  kind: string;
  category: string;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  widthOptions: number[] | null;
  thumbnailUrl: string | null;
  hasModel: boolean;
  product: Product;
  readiness: { ready: boolean; checks: Check[] };
  /** What the page would show (0 with Price on request), or null before the page exists. */
  publicPrice: number | null;
  listing: Listing | null;
}

export interface BrandProducts {
  brand: OwnerBrand | null;
  readOnly: boolean;
  limit: number;
  liveCount: number;
  products: ProductEntry[];
}

export interface Lead {
  id: string;
  productId: string | null;
  productName: string;
  projectName: string;
  shareToken: string | null;
  kitchenAttached: boolean;
  name: string;
  email: string;
  phone: string;
  location: string;
  message: string;
  status: LeadStatus;
  notes: string;
  unread: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Totals {
  brandViews: number;
  productViews: number;
  adds: number;
  quoteClicks: number;
  leads: number;
}

export interface Analytics {
  days: number;
  since: string;
  totals: Totals;
  byDay: (Totals & { day: string })[];
  topProducts: { id: string; sourceId: string | null; name: string; views: number; adds: number; quoteClicks: number; leads: number }[];
  isDemo: boolean;
}

export interface BrandSummaryWire {
  brandId?: string;
  slug?: string;
  name?: string;
  pageStatus: PageStatus;
  statusNote?: string;
  monthViews?: number;
  monthLeads?: number;
  unread?: number;
  liveProducts?: number;
  isDemo?: boolean;
}

export interface LeadInput {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  message?: string;
  consent: boolean;
  productId?: string;
  projectId?: string;
  /** The honeypot: always empty from a person. */
  website_url?: string;
}

// ── admin ──────────────────────────────────────────────────────────────

export interface AdminBrand extends OwnerBrand {
  owner: { id: string; name: string; email: string } | null;
  company: { company: string; phone: string; email: string; website: string; serviceArea: string } | null;
  planActive: boolean | null;
  liveProducts: number;
  /** Counts only: what a lead says stays with the contractor. */
  leadCount: number;
}

export interface GlbReport {
  sizeBytes: number;
  triangles: number | null;
  slots: string[];
  materials: string[];
  bboxIn: GlbMeta['bboxIn'] | null;
  declared: { w: number; h: number; d: number };
  mismatches: { axis: 'w' | 'h' | 'd'; model: number; declared: number }[];
  warnings: string[];
}

export interface ReviewItem {
  id: string;
  brand: { id: string; name: string; slug: string; kind: BrandKind; pageStatus: PageStatus } | null;
  sourceId: string | null;
  status: string;
  submittedAt: number | null;
  working: Product;
  live: Product | null;
  diff: { field: string; before: unknown; after: unknown }[];
  glb: GlbReport | null;
  history: { action: string; note: string; at: number }[];
}

export interface PagePreview {
  brand: PublicBrand;
  products: PublicProduct[];
  preview: true;
  pageStatus: PageStatus;
}

export interface LineResult {
  published: { id: string; name: string; status: string }[];
  skipped: { id: string; name: string; reason: string }[];
  liveCount: number;
}

const enc = encodeURIComponent;

export const brandApi = {
  // the contractor's tab
  state: () => call<BrandState>('GET', '/api/pro/brand'),
  save: (body: BrandSettingsInput) => call<BrandState>('PUT', '/api/pro/brand', body),
  submit: () => call<BrandState>('POST', '/api/pro/brand/submit'),
  preview: () => call<PagePreview>('GET', '/api/pro/brand/preview'),
  summary: () => call<{ summary: BrandSummaryWire }>('GET', '/api/pro/brand/summary'),
  products: () => call<BrandProducts>('GET', '/api/pro/brand/products'),
  publish: (id: string) => call<{ status: string; product: ProductEntry; liveCount: number }>('POST', `/api/pro/brand/products/${enc(id)}/publish`),
  unpublish: (id: string) => call<{ product: ProductEntry; liveCount: number }>('POST', `/api/pro/brand/products/${enc(id)}/unpublish`),
  publishLine: (line: string) => call<LineResult>('POST', '/api/pro/brand/lines/publish', { line }),
  leads: (status?: LeadStatus) => call<{ leads: Lead[]; counts: LeadCounts }>('GET', `/api/pro/brand/leads${status ? `?status=${status}` : ''}`),
  updateLead: (id: string, patch: { status?: LeadStatus; notes?: string }) => call<{ lead: Lead; counts: LeadCounts }>('PATCH', `/api/pro/brand/leads/${enc(id)}`, patch),
  markRead: (ids: string[]) => call<{ counts: LeadCounts }>('POST', '/api/pro/brand/leads/read', { ids }),
  analytics: (days: 7 | 30 | 90) => call<{ analytics: Analytics | null }>('GET', `/api/pro/brand/analytics?days=${days}`),
  uploadCover: (file: File) => upload<{ file: FileWire }>('/api/files', file, { kind: 'image', name: file.name }),

  // public
  page: (slug: string) => call<{ brand: PublicBrand; products: PublicProduct[] }>('GET', `/api/brands/by-slug/${enc(slug)}`),
  contact: (slug: string) =>
    call<{ brand: { slug: string; name: string; kind: BrandKind; verified: boolean; leadForm: boolean; logoUrl: string | null; isDemo: boolean } }>(
      'GET',
      `/api/brands/by-slug/${enc(slug)}/contact`,
    ),
  /** Fire-and-forget beacon (page views, quote clicks); never throws. */
  event: (slug: string, type: 'brand_view' | 'quote_click', productId?: string) =>
    call<void>('POST', `/api/brands/by-slug/${enc(slug)}/events`, productId ? { type, productId } : { type }).catch(() => undefined),
  sendLead: (slug: string, body: LeadInput) => call<{ ok: true; company: string }>('POST', `/api/brands/by-slug/${enc(slug)}/leads`, body),

  // admin
  moderation: () => call<{ brands: AdminBrand[]; products: ReviewItem[] }>('GET', '/api/admin/moderation'),
  adminPreview: (id: string) => call<PagePreview>('GET', `/api/admin/brand-pages/${enc(id)}/preview`),
  approvePage: (id: string) => call<{ brand: AdminBrand }>('POST', `/api/admin/brand-pages/${enc(id)}/approve`),
  rejectPage: (id: string, note: string) => call<{ brand: AdminBrand }>('POST', `/api/admin/brand-pages/${enc(id)}/reject`, { note }),
  approveProduct: (id: string) => call<{ product: ReviewItem }>('POST', `/api/admin/products/${enc(id)}/approve`),
  rejectProduct: (id: string, note: string) => call<{ product: ReviewItem }>('POST', `/api/admin/products/${enc(id)}/reject`, { note }),
  adminBrands: (kind?: BrandKind) => call<{ brands: AdminBrand[] }>('GET', `/api/admin/brands${kind ? `?kind=${kind}` : ''}`),
  createPartner: (body: { name: string; tagline?: string; about?: string; website?: string; isDemo?: boolean }) => call<{ brand: AdminBrand }>('POST', '/api/admin/brands', body),
  editPartner: (id: string, body: { name?: string; tagline?: string; about?: string; website?: string }) => call<{ brand: AdminBrand }>('PATCH', `/api/admin/brands/${enc(id)}`, body),
  brandAction: (id: string, action: 'suspend' | 'reinstate' | 'verify' | 'unverify', note = '') => call<{ brand: AdminBrand }>('POST', `/api/admin/brands/${enc(id)}/${action}`, { note }),
  brandProducts: (id: string) => call<{ products: (Product & { status: string; reviewNote: string })[] }>('GET', `/api/admin/brands/${enc(id)}/products`),
  productAction: (id: string, action: 'unpublish' | 'restore') => call<{ product: Product & { status: string } }>('POST', `/api/admin/products/${enc(id)}/${action}`),
};
