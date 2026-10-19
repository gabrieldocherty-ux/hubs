/**
 * Wire types for Admin > Companies, Sales leads and the Overview's showroom numbers
 * (server/routes/tenantsAdmin.mjs, tenantsBilling.mjs, tenantsLeads.mjs, adminShowrooms.mjs;
 * docs/handoff/tenancy.md §5).
 */
import type { ByCurrency, CountMoney } from './types';

export type TenantStatus = 'setup' | 'trial' | 'live' | 'lapsed' | 'suspended';
export type PaidHow = 'invoice' | 'etransfer' | 'cheque' | 'card' | 'cash' | 'comp' | 'other';

export interface TenantHostname {
  hostname: string;
  kind: 'subdomain' | 'custom';
  verified: boolean;
  primary: boolean;
  createdAt: number;
}

export interface TenantMember {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'staff';
  addedAt: number;
  lastSeenAt: number | null;
  /** The address already had an account on the showroom: joins once the invite link is used. */
  pending?: boolean;
}

export interface TenantLicense {
  id: string;
  amountCents: number;
  currency: string;
  startsOn: string;
  endsOn: string;
  paidHow: PaidHow;
  note: string;
  recordedBy: string | null;
  createdAt: number;
  voidedAt: number | null;
}

export interface TenantMonthly {
  provider: 'stripe' | 'demo' | 'comp';
  status: 'active' | 'past_due' | 'canceled' | 'incomplete';
  paid: boolean;
  amountCents: number;
  currency: string;
  periodEnd: number | null;
  graceUntil: number | null;
  cancelAtPeriodEnd: boolean;
  hasPaymentMethod: boolean;
  note: string;
  updatedAt: number;
}

export interface TenantCheckout {
  ref: string;
  tenantId: string;
  provider: 'stripe' | 'demo';
  url: string | null;
  status: 'pending' | 'completed' | 'expired' | 'canceled';
  amountCents: number;
  currency: string;
  createdAt: number;
  completedAt: number | null;
}

export interface TenantSettings {
  fillGaps: boolean;
  bathrooms: boolean;
  visitorRenders: boolean;
  dailyRenderCap: number;
}

export interface AdminTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  statusNote: string;
  isDemo: boolean;
  url: string;
  contact: { phone: string; email: string; website: string; address: string; serviceArea: string; hours: string };
  settings: TenantSettings;
  hostnames: TenantHostname[];
  createdAt: number;
  updatedAt: number;
  members: TenantMember[];
  /** A prospect trial (Quick setup): null when the company isn't (or is no longer) one. */
  trial?: TenantTrial | null;
  branding?: { logoUrl: string | null; primaryColor: string | null; accentColor: string | null; featuredLines: string[] };
  standing?: { licenseCurrent: boolean; monthlyPaid: boolean; live: boolean };
  license?: TenantLicense | null;
  licenses?: TenantLicense[];
  monthly?: TenantMonthly | null;
  checkouts?: TenantCheckout[];
  credits?: { balanceCents: number };
  /** Counts only (no names or contact details): people who used the showroom, new to the team, first seen this month, sent a design. */
  leads?: LeadCountsAdmin;
  usage?: { rendersUsed: number; renderCents: number; products: number; includedProducts: number; queueOpen: number };
  /** A monthly payment was refunded or disputed (charged back): look into it, then clear it. */
  review?: { reason: string; at: number } | null;
}

export interface TenantTrial {
  endsAt: number;
  daysLeft: number;
  /** Visitors can use it now (false once it has lapsed). */
  active: boolean;
}

/** GET /api/admin/quick-setup/slug */
export interface SlugCheck {
  slug: string;
  available: boolean;
  problem: 'invalid' | 'reserved' | 'taken' | null;
  suggestion: string;
}

export type StarterCatalog = 'demo' | 'empty';
export type SetupPurpose = 'trial' | 'customer';

export interface QuickSetupBody {
  name: string;
  slug?: string;
  /** Base64 (a data: URL is fine): PNG, JPEG or WebP, 2 MB at most. */
  logo?: string;
  branding?: { primaryColor?: string; accentColor?: string };
  contact?: { website?: string; serviceArea?: string; phone?: string; email?: string };
  catalog: StarterCatalog;
  purpose: SetupPurpose;
}

/** GET /api/admin/tenants/:id/showroom-images/:run */
export interface ImagesRun {
  state: 'waiting' | 'running' | 'done';
  uploads: number;
  made: number;
  failed: number;
  finishedAt: number | null;
  expiresAt: number;
}

export interface InviteLink {
  url: string;
  expiresAt: number;
  emailed?: boolean;
}

export interface CreditLot {
  id: string;
  source: 'monthly' | 'adjust';
  cents: number;
  remaining: number;
  expiresAt: number;
  createdAt: number;
}

export interface CreditEntry {
  id: number;
  kind: 'grant' | 'expire' | 'reserve' | 'charge' | 'release' | 'refund' | 'adjust';
  cents: number;
  balanceAfter: number;
  holdId: string | null;
  ref: string | null;
  note: string;
  by: string | null;
  at: number;
}

export interface TenantCredits {
  balanceCents: number;
  lots: CreditLot[];
  nextExpiry: { at: number; cents: number } | null;
  heldCents: number;
  history: CreditEntry[];
}

export interface QueueOrder {
  id: string;
  status: string;
  tier: string;
  brief: string;
  line: string;
  email: string | null;
  assignedTo: string | null;
  dueAt: number | null;
  paidAt: number | null;
  createdAt: number;
  overdue: boolean;
}

export interface CountCents {
  count: number;
  cents: number;
}

export interface TenantUsage {
  renders: { total: CountCents; d30: CountCents; month: CountCents };
  products: { live: number; hidden: number; total: number; included: number };
  leads: LeadCountsAdmin | null;
  queue: { open: number; overdue: number; orders: QueueOrder[] };
}

export interface QueueGroup {
  tenant: { id: string; slug: string; name: string } | null;
  open: number;
  overdue: number;
  orders: QueueOrder[];
}

export interface ShowroomOverview {
  companies: Record<TenantStatus, number> & { total: number; demo: number };
  monthly: { stripe: CountMoney; demo: CountMoney; comp: number; pastDue: number; cancelling: number };
  licenses: { year: number; count: number; byCurrency: ByCurrency; comp: number; current: number };
  credits: { used30d: CountCents; usedYear: CountCents; outstandingCents: number };
  salesLeads: { total: number; new: number; d30: number };
  queue: { companies: number; open: number; overdue: number };
  generatedAt: number;
}

export type SalesLeadStatus = 'new' | 'contacted' | 'demo' | 'won' | 'lost';
export const SALES_LEAD_STATUSES: SalesLeadStatus[] = ['new', 'contacted', 'demo', 'won', 'lost'];

export interface SalesLead {
  id: string;
  company: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  message: string;
  status: SalesLeadStatus;
  adminNotes: string;
  emailed: boolean;
  createdAt: number;
}

export type SalesLeadCounts = Record<SalesLeadStatus, number> & { total: number };

/** A showroom's leads for Admin > Companies (docs/handoff/leads.md): counts, never people. */
export interface LeadCountsAdmin {
  total: number;
  new: number;
  thisMonth?: number;
  sent?: number;
}

/** "12 · 3 this month · 5 sent". */
export function leadSummary(l: LeadCountsAdmin | null | undefined): string {
  if (!l) return '0';
  return [String(l.total), l.thisMonth !== undefined ? `${l.thisMonth} this month` : '', l.sent !== undefined ? `${l.sent} sent` : '', l.new ? `${l.new} new` : ''].filter(Boolean).join(' · ');
}
