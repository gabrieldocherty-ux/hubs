import { createElement, lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Package D (generate) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

/** "Start from a photo" (`#/generate`). `q` is accepted for the route contract and ignored. */
export const GenerateScreen: Lazy<{ q?: string; from?: string }> = lazy(() => import('./GenerateScreen'));

export interface PhotoReferenceProps {
  /** An account kitchen's id; null or absent for the kitchen kept on this device. */
  projectId?: string | null;
  /** Device kitchens only: which stored photo set (default: the `#/local` kitchen's). */
  localKey?: string;
}

const PhotoReferencePanel: Lazy<PhotoReferenceProps> = lazy(() => import('./PhotoReference'));

/**
 * The floating "Your photos" viewer for the editor: the photos a kitchen was started from, to
 * compare with the model while redesigning. Renders nothing when the kitchen has none. Safe to
 * mount anywhere: it loads lazily inside its own Suspense (fallback: nothing), so it never
 * suspends the editor around it.
 */
export function PhotoReference(props: PhotoReferenceProps) {
  return createElement(Suspense, { fallback: null }, createElement(PhotoReferencePanel, props));
}
