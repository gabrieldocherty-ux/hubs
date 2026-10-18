import { Suspense, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { amount } from '../../lib/money';
import { hrefFor } from '../../lib/router';
import { day, when, wsApi, type CreditEntry, type CreditsWire } from './api';
import { useWorkspace } from './context';
import { RendersGallery } from '../renders';

const KIND: Record<CreditEntry['kind'], string> = {
  grant: 'Monthly credits',
  expire: 'Expired',
  reserve: 'Render started',
  charge: 'Render',
  release: 'Render didn’t finish: returned',
  refund: 'Refunded',
  adjust: 'Adjusted by BluModel Studio',
};

/**
 * The Renders tab: the showroom's render credits (balance, what a render costs, the next expiry,
 * the ledger). Each paid month adds credits that roll over for three months, oldest spent first.
 * Staff make renders from the editor with "Make it photoreal"; visitors only when the showroom
 * switched visitor renders on. Uses only GET /api/workspace/credits, so it stands on its own
 * whether or not the renders package's page is in this build.
 */
export default function RendersTab() {
  const { tenant } = useWorkspace();
  const [data, setData] = useState<CreditsWire | null>(null);
  const [older, setOlder] = useState<CreditEntry[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wsApi
      .credits()
      .then((r) => {
        setData(r);
        setMore(r.history.length >= 50);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your render credits.'));
  }, []);

  const loadMore = async () => {
    const all = [...(data?.history ?? []), ...older];
    const last = all[all.length - 1];
    if (!last) return;
    try {
      const r = await wsApi.credits(last.id);
      setOlder((cur) => [...cur, ...r.history]);
      setMore(r.history.length >= 50);
    } catch {
      setMore(false);
    }
  };

  if (error) return <div className="ws-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading your render credits…</div>;

  const renders = data.renderCostCents > 0 ? Math.floor(data.balanceCents / data.renderCostCents) : 0;
  const history = [...data.history, ...older];
  const s = tenant.settings;

  return (
    <div className="ws-renders">
      <div className="ws-head">
        <div>
          <span className="eyebrow">Renders</span>
          <h1>Photoreal renders</h1>
          <p>
            Turn any design into a photoreal image with “Make it photoreal” in the editor. Each render uses {amount(data.renderCostCents)} of credits. Your monthly plan adds credits every month; unused credits roll over for {data.rolloverMonths} months, oldest spent
            first.
          </p>
        </div>
      </div>
      <div className="ws-stats">
        <div className="ws-stat">
          <b>{amount(data.balanceCents)}</b>
          <span>credits left · about {renders} render{renders === 1 ? '' : 's'}</span>
        </div>
        <div className="ws-stat">
          <b>{data.nextExpiry ? amount(data.nextExpiry.cents) : '—'}</b>
          <span>{data.nextExpiry ? `expire on ${day(data.nextExpiry.at)} unless used` : 'nothing expiring soon'}</span>
        </div>
        <div className="ws-stat">
          <b>{s.visitorRenders ? `${s.dailyRenderCap}/day` : 'Off'}</b>
          <span>
            visitor renders ·{' '}
            <a href={hrefFor({ name: 'studio', rest: '' })} className="ws-inline-link">
              change on the Showroom tab
            </a>
          </span>
        </div>
      </div>
      {data.heldCents > 0 && <p className="ws-note">{amount(data.heldCents)} is set aside for renders in progress; it’s charged when they finish, or returned if they don’t.</p>}

      {data.lots.length > 0 && (
        <section className="ws-card" aria-labelledby="ws-lots-title">
          <h2 id="ws-lots-title">Credits by month</h2>
          <div className="ws-scroll">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Added</th>
                  <th className="num">Left</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {data.lots.map((l) => (
                  <tr key={l.id}>
                    <td>{day(l.createdAt)}</td>
                    <td className="num">{amount(l.cents)}</td>
                    <td className="num">{amount(l.remaining)}</td>
                    <td>{day(l.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Every render the showroom made (the renders package). */}
      <section className="ws-card" aria-label="Renders">
        <Suspense fallback={<p className="muted">Loading renders…</p>}>
          <RendersGallery title="Renders" />
        </Suspense>
      </section>

      <section className="ws-card" aria-labelledby="ws-ledger-title">
        <h2 id="ws-ledger-title">History</h2>
        {history.length === 0 ? (
          <p className="muted">No credits or renders yet. Your first month’s credits arrive with your first monthly payment.</p>
        ) : (
          <div className="ws-scroll">
            <table className="ws-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th className="num">Change</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id}>
                    <td>{when(e.at)}</td>
                    <td>
                      {KIND[e.kind] ?? e.kind}
                      {e.note ? <span className="fine"> · {e.note}</span> : null}
                    </td>
                    <td className={`num ${e.cents > 0 ? 'ws-amount-plus' : 'ws-amount-minus'}`}>
                      {e.cents > 0 ? '+' : e.cents < 0 ? '−' : ''}
                      {amount(Math.abs(e.cents))}
                    </td>
                    <td className="num">{amount(e.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more && (
          <button type="button" className="btn" onClick={() => void loadMore()}>
            Show older
          </button>
        )}
      </section>
    </div>
  );
}
