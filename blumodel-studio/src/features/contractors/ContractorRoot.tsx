import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Check, Logo, Wordmark } from '../../components/Icons';
import { Toasts } from '../../components/Toasts';
import { AgreeToPay, DemoBanner, PaymentsSoon } from '../../components/PaymentNotice';
import { ApiError, call } from '../../lib/api';
import { usePayments } from '../../lib/config';
import { clearSessionId, markCheckout, paymentError, takeCheckoutReturn, type CheckoutReturn } from '../../lib/payments';
import { hrefFor, navigateHash } from '../../lib/router';
import { useSession } from '../../store/useSession';
import type { ContractorProfile, Plan } from '../../types/platform';
import plansJson from '../../data/plans.json';
import { proApi } from './api';
import { needsCompanyDetails } from './CompanyFields';
import { loadPriceBook } from './pricing';
import { ProBrandTab } from '../brands';
import { useBrandSummary } from '../brands/summary';
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
  // Package B2: the brand page lives in the workspace (BRAND_PAGE.md §2).
  ['brand', 'Brand page'],
  ['brands', 'Brands I carry'],
  ['quotes', 'Quotes'],
  ['modelling', 'Modelling requests'],
  ['company', 'Company'],
];

/**
 * Back from the Contractor plan's checkout (`#/pro` is its return page). A paid Stripe checkout is
 * confirmed with the server first, without waiting for the webhook; then the session is re-read so
 * the workspace opens on the new plan.
 */
async function settleReturn(): Promise<CheckoutReturn | null> {
  const back = takeCheckoutReturn('#/pro');
  if (!back) return null;
  if (back.sessionId) {
    try {
      await call('POST', '/api/billing/sync', { sessionId: back.sessionId });
    } catch {
      // The webhook catches up; the plan shows on the next visit.
    }
    clearSessionId();
  }
  await useSession.getState().refresh();
  return back;
}

/** `#/pro/<rest>`: the Contractor workspace (PLANS_AND_CONTRACTORS §4). */
export default function ContractorRoot({ rest }: { rest: string }) {
  const [state, setState] = useState<'loading' | 'pitch' | { error: string } | { profile: ContractorProfile | null; readOnly: boolean }>('loading');
  const [back, setBack] = useState<CheckoutReturn | null>(null);

  useEffect(() => {
    let live = true;
    void settleReturn().then((b) => {
      if (!live || !b) return;
      setBack(b);
      void load();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  if (state === 'pitch') return <Pitch brand={rest.split('/')[0] === 'brand'} back={back} />;
  if ('error' in state)
    return (
      <div className="screen-msg">
        <p>{state.error}</p>
        <a className="btn" href="#/">Back to my kitchens</a>
      </div>
    );
  // No company yet, or (while the plan is active) one saved before the business name and phone were
  // both required: the setup asks for them before the workspace opens.
  if (!state.profile || (!state.readOnly && needsCompanyDetails(state.profile))) {
    return (
      <>
        {!state.profile && back && back.outcome === 'success' && (
          <div className="auth-ok pro-return" role="status">
            Payment received: you’re on the Contractor plan. Set up your company to open the workspace.
          </div>
        )}
        <Suspense fallback={<div className="screen-msg">Loading…</div>}>
          <Setup onDone={refresh} existing={state.profile} />
        </Suspense>
      </>
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
            <Wordmark />
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
              {k === 'brand' && <BrandBadge />}
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
            {active === 'brand' && <ProBrandTab rest={rest} />}
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

/** Package B2: the unread-leads badge on the Brand page tab. */
function BrandBadge() {
  const unread = useBrandSummary((s) => s.summary?.unread ?? 0);
  useEffect(() => {
    void useBrandSummary.getState().load();
  }, []);
  return unread > 0 ? (
    <span className="badge bad" aria-label={`${unread} new lead${unread === 1 ? '' : 's'}`}>
      {unread}
    </span>
  ) : null;
}

/**
 * For anyone without the Contractor plan: what it is and how to start it. The button follows this
 * server's payments: Stripe's hosted checkout, the labelled DEMO, or "opens soon" while payments
 * aren't open (no checkout is started then).
 */
function Pitch({ brand = false, back = null }: { brand?: boolean; back?: CheckoutReturn | null }) {
  const plan = useSession((s) => s.user?.plan);
  const payments = usePayments();
  const soon = payments === 'none';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    if (soon) return;
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
      markCheckout('contractor', '#/pro');
      if (url.startsWith('#/')) navigateHash(url);
      else location.assign(url);
    } catch (e) {
      setError(paymentError(e, 'Could not start the plan. Try again.'));
      setBusy(false);
    }
  };
  return (
    <div className="pro pro-pitch">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <AccountMenu />
      </header>
      <main className="pro-pitch-main">
        <span className="eyebrow">For kitchen contractors, cabinet shops and remodelers</span>
        <h1>{CONTRACTOR.tagline}</h1>
        {brand && (
          // Package B2: `#/brand*` lands here for anyone without the plan (BRAND_PAGE §2).
          <p className="pro-pitch-brand">
            <b>Get found:</b> put the cabinets you sell in front of homeowners designing their kitchens. A brand page with your products in 3D and a leads inbox is included in the
            Contractor plan.
          </p>
        )}
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
            {back?.outcome === 'cancel' && (
              <div className="auth-note" role="status">
                Checkout cancelled. Nothing was charged.
              </div>
            )}
            {back?.outcome === 'success' && (
              <div className="auth-note" role="status">
                Payment received. We’re still confirming it with the payment provider: reload this page in a minute.
              </div>
            )}
            {payments === 'demo' && <DemoBanner compact />}
            {soon ? (
              <PaymentsSoon compact title="The Contractor plan opens soon">
                Sign-ups open with payments. Until then you can design and share kitchens for free.
              </PaymentsSoon>
            ) : (
              <button className="btn primary big wide" onClick={start} disabled={busy}>
                {busy ? 'One moment…' : plan?.id === 'unlimited' ? 'Switch from Unlimited to Contractor' : 'Start the Contractor plan'}
              </button>
            )}
            {error && <div className="auth-error">{error}</div>}
            {!soon && <AgreeToPay />}
            <p className="fine">Your clients only ever see your sell prices. Your costs stay in your account.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
