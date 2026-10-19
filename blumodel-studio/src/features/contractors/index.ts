import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import './editor.css';

/**
 * Package H (contractors) public surface, BUILD_PLAN §13.2. Frozen: add exports, never rename or
 * remove. The workspace is lazy (`#/pro/<rest>`); the hooks and the two small controls below live
 * in the main chunk because the editor's estimate and top bar use them.
 */
type Lazy<P> = LazyExoticComponent<ComponentType<P>>;

export const ContractorRoot: Lazy<{ rest: string }> = lazy(() => import('./ContractorRoot'));

export { usePriceBook, useContractorCatalog, useClientView, useShowCosts, useKitchenPriceOf, setSharedPrices, loadPriceBook } from './pricing';
export { ClientViewToggle, PresentButton } from './ClientViewToggle';

/** From the editor: captures the plan and 3D views for the quote, then opens `#/pro/quote/:projectId`. */
export async function openQuote(projectId: string): Promise<void> {
  const m = await import('./quoteCapture');
  await m.openQuote(projectId);
}
