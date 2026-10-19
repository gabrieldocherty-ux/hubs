import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { LegalDocId } from '../../lib/router';

/** The Terms, Privacy and Refund pages (lazy) and the footer links every public page carries (tiny). */
export const LegalScreen: LazyExoticComponent<ComponentType<{ doc: LegalDocId }>> = lazy(() => import('./LegalScreen'));
export { LegalLinks, LegalUnsetBadge } from './LegalLinks';
