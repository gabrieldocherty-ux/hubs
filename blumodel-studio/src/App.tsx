import { lazy, Suspense, useEffect, useRef } from 'react';
import { navigateHash, safeNext, signinHref, splitHash, useRoute, type Route } from './lib/router';
import { loadConfig } from './lib/config';
import { useSession } from './store/useSession';
import { useCatalog } from './store/useCatalog';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SetupWizard } from './screens/SetupWizard';
import { NotFound } from './screens/NotFound';
import { ConnectionBanner } from './components/ConnectionBanner';
import { ErrorBoundary, QaCrash } from './components/ErrorBoundary';
import { ProductPage } from './features/viewer';
import { BrandPage, BrandPortal } from './features/brands';
import { DemoPay, OrdersRoot } from './features/orders';
import { GenerateScreen, PhotoReference } from './features/generate';
import { LandingScreen, PricingScreen, SharedKitchen } from './features/share';
import { BillingHost, BillingPage, DemoPlanPay } from './features/billing';
import { ContractorRoot } from './features/contractors';
import { WorkspaceRoot } from './features/workspace';
import { ContractorsPage } from './features/finder';
import { LegalScreen } from './features/legal';

const AdminScreen = lazy(() => import('./screens/AdminScreen'));
const AccountScreen = lazy(() => import('./screens/AccountScreen'));
// The sales site's Book a call page (docs/SHOWROOM_PIVOT.md §6).
const BookCallScreen = lazy(() => import('./features/marketing/BookCallScreen'));
// The editor carries the 2D plan (konva), the panels and the exports: about 60% of what used to be
// the entry chunk, and none of it is needed by the landing page, pricing, product pages or sign-in.
const KitchenEditor = lazy(() => import('./screens/Editor').then((m) => ({ default: m.KitchenEditor })));
const LocalEditor = lazy(() => import('./screens/Editor').then((m) => ({ default: m.LocalEditor })));

/** Routes that need an account; signed-out visitors are sent to sign in (and brought back after). */
const NEEDS_ACCOUNT: ReadonlySet<Route['name']> = new Set(['new', 'kitchen', 'brand', 'orders', 'payDemo', 'admin', 'billing', 'account', 'pro', 'payDemoPlan', 'studio']);

const loading = <div className="screen-msg">Loading…</div>;

export default function App() {
  const route = useRoute();
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id ?? null);
  const init = useSession((s) => s.init);
  const lastUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    void init();
    // Payments mode and the legal details: every paying screen and the legal pages read them.
    void loadConfig();
  }, [init]);

  // The catalog loads in the background from the start (the editor waits for it, briefly, before
  // opening a kitchen). It reloads when the user changes, because private custom models are
  // listed only for their owner.
  useEffect(() => {
    if (status === 'loading') {
      void useCatalog.getState().load();
      return;
    }
    const changed = lastUser.current !== undefined && lastUser.current !== userId;
    lastUser.current = userId;
    void useCatalog.getState().load(changed);
  }, [status, userId]);

  const needsAccount = NEEDS_ACCOUNT.has(route.name);
  // A password-reset link (`#/signin?reset=`) opens even when this browser is signed in: setting
  // the new password signs the browser in as the account it belongs to.
  const resetPage = route.name === 'signin' && splitHash(location.hash).query.has('reset');
  const authPage = (route.name === 'signin' || route.name === 'signup') && !resetPage;

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'signedIn' && needsAccount) navigateHash(signinHref(), true);
    if (status === 'signedIn' && authPage) navigateHash(safeNext(splitHash(location.hash).query), true);
  }, [status, needsAccount, authPage]);

  // A crash on one screen shows "Something went wrong" in its place; moving to another screen clears it.
  const boundaryKey = splitHash(location.hash).path || 'home';

  // Device-only mode works with no server at all, so it never waits on the session.
  if (route.name === 'local')
    return (
      <>
        <ErrorBoundary inline key={boundaryKey}>
          <QaCrash where="route" />
          <Suspense fallback={loading}>
            <LocalEditor />
          </Suspense>
          <PhotoReference />
          <BillingHost />
        </ErrorBoundary>
        <ConnectionBanner local />
      </>
    );
  // The legal pages and the 404 need no session, so they don't wait for it either.
  if (route.name === 'legal' || route.name === 'notFound')
    return (
      <>
        <ErrorBoundary inline key={boundaryKey}>
          <QaCrash where="route" />
          {route.name === 'legal' ? (
            <Suspense fallback={loading}>
              <LegalScreen doc={route.doc} />
            </Suspense>
          ) : (
            <NotFound />
          )}
        </ErrorBoundary>
        <ConnectionBanner />
      </>
    );
  if (status === 'loading') return loading;

  const signedIn = status === 'signedIn';
  if (authPage || resetPage || (needsAccount && !signedIn))
    return (
      <>
        <AuthScreen mode={route.name === 'signup' ? 'signup' : 'signin'} />
        <ConnectionBanner />
      </>
    );

  return (
    <>
      <ErrorBoundary inline key={boundaryKey}>
        <QaCrash where="route" />
        <Suspense fallback={loading}>{screenFor(route, signedIn)}</Suspense>
        <BillingHost />
      </ErrorBoundary>
      <ConnectionBanner />
    </>
  );
}

function screenFor(route: Route, signedIn: boolean) {
  switch (route.name) {
    case 'home':
      return signedIn ? <HomeScreen /> : <LandingScreen />;
    case 'welcome':
      return <LandingScreen />;
    case 'pricing':
      return <PricingScreen />;
    case 'book':
      return <BookCallScreen />;
    case 'new':
      return <SetupWizard />;
    case 'kitchen':
      // The photos a kitchen was started from float over the editor. Never on a share view
      // (`#/s/:token`): they are private to the owner.
      return (
        <>
          <KitchenEditor key={route.id} id={route.id} add={route.add} />
          <PhotoReference key={`ref-${route.id}`} projectId={route.id} />
        </>
      );
    case 'generate':
      return <GenerateScreen q={route.q} from={route.from} />;
    case 'product':
      return <ProductPage key={route.id} id={route.id} finish={route.finish} />;
    case 'brandPage':
      return <BrandPage key={route.slug} slug={route.slug} />;
    case 'contractors':
      return <ContractorsPage near={route.near} kitchen={route.kitchen} />;
    case 'brand':
      return <BrandPortal rest={route.rest} />;
    case 'orders':
      return <OrdersRoot rest={route.rest} />;
    case 'payDemo':
      return <DemoPay key={route.orderId} orderId={route.orderId} />;
    case 'share':
      return <SharedKitchen key={route.token} token={route.token} />;
    case 'admin':
      return <AdminScreen tab={route.tab} />;
    case 'billing':
      return <BillingPage />;
    case 'account':
      return <AccountScreen />;
    case 'pro':
      return <ContractorRoot rest={route.rest} />;
    case 'studio':
      return <WorkspaceRoot rest={route.rest} />;
    case 'payDemoPlan':
      return <DemoPlanPay key={route.ref} checkoutRef={route.ref} />;
    case 'legal':
      return <LegalScreen doc={route.doc} />;
    case 'notFound':
      return <NotFound />;
    default:
      return signedIn ? <HomeScreen /> : <LandingScreen />;
  }
}
