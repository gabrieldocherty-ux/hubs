import { useEffect, useMemo, useState } from 'react';
import { ProductArt } from '../../components/ProductArt';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { productCode } from '../../data/catalog';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { useDesignStore } from '../../store/useDesignStore';
import type { Product } from '../../types';
import { proApi } from './api';
import { useWorkspace } from './ContractorRoot';
import { loadPriceBook, usePriceBook } from './pricing';

/** `#/pro/catalog`: the contractor's own products, grouped by line (PLANS_AND_CONTRACTORS §4.2). */
export default function MyCatalog() {
  const { readOnly } = useWorkspace();
  const { data, priceOf } = usePriceBook();
  const [archived, setArchived] = useState(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [limit, setLimit] = useState(500);
  const [error, setError] = useState<string | null>(null);
  const toast = useDesignStore((s) => s.toast);

  const load = async (withArchived = archived) => {
    try {
      const r = await proApi.products(withArchived);
      setProducts(r.products);
      setLimit(r.limit);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your catalog.');
    }
  };

  useEffect(() => {
    void load(archived);
    void loadPriceBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived]);

  const lines = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products ?? []) m.set(p.line || '', [...(m.get(p.line || '') ?? []), p]);
    return [...m].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [products]);

  const setStatus = async (p: Product, archive: boolean) => {
    try {
      await (archive ? proApi.archiveProduct(p.id) : proApi.restoreProduct(p.id));
      toast(archive ? `Archived ${p.name}. Kitchens that use it keep it.` : `${p.name} is back in your catalog.`, 'ok');
      await load();
      // The editor's catalog panel should drop (or regain) it too.
      void useCatalog.getState().load(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'warn');
    }
  };

  const active = (products ?? []).filter((p) => p.status !== 'archived').length;

  return (
    <div className="pro-catalog">
      <div className="pro-head">
        <div>
          <span className="eyebrow">My catalog · private to you</span>
          <h1>The products you sell</h1>
          <p className="muted">They appear first in your catalog panel while you design, drawn at true size in the plan, the walls and 3D. Only you see them; clients see them in the kitchens you share.</p>
        </div>
        <div className="pro-head-actions">
          <label className="pro-check">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
          </label>
          {!readOnly && (
            <a className="btn primary" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
              Add a product
            </a>
          )}
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!products && !error && <div className="screen-msg">Loading your catalog…</div>}
      {products && products.length === 0 && (
        <div className="pro-empty">
          <h2>Nothing here yet</h2>
          <p>Quick add a product: pick its type, the widths you sell, its door style and finishes. Mise draws it at true size, so most cabinet lines look right without any 3D modelling.</p>
          {!readOnly && (
            <a className="btn primary big" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
              Quick add your first product
            </a>
          )}
        </div>
      )}
      {lines.map(([line, items]) => (
        <section key={line || 'none'} className="pro-line" aria-label={line || 'Not in a line'}>
          <h2>
            {line || 'Not in a line'} <span>{items.length} piece{items.length === 1 ? '' : 's'}</span>
          </h2>
          <div className="pro-products">
            {items.map((p) => {
              const row = data?.rows[p.id];
              const costed = !!(row && (row.costCents !== null || (row.costByWidth && Object.keys(row.costByWidth).length)));
              const sell = priceOf(p, p.widthIn).sell;
              return (
                <article key={p.id} className={`pro-product${p.status === 'archived' ? ' is-archived' : ''}`}>
                  <a className="pro-product-art" href={hrefFor({ name: 'pro', rest: `catalog/${p.id}` })} aria-label={`Edit ${p.name}`}>
                    {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" /> : <ProductArt product={p} surfaces={DEFAULT_SURFACES} />}
                  </a>
                  <div className="pro-product-body">
                    <a className="pro-product-name" href={hrefFor({ name: 'pro', rest: `catalog/${p.id}` })}>
                      {p.name}
                    </a>
                    <span className="muted mono">
                      {(p.sku || p.code) ? productCode(p, p.widthIn) : '—'} · {p.widthOptions?.length ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″` : `${p.widthIn}″`}
                    </span>
                    {p.doorStyle && <span className="muted">{p.doorStyle[0].toUpperCase() + p.doorStyle.slice(1)} doors</span>}
                    <span className="pro-product-foot">
                      {p.status === 'archived' ? (
                        <span className="tag">Archived</span>
                      ) : costed ? (
                        <span className="tag ok">Sells at {money(sell)}</span>
                      ) : (
                        <span className="tag warn">No cost entered</span>
                      )}
                      {p.model && <span className="tag">3D model</span>}
                    </span>
                  </div>
                  {!readOnly && (
                    <div className="pro-product-actions">
                      <a className="btn" href={hrefFor({ name: 'pro', rest: `catalog/${p.id}` })}>
                        Edit
                      </a>
                      {p.status === 'archived' ? (
                        <button className="btn" onClick={() => setStatus(p, false)}>
                          Restore
                        </button>
                      ) : (
                        <button className="btn" onClick={() => setStatus(p, true)}>
                          Archive
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {products && products.length > 0 && <p className="fine">{active} of {limit} products.</p>}
    </div>
  );
}
