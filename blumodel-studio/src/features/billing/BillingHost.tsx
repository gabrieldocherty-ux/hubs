import { lazy, Suspense } from 'react';
import { useUnlock } from './entitlements';

const UnlockDialog = lazy(() => import('./UnlockDialog'));

/** Mounted once by the app shell: shows the Unlock dialog when an export asks for it. */
export function BillingHost() {
  const request = useUnlock((s) => s.request);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <UnlockDialog key={`${request.projectId ?? 'local'}:${request.kind}`} request={request} />
    </Suspense>
  );
}
