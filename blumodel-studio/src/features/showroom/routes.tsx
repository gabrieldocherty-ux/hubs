import { lazy } from 'react';
import type { Route } from '../../lib/router';
import { HomeScreen } from '../../screens/HomeScreen';
import { SetupWizard } from '../../screens/SetupWizard';
import { NotFound } from '../../screens/NotFound';
import { ProductPage } from '../viewer';
import { SharedKitchen } from '../share';
import { NOT_ON_SHOWROOM, ShowroomLanding } from './index';
import { LeadGate } from './LeadGate';
import { useVisitor, useVisitorStore } from './visitor';

const KitchenEditor = lazy(() => import('../../screens/Editor').then((m) => ({ default: m.KitchenEditor })));
const ShowroomLocal = lazy(() => import('./ShowroomLocal'));
const ShowroomImagesPage = lazy(() => import('./images/ShowroomImagesPage'));

/**
 * The screen for a route on a showroom, or undefined to let the app shell draw it as it does on
 * the sales site (sign-in, account settings, the legal pages, the company workspace…).
 * A visitor's home is the company's landing page; once they have given their details (or signed
 * in), it is their designs. Starting a design (#/new), opening one (#/k/…) and a design kept on
 * this device (#/local) go through "Before you start" (LeadGate) first.
 */
export function showroomScreen(route: Route, signedIn: boolean): JSX.Element | undefined {
  if (NOT_ON_SHOWROOM.has(route.name)) return <NotFound />;
  switch (route.name) {
    case 'home':
      return signedIn ? <HomeScreen /> : <VisitorHome />;
    case 'welcome':
      return <ShowroomLanding />;
    case 'new':
      return (
        <LeadGate>
          <SetupWizard />
        </LeadGate>
      );
    case 'local':
      return (
        <LeadGate>
          <ShowroomLocal signedIn={signedIn} />
        </LeadGate>
      );
    case 'kitchen':
      return (
        <LeadGate>
          <KitchenEditor key={route.id} id={route.id} add={route.add} />
        </LeadGate>
      );
    case 'product':
      return <ProductPage key={route.id} id={route.id} finish={route.finish} />;
    case 'share':
      return <SharedKitchen key={route.token} token={route.token} />;
    case 'showroomImages':
      return <ShowroomImagesPage />;
    default:
      return undefined;
  }
}

/** Signed out: the landing page, or the visitor's designs once this browser has given its details. */
function VisitorHome() {
  const visitor = useVisitor();
  const status = useVisitorStore((s) => s.status);
  if (visitor) return <HomeScreen />;
  if (status === 'idle' || status === 'loading') return <div className="screen-msg">Loading…</div>;
  return <ShowroomLanding />;
}
