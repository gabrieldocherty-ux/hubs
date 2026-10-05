import { call } from '../../lib/api';
import type { AccountPlanId, Entitlements, Plan, PlanState, Subscription } from '../../types/platform';

/** Package G's calls (BUILD_PLAN §14). Every amount comes from the server. */

export interface Receipt {
  id: string;
  kind: 'kitchen_unlock' | 'subscription' | 'renewal';
  plan: 'unlimited' | 'contractor' | null;
  projectId: string | null;
  projectName: string;
  amountCents: number;
  currency: string;
  provider: 'demo' | 'stripe';
  createdAt: number;
}

export interface BillingMe {
  plan: PlanState;
  subscription: Subscription | null;
  unlocks: { projectId: string; name: string; amountCents: number; createdAt: number }[];
  receipts: Receipt[];
  payments: 'demo' | 'stripe';
  demo: boolean;
  graceDays: number;
}

export interface CheckoutWire {
  ref: string;
  kind: 'kitchen_unlock' | 'subscription';
  plan: 'unlimited' | 'contractor' | null;
  projectId: string | null;
  projectName: string;
  amountCents: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'canceled' | 'expired';
  provider: 'demo' | 'stripe';
  returnTo: string;
}

export interface ProviderStats {
  active: { unlimited: number; contractor: number };
  mrrCents: number;
  pastDue: number;
  cancelling: number;
  unlocks: number;
  unlockCents: number;
  collected30dCents: number;
  churn30d: number;
}

type CheckoutBody = { kind: 'kitchen_unlock'; projectId: string; returnTo?: string } | { kind: 'subscription'; plan: 'unlimited' | 'contractor'; returnTo?: string };

export const billingApi = {
  plans: () => call<{ plans: Plan[]; payments: 'demo' | 'stripe'; demo: boolean }>('GET', '/api/billing/plans'),
  me: () => call<BillingMe>('GET', '/api/billing/me'),
  entitlements: () => call<Entitlements>('GET', '/api/billing/entitlements'),
  checkout: (body: CheckoutBody) => call<{ url: string; ref: string; provider: 'demo' | 'stripe' }>('POST', '/api/billing/checkout', body),
  checkoutInfo: (ref: string) => call<{ checkout: CheckoutWire; demo: boolean }>('GET', `/api/billing/checkouts/${encodeURIComponent(ref)}`),
  demoComplete: (ref: string, outcome: 'success' | 'decline' | 'cancel') =>
    call<{ checkout: CheckoutWire; entitlements: Entitlements }>('POST', `/api/billing/demo/${encodeURIComponent(ref)}/complete`, { outcome }),
  demoSimulate: (event: 'renewal' | 'renewal_failed' | 'period_end' | 'grace_end') => call<BillingMe>('POST', '/api/billing/demo/simulate', { event }),
  sync: (sessionId: string) => call<{ entitlements: Entitlements; checkout: CheckoutWire | null }>('POST', '/api/billing/sync', { sessionId }),
  portal: () => call<{ url: string }>('POST', '/api/billing/portal'),
  change: (plan: Exclude<AccountPlanId, 'free'>) => call<BillingMe>('POST', '/api/billing/change', { plan }),
  cancel: () => call<BillingMe>('POST', '/api/billing/cancel'),
  resume: () => call<BillingMe>('POST', '/api/billing/resume'),
  admin: () => call<{ payments: 'demo' | 'stripe'; demo: ProviderStats; stripe: ProviderStats }>('GET', '/api/admin/billing'),
};

/** Goes to a checkout URL: an in-app hash (DEMO) or Stripe's hosted page. */
export function goToCheckout(url: string) {
  if (url.startsWith('#/')) {
    history.pushState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.assign(url);
}

export const dollars = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
