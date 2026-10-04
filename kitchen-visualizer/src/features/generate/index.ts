import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package D (generate) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const GenerateScreen: Lazy<{ q?: string; from?: string }> = lazy(() => import('./GenerateScreen'));
