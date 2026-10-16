/**
 * Admin > Overview: the business at a glance, from one server snapshot (GET /api/admin/dashboard).
 * Real money (Stripe) and demo money are shown apart; every amount keeps its currency, and legacy
 * USD sits on its own line under the CAD figure, never added to it.
 */
import { money } from '../../lib/money';
import { timeAgo } from '../../store/useSession';
import { adminApi } from './api';
import { openUser } from './selection';
import type { Dashboard, DashboardPayment, DashboardSignup, ProviderSubs } from './types';
import { DataTable, MoneyLines, Notice, PLAN_LABEL, Pill, Section, Stat, dateTime, useLoad } from './ui';

const hasDemo = (s: ProviderSubs) => s.unlimited + s.contractor > 0;

function PaymentsBanner({ d }: { d: Dashboard }) {
  if (d.payments === 'stripe' && d.stripeMode === 'live') return null;
  if (d.payments === 'stripe') return <Notice tone="warn">Stripe is in test mode: the Stripe figures below are test charges, not real money.</Notice>;
  if (d.payments === 'demo') return <Notice tone="warn">Demo payments are on: nothing below the demo lines is real money. Stripe figures stay at zero until Stripe is set up (Admin › System).</Notice>;
  return <Notice tone="bad">Payments are off on this server (no Stripe, no demo). See Admin › System for why.</Notice>;
}

export default function AdminDashboard() {
  const { data: d, error, loading, reload } = useLoad(() => adminApi.dashboard());

  if (error && !d) return <div className="auth-error">{error}</div>;
  if (!d) return <div className="screen-msg">Loading the overview…</div>;

  const s = d.subscriptions;
  const m = d.money;
  const demoSubs = hasDemo(s.demo);
  const demoMoney = m.demo.unlocksAll.count > 0 || m.demo.refundsAll.count > 0;

  return (
    <div className="adm adm-overview admin-overview">
      <div className="adm-head">
        <div>
          <h1>Overview</h1>
          <p>Updated {timeAgo(d.generatedAt)}. Amounts keep their currency: CAD, with older USD charges shown apart.</p>
        </div>
        <div className="adm-head-actions">
          <button type="button" className="btn small" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <PaymentsBanner d={d} />
      {error && <div className="auth-error">{error}</div>}

      <div className="adm-stats" aria-label="Key numbers">
        <Stat title="Sign-ups, 7 days">
          <b className="adm-big mono">{d.signups.d7}</b>
          <span className="adm-sub">
            {d.signups.d30} in 30 days · {d.signups.total} accounts{d.signups.disabled ? ` · ${d.signups.disabled} disabled` : ''}
          </span>
        </Stat>
        <Stat title="Paying plans (Stripe)">
          <b className="adm-big mono">{s.stripe.unlimited + s.stripe.contractor}</b>
          <span className="adm-sub">
            Unlimited {s.stripe.unlimited} · Contractor {s.stripe.contractor}
          </span>
          {(s.stripe.pastDue > 0 || s.stripe.cancelling > 0) && (
            <span className="adm-sub">
              {s.stripe.pastDue} past due · {s.stripe.cancelling} cancelling
            </span>
          )}
          <span className="adm-sub">
            Complimentary: Unlimited {s.comp.unlimited} · Contractor {s.comp.contractor}
          </span>
          {demoSubs && (
            <span className="adm-sub">
              <span className="adm-tag">demo</span> Unlimited {s.demo.unlimited} · Contractor {s.demo.contractor}
            </span>
          )}
        </Stat>
        <Stat title="Monthly recurring revenue">
          <MoneyLines by={s.stripe.mrrByCurrency} legacyLabel="legacy" />
          {demoSubs && (
            <span className="adm-sub">
              <span className="adm-tag">demo</span> {Object.entries(s.demo.mrrByCurrency).map(([c, v]) => money(v ?? 0, c)).join(' + ') || '$0 CAD'}
            </span>
          )}
        </Stat>
        <Stat title="Kitchen unlocks, 30 days">
          <MoneyLines by={m.stripe.unlocks30d.byCurrency} />
          <span className="adm-sub">
            {m.stripe.unlocks30d.count} unlock{m.stripe.unlocks30d.count === 1 ? '' : 's'} · {m.stripe.unlocksAll.count} all time
          </span>
          {demoMoney && (
            <span className="adm-sub">
              <span className="adm-tag">demo</span> {m.demo.unlocksAll.count} all time
            </span>
          )}
        </Stat>
        <Stat title="Refunds, 30 days" tone={m.stripe.refunds30d.count ? 'warn' : undefined}>
          <MoneyLines by={m.stripe.refunds30d.byCurrency} />
          <span className="adm-sub">
            {m.stripe.refunds30d.count} refund{m.stripe.refunds30d.count === 1 ? '' : 's'} · {m.stripe.refundsAll.count} all time
          </span>
        </Stat>
        <Stat title="Custom models this period">
          <b className="adm-big mono">
            {d.models.used} / {d.models.included + d.models.granted}
          </b>
          <span className="adm-sub">
            used across {d.models.contractors} Contractor plan{d.models.contractors === 1 ? '' : 's'}
            {d.models.granted ? ` (${d.models.granted} extra granted)` : ''}
          </span>
        </Stat>
        <Stat title="Studio queue" tone={d.studioQueue.overdue ? 'bad' : undefined}>
          <b className="adm-big mono">{d.studioQueue.open}</b>
          <span className="adm-sub">
            {d.studioQueue.toStart} to start · {d.studioQueue.inProgress} in progress · {d.studioQueue.revision} revision
          </span>
          {d.studioQueue.overdue > 0 && (
            <span className="adm-sub">
              <Pill tone="bad">{d.studioQueue.overdue} overdue</Pill>
            </span>
          )}
        </Stat>
        <Stat title="Brand-page leads, 30 days">
          <b className="adm-big mono">{d.leads.d30}</b>
          <span className="adm-sub">
            {d.leads.d7} in 7 days · {d.leads.unread} unread
          </span>
        </Stat>
        <Stat title="Retail link-outs, 30 days">
          <b className="adm-big mono">{d.retail.d30}</b>
          <span className="adm-sub">{d.retail.d7} in 7 days</span>
        </Stat>
      </div>

      <div className="adm-cols">
        <Section title="Recent sign-ups" id="adm-recent-signups">
          <DataTable<DashboardSignup>
            label="Recent sign-ups"
            rows={d.recentSignups}
            rowKey={(u) => u.id}
            empty="No sign-ups yet."
            columns={[
              {
                label: 'Account',
                primary: true,
                cell: (u) => (
                  <span className="adm-who">
                    <button type="button" className="adm-link" onClick={() => openUser(u.id)}>
                      {u.name}
                    </button>
                    <span>{u.email}</span>
                  </span>
                ),
              },
              { label: 'Plan', cell: (u) => (u.disabled ? <Pill tone="bad">Disabled</Pill> : PLAN_LABEL[u.plan] ?? u.plan) },
              { label: 'Joined', cell: (u) => timeAgo(u.createdAt) },
            ]}
          />
        </Section>
        <Section title="Recent payments" id="adm-recent-payments">
          <DataTable<DashboardPayment>
            label="Recent payments"
            rows={d.recentPayments}
            rowKey={(p) => `${p.kind}-${p.at}-${p.userId ?? ''}-${p.amountCents}`}
            empty="No payments yet."
            columns={[
              {
                label: 'Payment',
                primary: true,
                cell: (p) => (
                  <span className="adm-who">
                    <b>{p.label}</b>
                    <span>{p.email ?? 'Deleted account'}</span>
                  </span>
                ),
              },
              {
                label: 'Amount',
                cell: (p) => (
                  <span className="mono">
                    {money(p.amountCents, p.currency)} {p.provider === 'demo' && <span className="adm-tag">demo</span>}
                  </span>
                ),
              },
              { label: 'When', cell: (p) => dateTime(p.at) },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
