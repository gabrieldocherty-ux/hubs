/**
 * Admin > Overview: the business at a glance. Showrooms first (GET /api/admin/showrooms/overview:
 * companies live / lapsed / setting up, MRR from the $50 monthly plans, licenses booked this year,
 * render credits used, sales leads, the studio queue for companies), then the legacy homeowner and
 * contractor numbers (GET /api/admin/dashboard). Real money (Stripe) and demo money are shown
 * apart; every amount keeps its currency, and legacy USD sits on its own line under the CAD
 * figure, never added to it.
 */
import { money } from '../../lib/money';
import { timeAgo } from '../../store/useSession';
import { adminApi } from './api';
import { openUser } from './selection';
import { showroomApi } from './showroomApi';
import type { ShowroomOverview } from './showroomTypes';
import type { Dashboard, DashboardPayment, DashboardSignup, ProviderSubs } from './types';
import { DataTable, MoneyLines, Notice, PLAN_LABEL, Pill, Section, Stat, dateTime, useLoad } from './ui';

const hasDemo = (s: ProviderSubs) => s.unlimited + s.contractor > 0;

function PaymentsBanner({ d }: { d: Dashboard }) {
  if (d.payments === 'stripe' && d.stripeMode === 'live') return null;
  if (d.payments === 'stripe') return <Notice tone="warn">Stripe is in test mode: the Stripe figures below are test charges, not real money.</Notice>;
  if (d.payments === 'demo') return <Notice tone="warn">Demo payments are on: nothing below the demo lines is real money. Stripe figures stay at zero until Stripe is set up (Admin › System).</Notice>;
  return <Notice tone="bad">Payments are off on this server (no Stripe, no demo). See Admin › System for why.</Notice>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The showroom business: what Gabe is selling now (docs/SHOWROOM_PIVOT.md §2). */
function ShowroomStats({ o }: { o: ShowroomOverview }) {
  const c = o.companies;
  const demoMrr = o.monthly.demo.count > 0;
  return (
    <div className="adm-stats" aria-label="Showrooms">
      <Stat title="Companies live" tone={c.lapsed ? 'warn' : undefined}>
        <b className="adm-big mono">{c.live}</b>
        <span className="adm-sub">
          {c.lapsed} lapsed · {c.setup} setting up{c.suspended ? ` · ${c.suspended} suspended` : ''}
        </span>
        <span className="adm-sub">
          <a className="adm-link" href="#/admin/companies">
            {plural(c.total, 'company', 'companies')}
          </a>
        </span>
      </Stat>
      <Stat title="Monthly recurring revenue">
        <MoneyLines by={o.monthly.stripe.byCurrency} />
        <span className="adm-sub">
          {plural(o.monthly.stripe.count, 'paying plan')}
          {o.monthly.comp ? ` · ${o.monthly.comp} complimentary` : ''}
        </span>
        {(o.monthly.pastDue > 0 || o.monthly.cancelling > 0) && (
          <span className="adm-sub">
            {o.monthly.pastDue} in grace · {o.monthly.cancelling} cancelling
          </span>
        )}
        {demoMrr && (
          <span className="adm-sub">
            <span className="adm-tag">demo</span> {Object.entries(o.monthly.demo.byCurrency).map(([cur, v]) => money(v ?? 0, cur)).join(' + ')}
          </span>
        )}
      </Stat>
      <Stat title={`Licenses booked, ${o.licenses.year}`}>
        <MoneyLines by={o.licenses.byCurrency} />
        <span className="adm-sub">
          {plural(o.licenses.count, 'license')}
          {o.licenses.comp ? ` · ${o.licenses.comp} complimentary` : ''}
        </span>
        <span className="adm-sub">{plural(o.licenses.current, 'company', 'companies')} covered today</span>
      </Stat>
      <Stat title="Render credits used, 30 days">
        <b className="adm-big mono">{money(o.credits.used30d.cents)}</b>
        <span className="adm-sub">
          {plural(o.credits.used30d.count, 'render')} · {money(o.credits.usedYear.cents)} this year
        </span>
        <span className="adm-sub">{money(o.credits.outstandingCents)} unspent across companies</span>
      </Stat>
      <Stat title="Sales leads" tone={o.salesLeads.new ? 'warn' : undefined}>
        <b className="adm-big mono">{o.salesLeads.new}</b>
        <span className="adm-sub">
          new ·{' '}
          <a className="adm-link" href="#/admin/sales-leads">
            {o.salesLeads.total} in all
          </a>
        </span>
        <span className="adm-sub">{o.salesLeads.d30} in 30 days</span>
      </Stat>
      <Stat title="Modelling for companies" tone={o.queue.overdue ? 'bad' : undefined}>
        <b className="adm-big mono">{o.queue.open}</b>
        <span className="adm-sub">open for {plural(o.queue.companies, 'company', 'companies')}</span>
        {o.queue.overdue > 0 && (
          <span className="adm-sub">
            <Pill tone="bad">{o.queue.overdue} overdue</Pill>
          </span>
        )}
      </Stat>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: d, error, loading, reload } = useLoad(() => adminApi.dashboard());
  const show = useLoad(() => showroomApi.overview());

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
          <button type="button" className="btn small" onClick={() => (void reload(), void show.reload())} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <PaymentsBanner d={d} />
      {error && <div className="auth-error">{error}</div>}

      <h2 className="adm-group">Showrooms</h2>
      {show.error && !show.data && <div className="auth-error">{show.error}</div>}
      {show.data ? <ShowroomStats o={show.data} /> : !show.error && <p className="empty-note">Loading the showroom numbers…</p>}

      <h2 className="adm-group">Legacy homeowner and contractor plans</h2>
      <p className="adm-note">Nothing new is sold here since the showroom pivot; what was already paid keeps running until it ends.</p>
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
        <Stat title="Legacy monthly revenue">
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
