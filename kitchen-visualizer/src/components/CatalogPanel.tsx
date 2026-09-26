import type { DragEvent } from 'react';
import { CATALOG, CATEGORY_LABELS } from '../data/catalog';
import type { Category } from '../types';

const CATEGORIES: Category[] = ['cabinet', 'appliance', 'countertop', 'flooring', 'fixture'];

export function CatalogPanel() {
  function onDragStart(e: DragEvent<HTMLDivElement>, catalogId: string) {
    e.dataTransfer.setData('text/plain', catalogId);
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <aside className="catalog-panel">
      <h2>Catalog</h2>
      <p className="hint">Drag an item onto the floor plan.</p>
      {CATEGORIES.map((category) => (
        <div key={category} className="catalog-category">
          <h3>{CATEGORY_LABELS[category]}</h3>
          <div className="catalog-items">
            {CATALOG.filter((item) => item.category === category).map((item) => (
              <div
                key={item.id}
                className="catalog-item"
                draggable
                onDragStart={(e) => onDragStart(e, item.id)}
              >
                <span className="swatch" style={{ background: item.finishes[0].hex }} />
                <div className="catalog-item-text">
                  <div className="catalog-item-name">{item.name}</div>
                  <div className="catalog-item-meta">
                    {item.brand} · {item.widthIn}"×{item.depthIn}"
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
