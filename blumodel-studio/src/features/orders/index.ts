import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package C (orders) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const OrdersRoot: Lazy<{ rest: string }> = lazy(() => import('./OrdersRoot'));
export const DemoPay: Lazy<{ orderId: string }> = lazy(() => import('./DemoPay'));
export const AdminStudioTab: Lazy<{}> = lazy(() => import('./AdminStudioTab'));
export const AdminRevenueTab: Lazy<{}> = lazy(() => import('./AdminRevenueTab'));
