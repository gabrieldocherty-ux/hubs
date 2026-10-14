import { useEffect, useState } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { settleDemoCheckout } from '../../lib/payments';
import { hrefFor, navigate } from '../../lib/router';
import { ordersApi, type OrderDetail } from './api';
import { dollars } from './model';
import { StatusPill } from './parts';
import './orders.css';

/**
 * `#/pay/demo/:orderId` (PRODUCT_SPEC §7.4): the DEMO stand-in for Stripe Checkout. It moves no
 * money and has no card or personal-data fields at all; its buttons simulate what a payment
 * provider would answer. Cancel goes back to the order unpaid, like Stripe's cancel URL.
 */
export default function DemoPay({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'success' | 'decline' | null>(null);

  useEffect(() => {
    let live = true;
    ordersApi
      .get(orderId)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load this payment.'));
    return () => {
      live = false;
    };
  }, [orderId]);

  const toOrder = () => navigate({ name: 'orders', rest: orderId }, true);
  const cancel = () => {
    settleDemoCheckout('cancel');
    toOrder();
  };

  const act = async (outcome: 'success' | 'decline') => {
    setBusy(outcome);
    setError(null);
    try {
      const d = await ordersApi.demoComplete(orderId, outcome);
      setData(d);
      if (outcome === 'success' && d.order.status === 'paid') {
        settleDemoCheckout('success');
        toOrder();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const o = data?.order;
  const payable = o && (o.status === 'pending_payment' || o.status === 'payment_failed');

  return (
    <div className="ord-pay">
      <div className="ord-pay-banner" role="note">
        <b>DEMO PAYMENT – no real money moves, no card details are collected.</b>
        <span>These buttons simulate the payment provider.</span>
      </div>
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
      </header>
      <main className="ord-pay-main">
        {!data && !error && <div className="ord-loading">Loading the payment…</div>}
        {!data && error && (
          <div className="screen-msg">
            <p>{error}</p>
            <a className="btn" href={hrefFor({ name: 'orders', rest: '' })}>
              Go to my orders
            </a>
          </div>
        )}
        {o && (
          <section className="ord-card ord-pay-card" aria-labelledby="ord-pay-title">
            <span className="eyebrow">Checkout · Demo</span>
            <h1 id="ord-pay-title">{o.title}</h1>
            <p className="muted">Custom 3D model{o.items.length > 1 ? `s (${o.items.length} products)` : ''} from the BluModel 3D studio</p>
            <ul className="ord-lines">
              {o.quote.lines.map((l, i) => (
                <li key={i}>
                  <span>{l.label}</span>
                  <span className="mono">{dollars(l.amountCents)}</span>
                </li>
              ))}
            </ul>
            <div className="ord-total">
              <span>Total (demo)</span>
              <b className="mono">{dollars(o.amountCents)}</b>
            </div>

            {!data.demo || o.provider !== 'demo' ? (
              <>
                <div className="auth-note">This order isn’t on the demo provider, so it can’t be paid here.</div>
                <button className="btn" onClick={toOrder}>
                  Back to the order
                </button>
              </>
            ) : payable ? (
              <>
                {o.status === 'payment_failed' && <div className="auth-error">Payment declined (simulated). Nothing was charged. Try again, or cancel.</div>}
                <div className="ord-pay-actions">
                  <button className="btn primary big" onClick={() => void act('success')} disabled={!!busy}>
                    {busy === 'success' ? 'Processing…' : 'Simulate successful payment'}
                  </button>
                  <button className="btn big" onClick={() => void act('decline')} disabled={!!busy}>
                    {busy === 'decline' ? 'Processing…' : 'Simulate declined payment'}
                  </button>
                  <button className="btn big" onClick={cancel} disabled={!!busy}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="ord-pay-state">
                  <StatusPill status={o.status} />
                  <span>
                    {o.status === 'draft'
                      ? 'Checkout hasn’t started for this order.'
                      : o.status === 'expired' || o.status === 'cancelled'
                        ? 'Nothing was charged.'
                        : 'This order is already paid.'}
                  </span>
                </div>
                <button className="btn primary big" onClick={toOrder} data-autofocus>
                  Go to the order
                </button>
              </>
            )}
            {error && <div className="auth-error">{error}</div>}
            <p className="fine">With real payments this is Stripe’s secure checkout page. BluModel Studio never sees or stores card details.</p>
          </section>
        )}
      </main>
    </div>
  );
}
