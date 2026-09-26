import { useMemo, useRef, useState, type DragEvent } from 'react';
import { CATALOG, CATEGORIES, priceFor } from '../data/catalog';
import type { CategoryId } from '../types';
import { useDesignStore } from '../store/useDesignStore';
import { ProductArt } from './ProductArt';
import { Plus, Search } from './Icons';
import { money } from '../lib/format';
import { finishList } from '../lib/finish';

export function CatalogPanel() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const addItem = useDesignStore((s) => s.addItem);
  const toast = useDesignStore((s) => s.toast);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter((p) => (cat === 'all' || p.category === cat) && (!q || `${p.name} ${p.brand} ${p.code} ${p.kind} ${p.blurb}`.toLowerCase().includes(q)));
  }, [query, cat]);

  const grouped = useMemo(() => {
    if (cat !== 'all' || query) return [{ id: 'results', label: '', items: results }];
    return CATEGORIES.map((c) => ({ id: c.id, label: c.label, items: results.filter((p) => p.category === c.id) }));
  }, [results, cat, query]);

  const onDragStart = (e: DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData('application/x-kitchen-product', id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="catalog">
      <div className="catalog-search">
        <Search />
        <input
          ref={searchRef}
          id="catalog-search"
          placeholder="Search ranges, sinks, pendants…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), searchRef.current?.blur())}
        />
        <kbd>/</kbd>
      </div>
      <div className="chips" role="tablist" aria-label="Categories">
        <button role="tab" aria-selected={cat === 'all'} className={cat === 'all' ? 'chip on' : 'chip'} onClick={() => setCat('all')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'chip on' : 'chip'} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="catalog-scroll">
        {results.length === 0 && <p className="empty-note">Nothing matches “{query}”. Try “range”, “brass” or “island”.</p>}
        {grouped.map((g) =>
          g.items.length ? (
            <section key={g.id} className="catalog-group">
              {g.label && <h4>{g.label}</h4>}
              <div className="catalog-grid">
                {g.items.map((p) => {
                  const finishes = finishList(p);
                  const from = p.widthOptions ? Math.min(...p.widthOptions.map((w) => priceFor(p, w))) : p.price;
                  return (
                    <button
                      key={p.id}
                      className="product-card"
                      draggable
                      onDragStart={(e) => onDragStart(e, p.id)}
                      onClick={() => {
                        addItem(p.id);
                        toast(`Added ${p.name}. Drag it into place on the plan.`, 'ok');
                      }}
                      title={`${p.brand} ${p.name}: ${p.blurb}`}
                    >
                      <span className="product-art">
                        <ProductArt product={p} surfaces={surfaces} />
                        <span className="product-add"><Plus width={12} height={12} /></span>
                      </span>
                      <span className="product-name">{p.name}</span>
                      <span className="product-meta">
                        <span>{p.brand}</span>
                        <span className="mono">{p.widthOptions ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″` : `${p.widthIn}″`}</span>
                      </span>
                      <span className="product-foot">
                        <span className="dots">
                          {finishes.slice(0, 4).map((f) => (
                            <i key={f.id} style={{ background: f.material === 'panel' ? 'repeating-linear-gradient(45deg,#cfc8bb 0 3px,#fff 3px 5px)' : f.hex }} title={f.name} />
                          ))}
                          {finishes.length > 4 && <em>+{finishes.length - 4}</em>}
                        </span>
                        <span className="price">{money(from)}{p.widthOptions ? '+' : ''}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </div>
  );
}
