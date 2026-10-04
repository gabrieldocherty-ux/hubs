import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package B (brands) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const BrandPortal: Lazy<{ rest: string }> = lazy(() => import('./BrandPortal'));
export const BrandPage: Lazy<{ slug: string }> = lazy(() => import('./BrandPage'));
export const AdminModerationTab: Lazy<{}> = lazy(() => import('./AdminModerationTab'));
export const AdminBrandsTab: Lazy<{}> = lazy(() => import('./AdminBrandsTab'));
