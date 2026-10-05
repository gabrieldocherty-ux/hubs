import { useEffect, useState } from 'react';
import { Logo } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { navigateHash } from '../../lib/router';
import { useSession } from '../../store/useSession';
import { billingApi, dollars, type CheckoutWire } from './api';
import { loadEntitlements } from './entitlements';
import './billing.css';

/**
 * `#/pay/demo-plan/:ref`: the DEMO stand-in for Stripe Checkout. It moves no money and has no card
 * fields at all; the buttons simulate what the payment provider would answer.
 */
export default function DemoPlanPay({ checkoutRef }: { checkoutRef: string }) {
  const [checkout, setCheckout] = useState<CheckoutWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'success' | 'decline' | 'cancel' | null>(null);

  useEffect(() => {
    billingApi
      .checkoutInfo(checkoutRef)
      .then((r) => setCheckout(r.checkout))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this payment.'));
  }, [checkoutRef]);

  const back = (c: CheckoutWire) => navigateHash(c.returnTo || '#/account/billing', true);

  const act = async (outcome: 'success' | 'decline' | 'cancel') => {
    if (!checkout) return;
    setBusy(outcome);
    setError(null);
    try {
      const r = await billingApi.demoComplete(checkout.ref, outcome);
      setCheckout(r.checkout);
      if (outcome === 'success') {
        await Promise.all([loadEntitlements(true), useSession.getState().refresh()]);
        back(r.checkout);
      } else if (outcome === 'cancel') back(r.checkout);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const what = !checkout
    ? ''
    : checkout.kind === 'kitchen_unlock'
      ? `Kitchen unlock: “${checkout.projectName || 'your kitchen'}”`
      : `Mise ${checkout.plan === 'contractor' ? 'Contractor' : 'Unlimited'}, monthly`;

  return (
    <div className="demo-pay">
      <div className="demo-pay-banner" role="note">
        <b>DEMO PAYMENT</b> No real money moves and no card details are collected. These buttons simulate the payment provider.
      </div>
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
      </header>
      <main className="demo-pay-main">
        {error && !checkout && (
          <div className="screen-msg">
            <p>{error}</p>
            <a className="btn" href="#/account/billing">Go to Billing</a>
          </div>
        )}
        {!checkout && !error && <div className="screen-msg">Loading the payment…</div>}
        {checkout && (
          <section className="demo-pay-card" aria-labelledby="demo-pay-title">
            <span className="eyebrow">Checkout · Demo</span>
            <h1 id="demo-pay-title">{what}</h1>
            <div className="demo-pay-amount">
              <b>{dollars(checkout.amountCents)}</b>
              <span>{checkout.kind === 'subscription' ? 'per month, renews monthly until you cancel' : 'one time'}</span>
            </div>
            {checkout.status === 'completed' ? (
              <>
                <div className="auth-ok">Paid (simulated). You’re all set.</div>
                <button className="btn primary big" onClick={() => back(checkout)} data-autofocus>
                  Continue
                </button>
              </>
            ) : checkout.status === 'pending' || checkout.status === 'failed' ? (
              <>
                {checkout.status === 'failed' && <div className="auth-error">Payment declined (simulated). Nothing was charged. Try again, or cancel.</div>}
                <div className="demo-pay-actions">
                  <button className="btn primary big" onClick={() => act('success')} disabled={!!busy}>
                    {busy === 'success' ? 'Processing…' : 'Simulate successful payment'}
                  </button>
                  <button className="btn big" onClick={() => act('decline')} disabled={!!busy}>
                    Simulate declined payment
                  </button>
                  <button className="btn big" onClick={() => act('cancel')} disabled={!!busy}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="auth-note">This checkout has {checkout.status === 'canceled' ? 'been cancelled' : 'expired'}. Nothing was charged.</div>
                <button className="btn" onClick={() => back(checkout)}>
                  Go back
                </button>
              </>
            )}
            {error && <div className="auth-error">{error}</div>}
            <p className="fine">With real payments, this is Stripe’s secure checkout page. Mise never sees or stores card details.</p>
          </section>
        )}
      </main>
    </div>
  );
}
