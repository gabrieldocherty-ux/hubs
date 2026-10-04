import { useEffect } from 'react';
import type { ProductStageProps } from './index';
import { ProductArt } from '../../components/ProductArt';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { finishList } from '../../lib/finish';
import './viewer.css';

/**
 * Placeholder until package A lands: the product drawn flat (or its thumbnail) instead of the
 * interactive 3D stage. Other packages embed `ProductStage`, so it has to look acceptable.
 */
export default function ProductStage({ product, finishId, height = 360, onReady }: ProductStageProps) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  const finish = finishId ? finishList(product).find((f) => f.id === finishId) : undefined;
  return (
    <div
      className="product-stage product-stage--placeholder"
      style={{
        height,
        display: 'grid',
        gridTemplateRows: 'minmax(0, 1fr) auto',
        gap: 8,
        padding: 16,
        borderRadius: 12,
        background: 'var(--paper)',
        border: '1px solid var(--line)',
      }}
    >
      <div style={{ minHeight: 0, display: 'grid', placeItems: 'center' }}>
        <ProductArt product={product} finish={finish} surfaces={DEFAULT_SURFACES} className="product-stage-art" />
      </div>
      <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>3D preview coming soon</span>
    </div>
  );
}
