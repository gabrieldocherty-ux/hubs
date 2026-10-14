import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Product } from '../../types';

/**
 * Package B (brands) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component.
 *
 * Since B2 (BRAND_PAGE.md) the brand page lives inside the Contractor workspace: `BrandPortal`
 * only redirects `#/brand*` to `#/pro/brand*`, and the tab itself is `ProBrandTab`.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const BrandPortal: Lazy<{ rest: string }> = lazy(() => import('./BrandPortal'));
export const BrandPage: Lazy<{ slug: string }> = lazy(() => import('./BrandPage'));
export const AdminModerationTab: Lazy<{}> = lazy(() => import('./AdminModerationTab'));
export const AdminBrandsTab: Lazy<{}> = lazy(() => import('./AdminBrandsTab'));

// ── B2 additions ──────────────────────────────────────────────────────────

/** The Contractor workspace's Brand page tab; `rest` is the workspace sub-path ("brand/leads"). */
export const ProBrandTab: Lazy<{ rest: string }> = lazy(() => import('./ProBrandTab'));
/** The Brand page card for the workspace Dashboard. */
export const BrandDashboardCard: Lazy<{}> = lazy(() => import('./DashboardCard'));
/**
 * "Request a quote" for the product page (`#/p/:id`): renders nothing unless the product belongs
 * to a live contractor brand that takes requests. Wrap it in `<Suspense fallback={null}>`.
 */
export const QuoteButton: Lazy<{ product: Product; className?: string }> = lazy(() => import('./QuoteButton'));
