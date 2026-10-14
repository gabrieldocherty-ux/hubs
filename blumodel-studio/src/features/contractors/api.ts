import { call, upload } from '../../lib/api';
import type { DesignDoc, Product } from '../../types';
import type { ContractorProfile, FileWire, PlanState, PreparedBy, PriceBookBrand, PriceBookData, PriceBookEntry, PriceBookRow, ProductSpecInput } from '../../types/platform';

/** Package H's calls: the `/api/pro/…` routes (BUILD_PLAN §15). */

export interface ProfileWire {
  profile: ContractorProfile | null;
  active: boolean;
  readOnly: boolean;
  plan?: PlanState;
}

export interface ProfileInput {
  company: string;
  phone?: string;
  email?: string;
  website?: string;
  serviceArea?: string;
  defaultMarkupPct?: number;
  taxPct?: number;
  logoFileId?: string | null;
}

export interface CostInput {
  costCents?: number | null;
  costByWidth?: Record<string, number | null> | null;
  markupPct?: number | null;
}

export interface Dashboard {
  profile: ContractorProfile;
  active: boolean;
  counts: { products: number; lines: number; uncosted: number; kitchens: number; clients: number };
  recent: { id: string; name: string; client: string; updatedAt: number }[];
}

export interface BrandRow extends PriceBookBrand {
  key: string;
  name: string;
  isDemo: boolean;
  verified: boolean;
  productCount: number;
}

export interface ImportRow {
  line: number;
  sku: string;
  name: string;
  productId?: string;
  width?: number | null;
  costCents: number;
  before?: number | null;
}

export interface ImportPreview {
  header: boolean;
  updated: ImportRow[];
  added: ImportRow[];
  unchanged: ImportRow[];
  unmatched: ImportRow[];
  errors: { line: number; sku: string; error: string }[];
}

export interface QuoteLine {
  label: string;
  sub: string;
  sku: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface Quote {
  projectId: string;
  kitchen: { name: string; client: string; room: DesignDoc['room']; updatedAt: number };
  doc: DesignDoc;
  preparedBy: PreparedBy | null;
  serviceArea: string;
  groups: { name: string; lines: QuoteLine[]; total: number }[];
  subtotal: number;
  taxPct: number;
  tax: number;
  total: number;
  validUntil: number;
  notes: string;
  hasBuiltin: boolean;
  disclaimer: string;
}

export interface QuoteSummary {
  projectId: string;
  name: string;
  client: string;
  items: number;
  total: number;
  updatedAt: number;
  validUntil: number | null;
}

const enc = encodeURIComponent;

export const proApi = {
  profile: () => call<ProfileWire>('GET', '/api/pro/profile'),
  saveProfile: (p: ProfileInput) => call<ProfileWire>('PUT', '/api/pro/profile', p),
  dashboard: () => call<Dashboard>('GET', '/api/pro/dashboard'),
  products: (archived = false) => call<{ products: Product[]; limit: number }>('GET', `/api/pro/products${archived ? '?archived=1' : ''}`),
  createProduct: (spec: ProductSpecInput, cost?: CostInput) => call<{ product: Product; price: PriceBookEntry | null }>('POST', '/api/pro/products', { spec, cost }),
  updateProduct: (id: string, spec: Partial<ProductSpecInput> & Record<string, unknown>, revision: number, cost?: CostInput) =>
    call<{ product: Product; price: PriceBookEntry | null }>('PATCH', `/api/pro/products/${enc(id)}`, { spec, revision, cost }),
  archiveProduct: (id: string) => call<{ product: Product }>('POST', `/api/pro/products/${enc(id)}/archive`),
  restoreProduct: (id: string) => call<{ product: Product }>('POST', `/api/pro/products/${enc(id)}/restore`),
  brands: () => call<{ brands: BrandRow[]; lines: { key: string; name: string; count: number; markupPct: number | null }[]; own: { count: number; markupPct: number | null } }>('GET', '/api/pro/brands'),
  setBrand: (key: string, patch: Partial<PriceBookBrand>) => call<{ key: string; setting: PriceBookBrand }>('PATCH', '/api/pro/brand-settings', { key, ...patch }),
  priceBook: () => call<{ rows: PriceBookRow[]; data: PriceBookData }>('GET', '/api/pro/price-book'),
  setPrice: (productId: string, patch: CostInput) => call<{ productId: string; row: PriceBookEntry }>('PATCH', `/api/pro/price-book/${enc(productId)}`, patch),
  importCsv: async (csv: string, dryRun: boolean): Promise<{ preview: ImportPreview; applied: number }> => {
    const res = await fetch(`/api/pro/price-book/import${dryRun ? '?dryRun=1' : ''}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Mise': '1', 'Content-Type': 'text/csv' },
      body: csv,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error ?? 'The import didn’t work.'), { preview: data?.preview as ImportPreview | undefined });
    return data;
  },
  exportCsv: () => call<{ filename: string; contentType: string; content: string }>('GET', '/api/pro/price-book/export'),
  quotes: () => call<{ quotes: QuoteSummary[] }>('GET', '/api/pro/quotes'),
  quote: (projectId: string) => call<Quote>('GET', `/api/pro/quotes/${enc(projectId)}`),
  saveQuote: (projectId: string, body: { validUntil: number | null; notes: string }) => call<Quote>('PUT', `/api/pro/quotes/${enc(projectId)}`, body),
  uploadImage: (file: File) => upload<{ file: FileWire }>('/api/files', file, { kind: 'image', name: file.name }),
  uploadModel: (file: File) => upload<{ file: FileWire }>('/api/files', file, { kind: 'model', name: file.name }),
  // Billing, for the pitch page (package G's endpoints).
  startContractorPlan: () => call<{ url: string }>('POST', '/api/billing/checkout', { kind: 'subscription', plan: 'contractor', returnTo: '#/pro' }),
  switchToContractor: () => call<unknown>('POST', '/api/billing/change', { plan: 'contractor' }),
};

export const cents = (dollars: number) => Math.round(dollars * 100);
export const toDollars = (c: number | null | undefined) => (typeof c === 'number' ? c / 100 : null);

/** "$1,250.50" / "1250.5" → 1250.5; '' → null; NaN for junk. */
export function parseDollars(v: string): number | null {
  const s = v.trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
