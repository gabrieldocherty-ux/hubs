import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Toasts } from '../../components/Toasts';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { wsApi, type MemberRole, type StaffTenant } from './api';
import { WorkspaceContext, type Workspace } from './context';
import './workspace.css';
import './products.css';
import './tabs.css';

const ShowroomTab = lazy(() => import('./ShowroomTab'));
const ProductsTab = lazy(() => import('./ProductsTab'));
const LeadsTab = lazy(() => import('./LeadsTab'));
const RendersTab = lazy(() => import('./RendersTab'));
const TeamTab = lazy(() => import('./TeamTab'));
const PlanTab = lazy(() => import('./PlanTab'));

export type WorkspaceTab = 'showroom' | 'products' | 'leads' | 'renders' | 'team' | 'plan';

export const TABS: [WorkspaceTab, string][] = [
  ['showroom', 'Showroom'],
  ['products', 'Products'],
  ['leads', 'Leads'],
  ['renders', 'Renders'],
  ['team', 'Team'],
  ['plan', 'Plan'],
];

/** `#/studio/<tab>/<rest>` → the tab ('' is the Showroom tab) and what follows it. */
export function tabOf(rest: string): { tab: WorkspaceTab | null; sub: string } {
  const [first = '', ...more] = rest.split('/');
  if (!first) return { tab: 'showroom', sub: '' };
  const tab = TABS.find(([k]) => k === first)?.[0] ?? null;
  return { tab, sub: more.join('/') };
}

type State = 'loading' | { error: string; code: 'sales' | 'not_staff' | 'other' } | { tenant: StaffTenant; role: MemberRole };

/**
 * `#/studio/<rest>` on a showroom: the company workspace (docs/SHOWROOM_PIVOT.md §5), for the
 * company's owners and staff, signed in on their showroom's own address. On the sales site, or for
 * an account that isn't on the team, it says so instead of showing an empty workspace.
 */
export default function WorkspaceRoot({ rest }: { rest: string }) {
  const [state, setState] = useState<State>('loading');
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await wsApi.showroom();
      setState({ tenant: r.tenant, role: r.role });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ code: 'sales', error: 'The company workspace opens on your showroom’s own web address.' });
      else if (e instanceof ApiError && e.status === 403) setState({ code: 'not_staff', error: 'This account isn’t on this showroom’s team.' });
      else setState({ code: 'other', error: e instanceof ApiError ? e.message : 'Could not open the workspace.' });
    }
  }, []);

  const refreshBadge = useCallback(() => {
    // New leads: people the team hasn't opened yet (a lead that sends a design is new again).
    wsApi
      .leadsSummary()
      .then((r) => setUnread(r.counts.unread ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = typeof state === 'object' && 'tenant' in state;
  useEffect(() => {
    if (ready) refreshBadge();
  }, [ready, refreshBadge]);

  const ws: Workspace | null = useMemo(
    () =>
      typeof state === 'object' && 'tenant' in state
        ? {
            tenant: state.tenant,
            role: state.role,
            owner: state.role === 'owner',
            setTenant: (t) => setState((s) => (typeof s === 'object' && 'tenant' in s ? { ...s, tenant: t } : s)),
            refresh: load,
            refreshBadge,
          }
        : null,
    [state, load, refreshBadge],
  );

  if (state === 'loading') return <div className="screen-msg">Opening your workspace…</div>;
  if ('error' in state)
    return (
      <div className="screen-msg ws-closed">
        <h1>Company workspace</h1>
        <p>{state.error}</p>
        {state.code === 'sales' && <p className="muted">Sign in at your showroom’s address (for example yourcompany.blumodel.studio) and open the workspace from your account menu.</p>}
        {state.code === 'not_staff' && <p className="muted">Ask an owner of the showroom to invite this email address from the Team tab.</p>}
        <a className="btn" href="#/">
          Back to the start
        </a>
      </div>
    );

  const { tab, sub } = tabOf(rest);
  const t = state.tenant;
  return (
    <WorkspaceContext.Provider value={ws}>
      <div className="ws">
        <header className="home-bar ws-bar">
          <a className="ws-company" href="#/" title="Open the showroom as visitors see it">
            {t.branding.logoUrl ? <img src={t.branding.logoUrl} alt="" /> : <span className="ws-initial" aria-hidden="true">{t.name.slice(0, 1)}</span>}
            <span className="ws-company-name">{t.name}</span>
          </a>
          <span className="ws-label">Workspace</span>
          <a className="btn ws-view" href="#/">
            View showroom
          </a>
          <AccountMenu />
        </header>
        <nav className="ws-tabs" aria-label="Company workspace">
          {TABS.map(([k, label]) => (
            <a key={k} href={hrefFor({ name: 'studio', rest: k === 'showroom' ? '' : k })} className={tab === k ? 'chip on' : 'chip'} aria-current={tab === k ? 'page' : undefined}>
              {label}
              {k === 'leads' && unread > 0 && (
                <span className="badge bad" aria-label={`${unread} new lead${unread === 1 ? '' : 's'}`} data-testid="leads-badge">
                  {unread}
                </span>
              )}
            </a>
          ))}
        </nav>
        {t.status !== 'live' && <StatusBanner tenant={t} />}
        <main className="ws-main">
          <Suspense fallback={<div className="screen-msg">Loading…</div>}>
            {tab === 'showroom' && <ShowroomTab />}
            {tab === 'products' && <ProductsTab sub={sub} />}
            {tab === 'leads' && <LeadsTab sub={sub} />}
            {tab === 'renders' && <RendersTab />}
            {tab === 'team' && <TeamTab />}
            {tab === 'plan' && <PlanTab />}
            {tab === null && (
              <div className="ws-empty">
                <p>That page isn’t part of the workspace.</p>
                <a className="btn" href={hrefFor({ name: 'studio', rest: '' })}>
                  Open the workspace
                </a>
              </div>
            )}
          </Suspense>
        </main>
        <Toasts />
      </div>
    </WorkspaceContext.Provider>
  );
}

/** What visitors see while the showroom isn't live, so the team isn't surprised by it. */
function StatusBanner({ tenant }: { tenant: StaffTenant }) {
  const text =
    tenant.status === 'setup'
      ? 'Your showroom is being set up. Visitors can already open it; we’ll switch it live with you once your products are in.'
      : tenant.status === 'lapsed'
        ? 'Your showroom is paused: visitors see a “temporarily unavailable” page. Everything is kept. See the Plan tab.'
        : 'Your showroom is suspended: visitors see a “temporarily unavailable” page. Everything is kept. Contact BluModel Studio.';
  return (
    <div className={`ws-status ${tenant.status === 'setup' ? 'info' : 'warn'}`} role="status">
      {text}
      {tenant.status !== 'setup' && (
        <a className="btn" href={hrefFor({ name: 'studio', rest: 'plan' })}>
          See the plan
        </a>
      )}
    </div>
  );
}
