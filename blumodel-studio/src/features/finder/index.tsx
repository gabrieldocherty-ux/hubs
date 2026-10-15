import { lazy, Suspense } from 'react';
import { useRoute } from '../../lib/router';
import { useSession } from '../../store/useSession';
import type { ContractorFinderProps } from './ContractorFinder';

/**
 * Package 'finder' (choose your contractor): a quiet "Need a contractor?" link near the end of
 * the journey and the `#/contractors` directory. Both read GET /api/contractors (server/routes/
 * finder.mjs): live, verified contractor brand pages, public fields only.
 *
 * `ContractorFinder` goes in three places, one element each: the bottom of the editor's
 * Overview / Estimate panel (`where="summary"`), the toast stack, where it appears for a while
 * after a successful export (`where="export"`), and the shared-kitchen page (`where="share"`).
 * It renders nothing until it knows there is a contractor to show, so it needs no wrapper.
 */
const LazyFinder = lazy(() => import('./ContractorFinder'));

/**
 * The link's own Suspense boundary (fallback: nothing). Without it, loading the finder's chunk
 * would suspend the nearest boundary up the tree: the route's, which would swap the whole editor
 * for "Loading…" for a moment. Hidden, or for a contractor, the chunk isn't even fetched.
 */
export function ContractorFinder(props: ContractorFinderProps) {
  // Contractors (on the plan, or with a company whose plan lapsed) aren't offered other contractors.
  const isContractor = useSession((s) => s.user?.plan?.id === 'contractor' || !!s.user?.contractor);
  // After an export: only in the editor (the toast stack also sits on brand, product and quote pages).
  const route = useRoute();
  const exportOutsideEditor = props.where === 'export' && route.name !== 'kitchen' && route.name !== 'local';
  if (props.hidden || isContractor || exportOutsideEditor) return null;
  return (
    <Suspense fallback={null}>
      <LazyFinder {...props} />
    </Suspense>
  );
}

/** `#/contractors?near=&kitchen=`: the directory (a routed screen; the route's Suspense covers it). */
export const ContractorsPage = lazy(() => import('./ContractorsPage'));
export type { ContractorFinderProps, FinderPlace } from './ContractorFinder';
