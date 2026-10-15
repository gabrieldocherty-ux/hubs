import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ContractorFinderProps } from './ContractorFinder';

/**
 * Package 'finder' (choose your contractor): a quiet "Need a contractor?" link near the end of
 * the journey and the `#/contractors` directory. Both read GET /api/contractors (server/routes/
 * finder.mjs): live, verified contractor brand pages, public fields only.
 *
 * `ContractorFinder` goes in three places, one element each: the bottom of the editor's
 * Overview / Estimate panel (`where="summary"`), the toast stack, where it appears for a while
 * after a successful export (`where="export"`), and the shared-kitchen page's footer
 * (`where="share"`). It is lazy and renders nothing until it knows there is a contractor to show,
 * so no wrapper or fallback is needed.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const ContractorFinder: Lazy<ContractorFinderProps> = lazy(() => import('./ContractorFinder'));
export const ContractorsPage: Lazy<{ near?: string; kitchen?: string }> = lazy(() => import('./ContractorsPage'));
export type { ContractorFinderProps, FinderPlace } from './ContractorFinder';
