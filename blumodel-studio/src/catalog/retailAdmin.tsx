/**
 * Admin > Retailers: the advertising groundwork for the real-retailer catalog.
 *
 * One card per store the catalog lists (RONA, Home Depot…): the tracking parameter added to every
 * "Where to buy" link to that store, whether the store is sponsored (sorted first and labelled
 * "Sponsored" on the product page), and how many times its links were followed. The server keeps
 * the settings in `retailers` and every change in the admin audit log; the counts in
 * `retail_clicks` are per store, product and day, with nothing about the person who clicked.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, call } from '../lib/api';
import { hrefFor } from '../lib/router';
import { timeAgo } from '../store/useSession';
import { checkedLabel, loadRetail, loadRetailers, storeLink, useRetail } from './retail';
import './retail.css';

interface AdminRetailer {
  slug: string;
  name: string;
  domain: string;
  sponsored: boolean;
  affiliate: string;
  updatedAt: number | null;
  /** Catalog products listed at this store. */
  products: number;
  clicks: { total: number; last30: number };
  /** The most-followed products in the last 30 days. */
  top: { productId: string; name: string; brand: string; clicks: number }[];
}

interface AdminRetailersWire {
  checkedAt: string | null;
  products: number;
  researched: number;
  leftOut: { count: number; byReason: Record<string, number> };
  since: string;
  retailers: AdminRetailer[];
}

export const retailAdminApi = {
  list: () => call<AdminRetailersWire>('GET', '/api/admin/retailers'),
  save: (slug: string, patch: { affiliate?: string; sponsored?: boolean }) =>
    call<{ retailer: AdminRetailer }>('PATCH', `/api/admin/retailers/${encodeURIComponent(slug)}`, patch),
};

export default function AdminRetailersTab() {
  const [data, setData] = useState<AdminRetailersWire | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadRetail();
    retailAdminApi
      .list()
      .then((d) => live && setData(d))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Could not load the retailers.'));
    return () => {
      live = false;
    };
  }, []);

  const saved = (r: AdminRetailer) => {
    setData((d) => (d ? { ...d, retailers: d.retailers.map((x) => (x.slug === r.slug ? { ...x, ...r, products: x.products, clicks: x.clicks, top: x.top } : x)) } : d));
    // The product pages read the public settings; refresh them so this tab's change shows there.
    void loadRetailers(true);
  };

  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading the retailers…</div>;
  const reasons = Object.entries(data.leftOut.byReason).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rt-admin">
      <h1>Retailers</h1>
      <p className="rt-lede">
        <b>{data.products}</b> real products in the catalog from {data.researched} researched listings, checked {checkedLabel(data.checkedAt) || 'on an unknown date'}.
        {data.leftOut.count > 0 && (
          <>
            {' '}
            {data.leftOut.count} left out:{' '}
            {reasons.map(([why, n], i) => (
              <span key={why}>
                {i > 0 && '; '}
                {why} ({n})
              </span>
            ))}
            .
          </>
        )}
      </p>
      <p className="rt-lede rt-lede--quiet">
        A tracking parameter is added to every link to that store. Sponsored stores are listed first under Where to buy and say Sponsored. Link-outs are counted per store and product each day, with nothing about the person who
        clicked. Every change here is in the admin log.
      </p>
      <div className="rt-list">
        {data.retailers.map((r) => (
          <RetailerCard key={r.slug} r={r} onSaved={saved} />
        ))}
      </div>
    </div>
  );
}

function RetailerCard({ r, onSaved }: { r: AdminRetailer; onSaved: (r: AdminRetailer) => void }) {
  const [affiliate, setAffiliate] = useState(r.affiliate);
  const [sponsored, setSponsored] = useState(r.sponsored);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const retail = useRetail((s) => s.data);
  // A real link to this store, to show what the parameter does to it.
  const example = useMemo(() => {
    for (const p of retail?.products ?? []) {
      const l = p.retail.stores.find((x) => x.store === r.slug);
      if (l) return l.url;
    }
    return null;
  }, [retail, r.slug]);
  const draft = affiliate.trim().replace(/^\?/, '');
  const dirty = draft !== r.affiliate || sponsored !== r.sponsored;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const { retailer } = await retailAdminApi.save(r.slug, { affiliate: draft, sponsored });
      setAffiliate(retailer.affiliate);
      setSponsored(retailer.sponsored);
      onSaved({ ...r, ...retailer });
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const id = `rt-${r.slug}`;
  return (
    <section className="admin-card rt-card" data-store={r.slug} aria-labelledby={`${id}-name`}>
      <div className="rt-head">
        <div className="rt-name">
          <h2 id={`${id}-name`}>
            {r.name}
            {r.sponsored && <span className="pp-buy-sponsored">Sponsored</span>}
          </h2>
          <span>
            {r.domain} · {r.products} product{r.products === 1 ? '' : 's'}
          </span>
        </div>
        <dl className="rt-clicks">
          <div>
            <dt>Link-outs, 30 days</dt>
            <dd className="mono">{r.clicks.last30}</dd>
          </div>
          <div>
            <dt>All time</dt>
            <dd className="mono">{r.clicks.total}</dd>
          </div>
        </dl>
      </div>

      <form className="rt-form" onSubmit={(e) => void save(e)}>
        <label className="rt-field" htmlFor={`${id}-aff`}>
          <span>Tracking parameter</span>
          <input
            id={`${id}-aff`}
            value={affiliate}
            onChange={(e) => (setAffiliate(e.target.value), setMsg(null))}
            placeholder="aff=blumodel"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            maxLength={200}
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={sponsored}
          className={sponsored ? 'rt-switch on' : 'rt-switch'}
          onClick={() => (setSponsored(!sponsored), setMsg(null))}
          aria-label={`${r.name} is sponsored`}
        >
          <span className="rt-switch-track" aria-hidden>
            <span className="rt-switch-knob" />
          </span>
          <span>Sponsored</span>
        </button>
        <button className="btn small primary" type="submit" disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
      {msg && (
        <p className={msg.ok ? 'rt-msg ok' : 'rt-msg'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
      {example && (
        <p className="rt-example">
          <span>Links read</span>
          <code>{storeLink(example, draft)}</code>
        </p>
      )}

      <div className="rt-top">
        <span className="mini-label">Most followed, last 30 days</span>
        {r.top.length === 0 ? (
          <p className="empty-note">No link-outs yet.</p>
        ) : (
          <ol>
            {r.top.map((t) => (
              <li key={t.productId}>
                <a href={hrefFor({ name: 'product', id: t.productId })}>
                  {t.brand && <span className="rt-brand">{t.brand}</span>} {t.name}
                </a>
                <span className="mono">{t.clicks}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {r.updatedAt && <small className="rt-when">Changed {timeAgo(r.updatedAt)}</small>}
    </section>
  );
}
