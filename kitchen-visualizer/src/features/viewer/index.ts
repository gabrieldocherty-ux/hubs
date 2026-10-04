import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Product } from '../../types';

/**
 * Package A (viewer) public surface, BUILD_PLAN §3.8. Frozen: add exports, never rename or remove.
 * Lazy modules default-export their component. Nothing here may statically import three or drei.
 */
export interface ProductStageProps {
  product: Product;
  finishId?: string;
  autoRotate?: boolean;
  showDims?: boolean;
  height?: number | string;
  onReady?: () => void;
}

export const ProductPage: LazyExoticComponent<ComponentType<{ id: string; finish?: string }>> = lazy(() => import('./ProductPage'));
export const ProductStage: LazyExoticComponent<ComponentType<ProductStageProps>> = lazy(() => import('./ProductStage'));

/** TopBar slot for the studio render dialog. Placeholder: renders nothing until package A lands. */
export function RenderButton(): JSX.Element | null {
  return null;
}
