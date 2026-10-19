import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * The company workspace (`#/studio/<rest>` on a showroom, docs/SHOWROOM_PIVOT.md §5): Showroom,
 * Products, Leads, Renders, Team and Plan. Lazy, so a visitor's showroom never loads it.
 * Add exports, never rename or remove.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const WorkspaceRoot: Lazy<{ rest: string }> = lazy(() => import('./WorkspaceRoot'));
