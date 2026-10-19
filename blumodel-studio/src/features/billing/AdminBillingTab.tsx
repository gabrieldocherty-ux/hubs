import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/money';
import { billingApi, type ProviderStats } from './api';
import './billing.css';

/** Admin → Billing: subscriptions, MRR, unlocks and churn, with demo kept apart from real money. */
export default function AdminBillingTab() {
  const [data, setData] = useState<{ payments: 'demo' | 'stripe'; demo: ProviderStats; stripe: ProviderStats } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    billingApi
      .admin()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load billing.'));
  }, []);

  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading billing…</div>;

  return (
    <div className="admin-billing">
      <h1>Billing</h1>
      <p className="muted">
        This server takes payments through <b>{data.payments === 'stripe' ? 'Stripe' : 'the DEMO provider (no real money)'}</b>.
      </p>
      <Provider title="Stripe · real money" stats={data.stripe} />
      <Provider title="Demo · simulated, no money moved" stats={data.demo} demo />
    </div>
  );
}

function Provider({ title, stats, demo = false }: { title: string; stats: ProviderStats; demo?: boolean }) {
  // Money is shown per currency: anything paid or billed before prices moved to CAD stays in USD,
  // and it gets its own tile rather than being added to the CAD figure.
  const others = (by: Record<string, number> | undefined) => Object.entries(by ?? {}).filter(([cur, cents]) => cur !== 'cad' && cents > 0);
  const tiles: [string, string][] = [
    ['MRR', money(stats.mrrCents, 'cad')],
    ...others(stats.mrrByCurrency).map(([cur, cents]): [string, string] => [`MRR still billed in ${cur.toUpperCase()}`, money(cents, cur)]),
    ['Unlimited', String(stats.active.unlimited)],
    ['Contractor', String(stats.active.contractor)],
    ['Kitchen unlocks', `${stats.unlocks} · ${money(stats.unlockCents, 'cad')}${others(stats.unlockByCurrency).map(([cur, cents]) => ` + ${money(cents, cur)}`).join('')}`],
    ['Collected, 30 days', money(stats.collected30dCents, 'cad')],
    ...others(stats.collected30dByCurrency).map(([cur, cents]): [string, string] => [`Collected, 30 days, ${cur.toUpperCase()}`, money(cents, cur)]),
    ['Churn, 30 days', `${Math.round(stats.churn30d * 1000) / 10}%`],
    ['Past due (in grace)', String(stats.pastDue)],
    ['Cancelling at period end', String(stats.cancelling)],
  ];
  return (
    <section className={`admin-card admin-billing-provider${demo ? ' is-demo' : ''}`} aria-label={title}>
      <span className="eyebrow">{title}</span>
      <div className="admin-billing-tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="admin-billing-tile">
            <span>{label}</span>
            <b className="mono">{value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
