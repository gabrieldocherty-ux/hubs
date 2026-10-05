import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Check, Logo } from '../../components/Icons';
import { Toasts } from '../../components/Toasts';
import { ApiError } from '../../lib/api';
import { hrefFor, navigateHash } from '../../lib/router';
import { useSession } from '../../store/useSession';
import type { ContractorProfile, Plan } from '../../types/platform';
import plansJson from '../../data/plans.json';
import { proApi } from './api';
import { loadPriceBook } from './pricing';
import './contractors.css';

const Setup = lazy(() => import('./Setup'));
const Dashboard = lazy(() => import('./Dashboard'));
const MyCatalog = lazy(() => import('./MyCatalog'));
const ProductForm = lazy(() => import('./ProductForm'));
const PriceBook = lazy(() => import('./PriceBook'));
const Brands = lazy(() => import('./Brands'));
const Quotes = lazy(() => import('./Quotes'));
const QuotePage = lazy(() => import('./QuotePage'));
const Company = lazy(() => import('./Company'));
const Modelling = lazy(() => import('./Modelling'));

const CONTRACTOR = (plansJson as Plan[]).find((p) => p.id === 'contractor')!;

interface Workspace {
  profile: ContractorProfile;
  /** True while the Contractor plan has lapsed: everything is visible, nothing can change. */
  readOnly: boolean;
  /** Re-reads the profile (and the session, price book) after a change. */
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<Workspace | null>(null);

/** The workspace's profile and lapsed state, for the tabs. */
export function useWorkspace(): Workspace {
  const w = useContext(WorkspaceContext);
  if (!w) throw new Error('useWorkspace outside the contractor workspace');
  return w;
}

const TABS: [string, string][] = [
  ['', 'Dashboard'],
  ['catalog', 'My catalog'],
  ['price-book', 'Price book'],
  ['brands', 'Brands I carry'],
  ['quotes', 'Quotes'],
  ['modelling', 'Modelling requests'],
  ['company', 'Company'],
];

/** `#/pro/<rest>`: the Contractor workspace (PLANS_AND_CONTRACTORS §4). */
export default function ContractorRoot({ rest }: { rest: string }) {
  const [state, setState] = useState<'loading' | 'pitch' | { error: string } | { profile: ContractorProfile | null; readOnly: boolean }>('loading');

  const load = useCallback(async () => {
    // Not a contractor (no plan, no company): the pitch, without asking the server for a 403.
    const user = useSession.getState().user;
    if (user && user.plan.id !== 'contractor' && !user.contractor) {
      setState('pitch');
      return;
    }
    try {
      const r = await proApi.profile();
      setState({ profile: r.profile, readOnly: r.readOnly });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setState('pitch');
      else setState({ error: e instanceof ApiError ? e.message : 'Could not open the workspace.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await Promise.all([load(), useSession.getState().refresh()]);
    await loadPriceBook(true);
  }, [load]);

  if (state === 'loading') return <div className="screen-msg">Opening your workspace…</div>;
  if (state === 'pitch') return <Pitch />;
  if ('error' in state)
    return (
      <div className="screen-msg">
        <p>{state.error}</p>
        <a className="btn" href="#/">Back to my kitchens</a>
      </div>
    );
  if (!state.profile) {
    return (
      <Suspense fallback={<div className="screen-msg">Loading…</div>}>
        <Setup onDone={refresh} />
      </Suspense>
    );
  }

  const [section, id] = rest.split('/');
  const ws: Workspace = { profile: state.profile, readOnly: state.readOnly, refresh };

  // The quote is a printable page of its own: no workspace chrome around it.
  if (section === 'quote' && id) {
    return (
      <WorkspaceContext.Provider value={ws}>
        <Suspense fallback={<div className="screen-msg">Preparing the quote…</div>}>
          <QuotePage projectId={id} />
        </Suspense>
      </WorkspaceContext.Provider>
    );
  }

  const active = TABS.some(([k]) => k === section) ? section : '';
  return (
    <WorkspaceContext.Provider value={ws}>
      <div className="pro">
        <header className="home-bar pro-bar">
          <a className="brand" href="#/">
            <Logo />
            <span className="wordmark">Mise</span>
          </a>
          <span className="pro-company" title="Contractor workspace">
            {state.profile.logoUrl && <img src={state.profile.logoUrl} alt="" />}
            {state.profile.company}
          </span>
          <AccountMenu />
        </header>
        <nav className="pro-tabs" aria-label="Contractor workspace">
          {TABS.map(([k, label]) => (
            <a key={k} href={hrefFor({ name: 'pro', rest: k })} className={active === k ? 'chip on' : 'chip'} aria-current={active === k ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
        {state.readOnly && (
          <div className="pro-lapsed" role="status">
            <b>Your Contractor plan has lapsed.</b> Everything is kept and your clients’ share links still work, but your catalog, price book and quotes are read-only.
            <a className="btn primary" href="#/account/billing">
              Renew to keep selling
            </a>
          </div>
        )}
        <main className="pro-main">
          <Suspense fallback={<div className="screen-msg">Loading…</div>}>
            {active === '' && <Dashboard />}
            {active === 'catalog' && (id === 'new' ? <ProductForm key="new" id={null} /> : id ? <ProductForm key={id} id={id} /> : <MyCatalog />)}
            {active === 'price-book' && <PriceBook />}
            {active === 'brands' && <Brands />}
            {active === 'quotes' && <Quotes />}
            {active === 'modelling' && <Modelling />}
            {active === 'company' && <Company />}
          </Suspense>
        </main>
        <Toasts />
      </div>
    </WorkspaceContext.Provider>
  );
}

/** For anyone without the Contractor plan: what it is and how to start it. */
function Pitch() {
  const plan = useSession((s) => s.user?.plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (plan?.id === 'unlimited') {
        await proApi.switchToContractor();
        await useSession.getState().refresh();
        location.reload();
        return;
      }
      const { url } = await proApi.startContractorPlan();
      if (url.startsWith('#/')) navigateHash(url);
      else location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the plan. Try again.');
      setBusy(false);
    }
  };
  return (
    <div className="pro pro-pitch">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <AccountMenu />
      </header>
      <main className="pro-pitch-main">
        <span className="eyebrow">For kitchen contractors, cabinet shops and remodelers</span>
        <h1>{CONTRACTOR.tagline}</h1>
        <div className="pro-pitch-grid">
          <ul className="plan-bullets pro-pitch-bullets">
            {CONTRACTOR.bullets.map((b) => (
              <li key={b}>
                <Check width={16} height={16} /> {b}
              </li>
            ))}
          </ul>
          <section className="pro-pitch-card" aria-label="Contractor plan">
            <span className="eyebrow">Contractor</span>
            <div className="pro-pitch-price">
              <b>${CONTRACTOR.priceCents / 100}</b>
              <span>/ month</span>
            </div>
            <p>Set up your company, add the cabinets you sell, and price kitchens at your markup. Cancel anytime.</p>
            <button className="btn primary big wide" onClick={start} disabled={busy}>
              {busy ? 'One moment…' : plan?.id === 'unlimited' ? 'Switch from Unlimited to Contractor' : 'Start the Contractor plan'}
            </button>
            {error && <div className="auth-error">{error}</div>}
            <p className="fine">Your clients only ever see your sell prices. Your costs stay in your account.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
