/** Wire types for the owner's admin panel (server/routes/adminPanel.mjs, server/admin/*). */
import type { PlanState, Role, Subscription } from '../../types/platform';

/** Amounts in cents, keyed by lower-case currency ('cad', 'usd'). Never summed across keys. */
export type ByCurrency = Partial<Record<string, number>>;

export interface CountMoney {
  count: number;
  byCurrency: ByCurrency;
}

export interface ProviderMoney {
  unlocks30d: CountMoney;
  unlocksAll: CountMoney;
  refunds30d: CountMoney;
  refundsAll: CountMoney;
  collected30d: ByCurrency;
}

export interface ProviderSubs {
  unlimited: number;
  contractor: number;
  pastDue: number;
  cancelling: number;
  mrrByCurrency: ByCurrency;
}

export interface DashboardSignup {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number;
  plan: 'free' | 'unlimited' | 'contractor';
  disabled: boolean;
}

export interface DashboardPayment {
  at: number;
  kind: 'kitchen_unlock' | 'subscription' | 'renewal' | 'order';
  label: string;
  userId: string | null;
  email: string | null;
  amountCents: number;
  currency: string;
  provider: 'stripe' | 'demo';
}

export interface Dashboard {
  generatedAt: number;
  payments: 'stripe' | 'demo' | 'none';
  stripeMode: 'live' | 'test' | null;
  signups: { d7: number; d30: number; total: number; disabled: number };
  subscriptions: { stripe: ProviderSubs; demo: ProviderSubs; comp: { unlimited: number; contractor: number } };
  money: { stripe: ProviderMoney; demo: ProviderMoney };
  models: { contractors: number; included: number; granted: number; used: number; left: number };
  studioQueue: { open: number; toStart: number; inProgress: number; revision: number; overdue: number };
  leads: { d7: number; d30: number; unread: number };
  retail: { d7: number; d30: number };
  kitchens: number;
  recentSignups: DashboardSignup[];
  recentPayments: DashboardPayment[];
}

export interface PanelUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number;
  projects?: number;
  plan?: 'free' | 'unlimited' | 'contractor';
  planProvider?: 'stripe' | 'demo' | 'comp' | null;
  disabled?: boolean;
  lastSeenAt?: number | null;
}

export interface AuditEntry {
  id: number;
  at: number;
  adminUserId: string | null;
  adminEmail: string;
  action: string;
  targetUserId: string | null;
  targetEmail: string;
  detail: Record<string, unknown>;
}

export interface BrandPageWire {
  id: string;
  slug: string;
  name: string;
  state: 'none' | 'draft' | 'in_review' | 'live' | 'hidden' | 'rejected' | 'suspended';
  verified: boolean;
  verifiedAt: number | null;
  liveAt: number | null;
}

export interface AllowanceWire {
  active: boolean;
  plan: string;
  included: number;
  granted: number;
  used: number;
  total: number;
  left: number;
  periodStart: number;
  periodEnd: number;
  resetsAt: number;
}

export interface UserDetail {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    phone: string;
    createdAt: number;
    lastSeenAt: number | null;
    disabled: { disabledAt: number; disabledBy: string | null; reason: string } | null;
  };
  plan: PlanState;
  subscription: (Subscription & { id: string | null; compNote: string | null; compEndsAt: number | null }) | null;
  entitlements: { plan: string; adminBypass: boolean; unlockedKitchens: number };
  kitchens: { count: number; recent: { id: string; name: string; updatedAt: number }[] };
  orders: { id: string; status: string; tier: string; amountCents: number; currency: string; provider: string; createdAt: number; paidAt: number | null }[];
  payments: { kind: string; plan: string | null; amountCents: number; currency: string; provider: string; at: number }[];
  contractor: {
    company: string;
    phone: string;
    email: string;
    website: string;
    serviceArea: string;
    brandPage: BrandPageWire | null;
    allowance: AllowanceWire;
  } | null;
  sessions: { id: string | null; browser: string; os: string; createdAt: number | null; lastSeenAt: number | null; expiresAt: number }[];
  audit: AuditEntry[];
}

export interface ContractorRow {
  userId: string;
  email: string;
  name: string;
  company: string;
  phone: string;
  createdAt: number;
  plan: { id: 'free' | 'unlimited' | 'contractor'; status: string; provider: string | null; cancelAtPeriodEnd: boolean; graceUntil: number | null };
  brandPage: BrandPageWire | null;
  models: { active: boolean; used: number; total: number; left: number; granted: number; resetsAt: number };
  disabled: boolean;
}

export interface SystemStatus {
  generatedAt: number;
  server: { version: string; commit: string | null; deployedAt: number | null; startedAt: number; uptimeSec: number; node: string; production: boolean; publicUrl: string; httpsPublicUrl: boolean; shuttingDown: boolean };
  database: { inMemory: boolean; sizeBytes: number | null; walBytes: number | null; integrity: 'ok' | 'problems' | 'not checked' };
  backups: { enabled: boolean; count: number; keep: number; lastDay: string | null; lastAt: number | null; offsite?: OffsiteStatus };
  disk: { freeBytes: number; totalBytes: number } | null;
  payments: {
    provider: 'stripe' | 'demo' | 'none';
    stripeMode: 'live' | 'test' | null;
    secretKeySet: boolean;
    webhookSecretSet: boolean;
    webhookSecretWellFormed: boolean;
    notes: string[];
    lastWebhookAt: number | null;
    webhooks30d: number;
    failures: { at: number; reason: string; status: number; eventType: string | null }[];
    failures24h: number;
  };
  email: { provider: 'resend' | 'postmark' | 'none'; configured: boolean; keySet: boolean; fromSet: boolean };
  legal: { supportEmailSet: boolean; legalNameSet: boolean; jurisdictionSet: boolean; ready: boolean };
  llm: { configured: boolean };
  log: { available: boolean; entries: { at: number | null; level: 'error' | 'warn'; text: string }[] };
  updates: UpdatesStatus;
  /** Every site on, or off for maintenance (server/ops/sitesSwitch.mjs). */
  sites: SitesState;
}

/** Encrypted off-site copies (server/ops/offsite.mjs). Never the passphrase. */
export interface OffsiteStatus {
  configured: boolean;
  dir: string | null;
  keep: number;
  passphraseSet: boolean;
  problem: string | null;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastFile: string | null;
  lastBytes: number | null;
  copies: number | null;
  oldestAt: number | null;
  verifiedAt: number | null;
  lastError: string | null;
  stale: boolean;
}

export interface SitesState {
  on: boolean;
  since: number | null;
  by: string | null;
  via: 'face' | 'admin' | 'cli' | null;
}

export type UpdateOutcome = 'current' | 'updated' | 'skipped' | 'refused' | 'busy' | 'rolled-back' | 'failed' | 'down' | 'error';
export interface UpdateResult {
  outcome: UpdateOutcome;
  at: number | null;
  from: string | null;
  to: string | null;
  durationMs: number | null;
  error: string | null;
  by: 'schedule' | 'update-now';
}
/** Admin > System > Updates (server/admin/updates.mjs). `available` is false on a development server. */
export type UpdatesStatus =
  | { available: false; reason: string }
  | {
      available: true;
      installed: boolean;
      enabled: boolean;
      time: string;
      branch: string | null;
      deployed: string | null;
      head: string | null;
      source: string | null;
      lastCheckAt: number | null;
      last: UpdateResult | null;
      lastUpdate: UpdateResult | null;
      failed: { commit: string; at: number | null } | null;
      rolledBack: boolean;
      pending: boolean;
    };

export interface AuditPage {
  entries: AuditEntry[];
  page: number;
  pages: number;
  total: number;
  perPage: number;
  actions: string[];
  actors: string[];
}
