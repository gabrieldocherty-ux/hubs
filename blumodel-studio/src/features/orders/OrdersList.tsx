import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../lib/api';
import { usePayments } from '../../lib/config';
import { hrefFor } from '../../lib/router';
import { useSession } from '../../store/useSession';
import { ordersApi, type Allowance, type OrderWire } from './api';
import { inFilter, isUnpaid, LIST_FILTERS, modelsLeftText, orderPrice, pricingLabel, relative, resetDay, shortDate, type ListFilter } from './model';
import { OrdersPayNote, OrdersShell, PlanOnlyNote, StatusPill } from './parts';

/**
 * `#/orders` ("Make custom models"): the buyer's custom-model requests, newest first, with status
 * chips. A contractor sees what is left of this month's included models and can start a request;
 * anyone else sees their earlier orders read-only (receipts and refunds keep working) and a note
 * that custom models come with the Contractor plan.
 */
export function OrdersList() {
  const [orders, setOrders] = useState<OrderWire[] | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const user = useSession((s) => s.user);
  const payments = usePayments();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListFilter>('all');

  useEffect(() => {
    let live = true;
    ordersApi
      .list()
      .then((r) => {
        if (!live) return;
        setOrders(r.orders);
        setAllowance(r.allowance);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your custom models.'));
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
  const active = allowance?.active === true;
  // Payments only matter for an order from before that still waits to be paid.
  const unpaidOrder = (orders ?? []).some((o) => o.pricing !== 'plan' && isUnpaid(o.status));

  return (
    <OrdersShell>
      <div className="ord-head">
        <div>
          <span className="eyebrow">Custom 3D models</span>
          <h1>{active ? 'Make custom models' : 'Custom models'}</h1>
          <p className="muted">
            {active
              ? 'Can’t find your range, sink or cabinet in the catalog? The BluModel 3D studio models it to scale from its name, UPC and a photo, and it lands privately in your catalog.'
              : 'Your custom 3D model orders and their receipts.'}
          </p>
        </div>
        {active && (
          <a className="btn primary big" href={hrefFor({ name: 'orders', rest: 'new' })}>
            Make a custom model
          </a>
        )}
      </div>
      {active && allowance && (
        <div className={allowance.left > 0 ? 'ord-allowance-bar' : 'ord-allowance-bar empty'} role="status">
          <b>
            {modelsLeftText(allowance)} - resets {resetDay(allowance.resetsAt)}
          </b>
          <span>
            {allowance.left > 0
              ? `Your Contractor plan includes ${allowance.included} custom 3D models a month${allowance.granted ? `, plus ${allowance.granted} extra this month` : ''}. Unused models don’t carry over.`
              : 'You’ve used this month’s models. '}
            {allowance.left <= 0 &&
              (allowance.supportEmail ? (
                <>
                  Need more? <a href={`mailto:${allowance.supportEmail}?subject=${encodeURIComponent('More custom models this month')}`}>Contact us</a>
                </>
              ) : (
                'Need more? Contact BluModel Studio.'
              ))}
          </span>
        </div>
      )}
      {allowance && !active && <PlanOnlyNote lapsed={!!user?.contractor} />}
      {unpaidOrder && <OrdersPayNote payments={payments} />}
      {error && <div className="auth-error">{error}</div>}
      {!orders && !error && <div className="ord-loading">Loading your custom models…</div>}
      {orders && orders.length === 0 && active && (
        <section className="ord-empty">
          <h2>No custom models yet</h2>
          <p>List the products you want: a name, the UPC from the box and a photo or two. The studio builds a true-to-size 3D model of each, one from your allowance per product.</p>
          <a className="btn primary" href={hrefFor({ name: 'orders', rest: 'new' })}>
            Make your first custom model
          </a>
        </section>
      )}
      {orders && orders.length === 0 && !active && <p className="empty-note">You haven’t ordered any custom models.</p>}
      {orders && orders.length > 0 && (
        <>
          <div className="chips ord-chips" role="group" aria-label="Filter requests">
            {LIST_FILTERS.map((f) => (
              <button key={f.id} type="button" className={f.id === filter ? 'chip on' : 'chip'} aria-pressed={f.id === filter} onClick={() => setFilter(f.id)}>
                {f.label} <span className="ord-chip-n">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="empty-note">Nothing here.</p>
          ) : (
            <ul className="ord-list">
              {shown.map((o) => (
                <li key={o.id}>
                  <a className="ord-row" href={hrefFor({ name: 'orders', rest: o.id })}>
                    <div className="ord-row-main">
                      <b className="ord-row-title">{o.title}</b>
                      <span className="ord-row-sub">
                        {o.items.length > 1 ? `${o.items.length} products · ` : ''}
                        {pricingLabel(o)}
                        {o.target === 'brand' && o.brandName ? ` · for ${o.brandName}` : o.target === 'contractor' ? ' · for My catalog' : ''}
                        {' · '}requested {shortDate(o.createdAt)}
                      </span>
                    </div>
                    <div className="ord-row-side">
                      <StatusPill status={o.status} pricing={o.pricing} />
                      <span className="ord-row-meta">
                        {o.provider === 'demo' && <span className="ord-tag">Demo</span>}
                        <span className={o.pricing !== 'plan' ? 'mono' : o.status === 'cancelled' ? 'muted' : 'ord-included'}>{orderPrice(o)}</span>
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

function whenText(o: OrderWire): string {
  if (o.pricing !== 'plan' && isUnpaid(o.status) && o.expiresAt) return `Expires ${relative(o.expiresAt)}`;
  if ((o.status === 'paid' || o.status === 'in_progress' || o.status === 'revision_requested') && o.dueAt) return `Due ${shortDate(o.dueAt)}`;
  if (o.status === 'delivered' && o.deliveredAt) return `Delivered ${shortDate(o.deliveredAt)}`;
  if (o.status === 'completed' && o.completedAt) return `Completed ${shortDate(o.completedAt)}`;
  return '';
}
