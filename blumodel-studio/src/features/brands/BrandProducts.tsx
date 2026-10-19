import { useEffect, useState } from 'react';
import { ProductArt } from '../../components/ProductArt';
import { Alert, Check } from '../../components/Icons';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { brandApi, type BrandProducts as Data, type PageStatus, type ProductEntry } from './api';
import { useBrandTab } from './context';
import { groupByLine, listingStatus, PRICE_DISPLAY_LABEL, subHref } from './logic';
import { PublishSwitch } from './PublishSwitch';

/**
 * `#/pro/brand/products` (BRAND_PAGE §4): the contractor's My-catalog products by line, each with
 * its readiness checklist and a "Show on my brand page" switch, plus "Publish whole line".
 */
export default function BrandProducts() {
  const { state, readOnly, reload } = useBrandTab();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const toast = useDesignStore((s) => s.toast);

  const load = async () => {
    try {
      setData(await brandApi.products());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your products.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const replace = (entry: ProductEntry, liveCount: number) => setData((d) => (d ? { ...d, liveCount, products: d.products.map((p) => (p.id === entry.id ? entry : p)) } : d));

  const publishLine = async (line: string) => {
    setBusyLine(line);
    try {
      const r = await brandApi.publishLine(line);
      const sent = r.published.length;
      const skipped = r.skipped.length;
      toast(
        sent
          ? `${sent} product${sent === 1 ? '' : 's'} from ${line} sent to your page${skipped ? `; ${skipped} not ready yet` : ''}.`
          : `Nothing from ${line} could be published yet: ${r.skipped[0]?.reason ?? 'not ready'}`,
        sent ? 'ok' : 'warn',
      );
      await load();
      void reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'warn');
    } finally {
      setBusyLine(null);
    }
  };

  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading your products…</div>;

  const pageStatus = data.brand?.pageStatus ?? 'none';
  const groups = groupByLine(data.products, 'Not in a line');
  const display = data.brand?.priceDisplay ?? 'from';

  return (
    <div className="brand-products">
      <div className="brand-toolbar">
        <p className="muted brand-intro">
          <b className="mono">{data.liveCount}</b> of {data.limit} products on your page. Only your own My-catalog products can be published, and only what the public may see goes with them:
          never your cost or markup. Prices show as <b>{PRICE_DISPLAY_LABEL[display]}</b> (<a href={subHref('settings')}>change</a>).
        </p>
        <a className="btn" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
          Add a product
        </a>
      </div>
      {!state.brand && (
        <div className="brand-banner">
          <span>Set up your page first; then switch products on here.</span>
          {!readOnly && (
            <a className="btn primary" href={subHref('settings')}>
              Set up my page
            </a>
          )}
        </div>
      )}
      {data.products.length === 0 && (
        <div className="pro-empty">
          <h2>No products in My catalog yet</h2>
          <p>Add the cabinets you sell in My catalog. Each one needs a photo or 3D model, a name and dimensions, a finish and a price before it can go on your page.</p>
          {!readOnly && (
            <a className="btn primary big" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
              Add your first product
            </a>
          )}
        </div>
      )}
      {groups.map((g) => {
        const off = g.items.filter((e) => !listingStatus(e.listing, pageStatus).on);
        return (
          <section key={g.line || 'none'} className="pro-line" aria-label={g.label}>
            <h2>
              {g.label} <span>{g.items.length} piece{g.items.length === 1 ? '' : 's'}</span>
              {g.line && !readOnly && state.brand && off.length > 0 && (
                <button className="btn brand-line-btn" onClick={() => void publishLine(g.line)} disabled={busyLine !== null}>
                  {busyLine === g.line ? 'Publishing…' : 'Publish whole line'}
                </button>
              )}
            </h2>
            <div className="brand-rows">
              {g.items.map((e) => (
                <ProductRow key={e.id} entry={e} pageStatus={pageStatus} readOnly={readOnly} onChange={replace} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProductRow({ entry: e, pageStatus, readOnly, onChange }: { entry: ProductEntry; pageStatus: PageStatus; readOnly: boolean; onChange: (e: ProductEntry, n: number) => void }) {
  const st = listingStatus(e.listing, pageStatus);
  const widths = e.widthOptions?.length ? `${Math.min(...e.widthOptions)}–${Math.max(...e.widthOptions)}″` : `${e.widthIn}″`;
  return (
    <article className={`brand-row${st.on ? ' is-on' : ''}`}>
      <a className="pro-product-art" href={hrefFor({ name: 'pro', rest: `catalog/${e.id}` })} aria-label={`Edit ${e.name}`}>
        {e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" /> : <ProductArt product={e.product} surfaces={DEFAULT_SURFACES} />}
      </a>
      <div className="brand-row-body">
        <a className="pro-product-name" href={hrefFor({ name: 'pro', rest: `catalog/${e.id}` })}>
          {e.name}
        </a>
        <span className="muted mono">
          {e.sku ? e.sku.replace('{w}', '') + ' · ' : ''}
          {widths} · {e.depthIn}″ d · {e.heightIn}″ h
        </span>
        <span className="brand-row-tags">
          <span className={`tag ${st.tone}`}>{st.label}</span>
          {e.publicPrice !== null && <span className="tag">{e.publicPrice > 0 ? `Public: ${money(e.publicPrice)}` : 'Public: on request'}</span>}
          {e.hasModel && <span className="tag">3D model</span>}
        </span>
        {e.listing?.reviewNote && (e.listing.status === 'rejected' || e.listing.status === 'submitted') && (
          <p className="brand-note">
            <b>BluModel Studio:</b> {e.listing.reviewNote}
          </p>
        )}
        {!st.on && !e.readiness.ready && (
          <ul className="brand-ready" aria-label="Before it can be published">
            {e.readiness.checks.map((c) => (
              <li key={c.id} className={c.ok ? 'ok' : 'missing'}>
                {c.ok ? <Check width={13} height={13} /> : <Alert width={13} height={13} />} {c.label}
              </li>
            ))}
            <li className="brand-ready-fix">
              <a href={hrefFor({ name: 'pro', rest: fixFor(e).rest })}>{fixFor(e).label}</a>
            </li>
          </ul>
        )}
      </div>
      <div className="brand-row-switch">
        <PublishSwitch entry={e} pageStatus={pageStatus} readOnly={readOnly} onChange={onChange} bare />
      </div>
    </article>
  );
}

/** Where to fix a product: its price is in the price book, everything else in its form. */
function fixFor(e: ProductEntry): { rest: string; label: string } {
  const missing = e.readiness.checks.filter((c) => !c.ok).map((c) => c.id);
  return missing.length === 1 && missing[0] === 'price' ? { rest: 'price-book', label: 'Add a cost in your price book' } : { rest: `catalog/${e.id}`, label: 'Fix in My catalog' };
}
