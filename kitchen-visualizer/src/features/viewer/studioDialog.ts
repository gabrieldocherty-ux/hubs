import { create } from 'zustand';

/**
 * Whether the Studio render dialog is open. Kept apart from studio.ts so the TopBar's
 * RenderButton (main chunk) carries only this.
 */
interface StudioDialogState {
  open: boolean;
  /** Download as soon as a render is ready (the resume after paying for an unlock). */
  autoDownload: boolean;
}

export const useStudio = create<StudioDialogState>()(() => ({ open: false, autoDownload: false }));

/** Opens the Studio render dialog (from the TopBar, or after an unlock to finish the download). */
export function openStudioRender(opts: { autoDownload?: boolean } = {}) {
  useStudio.setState({ open: true, autoDownload: !!opts.autoDownload });
}

export function closeStudioRender() {
  useStudio.setState({ open: false, autoDownload: false });
}
