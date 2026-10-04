import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package E (share) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component. `LandingScreen` and `PricingScreen` live in
 * `src/features/marketing/` (also package E) and are re-exported from here.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const LandingScreen: Lazy<{}> = lazy(() => import('../marketing/LandingScreen'));
export const PricingScreen: Lazy<{}> = lazy(() => import('../marketing/PricingScreen'));
export const SharedKitchen: Lazy<{ token: string }> = lazy(() => import('./SharedKitchen'));

/** TopBar slot for the share dialog; null in device-only mode. Placeholder: renders nothing until package E lands. */
export function ShareButton(_p: { projectId: string | null }): JSX.Element | null {
  return null;
}
