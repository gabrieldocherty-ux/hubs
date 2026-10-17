import { lazy } from 'react';
import type { Route } from '../../lib/router';
import { HomeScreen } from '../../screens/HomeScreen';
import { SetupWizard } from '../../screens/SetupWizard';
import { NotFound } from '../../screens/NotFound';
import { ProductPage } from '../viewer';
import { SharedKitchen } from '../share';
import { NOT_ON_SHOWROOM, ShowroomLanding } from './index';

const KitchenEditor = lazy(() => import('../../screens/Editor').then((m) => ({ default: m.KitchenEditor })));
const ShowroomLocal = lazy(() => import('./ShowroomLocal'));

/**
 * The screen for a route on a showroom, or undefined to let the app shell draw it as it does on
 * the sales site (sign-in, account settings, the legal pages, the company workspace…).
 * A visitor's home is the company's landing page; signed in, it is their designs.
 */
export function showroomScreen(route: Route, signedIn: boolean): JSX.Element | undefined {
  if (NOT_ON_SHOWROOM.has(route.name)) return <NotFound />;
  switch (route.name) {
    case 'home':
      return signedIn ? <HomeScreen /> : <ShowroomLanding />;
    case 'welcome':
      return <ShowroomLanding />;
    case 'new':
      return <SetupWizard />;
    case 'local':
      return <ShowroomLocal signedIn={signedIn} />;
    case 'kitchen':
      return <KitchenEditor key={route.id} id={route.id} add={route.add} />;
    case 'product':
      return <ProductPage key={route.id} id={route.id} finish={route.finish} />;
    case 'share':
      return <SharedKitchen key={route.token} token={route.token} />;
    default:
      return undefined;
  }
}
