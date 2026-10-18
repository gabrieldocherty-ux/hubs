/**
 * Admin > Companies and Sales leads: the showroom admin API (docs/handoff/tenancy.md §5 "Admin").
 * Every write goes through `call` (the X-BluModel CSRF header) to an admin-only, audited route.
 */
import { call } from '../../lib/api';
import type {
  AdminTenant,
  ImagesRun,
  InviteLink,
  PaidHow,
  QueueGroup,
  QuickSetupBody,
  SalesLead,
  SalesLeadCounts,
  SalesLeadStatus,
  ShowroomOverview,
  SlugCheck,
  TenantCheckout,
  TenantCredits,
  TenantLicense,
  TenantMember,
  TenantSettings,
  TenantUsage,
} from './showroomTypes';

const enc = encodeURIComponent;
const tn = (id: string) => `/api/admin/tenants/${enc(id)}`;
type One = { tenant: AdminTenant };

export const showroomApi = {
  overview: () => call<ShowroomOverview>('GET', '/api/admin/showrooms/overview'),
  queue: () => call<{ groups: QueueGroup[] }>('GET', '/api/admin/showrooms/queue'),
  list: () => call<{ tenants: AdminTenant[] }>('GET', '/api/admin/tenants'),
  get: (id: string) => call<One>('GET', tn(id)),
  create: (b: { name: string; slug?: string; ownerEmail?: string; ownerName?: string }) => call<One & { invite?: InviteLink }>('POST', '/api/admin/tenants', b),
  update: (id: string, b: { name?: string; settings?: Partial<TenantSettings> }) => call<One>('PATCH', tn(id), b),
  setStatus: (id: string, status: 'setup' | 'live' | 'suspended', note?: string) => call<One>('POST', `${tn(id)}/status`, { status, note }),
  addHostname: (id: string, hostname: string, kind: 'subdomain' | 'custom') => call<One>('POST', `${tn(id)}/hostnames`, { hostname, kind }),
  updateHostname: (id: string, hostname: string, b: { verified?: boolean; primary?: boolean }) => call<One>('PATCH', `${tn(id)}/hostnames/${enc(hostname)}`, b),
  removeHostname: (id: string, hostname: string) => call<One>('DELETE', `${tn(id)}/hostnames/${enc(hostname)}`),
  addMember: (id: string, b: { email: string; role: 'owner' | 'staff'; name?: string }) => call<{ member: TenantMember; pending?: boolean; invite?: InviteLink }>('POST', `${tn(id)}/members`, b),
  removeMember: (id: string, userId: string) => call<{ members: TenantMember[] }>('DELETE', `${tn(id)}/members/${enc(userId)}`),
  recordLicense: (id: string, b: { amountCents: number; startsOn?: string; endsOn?: string; paidHow: PaidHow; note?: string }) =>
    call<One & { license: TenantLicense }>('POST', `${tn(id)}/licenses`, b),
  voidLicense: (id: string, licenseId: string) => call<One>('DELETE', `${tn(id)}/licenses/${enc(licenseId)}`),
  monthlyCheckout: (id: string) => call<One & { checkout: TenantCheckout }>('POST', `${tn(id)}/monthly/checkout`),
  monthlyComp: (id: string, on: boolean, note?: string) => call<One>('POST', `${tn(id)}/monthly/comp`, { on, note }),
  monthlyCancel: (id: string) => call<One>('POST', `${tn(id)}/monthly/cancel`),
  monthlyDemo: (id: string, event: 'renewal' | 'renewal_failed' | 'grace_end' | 'cancel') => call<One>('POST', `${tn(id)}/monthly/demo`, { event }),
  credits: (id: string) => call<TenantCredits>('GET', `${tn(id)}/credits`),
  adjustCredits: (id: string, cents: number, note: string) => call<TenantCredits>('POST', `${tn(id)}/credits`, { cents, note }),
  /** A 2-hour link to the showroom's picture generator, opened in this browser (server/tenancy/images.mjs); `auto` starts it at once. */
  imagesLink: (id: string, auto = false) => call<{ url: string; expiresAt: number; run: string }>('POST', `${tn(id)}/showroom-images${auto ? '?auto=1' : ''}`),
  /** How the generator opened with that link is getting on. */
  imagesRun: (id: string, run: string) => call<ImagesRun>('GET', `${tn(id)}/showroom-images/${enc(run)}`),
  /** Quick setup (server/routes/quickSetup.mjs): the whole showroom in one call. */
  quickSetup: (b: QuickSetupBody) => call<One & { products: number; trialEndsAt: number | null }>('POST', '/api/admin/quick-setup', b),
  slugCheck: (slug: string, name: string) => call<SlugCheck>('GET', `/api/admin/quick-setup/slug?${new URLSearchParams({ slug, name }).toString()}`),
  trialExtend: (id: string, days = 7) => call<One>('POST', `${tn(id)}/trial/extend`, { days }),
  trialEnd: (id: string) => call<One>('POST', `${tn(id)}/trial/end`),
  trialConvert: (id: string) => call<One>('POST', `${tn(id)}/trial/convert`),
  clearReview: (id: string, restore: boolean) => call<One>('POST', `${tn(id)}/review/clear`, { restore }),
  exportLink: (id: string) => call<{ url: string; expiresAt: number; counts: Record<string, number> }>('POST', `${tn(id)}/export`),
  deleteCompany: (id: string, confirm: string) => call<{ deleted: true; counts: Record<string, number> }>('POST', `${tn(id)}/delete`, { confirm }),
  usage: (id: string) => call<TenantUsage>('GET', `${tn(id)}/usage`),
  salesLeads: (status?: SalesLeadStatus) => call<{ leads: SalesLead[]; counts: SalesLeadCounts }>('GET', `/api/admin/sales-leads${status ? `?status=${enc(status)}` : ''}`),
  updateSalesLead: (id: string, b: { status?: SalesLeadStatus; adminNotes?: string }) => call<{ lead: SalesLead }>('PATCH', `/api/admin/sales-leads/${enc(id)}`, b),
  deleteSalesLead: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/sales-leads/${enc(id)}`),
};
