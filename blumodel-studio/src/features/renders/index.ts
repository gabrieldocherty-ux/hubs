import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package 'renders' (docs/SHOWROOM_PIVOT.md §5, §7; docs/handoff/renders.md): photoreal AI
 * renderings on a company's showroom.
 *
 *  - `PhotorealButton`: the editor's "Make it photoreal" (TopBar slot, main chunk, no three). It
 *    shows itself only on a showroom, to the team, and to visitors when the company switched
 *    visitor renders on; its dialog is lazy.
 *  - `RendersPage`: the company workspace's Renders page (lazy, default-exported module): balance,
 *    cost, expiry, this month's use, every render, the credits ledger. Fetches its own data.
 *  - `openPhotoreal()`: opens the dialog from elsewhere.
 */
export const RendersPage: LazyExoticComponent<ComponentType<{}>> = lazy(() => import('./RendersPage'));
export { PhotorealButton, openPhotoreal, closePhotoreal, showroomRole } from './PhotorealButton';
export type { RenderWire, RendersStatus, WorkspaceRenders, WorkspaceCredits } from './api';
