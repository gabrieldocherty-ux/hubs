import { useMemo, useRef, useState, type DragEvent } from 'react';
import { CATEGORIES, isBuiltin, priceFor } from '../data/catalog';
import type { CategoryId, Product } from '../types';
import { useDesignStore } from '../store/useDesignStore';
import { useCatalog } from '../store/useCatalog';
import { ProductArt } from './ProductArt';
import { Info, Plus, Search } from './Icons';
import { money } from '../lib/format';
import { finishList } from '../lib/finish';
import { hrefFor } from '../lib/router';

const ALL = 'all';

/** Brand facets: server (uploaded) brands first, in catalog order, then the built-in demo brands A–Z. */
function brandFacets(list: Product[]): string[] {
  const server: string[] = [];
  const builtin = new Set<string>();
  for (const p of list) {
    if (isBuiltin(p.id)) builtin.add(p.brand);
    else if (!server.includes(p.brand)) server.push(p.brand);
  }
  return [...server, ...[...builtin].filter((b) => !server.includes(b)).sort((a, b) => a.localeCompare(b))];
}

export function CatalogPanel() {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | typeof ALL>(ALL);
  const [brand, setBrand] = useState<string>(ALL);
  const products = useCatalog((s) => s.products);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const addItem = useDesignStore((s) => s.addItem);
  const toast = useDesignStore((s) => s.toast);
  const searchRef = useRef<HTMLInputElement>(null);

  const inCategory = useMemo(() => products.filter((p) => cat === ALL || p.category === cat), [products, cat]);
  const brands = useMemo(() => brandFacets(inCategory), [inCategory]);
  const activeBrand = brand !== ALL && brands.includes(brand) ? brand : ALL;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inCategory.filter(
      (p) =>
        (activeBrand === ALL || p.brand === activeBrand) &&
        (!q || `${p.name} ${p.brand} ${p.sku ?? ''} ${p.code} ${p.kind} ${p.blurb}`.toLowerCase().includes(q)),
    );
  }, [inCategory, activeBrand, query]);

  const grouped = useMemo(() => {
    if (cat !== ALL || query || activeBrand !== ALL) return [{ id: 'results', label: '', items: results }];
    const known = new Set<string>(CATEGORIES.map((c) => c.id));
    const groups = CATEGORIES.map((c) => ({ id: c.id as string, label: c.label, items: results.filter((p) => p.category === c.id) }));
    const other = results.filter((p) => !known.has(p.category));
    return other.length ? [...groups, { id: 'other', label: 'Other', items: other }] : groups;
  }, [results, cat, query, activeBrand]);

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
          aria-label="Search products"
        />
        <kbd>/</kbd>
      </div>
      <div className="chips" role="tablist" aria-label="Categories">
        <button role="tab" aria-selected={cat === ALL} className={cat === ALL ? 'chip on' : 'chip'} onClick={() => setCat(ALL)}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'chip on' : 'chip'} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {brands.length > 1 && (
        <div className="chips chips--brands" role="group" aria-label="Brands">
          <button aria-pressed={activeBrand === ALL} className={activeBrand === ALL ? 'chip on' : 'chip'} onClick={() => setBrand(ALL)}>
            All brands
          </button>
          {brands.map((b) => (
            <button key={b} aria-pressed={activeBrand === b} className={activeBrand === b ? 'chip on' : 'chip'} onClick={() => setBrand(b)}>
              {b}
            </button>
          ))}
        </div>
      )}
      <div className="catalog-scroll">
        {results.length === 0 && <p className="empty-note">Nothing matches{query ? ` “${query}”` : ''}. Try “range”, “brass” or “island”.</p>}
        {grouped.map((g) =>
          g.items.length ? (
            <section key={g.id} className="catalog-group">
              {g.label && <h4>{g.label}</h4>}
              <div className="catalog-grid">
                {g.items.map((p) => {
                  const finishes = finishList(p);
                  const from = p.widthOptions?.length ? Math.min(...p.widthOptions.map((w) => priceFor(p, w))) : p.price;
                  const custom = p.source === 'custom';
                  return (
                    <div key={p.id} className="product-card-wrap">
                      <button
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
                          {(p.model || custom) && (
                            <span className="product-badges">
                              {p.model && <span className="product-badge">3D model</span>}
                              {custom && <span className="product-badge mine">Your model</span>}
                            </span>
                          )}
                        </span>
                        <span className="product-name">{p.name}</span>
                        <span className="product-meta">
                          <span>{p.brand}</span>
                          <span className="mono">{p.widthOptions?.length ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″` : `${p.widthIn}″`}</span>
                        </span>
                        <span className="product-foot">
                          <span className="dots">
                            {finishes.slice(0, 4).map((f) => (
                              <i key={f.id} style={{ background: f.material === 'panel' ? 'repeating-linear-gradient(45deg,#cfc8bb 0 3px,#fff 3px 5px)' : f.hex }} title={f.name} />
                            ))}
                            {finishes.length > 4 && <em>+{finishes.length - 4}</em>}
                          </span>
                          <span className="price">{money(from)}{p.widthOptions?.length ? '+' : ''}</span>
                        </span>
                      </button>
                      <a className="product-info" href={hrefFor({ name: 'product', id: p.id })} aria-label={`About ${p.name}`} title="Product details">
                        <Info width={13} height={13} />
                      </a>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
        <p className="catalog-foot">
          Can’t find it? <a href={hrefFor({ name: 'orders', rest: 'new' })}>Request a custom model</a>
        </p>
      </div>
    </div>
  );
}
