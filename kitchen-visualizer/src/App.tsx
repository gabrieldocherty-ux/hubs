import { lazy, Suspense, useEffect, useRef } from 'react';
import { navigateHash, safeNext, signinHref, splitHash, useRoute, type Route } from './lib/router';
import { useSession } from './store/useSession';
import { useCatalog } from './store/useCatalog';
import { AuthScreen } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SetupWizard } from './screens/SetupWizard';
import { KitchenEditor, LocalEditor } from './screens/Editor';
import { ProductPage } from './features/viewer';
import { BrandPage, BrandPortal } from './features/brands';
import { DemoPay, OrdersRoot } from './features/orders';
import { GenerateScreen } from './features/generate';
import { LandingScreen, PricingScreen, SharedKitchen } from './features/share';
import { BillingHost, BillingPage, DemoPlanPay } from './features/billing';
import { ContractorRoot } from './features/contractors';

const AdminScreen = lazy(() => import('./screens/AdminScreen'));

/** Routes that need an account; signed-out visitors are sent to sign in (and brought back after). */
const NEEDS_ACCOUNT: ReadonlySet<Route['name']> = new Set(['new', 'kitchen', 'brand', 'orders', 'payDemo', 'admin', 'billing', 'pro', 'payDemoPlan']);

const loading = <div className="screen-msg">Loading…</div>;

export default function App() {
  const route = useRoute();
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id ?? null);
  const init = useSession((s) => s.init);
  const lastUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    void init();
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
  const authPage = route.name === 'signin' || route.name === 'signup';

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'signedIn' && needsAccount) navigateHash(signinHref(), true);
    if (status === 'signedIn' && authPage) navigateHash(safeNext(splitHash(location.hash).query), true);
  }, [status, needsAccount, authPage]);

  // Device-only mode works with no server at all, so it never waits on the session.
  if (route.name === 'local')
    return (
      <>
        <LocalEditor />
        <BillingHost />
      </>
    );
  if (status === 'loading') return loading;

  const signedIn = status === 'signedIn';
  if (authPage || (needsAccount && !signedIn)) return <AuthScreen mode={route.name === 'signup' ? 'signup' : 'signin'} />;

  return (
    <>
      <Suspense fallback={loading}>{screenFor(route, signedIn)}</Suspense>
      <BillingHost />
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
    case 'new':
      return <SetupWizard />;
    case 'kitchen':
      return <KitchenEditor key={route.id} id={route.id} add={route.add} />;
    case 'generate':
      return <GenerateScreen q={route.q} from={route.from} />;
    case 'product':
      return <ProductPage key={route.id} id={route.id} finish={route.finish} />;
    case 'brandPage':
      return <BrandPage key={route.slug} slug={route.slug} />;
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
    case 'pro':
      return <ContractorRoot rest={route.rest} />;
    case 'payDemoPlan':
      return <DemoPlanPay key={route.ref} checkoutRef={route.ref} />;
    default:
      return signedIn ? <HomeScreen /> : <LandingScreen />;
  }
}
