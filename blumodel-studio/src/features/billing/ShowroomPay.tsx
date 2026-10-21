import { useEffect, useRef, useState } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { ApiError, call } from '../../lib/api';
import { money } from '../../lib/money';
import { clearSessionId } from '../../lib/payments';
import { pageQuery } from '../../lib/router';
import './billing.css';

/**
 * `#/pay/showroom/:ref` on the sales site (docs/SHOWROOM_PIVOT.md §2): the page a company's monthly
 * plan link lands on. The admin's link points here, and so do Stripe's success and cancel URLs.
 * It needs no sign-in (a lapsed showroom answers 503, so it can't live there).
 *   - unpaid Stripe link: "Pay by card" goes to Stripe's own checkout page;
 *   - back from Stripe with ?session_id=: confirmed at once (POST …/sync), not waiting for the webhook;
 *   - demo provider: simulate a payment or a cancel (no money, no card fields);
 *   - paid: "Your showroom's monthly plan is active", with a link to the showroom.
 */
interface ShowroomCheckout {
  checkout: { ref: string; status: 'pending' | 'completed' | 'canceled' | 'expired' | 'failed'; amountCents: number; currency: string; provider: 'stripe' | 'demo'; demo?: boolean; payUrl?: string | null };
  showroom: { name: string; slug: string; live?: boolean; url?: string | null };
}

const path = (ref: string) => `/api/showroom-checkouts/${encodeURIComponent(ref)}`;

export default function ShowroomPay({ checkoutRef }: { checkoutRef: string }) {
  const [data, setData] = useState<ShowroomCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'success' | 'cancel' | null>(null);
  const [returned, setReturned] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const sessionId = pageQuery().get('session_id');
    (async () => {
      try {
        const first = await call<ShowroomCheckout>('GET', path(checkoutRef));
        let out = first;
        if (sessionId && first.checkout.provider === 'stripe' && first.checkout.status === 'pending') {
          setReturned(true);
          try {
            const synced = await call<ShowroomCheckout>('POST', `${path(checkoutRef)}/sync`, { sessionId });
            out = { checkout: { ...first.checkout, ...synced.checkout, payUrl: synced.checkout.status === 'pending' ? first.checkout.payUrl : null }, showroom: { ...first.showroom, ...synced.showroom } };
          } catch {
            // The webhook still records the payment; the page says it's being confirmed.
          }
        }
        if (sessionId) clearSessionId();
        setData(out);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load this payment link.');
      }
    })();
  }, [checkoutRef]);

  const demoAct = async (outcome: 'success' | 'cancel') => {
    if (!data) return;
    setBusy(outcome);
    setError(null);
    try {
      await call('POST', `${path(checkoutRef)}/demo`, { outcome });
      setData(await call<ShowroomCheckout>('GET', path(checkoutRef)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const c = data?.checkout;
  const name = data?.showroom.name || 'your showroom';
  return (
    <div className="demo-pay show-pay">
      {c?.provider === 'demo' ? (
        <div className="demo-pay-banner" role="note">
          <b>DEMO PAYMENT</b> No real money moves and no card details are collected.
        </div>
      ) : (
        <div aria-hidden="true" />
      )}
      <header className="home-bar">
        <a className="brand" href="#/" aria-label="BluModel Studio home">
          <Logo />
          <Wordmark />
        </a>
      </header>
      <main className="demo-pay-main">
        {error && !data && (
          <div className="screen-msg">
            <p>{error}</p>
            <p className="fine">Ask us for a new link if this one has ended.</p>
          </div>
        )}
        {!data && !error && <div className="screen-msg">Loading the payment…</div>}
        {data && c && (
          <section className="demo-pay-card" aria-labelledby="show-pay-title">
            <span className="eyebrow">Monthly plan{c.provider === 'demo' ? ' · Demo' : ''}</span>
            <h1 id="show-pay-title">{name}</h1>
            <div className="demo-pay-amount">
              <b>{money(c.amountCents, c.currency)}</b>
              <span>per month: hosting, running and your web address. Renews monthly until cancelled.</span>
            </div>
            {c.status === 'completed' ? (
              <>
                <div className="auth-ok" role="status">
                  {data.showroom.live ? `Paid. ${name}’s monthly plan is active and the showroom is live.` : `Paid. ${name}’s monthly plan is active.`}
                </div>
                {data.showroom.live && data.showroom.url && (
                  <a className="btn primary big" href={data.showroom.url}>
                    Open the showroom
                  </a>
                )}
                <p className="fine">A receipt is on the showroom’s Plan tab. Its owners manage the card from there.</p>
              </>
            ) : c.status === 'pending' ? (
              returned ? (
                <div className="auth-note" role="status">
                  We’re confirming the payment with Stripe. This page updates once it’s through; you can also reload it in a minute.
                </div>
              ) : c.provider === 'demo' ? (
                <div className="demo-pay-actions">
                  <button className="btn primary big" onClick={() => void demoAct('success')} disabled={!!busy}>
                    {busy === 'success' ? 'Processing…' : 'Simulate successful payment'}
                  </button>
                  <button className="btn big" onClick={() => void demoAct('cancel')} disabled={!!busy}>
                    Cancel
                  </button>
                </div>
              ) : c.payUrl ? (
                <>
                  <a className="btn primary big" href={c.payUrl}>
                    Pay by card
                  </a>
                  <p className="fine">You’ll pay on Stripe’s secure page. BluModel Studio never sees or stores card details.</p>
                </>
              ) : (
                <div className="auth-note">This link isn’t ready for payment. Ask us for a new one.</div>
              )
            ) : (
              <div className="auth-error" role="status">
                Payment didn’t go through: this link has {c.status === 'canceled' ? 'been cancelled' : c.status === 'failed' ? 'failed' : 'expired'}. Nothing was charged. Ask us for a new link.
              </div>
            )}
            {error && <div className="auth-error">{error}</div>}
          </section>
        )}
      </main>
    </div>
  );
}
