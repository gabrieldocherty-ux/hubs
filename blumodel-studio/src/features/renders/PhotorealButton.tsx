import { lazy, Suspense, useEffect, useState, type SVGProps } from 'react';
import { create } from 'zustand';
import { useCompact, useMedia } from '../../components/MobileState';
import { useRoute } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import { useShowroom } from '../showroom';
import { showButton, showroomRole } from './model';
import { rendersApi } from './api';

export { showroomRole };

/**
 * The editor's "Make it photoreal" button (docs/SHOWROOM_PIVOT.md §5, §7). In the main chunk, so it
 * imports no three and nothing heavy: the dialog loads on first open.
 *
 * Shown only on a company's showroom, to someone signed in there: the team always (their own
 * designs, and a lead's design opened from its share link), a visitor only when the company
 * switched visitor renders on. Never on the sales site, a local draft or a signed-out page.
 */
const PhotorealDialog = lazy(() => import('./PhotorealDialog'));

interface PhotorealState {
  open: boolean;
}
export const usePhotoreal = create<PhotorealState>()(() => ({ open: false }));
export const openPhotoreal = () => usePhotoreal.setState({ open: true });
export const closePhotoreal = () => usePhotoreal.setState({ open: false });

function SparkleIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z" />
      <path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}

/** Free renders left on this account (one status call per signed-in account and page; 0 until known). */
const freeCache = new Map<string, Promise<number>>();
function useFreeLeft(userId: string | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!userId) return setLeft(0);
    let live = true;
    let p = freeCache.get(userId);
    if (!p) {
      p = rendersApi
        .status()
        .then((s) => s.free?.left ?? 0)
        .catch(() => 0);
      freeCache.set(userId, p);
    }
    void p.then((n) => live && setLeft(n));
    return () => {
      live = false;
    };
  }, [userId]);
  return left;
}
/** After a render, the next status call is fresh (the free count may have changed). */
export const forgetFreeLeft = () => freeCache.clear();

export function PhotorealButton(): JSX.Element | null {
  const tenant = useShowroom();
  const user = useSession((s) => s.user);
  const projectId = useSession((s) => s.projectId);
  const readOnly = useDesignStore((s) => s.readOnly);
  const route = useRoute();
  const open = usePhotoreal((s) => s.open);
  const compact = useCompact();
  const iconOnly = useMedia('(max-width: 1199px)') || compact;
  useEffect(() => () => closePhotoreal(), []);

  const team = !!showroomRole(user);
  const shareToken = readOnly && route.name === 'share' ? route.token : null;
  const hasDesign = readOnly ? team && !!shareToken : !!projectId;
  // A visitor on a showroom without visitor renders: ask once whether their account has free ones left.
  const ask = !!tenant && !!user && !team && hasDesign && !tenant.features.visitorRenders;
  const freeLeft = useFreeLeft(ask ? (user?.id ?? null) : null);
  if (!showButton({ onShowroom: !!tenant, signedIn: !!user, team, visitorRenders: !!tenant?.features.visitorRenders, hasDesign, freeLeft })) return null;

  return (
    <>
      <button
        type="button"
        className={iconOnly ? 'icon-btn photoreal-btn' : 'btn photoreal-btn'}
        // Inline: this button is in the main chunk, where the renders stylesheet isn't loaded yet.
        style={{ whiteSpace: 'nowrap' }}
        onClick={openPhotoreal}
        aria-haspopup="dialog"
        aria-label="Make it photoreal"
        title="Make it photoreal: an AI rendering of this view"
      >
        <SparkleIcon width={compact ? 20 : 16} height={compact ? 20 : 16} />
        {!iconOnly && <span>Make it photoreal</span>}
      </button>
      {open && (
        <Suspense fallback={null}>
          <PhotorealDialog projectId={readOnly ? null : projectId} shareToken={shareToken} team={team} />
        </Suspense>
      )}
    </>
  );
}
