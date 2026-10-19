/**
 * The company workspace's Renders page, whole (docs/SHOWROOM_PIVOT.md §5): the credit balance,
 * what one render costs, when credits expire, credits by expiry, every render the showroom made
 * (RendersGallery) and the credits ledger. Fetches its own data (GET /api/workspace/credits and
 * /api/workspace/renders); needs only to be on a showroom, signed in as a team member. The
 * workspace's own Renders tab shows the credits itself and adds just RendersGallery.
 */
import { useCallback, useEffect, useState } from 'react';
import { rendersApi, type CreditEntry, type WorkspaceCredits } from './api';
import RendersGallery from './RendersGallery';
import { MONTHLY_CREDIT_CENTS, cents, day, entryLabel, plural, rendersLeft } from './model';
import './renders.css';

export default function RendersPage() {
  const [credits, setCredits] = useState<WorkspaceCredits | null>(null);
  const [history, setHistory] = useState<CreditEntry[]>([]);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await rendersApi.credits();
      setCredits(c);
      setHistory(c.history);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the credits.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const moreHistory = async () => {
    if (!history.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const c = await rendersApi.credits({ before: history[history.length - 1].id });
      setHistory([...history, ...c.history]);
    } finally {
      setLoadingMore(false);
    }
  };

  if (error && !credits)
    return (
      <div className="rn-page">
        <p className="photoreal-error" role="alert">
          {error}
        </p>
      </div>
    );
  if (!credits)
    return (
      <div className="rn-page screen-msg" role="status">
        Loading renders…
      </div>
    );

  const left = rendersLeft(credits.balanceCents, credits.renderCostCents);
  return (
    <div className="rn-page">
      <header className="rn-head">
        <h2>Renders</h2>
        <p>
          Photoreal AI renderings of your showroom’s designs. Each paid month adds {cents(MONTHLY_CREDIT_CENTS)} of credits, kept for {plural(credits.rolloverMonths, 'month')}, oldest spent first.
        </p>
      </header>

      <section className="rn-cards" aria-label="Credits">
        <div className="rn-card">
          <span className="rn-card-label">Balance</span>
          <b className="rn-card-value">{cents(credits.balanceCents)}</b>
          <span className="rn-card-sub">
            about {plural(left, 'render')} at {cents(credits.renderCostCents)} each
          </span>
        </div>
        <div className="rn-card">
          <span className="rn-card-label">Next expiry</span>
          <b className="rn-card-value">{credits.nextExpiry ? cents(credits.nextExpiry.cents) : '—'}</b>
          <span className="rn-card-sub">{credits.nextExpiry ? `on ${day(credits.nextExpiry.at)} unless used` : 'nothing is due to expire'}</span>
        </div>
        <div className="rn-card">
          <span className="rn-card-label">In progress</span>
          <b className="rn-card-value">{cents(credits.heldCents)}</b>
          <span className="rn-card-sub">set aside for renders running now: charged when they finish, returned if they don’t</span>
        </div>
      </section>

      {credits.lots.length > 0 && (
        <section className="rn-section" aria-label="Credits by expiry">
          <h3>Credits by expiry</h3>
          <ul className="rn-lots">
            {credits.lots.map((l) => (
              <li key={l.id}>
                <span>
                  {l.source === 'monthly' ? 'Monthly credits' : 'Added credits'} from {day(l.createdAt)}
                </span>
                <span className="mono">
                  {cents(l.remaining)} of {cents(l.cents)} · expires {day(l.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RendersGallery />

      <section className="rn-section" aria-label="Credit history">
        <h3>Credit history</h3>
        {history.length === 0 ? (
          <p className="empty-note">No credits yet. They arrive with the first paid month.</p>
        ) : (
          <div className="rn-table-wrap">
            <table className="rn-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className={`is-${e.kind}`}>
                    <td>{day(e.at)}</td>
                    <td>
                      {entryLabel(e.kind)}
                      {e.note && e.kind !== 'reserve' && e.kind !== 'charge' ? <span className="rn-note"> · {e.note}</span> : null}
                    </td>
                    <td className="num mono">{e.cents === 0 ? '—' : `${e.cents > 0 ? '+' : ''}${cents(e.cents)}`}</td>
                    <td className="num mono">{cents(e.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {history.length >= 50 && history.length % 50 === 0 && (
          <button type="button" className="btn rn-more" onClick={() => void moreHistory()} disabled={loadingMore}>
            Show older entries
          </button>
        )}
      </section>
    </div>
  );
}
