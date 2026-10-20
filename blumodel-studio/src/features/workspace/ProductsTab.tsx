import { ProductThumb } from '../../components/thumbs/ProductThumb';
import { lazy, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { CATEGORIES } from '../../data/catalog';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import type { Product } from '../../types';
import { wsApi, type PricingWire } from './api';
import { useWorkspace } from './context';
import { parseDollars } from './pricing';

const ProductForm = lazy(() => import('./ProductForm'));
const Requests = lazy(() => import('./Requests'));

const studio = (rest: string) => hrefFor({ name: 'studio', rest });

/**
 * The Products tab: the showroom's catalog (products we modelled for the company and the ones its
 * team quick-added), with the prices visitors see, hide/show, the default markup, and "Request more
 * products" for anything we should model next (`#/studio/products/requests`).
 */
export default function ProductsTab({ sub }: { sub: string }) {
  const [first, second] = sub.split('/');
  if (first === 'requests') return <Requests sub={second ?? ''} />;
  if (first === 'new') return <ProductForm key="new" id={null} />;
  if (first) return <ProductForm key={first} id={first} />;
  return <Catalog />;
}

type Filter = 'all' | 'live' | 'hidden';

function Catalog() {
  const { tenant } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [pricing, setPricing] = useState<PricingWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [p, pr] = await Promise.all([wsApi.products(), wsApi.pricing()]);
      setProducts(p.products);
      setPricing(pr);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your products.');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      if (filter === 'live' && p.status === 'archived') return false;
      if (filter === 'hidden' && p.status !== 'archived') return false;
      if (needle && !`${p.name} ${p.line ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [products, filter, q]);

  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of shown) m.set(p.line || '', [...(m.get(p.line || '') ?? []), p]);
    return [...m].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'en')));
  }, [shown]);

  const live = (products ?? []).filter((p) => p.status !== 'archived').length;
  const hidden = (products ?? []).length - live;

  const toggle = async (p: Product) => {
    setBusy(p.id);
    try {
      const r = p.status === 'archived' ? await wsApi.showProduct(p.id) : await wsApi.hideProduct(p.id);
      setProducts((cur) => (cur ?? []).map((x) => (x.id === p.id ? r.product : x)));
      toast(p.status === 'archived' ? `${p.name} is on your showroom again.` : `${p.name} is hidden from visitors. Designs that use it keep it.`, 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ws-products">
      <div className="ws-head">
        <div>
          <span className="eyebrow">Products</span>
          <h1>Your catalog</h1>
          <p>
            What visitors design with on your showroom{tenant.settings.fillGaps ? ', with BluModel Basics filling the gaps' : ''}. Products we model for you arrive here; you can quick-add simple ones yourself, set your prices and hide anything you
            don’t sell any more.
          </p>
        </div>
        <div className="ws-actions">
          <a className="btn" href={studio('products/requests')}>
            Request more products
          </a>
          <a className="btn primary" href={studio('products/new')}>
            Quick add a product
          </a>
        </div>
      </div>

      <div className="ws-stats">
        <div className="ws-stat">
          <b>{products ? live : '—'}</b>
          <span>on your showroom</span>
        </div>
        <div className="ws-stat">
          <b>{products ? hidden : '—'}</b>
          <span>hidden</span>
        </div>
        {pricing && <DefaultMarkup pricing={pricing} onSaved={setPricing} />}
      </div>

      {error && <div className="ws-error">{error}</div>}
      {!products && !error && <div className="screen-msg">Loading your products…</div>}
      {products && products.length === 0 && (
        <div className="ws-empty">
          <b>No products yet</b>
          <p>We model your starting range as part of your setup; it appears here as each product is ready. Meanwhile you can quick-add a product from its sizes and finishes, or send us a list of what to model.</p>
          <div className="ws-actions">
            <a className="btn primary" href={studio('products/new')}>
              Quick add a product
            </a>
            <a className="btn" href={studio('products/requests/new')}>
              Request products
            </a>
          </div>
        </div>
      )}
      {products && products.length > 0 && (
        <div className="ws-filters">
          <div className="chips" role="group" aria-label="Show">
            {(
              [
                ['all', `All (${products.length})`],
                ['live', `On the showroom (${live})`],
                ['hidden', `Hidden (${hidden})`],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" className={filter === k ? 'chip on' : 'chip'} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <input className="ws-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, line or SKU" aria-label="Search products" />
        </div>
      )}
      {products && products.length > 0 && shown.length === 0 && <p className="muted">No products match.</p>}

      {groups.map(([line, items]) => (
        <section key={line || 'none'} className="ws-line" aria-label={line || 'Not in a line'}>
          <h2>
            {line || 'Not in a line'} <span>{items.length}</span>
          </h2>
          <div className="ws-product-grid">
            {items.map((p) => {
              const row = pricing?.rows[p.id];
              const hasCost = !!row && (row.costCents !== null || !!(row.costByWidth && Object.keys(row.costByWidth).length));
              const cat = CATEGORIES.find((c) => c.id === p.category)?.label ?? p.category;
              return (
                <article key={p.id} className={`ws-product${p.status === 'archived' ? ' is-hidden' : ''}`}>
                  <a className="ws-product-art" href={studio(`products/${p.id}`)} aria-label={`Edit ${p.name}`}>
                    <ProductThumb product={p} surfaces={DEFAULT_SURFACES} />
                  </a>
                  <div className="ws-product-body">
                    <a className="ws-product-name" href={studio(`products/${p.id}`)}>
                      {p.name}
                    </a>
                    <span className="muted">
                      {cat} · {p.widthOptions?.length ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″` : `${p.widthIn}″`} W
                    </span>
                    <span className="ws-product-tags">
                      {p.status === 'archived' ? <span className="ws-pill">Hidden</span> : p.status === 'published' ? <span className="ws-pill ok">On the showroom</span> : <span className="ws-pill warn">Draft</span>}
                      <span className="ws-pill">{p.price > 0 ? money(p.price) : 'No price'}</span>
                      {hasCost && <span className="ws-pill info">Cost entered</span>}
                      {p.model && <span className="ws-pill">3D model</span>}
                    </span>
                  </div>
                  <div className="ws-product-actions">
                    <a className="btn" href={studio(`products/${p.id}`)}>
                      Edit
                    </a>
                    <button type="button" className="btn" onClick={() => void toggle(p)} disabled={busy === p.id}>
                      {p.status === 'archived' ? 'Show' : 'Hide'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function DefaultMarkup({ pricing, onSaved }: { pricing: PricingWire; onSaved: (p: PricingWire) => void }) {
  const toast = useDesignStore((s) => s.toast);
  const [text, setText] = useState(String(pricing.defaultMarkupPct));
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(String(pricing.defaultMarkupPct)), [pricing.defaultMarkupPct]);
  const n = parseDollars(text);
  const valid = n !== null && !Number.isNaN(n) && n <= 1000;
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      onSaved(await wsApi.setDefaultMarkup(n));
      toast(`Default markup is ${n}%. It applies when you work a price out from your cost.`, 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t save.', 'warn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="ws-stat ws-markup"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="ws-default-markup">Default markup</label>
      <div className="ws-markup-row">
        <input id="ws-default-markup" value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-invalid={!valid} />
        <span>%</span>
        <button type="submit" className="btn" disabled={busy || !valid || n === pricing.defaultMarkupPct}>
          Save
        </button>
      </div>
      <span>Used when a product has a cost and no markup of its own. Costs stay private to your team.</span>
    </form>
  );
}
