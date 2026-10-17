import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { amount, money } from '../../lib/money';
import { day, wsApi, type Monthly, type PlanWire } from './api';
import { useWorkspace } from './context';

const PAID_HOW: Record<string, string> = { invoice: 'Invoice', etransfer: 'Interac e-Transfer', cheque: 'Cheque', card: 'Card', cash: 'Cash', comp: 'Complimentary', other: 'Other' };
const RECEIPT_KIND: Record<string, string> = { license: 'Yearly license', monthly: 'Monthly plan', showroom_monthly: 'Monthly plan' };

function monthlyState(m: Monthly | null, graceDays: number): { tone: string; label: string; text: string } {
  if (!m) return { tone: 'warn', label: 'Not started', text: 'We send you a secure card payment link when your showroom is ready to go live.' };
  if (m.provider === 'comp') return { tone: 'ok', label: 'Complimentary', text: 'Your monthly plan is complimentary for now: nothing is charged.' };
  if (m.provider === 'demo') return { tone: 'info', label: 'Demo', text: 'A demonstration plan: no money moves.' };
  if (m.status === 'past_due')
    return {
      tone: 'bad',
      label: 'Payment failed',
      text: m.graceUntil ? `The last payment didn’t go through. Your showroom stays live until ${day(m.graceUntil)} while the card is retried (${graceDays} days of grace). Update the card to keep it running.` : 'The last payment didn’t go through. Update the card to keep your showroom running.',
    };
  if (m.status === 'active' && m.cancelAtPeriodEnd) return { tone: 'warn', label: 'Ending', text: `The monthly plan ends on ${day(m.periodEnd)}; the showroom pauses then. Everything is kept.` };
  if (m.status === 'active') return { tone: 'ok', label: 'Active', text: m.periodEnd ? `Renews on ${day(m.periodEnd)}.` : 'Active.' };
  if (m.status === 'canceled') return { tone: 'bad', label: 'Cancelled', text: 'The monthly plan is cancelled, so the showroom is paused. Everything is kept; contact us to restart it.' };
  return { tone: 'warn', label: m.status, text: 'Contact us if this doesn’t look right.' };
}

/**
 * The Plan tab: the yearly license (dates, amount, how it was paid), the $50 monthly plan ($25
 * hosting with the web address, $25 of render credits) with its status, receipts, and for an owner
 * the Stripe portal to update the card. Prices come from the server (src/data/plans.json).
 */
export default function PlanTab() {
  const { owner } = useWorkspace();
  const [plan, setPlan] = useState<PlanWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    wsApi
      .plan()
      .then(setPlan)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your plan.'));
  }, []);

  const portal = async () => {
    setBusy(true);
    setPortalError(null);
    try {
      const { url } = await wsApi.portal();
      location.assign(url);
    } catch (e) {
      setPortalError(e instanceof ApiError ? e.message : 'Could not open the card page.');
      setBusy(false);
    }
  };

  if (error) return <div className="ws-error">{error}</div>;
  if (!plan) return <div className="screen-msg">Loading your plan…</div>;

  const m = monthlyState(plan.monthly, plan.graceDays);
  const lic = plan.license;
  const daysLeft = lic ? Math.ceil((new Date(`${lic.endsOn}T23:59:59Z`).getTime() - Date.now()) / 86_400_000) : 0;
  const live = plan.standing.licenseCurrent && plan.standing.monthlyPaid;

  return (
    <div className="ws-plan">
      <div className="ws-head">
        <div>
          <span className="eyebrow">Plan</span>
          <h1>Your plan</h1>
          <p>Your showroom is live while the yearly license is current and the monthly plan is paid. If either lapses, visitors see a polite “temporarily unavailable” page and nothing is deleted.</p>
        </div>
        <span className={`ws-pill ${live ? 'ok' : 'warn'}`}>{live ? 'Showroom live' : plan.standing.status === 'setup' ? 'Being set up' : 'Showroom paused'}</span>
      </div>

      <div className="ws-plan-grid">
        <section className="ws-card" aria-labelledby="ws-license-title">
          <div className="ws-plan-head">
            <h2 id="ws-license-title">Yearly license</h2>
            <span className={`ws-pill ${lic ? (daysLeft <= 30 ? 'warn' : 'ok') : 'bad'}`}>{lic ? (daysLeft <= 30 ? `Ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Current') : 'No current license'}</span>
          </div>
          {lic ? (
            <dl className="ws-kv">
              <dt>Period</dt>
              <dd>
                {day(lic.startsOn)} to {day(lic.endsOn)}
              </dd>
              <dt>Amount</dt>
              <dd>
                {money(lic.amountCents, lic.currency)}
              </dd>
              <dt>Paid by</dt>
              <dd>{PAID_HOW[lic.paidHow] ?? lic.paidHow}</dd>
              {lic.note && (
                <>
                  <dt>Note</dt>
                  <dd>{lic.note}</dd>
                </>
              )}
            </dl>
          ) : (
            <p>There’s no license in force today. We record it once your agreement is signed; contact us if you’ve already paid.</p>
          )}
          <p className="fine">
            The license covers the showroom software, its setup and modelling your starting range, at the amount on your order or invoice. More products are quoted
            from the Products tab. We contact you before it renews.
          </p>
        </section>

        <section className="ws-card" aria-labelledby="ws-monthly-title">
          <div className="ws-plan-head">
            <h2 id="ws-monthly-title">Monthly plan</h2>
            <span className={`ws-pill ${m.tone}`}>{m.label}</span>
          </div>
          <div className="ws-plan-price">
            <b>{amount(plan.monthly?.amountCents ?? plan.prices.monthly.cents)}</b>
            <span className="muted">{(plan.monthly?.currency ?? plan.prices.currency).toUpperCase()} a month</span>
          </div>
          <ul className="ws-breakdown">
            <li>
              <span>Hosting, updates and your web address</span>
              <span>{money(plan.prices.monthly.hostingCents)}</span>
            </li>
            <li>
              <span>Photoreal render credits (roll over 3 months)</span>
              <span>{money(plan.prices.monthly.creditCents)}</span>
            </li>
          </ul>
          <p>{m.text}</p>
          {owner && plan.monthly?.provider === 'stripe' && plan.monthly.hasPaymentMethod && (
            <div className="ws-actions">
              <button type="button" className="btn primary" onClick={() => void portal()} disabled={busy}>
                {busy ? 'Opening…' : 'Update card or see invoices'}
              </button>
              <span className="fine">Opens Stripe’s secure billing page.</span>
            </div>
          )}
          {!owner && plan.monthly?.provider === 'stripe' && <p className="fine">An owner of the showroom manages the card.</p>}
          {portalError && <div className="ws-error">{portalError}</div>}
        </section>
      </div>

      <section className="ws-card" aria-labelledby="ws-receipts-title">
        <h2 id="ws-receipts-title">Receipts</h2>
        {plan.receipts.length === 0 ? (
          <p className="muted">No payments recorded yet.</p>
        ) : (
          <div className="ws-scroll">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>For</th>
                  <th>Paid by</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {plan.receipts.map((r) => (
                  <tr key={String(r.id)}>
                    <td>{day(r.createdAt)}</td>
                    <td>
                      {RECEIPT_KIND[r.kind] ?? r.kind}
                      {r.periodEnd ? <span className="fine"> · to {day(r.periodEnd)}</span> : null}
                    </td>
                    <td>{r.provider === 'stripe' ? 'Card' : r.provider === 'demo' ? 'Demo' : (PAID_HOW[r.provider] ?? r.provider)}</td>
                    <td className="num">
                      {money(r.amountCents, r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {plan.licenses.length > 1 && (
          <p className="fine">
            Earlier licenses:{' '}
            {plan.licenses
              .filter((l) => l.id !== lic?.id)
              .map((l) => `${day(l.startsOn)} to ${day(l.endsOn)}`)
              .join('; ')}
            .
          </p>
        )}
      </section>
    </div>
  );
}
