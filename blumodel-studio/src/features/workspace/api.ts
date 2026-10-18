import { call, upload } from '../../lib/api';
import type { Product } from '../../types';
import type { FileWire, ProductSpecInput } from '../../types/platform';
import type { ShowroomImages } from '../showroom/site';

/**
 * The company workspace's calls (`#/studio` on a showroom, docs/SHOWROOM_PIVOT.md §5). The shapes
 * are the server's (docs/handoff/tenancy.md §5, and server/routes/workspace.mjs for pricing and
 * product requests). Package-local: the shared client tenant types belong to the foundation.
 */

export type TenantStatus = 'setup' | 'live' | 'lapsed' | 'suspended';
export type MemberRole = 'owner' | 'staff';

export interface Branding {
  logoUrl: string | null;
  logoFileId: string | null;
  primaryColor: string;
  accentColor: string;
  welcomeTitle: string;
  welcomeText: string;
  featuredLines: string[];
}

export interface Contact {
  phone: string;
  email: string;
  website: string;
  address: string;
  serviceArea: string;
  hours: string;
}

export interface ShowroomSettings {
  fillGaps: boolean;
  bathrooms: boolean;
  visitorRenders: boolean;
  dailyRenderCap: number;
}

export interface Hostname {
  hostname: string;
  kind: 'subdomain' | 'custom';
  verified: boolean;
  primary: boolean;
  createdAt: number;
}

export interface StaffTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  statusNote?: string | null;
  isDemo: boolean;
  url: string;
  branding: Branding;
  contact: Contact;
  features: { fillGaps: boolean; bathrooms: boolean; visitorRenders: boolean };
  settings: ShowroomSettings;
  hostnames: Hostname[];
  createdAt: number;
  updatedAt: number;
  /** What visitors see (a photo wins), and each source on its own. */
  images?: ShowroomImages;
  imageSources?: { render: ShowroomImages; photo: ShowroomImages };
}

export interface ShowroomPatch {
  name?: string;
  branding?: Partial<Omit<Branding, 'logoUrl'>>;
  contact?: Partial<Contact>;
  settings?: Partial<ShowroomSettings>;
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  addedAt: number;
  lastSeenAt: number | null;
  /** Invited, but the address already had an account here: joins once the invite link is used. */
  pending?: boolean;
}

export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost';
export const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'quoted', 'won', 'lost'];

export interface Lead {
  id: string;
  status: LeadStatus;
  name: string;
  email: string;
  phone: string;
  postalCode: string;
  budget: string;
  timeline: string;
  notes: string;
  consent: boolean;
  consentText: string;
  staffNotes: string;
  design: { name: string; shareToken: string; url: string } | null;
  signedIn: boolean;
  read: boolean;
  createdAt: number;
  updatedAt: number;
}

export type LeadCounts = Record<LeadStatus | 'total' | 'unread', number>;

export interface License {
  id: string;
  amountCents: number;
  currency: string;
  startsOn: string;
  endsOn: string;
  paidHow: string;
  note: string;
  createdAt: number;
  voidedAt: number | null;
}

export interface Monthly {
  provider: 'stripe' | 'demo' | 'comp';
  status: string;
  paid: boolean;
  amountCents: number | null;
  currency: string | null;
  periodEnd: number | null;
  graceUntil: number | null;
  cancelAtPeriodEnd: boolean;
  hasPaymentMethod: boolean;
  note: string | null;
  updatedAt: number;
}

export interface Receipt {
  id: string | number;
  kind: string;
  amountCents: number;
  currency: string;
  provider: string;
  periodEnd: number | null;
  createdAt: number;
}

export interface PlanWire {
  license: License | null;
  licenses: License[];
  monthly: Monthly | null;
  receipts: Receipt[];
  standing: { licenseCurrent: boolean; monthlyPaid: boolean; status: TenantStatus };
  prices: { license: { quoted: true }; monthly: { cents: number; hostingCents: number; creditCents: number }; currency: string };
  graceDays: number;
}

export interface CreditEntry {
  id: number;
  kind: 'grant' | 'expire' | 'reserve' | 'charge' | 'release' | 'refund' | 'adjust';
  cents: number;
  balanceAfter: number;
  holdId: string | null;
  ref: string | null;
  note: string | null;
  by: string | null;
  at: number;
}

export interface CreditsWire {
  balanceCents: number;
  lots: { id: string; source: string; cents: number; remaining: number; expiresAt: number; createdAt: number }[];
  nextExpiry: { at: number; cents: number } | null;
  heldCents: number;
  renderCostCents: number;
  rolloverMonths: number;
  history: CreditEntry[];
}

/** What the company paid for a product (private to the team) and its markup. */
export interface PriceRow {
  costCents: number | null;
  costByWidth: Record<string, number> | null;
  markupPct: number | null;
}

export interface PricingWire {
  defaultMarkupPct: number;
  rows: Record<string, PriceRow>;
}

export type RequestStatus = 'requested' | 'quoted' | 'approved' | 'in_progress' | 'delivered' | 'declined' | 'cancelled';

export interface RequestItemInput {
  name: string;
  brand?: string;
  sku?: string;
  upc?: string;
  url?: string;
  widthIn?: number | null;
  depthIn?: number | null;
  heightIn?: number | null;
  finishes?: string;
  notes?: string;
  referenceFileIds?: string[];
}

export interface RequestItem extends Required<Omit<RequestItemInput, 'widthIn' | 'depthIn' | 'heightIn' | 'referenceFileIds'>> {
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
  referenceFileIds: string[];
}

export interface RequestEvent {
  id: number;
  type: string;
  from: RequestStatus | null;
  to: RequestStatus | null;
  note: string;
  by: 'you' | 'your team' | 'BluModel studio' | string;
  at: number;
}

export interface ProductRequest {
  id: string;
  status: RequestStatus;
  items: RequestItem[];
  note: string;
  quote: { amountCents: number; currency: string; note: string; turnaroundDays: number | null; includedInLicense: boolean; at: number } | null;
  requestedBy: { name: string; email: string } | null;
  createdAt: number;
  updatedAt: number;
  events?: RequestEvent[];
  references?: FileWire[];
}

export interface RequestsWire {
  requests: ProductRequest[];
  included: { products: number; modelled: number; inLicense: number };
}

const enc = encodeURIComponent;

export const wsApi = {
  showroom: () => call<{ tenant: StaffTenant; role: MemberRole }>('GET', '/api/workspace/showroom'),
  saveShowroom: (patch: ShowroomPatch) => call<{ tenant: StaffTenant }>('PATCH', '/api/workspace/showroom', patch),
  uploadLogo: (file: File) => upload<{ file: FileWire }>('/api/files', file, { kind: 'image', visibility: 'public', name: file.name || 'logo.png' }),
  uploadImage: (file: File) => upload<{ file: FileWire }>('/api/files', file, { kind: 'image', visibility: 'public', name: file.name || 'photo.jpg' }),
  uploadModel: (file: File) => upload<{ file: FileWire }>('/api/files', file, { kind: 'model', visibility: 'public', name: file.name || 'model.glb' }),
  uploadReference: (file: Blob, name: string) => upload<{ file: FileWire }>('/api/files', file, { kind: 'reference', name }),

  team: () => call<{ members: Member[]; role: MemberRole }>('GET', '/api/workspace/team'),
  invite: (body: { email: string; name?: string; role: MemberRole }) =>
    call<{ member: Member; pending?: boolean; invite?: { url: string; expiresAt: number; emailed: boolean } }>('POST', '/api/workspace/team', body),
  setRole: (userId: string, role: MemberRole) => call<{ member: Member }>('PATCH', `/api/workspace/team/${enc(userId)}`, { role }),
  removeMember: (userId: string) => call<{ members: Member[] }>('DELETE', `/api/workspace/team/${enc(userId)}`),

  products: () => call<{ products: Product[] }>('GET', '/api/workspace/products'),
  createProduct: (spec: ProductSpecInput) => call<{ product: Product }>('POST', '/api/workspace/products', { spec }),
  updateProduct: (id: string, spec: Record<string, unknown> | undefined, revision: number) => call<{ product: Product }>('PATCH', `/api/workspace/products/${enc(id)}`, { ...(spec ? { spec } : {}), revision }),
  hideProduct: (id: string) => call<{ product: Product }>('POST', `/api/workspace/products/${enc(id)}/hide`),
  showProduct: (id: string) => call<{ product: Product }>('POST', `/api/workspace/products/${enc(id)}/show`),

  pricing: () => call<PricingWire>('GET', '/api/workspace/pricing'),
  setDefaultMarkup: (defaultMarkupPct: number) => call<PricingWire>('PUT', '/api/workspace/pricing', { defaultMarkupPct }),
  setPrice: (productId: string, row: PriceRow) => call<{ productId: string; row: PriceRow }>('PUT', `/api/workspace/pricing/${enc(productId)}`, row),

  leads: (q: { status?: LeadStatus | ''; q?: string; before?: number; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.status) p.set('status', q.status);
    if (q.q) p.set('q', q.q);
    if (q.before) p.set('before', String(q.before));
    if (q.limit) p.set('limit', String(q.limit));
    const s = p.toString();
    return call<{ leads: Lead[]; counts: LeadCounts }>('GET', `/api/workspace/leads${s ? `?${s}` : ''}`);
  },
  lead: (id: string) => call<{ lead: Lead }>('GET', `/api/workspace/leads/${enc(id)}`),
  saveLead: (id: string, patch: { status?: LeadStatus; staffNotes?: string }) => call<{ lead: Lead }>('PATCH', `/api/workspace/leads/${enc(id)}`, patch),
  exportLeads: () => call<{ filename: string; contentType: string; content: string }>('GET', '/api/workspace/leads/export'),

  plan: () => call<PlanWire>('GET', '/api/workspace/plan'),
  portal: () => call<{ url: string }>('POST', '/api/workspace/plan/portal'),
  credits: (before?: number) => call<CreditsWire>('GET', `/api/workspace/credits${before ? `?before=${before}` : ''}`),

  requests: () => call<RequestsWire>('GET', '/api/workspace/requests'),
  request: (id: string) => call<{ request: ProductRequest }>('GET', `/api/workspace/requests/${enc(id)}`),
  createRequest: (body: { items: RequestItemInput[]; note?: string }) => call<{ request: ProductRequest }>('POST', '/api/workspace/requests', body),
  approveRequest: (id: string) => call<{ request: ProductRequest }>('POST', `/api/workspace/requests/${enc(id)}/approve`),
  declineRequest: (id: string, note: string) => call<{ request: ProductRequest }>('POST', `/api/workspace/requests/${enc(id)}/decline`, { note }),
  cancelRequest: (id: string) => call<{ request: ProductRequest }>('POST', `/api/workspace/requests/${enc(id)}/cancel`),
  noteRequest: (id: string, note: string) => call<{ request: ProductRequest }>('POST', `/api/workspace/requests/${enc(id)}/note`, { note }),
};

/** Downloads text as a file (the leads CSV). */
export function saveText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A day like "Oct 17, 2026" from a timestamp or a YYYY-MM-DD date (read as that calendar day). */
export function day(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'string' ? new Date(`${v}T12:00:00Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', ...(typeof v === 'string' ? { timeZone: 'UTC' } : {}) });
}

/** "Oct 17, 2026, 3:04 p.m." */
export function when(ms: number): string {
  return new Date(ms).toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
