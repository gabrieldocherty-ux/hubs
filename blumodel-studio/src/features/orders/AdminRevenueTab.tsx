import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { ordersApi, type RevenueSlice, type RevenueWire } from './api';
import { dollars } from './model';
import './orders.css';

const RANGES = [30, 90, 365] as const;
/** Model packs since 2026-10-14; the retired tiers stay so older orders still add up. */
const TIER_NAME: Record<string, string> = { pack: 'Model pack', simple: 'Simple (retired)', standard: 'Standard (retired)', complex: 'Complex (retired)' };

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * `#/admin/revenue` (PRODUCT_SPEC §8): custom-model orders only (subscriptions and unlocks are
 * Admin → Billing). Gross, refunds and net, by tier, by day and average turnaround, with DEMO and
 * Stripe kept apart: the headline is the active provider, the other one is shown beside it.
 */
export default function AdminRevenueTab() {
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<RevenueWire | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    ordersApi
      .revenue(days)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load revenue.'));
    return () => {
      live = false;
    };
  }, [days]);

  const demo = data?.provider === 'demo';
  const other = data ? (demo ? data.byProvider.stripe : data.byProvider.demo) : null;

  return (
    <div className="ord-revenue">
      <div className="ord-rev-head">
        <div>
          <h1>Revenue</h1>
          <p className="muted">Custom-model orders only. Plans and kitchen unlocks are under Billing.</p>
        </div>
        <div className="chips ord-chips" role="group" aria-label="Period">
          {RANGES.map((n) => (
            <button key={n} type="button" className={n === days ? 'chip on' : 'chip'} aria-pressed={n === days} onClick={() => setDays(n)}>
              {n === 365 ? '12 months' : `${n} days`}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!data && !error && <div className="ord-loading">Loading revenue…</div>}
      {data && (
        <>
          {demo && (
            <div className="ord-demo" role="note">
              <b>Demo</b>
              <span>Payments run on the DEMO provider: these figures are simulated orders, not money. Stripe takes over once both keys are set.</span>
            </div>
          )}
          <div className="ord-kpis">
            <Kpi label={`Gross${demo ? ' (demo)' : ''}`} value={dollars(data.gross)} sub={`${data.count} paid order${data.count === 1 ? '' : 's'}`} />
            <Kpi label="Refunds" value={dollars(data.refunds)} sub={`${data.refundCount} refund${data.refundCount === 1 ? '' : 's'}`} />
            <Kpi label="Net" value={dollars(data.net)} sub={`last ${data.days} days`} />
            <Kpi label="Average order" value={data.count ? dollars(Math.round(data.gross / data.count)) : '—'} sub="gross ÷ paid orders" />
            <Kpi label="Avg turnaround" value={data.avgTurnaroundDays == null ? '—' : `${data.avgTurnaroundDays} d`} sub="paid → first delivery" />
          </div>
          {other && (
            <p className="fine">
              {demo ? 'Stripe' : 'Demo'} in the same period, kept separate: {dollars(other.gross)} gross, {dollars(other.refunds)} refunds, {other.count} order{other.count === 1 ? '' : 's'}.
            </p>
          )}
          <div className="ord-rev-grid">
            <section className="admin-card">
              <span className="eyebrow">By tier</span>
              <ByTier slice={data} />
            </section>
            <section className="admin-card">
              <span className="eyebrow">By day</span>
              <ByDay slice={data} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="ord-kpi">
      <span className="eyebrow">{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

function ByTier({ slice }: { slice: RevenueSlice }) {
  const total = slice.byTier.reduce((s, t) => s + t.gross, 0);
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Tier</th>
          <th className="ord-num">Models</th>
          <th className="ord-num">Gross</th>
          <th className="ord-num">Share</th>
        </tr>
      </thead>
      <tbody>
        {slice.byTier.map((t) => (
          <tr key={t.tier}>
            <td>{TIER_NAME[t.tier] ?? t.tier}</td>
            <td className="ord-num">{t.items}</td>
            <td className="ord-num mono">{dollars(t.gross)}</td>
            <td className="ord-num">{total ? `${Math.round((t.gross / total) * 100)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Daily gross as thin bars (one series, refunds hatched under it), a hover/focus readout and a table view. */
function ByDay({ slice }: { slice: RevenueSlice }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = slice.byDay;
  const max = Math.max(1, ...rows.map((r) => r.gross + r.refunds));
  const h = hover != null ? rows[hover] : null;
  const any = rows.some((r) => r.gross || r.refunds);
  if (!rows.length) return <p className="empty-note">No days in range.</p>;
  return (
    <>
      <div className="ord-bars" role="list" aria-label="Gross and refunds by day" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <div
            key={r.day}
            role="listitem"
            className="ord-bar"
            tabIndex={r.gross || r.refunds ? 0 : -1}
            aria-label={`${dayLabel(r.day)}: ${dollars(r.gross)} gross from ${r.count} orders${r.refunds ? `, ${dollars(r.refunds)} refunded` : ''}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            {r.gross > 0 && <span style={{ height: `${(r.gross / max) * 100}%` }} />}
            {r.refunds > 0 && <span className="ord-bar-refund" style={{ height: `${(r.refunds / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div className="ord-bars-axis">
        <span>{dayLabel(rows[0]!.day)}</span>
        <span>{dayLabel(rows[rows.length - 1]!.day)}</span>
      </div>
      <p className="ord-bar-tip" aria-live="polite">
        {h ? `${dayLabel(h.day)} · ${dollars(h.gross)} gross · ${h.count} order${h.count === 1 ? '' : 's'}${h.refunds ? ` · ${dollars(h.refunds)} refunded` : ''}` : any ? 'Hover or focus a bar for the day’s figures.' : 'No paid orders in this period.'}
      </p>
      <div className="ord-legend">
        <span>
          <i aria-hidden />
          Gross
        </span>
        <span>
          <i className="ord-legend-refund" aria-hidden />
          Refunds
        </span>
      </div>
      <details>
        <summary className="fine">Table view</summary>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="ord-num">Orders</th>
              <th className="ord-num">Gross</th>
              <th className="ord-num">Refunds</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.gross || r.refunds)
              .map((r) => (
                <tr key={r.day}>
                  <td>{dayLabel(r.day)}</td>
                  <td className="ord-num">{r.count}</td>
                  <td className="ord-num mono">{dollars(r.gross)}</td>
                  <td className="ord-num mono">{dollars(r.refunds)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
