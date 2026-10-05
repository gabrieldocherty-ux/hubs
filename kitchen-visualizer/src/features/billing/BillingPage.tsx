import { useCallback, useEffect, useState } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Dialog } from '../../components/Dialog';
import { Check, Logo } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { navigateHash, pageQuery, useHashQuery } from '../../lib/router';
import { useSession } from '../../store/useSession';
import type { Plan } from '../../types/platform';
import plansJson from '../../data/plans.json';
import { billingApi, dollars, goToCheckout, type BillingMe } from './api';
import { loadEntitlements } from './entitlements';
import './billing.css';

const PLANS = plansJson as Plan[];
const planName = (id: string) => PLANS.find((p) => p.id === id)?.name ?? id;
const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—');

/** `#/account/billing` (PLANS_AND_CONTRACTORS §5): plan, changes, cancellation, unlocks and receipts. */
export default function BillingPage() {
  const query = useHashQuery();
  const [me, setMe] = useState<BillingMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const portalDemo = query.get('portal') === 'demo';

  const apply = useCallback(async (next: BillingMe) => {
    setMe(next);
    await Promise.all([loadEntitlements(true), useSession.getState().refresh()]);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      // Back from Stripe Checkout: confirm the payment without waiting for the webhook.
      const sessionId = pageQuery().get('session_id');
      if (sessionId) {
        try {
          await billingApi.sync(sessionId);
        } catch {
          /* the webhook will catch up */
        }
        history.replaceState(null, '', `${location.pathname}${location.hash}`);
      }
      const next = await billingApi.me();
      if (live) await apply(next);
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
      setError(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const subscribe = async (plan: 'unlimited' | 'contractor') => {
    setBusy(plan);
    setError(null);
    try {
      const r = await billingApi.checkout({ kind: 'subscription', plan, returnTo: plan === 'contractor' ? '#/pro' : '#/account/billing' });
      goToCheckout(r.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the payment.');
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy('portal');
    try {
      goToCheckout((await billingApi.portal()).url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the billing portal.');
    } finally {
      setBusy(null);
    }
  };

  const sub = me?.subscription ?? null;
  const plan = me?.plan;
  const onPlan = plan && plan.id !== 'free';
  const other = plan?.id === 'unlimited' ? 'contractor' : 'unlimited';

  return (
    <div className="billing">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <AccountMenu />
      </header>
      <main className="home-main billing-main">
        <div className="home-head">
          <div>
            <span className="eyebrow">Account</span>
            <h1>Billing</h1>
          </div>
          {me?.demo && (
            <span className="demo-chip" title="Payments on this server are simulated: no real money moves.">
              Demo payments
            </span>
          )}
        </div>
        {error && <div className="auth-error billing-error">{error}</div>}
        {!me && !error && <div className="screen-msg">Loading billing…</div>}
        {me && plan && (
          <>
            <section className="billing-card billing-current" aria-labelledby="current-plan">
              <div>
                <span className="eyebrow">Current plan</span>
                <h2 id="current-plan">{planName(plan.id)}</h2>
                <p className="billing-status">{statusLine(me)}</p>
              </div>
              <div className="billing-actions">
                {onPlan && sub && (
                  <>
                    {!sub.cancelAtPeriodEnd && (
                      <button className="btn" onClick={() => run('change', () => billingApi.change(other))} disabled={!!busy}>
                        {busy === 'change' ? 'Changing…' : `Switch to ${planName(other)} (${dollars(PLANS.find((p) => p.id === other)!.priceCents)}/mo)`}
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
                {sub && (
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
                <div className="billing-plans">
                  {(['unlimited', 'contractor'] as const).map((id) => {
                    const p = PLANS.find((x) => x.id === id)!;
                    return (
                      <section key={id} className={`plan-option${id === 'contractor' ? ' plan-option--featured' : ''}`} aria-label={p.name}>
                        <span className="eyebrow">Monthly</span>
                        <h4>{p.name}</h4>
                        <div className="plan-price">
                          <b>{dollars(p.priceCents)}</b>
                          <span>/ month</span>
                        </div>
                        <p className="plan-note">{p.tagline}</p>
                        <ul className="plan-bullets">
                          {p.bullets.map((b) => (
                            <li key={b}>
                              <Check width={14} height={14} /> {b}
                            </li>
                          ))}
                        </ul>
                        <button className={id === 'contractor' ? 'btn primary wide' : 'btn wide'} onClick={() => subscribe(id)} disabled={!!busy}>
                          {busy === id ? 'Starting…' : `Choose ${p.name}`}
                        </button>
                      </section>
                    );
                  })}
                </div>
                <p className="fine">One kitchen only? Open it and choose Export: you can unlock just that kitchen for {dollars(PLANS.find((p) => p.id === 'kitchen_unlock')!.priceCents)}, once.</p>
              </section>
            )}

            {me.demo && sub?.provider === 'demo' && (
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

            <section className="billing-card" aria-labelledby="unlocks-title">
              <span className="eyebrow" id="unlocks-title">
                Unlocked kitchens
              </span>
              {me.unlocks.length === 0 ? (
                <p className="empty-note">None yet. Unlock one kitchen from its Export menu.</p>
              ) : (
                <ul className="billing-list">
                  {me.unlocks.map((u) => (
                    <li key={u.projectId}>
                      <a href={`#/k/${u.projectId}`}>{u.name}</a>
                      <span className="muted">Unlocked {date(u.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

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
                          {r.provider === 'demo' && <span className="demo-tag">Demo</span>}
                        </td>
                        <td className="num mono">{dollars(r.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>

      {confirmCancel && sub && (
        <Dialog title="Cancel your plan?" onClose={() => setConfirmCancel(false)}>
          <p className="dialog-copy">
            You keep {planName(sub.plan)} until <b>{date(sub.currentPeriodEnd)}</b>, then your account is Free. Kitchens you unlocked for {dollars(500)} stay unlocked forever.
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

      {portalDemo && (
        <Dialog title="Billing portal (demo)" onClose={() => navigateHash('#/account/billing', true)}>
          <p className="dialog-copy">
            With real payments, this opens Stripe’s secure customer portal, where you update your card and download invoices. Mise never sees card details. Payments on this server are simulated, so there is nothing to manage here.
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

function statusLine(me: BillingMe): string {
  const { plan, subscription: sub } = me;
  if (plan.id === 'free') {
    if (sub?.status === 'past_due') return `Your ${planName(sub.plan)} renewal failed and the ${me.graceDays}-day grace period has ended. Update your payment to restore it.`;
    if (sub?.status === 'canceled') return `Your ${planName(sub.plan)} plan ended. Exports are locked; everything you designed is still here.`;
    return 'Design, save and share for free. Exports need a plan or a one-time kitchen unlock.';
  }
  if (plan.status === 'past_due') return `The last payment failed. You keep ${planName(plan.id)} until ${date(plan.graceUntil)} while it is retried.`;
  if (plan.cancelAtPeriodEnd) return `Cancelled. You keep ${planName(plan.id)} until ${date(plan.periodEnd)}.`;
  return `Renews on ${date(plan.periodEnd)} for ${dollars(PLANS.find((p) => p.id === plan.id)?.priceCents ?? 0)}.`;
}
