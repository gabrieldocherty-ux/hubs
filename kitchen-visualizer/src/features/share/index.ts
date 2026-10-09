import { createElement as h, lazy, Suspense, useState, type ComponentType, type LazyExoticComponent } from 'react';
import { useCompact } from '../../components/MobileState';

/**
 * Package E (share) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component. `LandingScreen` and `PricingScreen` live in
 * `src/features/marketing/` (also package E) and are re-exported from here.
 *
 * This file is in the main chunk (the TopBar imports `ShareButton`), so it stays tiny: the share
 * dialog, the shared page and the marketing pages are all lazy.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const LandingScreen: Lazy<{}> = lazy(() => import('../marketing/LandingScreen'));
export const PricingScreen: Lazy<{}> = lazy(() => import('../marketing/PricingScreen'));
export const SharedKitchen: Lazy<{ token: string }> = lazy(() => import('./SharedKitchen'));

const ShareDialog: Lazy<{ projectId: string; onClose: () => void }> = lazy(() => import('./ShareDialog'));

/** The share glyph: a box with an arrow leaving it. Inline so the TopBar needs no new icon. */
const shareIcon = (size: number) =>
  h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M12 3v12' }),
    h('path', { d: 'M7.5 7.5 12 3l4.5 4.5' }),
    h('path', { d: 'M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12' }),
  );

/**
 * TopBar slot: opens the share dialog (view-only links with label, prices on/off, expiry, view
 * counts, copy and revoke). Renders nothing for device-only kitchens, which have no server copy
 * to share.
 */
export function ShareButton({ projectId }: { projectId: string | null }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const compact = useCompact();
  if (!projectId) return null;
  const button = compact
    ? h('button', { type: 'button', className: 'icon-btn share-btn', onClick: () => setOpen(true), 'aria-label': 'Share', title: 'Share a view-only link', 'aria-haspopup': 'dialog' }, shareIcon(20))
    : h('button', { type: 'button', className: 'btn share-btn', onClick: () => setOpen(true), title: 'Share a view-only link', 'aria-haspopup': 'dialog' }, shareIcon(15), 'Share');
  return h(
    'span',
    { className: 'share-slot' },
    button,
    open ? h(Suspense, { fallback: null }, h(ShareDialog, { projectId, onClose: () => setOpen(false) })) : null,
  );
}
