import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package G (billing) public surface, BUILD_PLAN §13.2. Frozen: add exports, never rename or
 * remove. Screens are lazy (default exports); the hooks below are small and live in the main
 * chunk because the editor's Export menu uses them.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const BillingPage: Lazy<{}> = lazy(() => import('./BillingPage'));
/** BUILD_PLAN §13.2 wrote this prop as `ref`, which React reserves (it never reaches the component). */
export const DemoPlanPay: Lazy<{ checkoutRef: string }> = lazy(() => import('./DemoPlanPay'));
export const AdminBillingTab: Lazy<{}> = lazy(() => import('./AdminBillingTab'));

export { useEntitlements, loadEntitlements, type ExportFile, type ExportRunner } from './entitlements';
export { requestExport, useResumeExport } from './exportFlow';
export { BillingHost } from './BillingHost';
