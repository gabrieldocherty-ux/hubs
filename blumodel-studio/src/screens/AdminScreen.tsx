import { lazy, Suspense, useEffect } from 'react';
import { ADMIN_TABS, hrefFor, navigate, type AdminTab } from '../lib/router';
import { useSession } from '../store/useSession';
import type { Role } from '../types/platform';
import { AccountMenu } from '../components/AccountMenu';
import { MfaEnrolScreen, ReauthPrompt } from '../components/TwoFactor';
import { Logo, Wordmark } from '../components/Icons';
import { AdminBrandsTab, AdminModerationTab } from '../features/brands';
import { AdminRevenueTab, AdminStudioTab } from '../features/orders';
import { AdminBillingTab } from '../features/billing';
import { AdminAuditTab, AdminCompaniesTab, AdminContractorsTab, AdminDashboardTab, AdminProspectsTab, AdminSalesLeadsTab, AdminSystemTab, AdminUsersTab } from '../features/admin';

// Real-retailer link settings and link-out counts (its own chunk: admins only).
const AdminRetailersTab = lazy(() => import('../catalog/retailAdmin'));

const LABELS: Record<AdminTab, string> = {
  overview: 'Overview',
  companies: 'Companies',
  'sales-leads': 'Sales leads',
  prospects: 'Prospects',
  moderation: 'Moderation',
  brands: 'Brands',
  retailers: 'Retailers',
  studio: 'Studio',
  revenue: 'Revenue',
  billing: 'Billing',
  users: 'Users',
  contractors: 'Contractors',
  system: 'System',
  audit: 'Audit',
};

const STUDIO_TABS: AdminTab[] = ['studio'];
const NO_TABS: AdminTab[] = [];

/** Tabs a role may open. The server enforces every rule; this only hides what isn't yours. */
export function adminTabsFor(role: Role | undefined): AdminTab[] {
  if (role === 'admin') return ADMIN_TABS;
  if (role === 'studio') return STUDIO_TABS;
  return NO_TABS;
}

/** `#/admin/:tab`: admins see every tab; the studio role sees only the studio queue. */
export default function AdminScreen({ tab }: { tab: AdminTab }) {
  const user = useSession((s) => s.user);
  const tabs = adminTabsFor(user?.role);
  const allowed = tabs.includes(tab);

  useEffect(() => {
    if (!allowed && tabs.length) navigate({ name: 'admin', tab: tabs[0] }, true);
  }, [allowed, tabs]);

  if (!tabs.length)
    return (
      <div className="screen-msg">
        <p>This area is for BluModel Studio staff.</p>
        <a className="btn" href="#/">Back to my kitchens</a>
      </div>
    );

  // An admin without two-factor sign-in sees only the enrolment (the server refuses every admin route
  // with mfa_enrol_required until then).
  const mustEnrol = user?.role === 'admin' && !!user.mfa?.required && !user.mfa.enabled;

  return (
    <div className="admin">
      <ReauthPrompt />
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
          {tabs.map((t) => (
            <a key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'chip on' : 'chip'} href={hrefFor({ name: 'admin', tab: t })}>
              {LABELS[t]}
            </a>
          ))}
        </nav>
        <AccountMenu />
      </header>
      <main className="admin-main">
        {mustEnrol && <MfaEnrolScreen />}
        {allowed && !mustEnrol && (
          <Suspense fallback={<div className="screen-msg">Loading…</div>}>
            {tab === 'overview' && <AdminDashboardTab />}
            {tab === 'companies' && <AdminCompaniesTab />}
            {tab === 'sales-leads' && <AdminSalesLeadsTab />}
            {tab === 'prospects' && <AdminProspectsTab />}
            {tab === 'users' && <AdminUsersTab />}
            {tab === 'contractors' && <AdminContractorsTab />}
            {tab === 'system' && <AdminSystemTab />}
            {tab === 'audit' && <AdminAuditTab />}
            {tab === 'moderation' && <AdminModerationTab />}
            {tab === 'brands' && <AdminBrandsTab />}
            {tab === 'retailers' && <AdminRetailersTab />}
            {tab === 'studio' && <AdminStudioTab />}
            {tab === 'revenue' && <AdminRevenueTab />}
            {tab === 'billing' && <AdminBillingTab />}
          </Suspense>
        )}
      </main>
    </div>
  );
}
