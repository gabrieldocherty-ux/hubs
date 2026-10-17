import { useCallback, useEffect, useState } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Dialog } from '../../components/Dialog';
import { Check, Logo, Wordmark } from '../../components/Icons';
import { AgreeToPay, DemoBanner, PaymentsSoon, SOON_LABEL } from '../../components/PaymentNotice';
import { LegalLinks } from '../legal/LegalLinks';
import { ApiError } from '../../lib/api';
import { usePayments } from '../../lib/config';
import { clearSessionId, isPaymentsUnavailable, markCheckout, paymentError, takeCheckoutReturn, type CheckoutReturn } from '../../lib/payments';
import { navigateHash, useHashQuery } from '../../lib/router';
import { useSession } from '../../store/useSession';
import type { Plan } from '../../types/platform';
import plansJson from '../../data/plans.json';
import { amount, money, planPrice } from '../../lib/money';
import { billingApi, goToCheckout, type BillingMe } from './api';
import { call } from '../../lib/api';
import { loadEntitlements } from './entitlements';
import './billing.css';

const PLANS = plansJson as Plan[];
const planName = (id: string) => PLANS.find((p) => p.id === id)?.name ?? id;
const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—');

/**
 * `#/account/billing` (PLANS_AND_CONTRACTORS §5): plan, changes, cancellation, unlocks and receipts.
 * The payment state comes from `/api/config`: real Stripe payments say nothing about demos, the
 * DEMO carries its banner and simulation controls, and while payments aren't open the plans are
 * shown with "Opens soon" instead of a checkout.
 */
export default function BillingPage() {
  const query = useHashQuery();
  const payments = usePayments();
  const soon = payments === 'none';
  const [me, setMe] = useState<BillingMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [back, setBack] = useState<(CheckoutReturn & { confirmed: boolean }) | null>(null);
  const portalDemo = query.get('portal') === 'demo';
  /** Custom-model orders this account has (paid ones from before 2026-10-15 have their own receipts). */
  const [orderCount, setOrderCount] = useState(0);
  const isContractor = useSession((s) => s.user?.plan.id === 'contractor' || !!s.user?.contractor);

  useEffect(() => {
    // Contractors reach their requests from the account menu; anyone else is pointed there from here.
    if (isContractor) return;
    let live = true;
    call<{ orders: unknown[] }>('GET', '/api/orders')
      .then((r) => live && setOrderCount(r.orders.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isContractor]);

  const apply = useCallback(async (next: BillingMe) => {
    setMe(next);
    await Promise.all([loadEntitlements(true), useSession.getState().refresh()]);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      // Back from a checkout: Stripe adds `?session_id=` after paying (confirm it without waiting
      // for the webhook); a cancelled checkout comes back without it.
      const ret = takeCheckoutReturn('#/account/billing');
      if (ret?.sessionId) {
        try {
          await billingApi.sync(ret.sessionId);
        } catch {
          /* the webhook will catch up */
        }
        clearSessionId();
      }
      let next: BillingMe;
      try {
        next = await billingApi.me();
      } catch (e) {
        // A server with payments switched off may refuse its billing endpoints: show the plan the
        // session knows (a complimentary one, usually) instead of an error.
        if (!isPaymentsUnavailable(e)) throw e;
        next = fromSession();
      }
      if (!live) return;
      await apply(next);
      if (ret) setBack({ ...ret, confirmed: next.plan.id !== 'free' });
    })().catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load billing.'));
    return () => {
      live = false;
    };
  }, [apply]);

  const run = async (key: string, fn: () => Promise<BillingMe>) => {
    setBusy(key);
    setError(null);
    try {
      await apply(await fn());
    } catch (e) {
      setError(paymentError(e, 'That didn’t work. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const subscribe = async (plan: 'unlimited' | 'contractor') => {
    setBusy(plan);
    setError(null);
    try {
      const returnTo = plan === 'contractor' ? '#/pro' : '#/account/billing';
      const r = await billingApi.checkout({ kind: 'subscription', plan, returnTo });
      markCheckout(plan, returnTo);
      goToCheckout(r.url);
    } catch (e) {
      setError(paymentError(e));
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy('portal');
    try {
      goToCheckout((await billingApi.portal()).url);
    } catch (e) {
      setError(paymentError(e, 'Could not open the billing portal.'));
    } finally {
      setBusy(null);
    }
  };

  const sub = me?.subscription ?? null;
  const plan = me?.plan;
  const onPlan = plan && plan.id !== 'free';
  const comp = sub?.provider === 'comp' || plan?.provider === 'comp';
  const other = plan?.id === 'unlimited' ? 'contractor' : 'unlimited';
  const demo = payments === 'demo';

  return (
    <div className="billing">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <AccountMenu />
      </header>
      <main className="home-main billing-main">
        <div className="home-head">
          <div>
            <span className="eyebrow">Account</span>
            <h1>Billing</h1>
          </div>
        </div>
        {demo && <DemoBanner>Demo payments on this server: no real money moves and no card details are collected.</DemoBanner>}
        {back && <ReturnNote back={back} plan={plan?.id ?? 'free'} />}
        {error && <div className="auth-error billing-error">{error}</div>}
        {!me && !error && <div className="screen-msg">Loading billing…</div>}
        {me && plan && (
          <>
            <section className="billing-card billing-current" aria-labelledby="current-plan">
              <div>
                <span className="eyebrow">Current plan</span>
                <h2 id="current-plan">{planName(plan.id)}</h2>
                <p className="billing-status">{statusLine(me, comp)}</p>
              </div>
              <div className="billing-actions">
                {onPlan && sub && !comp && !soon && (
                  <>
                    {!sub.cancelAtPeriodEnd && (
                      <button className="btn" onClick={() => run('change', () => billingApi.change(other))} disabled={!!busy}>
                        {busy === 'change' ? 'Changing…' : `Switch to ${planName(other)} (${planPrice(PLANS.find((p) => p.id === other)!)})`}
                      </button>
                    )}
                    {sub.cancelAtPeriodEnd ? (
                      <button className="btn primary" onClick={() => run('resume', billingApi.resume)} disabled={!!busy}>
                        {busy === 'resume' ? 'Resuming…' : 'Keep my plan'}
                      </button>
                    ) : (
                      <button className="btn" onClick={() => setConfirmCancel(true)} disabled={!!busy}>
                        Cancel plan
                      </button>
                    )}
                  </>
                )}
                {sub && !comp && !soon && (
                  <button className="btn" onClick={portal} disabled={!!busy}>
                    Manage payment & invoices
                  </button>
                )}
              </div>
            </section>

            {!onPlan && (
              <section aria-labelledby="plans-title">
                <h2 id="plans-title" className="billing-h2">
                  Plans
                </h2>
                {soon && (
                  <PaymentsSoon>
                    Plans aren’t on sale yet. Your kitchens, sharing and everything you design stay free; this is what the plans will cost when payments open.
                  </PaymentsSoon>
                )}
                <div className="billing-plans">
                  {(['unlimited', 'contractor'] as const).map((id) => {
                    const p = PLANS.find((x) => x.id === id)!;
                    return (
                      <section key={id} className={`plan-option${id === 'contractor' ? ' plan-option--featured' : ''}`} aria-label={p.name}>
                        <span className="eyebrow">Monthly</span>
                        <h4>{p.name}</h4>
                        <div className="plan-price">
                          <b>{amount(p.priceCents)}</b>
                          <span>CAD / month</span>
                        </div>
                        <p className="plan-note">{p.tagline}</p>
                        <ul className="plan-bullets">
                          {p.bullets.map((b) => (
                            <li key={b}>
                              <Check width={14} height={14} /> {b}
                            </li>
                          ))}
                        </ul>
                        <button className={id === 'contractor' ? 'btn primary wide' : 'btn wide'} onClick={() => subscribe(id)} disabled={!!busy || soon}>
                          {soon ? SOON_LABEL : busy === id ? 'Starting…' : `Choose ${p.name}`}
                        </button>
                      </section>
                    );
                  })}
                </div>
                {!soon && <AgreeToPay />}
                <p className="fine">
                  Prices are in Canadian dollars.
                </p>
              </section>
            )}

            {demo && sub?.provider === 'demo' && (
              <section className="billing-card demo-controls" aria-labelledby="demo-title">
                <span className="eyebrow" id="demo-title">
                  Demo controls · no real money
                </span>
                <p>Try what happens at renewal time without waiting a month.</p>
                <div className="billing-actions">
                  <button className="btn" onClick={() => run('renewal', () => billingApi.demoSimulate('renewal'))} disabled={!!busy}>
                    Simulate renewal
                  </button>
                  <button className="btn" onClick={() => run('renewal_failed', () => billingApi.demoSimulate('renewal_failed'))} disabled={!!busy}>
                    Simulate failed renewal
                  </button>
                  <button className="btn" onClick={() => run('period_end', () => billingApi.demoSimulate('period_end'))} disabled={!!busy}>
                    End this billing period now
                  </button>
                  {sub.status === 'past_due' && (
                    <button className="btn" onClick={() => run('grace_end', () => billingApi.demoSimulate('grace_end'))} disabled={!!busy}>
                      End the grace period now
                    </button>
                  )}
                </div>
              </section>
            )}

            {/* Only for someone who has unlocked a kitchen: the one-kitchen unlock is offered at export time, not advertised. */}
            {me.unlocks.length > 0 && (
              <section className="billing-card" aria-labelledby="unlocks-title">
                <span className="eyebrow" id="unlocks-title">
                  Unlocked kitchens
                </span>
                <ul className="billing-list">
                  {me.unlocks.map((u) => (
                    <li key={u.projectId}>
                      <a href={`#/k/${u.projectId}`}>{u.name}</a>
                      <span className="muted">Unlocked {date(u.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="billing-card" aria-labelledby="receipts-title">
              <span className="eyebrow" id="receipts-title">
                Receipts
              </span>
              {me.receipts.length === 0 ? (
                <p className="empty-note">No payments yet.</p>
              ) : (
                <table className="admin-table billing-receipts">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>For</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.receipts.map((r) => (
                      <tr key={r.id}>
                        <td>{date(r.createdAt)}</td>
                        <td>
                          {r.kind === 'kitchen_unlock' ? `Kitchen unlock: ${r.projectName || 'kitchen'}` : `${planName(r.plan ?? '')} plan${r.kind === 'renewal' ? ', renewal' : ''}`}
                          {/* A receipt from the simulation says so, whatever mode the server is in now: nothing was charged. */}
                          {r.provider === 'demo' && <span className="demo-tag">Demo</span>}
                        </td>
                        <td className="num mono">{money(r.amountCents, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {orderCount > 0 && (
              <p className="fine">
                Custom 3D model orders have their own receipts: <a href="#/orders">see your custom model orders</a>.
              </p>
            )}
            <p className="fine billing-policy">
              Cancelling keeps your plan until the end of the period you’ve paid for. See the <a href="#/refunds">Refund policy</a> and the <a href="#/terms">Terms</a>.
            </p>
          </>
        )}
        <LegalLinks />
      </main>

      {confirmCancel && sub && (
        <Dialog title="Cancel your plan?" onClose={() => setConfirmCancel(false)}>
          <p className="dialog-copy">
            You keep {planName(sub.plan)} until <b>{date(sub.currentPeriodEnd)}</b>, then your account is Free.{me && me.unlocks.length ? ' Kitchens you unlocked stay unlocked forever.' : ''}
            {sub.plan === 'contractor' ? ' Your catalog, price book and quotes become read-only, and your clients’ share links keep working.' : ''}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmCancel(false)} data-autofocus>
              Keep my plan
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setConfirmCancel(false);
                void run('cancel', billingApi.cancel);
              }}
            >
              Cancel at period end
            </button>
          </div>
        </Dialog>
      )}

      {portalDemo && demo && (
        <Dialog title="Billing portal (demo)" onClose={() => navigateHash('#/account/billing', true)}>
          <p className="dialog-copy">
            With real payments, this opens Stripe’s secure customer portal, where you update your card and download invoices. BluModel Studio never sees card details. Payments on this server are simulated, so there is nothing to manage here.
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => navigateHash('#/account/billing', true)} data-autofocus>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** What happened at checkout, said once on the way back. */
function ReturnNote({ back, plan }: { back: CheckoutReturn & { confirmed: boolean }; plan: string }) {
  if (back.outcome === 'cancel')
    return (
      <div className="auth-note billing-return" role="status">
        Checkout cancelled. Nothing was charged.
      </div>
    );
  if (back.confirmed)
    return (
      <div className="auth-ok billing-return" role="status">
        Payment received. You’re on {planName(plan)}: exports are unlocked on all your kitchens.
      </div>
    );
  return (
    <div className="auth-note billing-return" role="status">
      Payment received. We’re still confirming it with the payment provider; reload this page in a minute to see your plan.
    </div>
  );
}

/** The Billing page from the session alone, for a server that won't answer `/api/billing/me`. */
function fromSession(): BillingMe {
  const plan = useSession.getState().user?.plan ?? { id: 'free', status: 'none', periodEnd: null, cancelAtPeriodEnd: false, graceUntil: null, provider: null };
  return { plan, subscription: null, unlocks: [], receipts: [], payments: 'demo', demo: false, graceDays: 7 };
}

function statusLine(me: BillingMe, comp: boolean): string {
  const { plan, subscription: sub } = me;
  if (plan.id === 'free') {
    if (sub?.status === 'past_due') return `Your ${planName(sub.plan)} renewal failed and the ${me.graceDays}-day grace period has ended. Update your payment to restore it.`;
    if (sub?.status === 'canceled') return `Your ${planName(sub.plan)} plan ended. Exports are locked; everything you designed is still here.`;
    return 'Design, save and share for free. Exports are a paid feature.';
  }
  if (comp) return plan.periodEnd ? `Complimentary, until ${date(plan.periodEnd)}. There is nothing to pay.` : 'Complimentary. There is nothing to pay.';
  if (plan.status === 'past_due') return `The last payment failed. You keep ${planName(plan.id)} until ${date(plan.graceUntil)} while it is retried.`;
  if (plan.cancelAtPeriodEnd) return `Cancelled. You keep ${planName(plan.id)} until ${date(plan.periodEnd)}.`;
  // What this subscription renews at: its own amount and currency (one started before prices moved
  // to CAD renews in USD at its old price until it is changed or ends).
  const cents = sub?.amountCents ?? PLANS.find((p) => p.id === plan.id)?.priceCents ?? 0;
  return `Renews on ${date(plan.periodEnd)} for ${money(cents, sub?.currency)}.`;
}
