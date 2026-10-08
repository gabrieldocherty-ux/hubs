import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { ordersApi, type OrderWire } from './api';
import { dollars, inFilter, isUnpaid, LIST_FILTERS, relative, shortDate, type ListFilter } from './model';
import { DemoBanner, OrdersShell, StatusPill } from './parts';

/** `#/orders`: the buyer's custom-model orders, newest first, with status chips. */
export function OrdersList() {
  const [orders, setOrders] = useState<OrderWire[] | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListFilter>('all');

  useEffect(() => {
    let live = true;
    ordersApi
      .list()
      .then((r) => {
        if (!live) return;
        setOrders(r.orders);
        setDemo(r.demo);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your orders.'));
    return () => {
      live = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<ListFilter, number> = { all: 0, open: 0, unpaid: 0, done: 0, closed: 0 };
    for (const o of orders ?? []) for (const f of LIST_FILTERS) if (inFilter(o.status, f.id)) c[f.id]++;
    return c;
  }, [orders]);
  const shown = (orders ?? []).filter((o) => inFilter(o.status, filter));

  return (
    <OrdersShell>
      <div className="ord-head">
        <div>
          <span className="eyebrow">Custom 3D models</span>
          <h1>My orders</h1>
          <p className="muted">Can’t find your range, sink or light in the catalog? The Mise studio models it to scale, and it lands privately in your catalog.</p>
        </div>
        <a className="btn primary big" href={hrefFor({ name: 'orders', rest: 'new' })}>
          Request a custom model
        </a>
      </div>
      {demo && <DemoBanner compact />}
      {error && <div className="auth-error">{error}</div>}
      {!orders && !error && <div className="ord-loading">Loading your orders…</div>}
      {orders && orders.length === 0 && (
        <section className="ord-empty">
          <h2>No orders yet</h2>
          <p>Send a few photos and the size, pick a tier and the studio builds an accurate model. Simple models start at $129.</p>
          <a className="btn primary" href={hrefFor({ name: 'orders', rest: 'new' })}>
            Request your first model
          </a>
        </section>
      )}
      {orders && orders.length > 0 && (
        <>
          <div className="chips ord-chips" role="group" aria-label="Filter orders">
            {LIST_FILTERS.map((f) => (
              <button key={f.id} type="button" className={f.id === filter ? 'chip on' : 'chip'} aria-pressed={f.id === filter} onClick={() => setFilter(f.id)}>
                {f.label} <span className="ord-chip-n">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="empty-note">No orders here.</p>
          ) : (
            <ul className="ord-list">
              {shown.map((o) => (
                <li key={o.id}>
                  <a className="ord-row" href={hrefFor({ name: 'orders', rest: o.id })}>
                    <div className="ord-row-main">
                      <b className="ord-row-title">{o.title}</b>
                      <span className="ord-row-sub">
                        {o.items.length > 1 ? `${o.items.length} products` : tierName(o.tier)}
                        {o.target === 'brand' && o.brandName ? ` · for ${o.brandName}` : o.target === 'contractor' ? ' · for My catalog' : ''}
                        {' · '}requested {shortDate(o.createdAt)}
                      </span>
                    </div>
                    <div className="ord-row-side">
                      <StatusPill status={o.status} />
                      <span className="ord-row-meta mono">
                        {dollars(o.amountCents)}
                        {o.provider === 'demo' ? ' · demo' : ''}
                      </span>
                      <span className="ord-row-when">{whenText(o)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </OrdersShell>
  );
}

const tierName = (t: string) => `${t[0]!.toUpperCase()}${t.slice(1)} model`;

function whenText(o: OrderWire): string {
  if (isUnpaid(o.status) && o.expiresAt) return `Expires ${relative(o.expiresAt)}`;
  if ((o.status === 'paid' || o.status === 'in_progress' || o.status === 'revision_requested') && o.dueAt) return `Due ${shortDate(o.dueAt)}`;
  if (o.status === 'delivered' && o.deliveredAt) return `Delivered ${shortDate(o.deliveredAt)}`;
  if (o.status === 'completed' && o.completedAt) return `Completed ${shortDate(o.completedAt)}`;
  return '';
}
