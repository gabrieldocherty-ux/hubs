import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { timeAgo } from '../../store/useSession';
import { proApi, type QuoteSummary } from './api';

/** `#/pro/quotes`: every kitchen as a quote at the contractor's sell prices. */
export default function Quotes() {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    proApi
      .quotes()
      .then((r) => setQuotes(r.quotes))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your quotes.'));
  }, []);

  return (
    <div className="pro-quotes">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Quotes</span>
          <h1>Your kitchens, priced</h1>
          <p className="muted">Each kitchen at your sell prices, with your extra lines. Open one to print it or save it as a PDF; clients never see your costs.</p>
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!quotes && !error && <div className="screen-msg">Loading…</div>}
      {quotes && quotes.length === 0 && <p className="empty-note">No kitchens yet. Design one for a client, then quote it from here or from the kitchen’s Export menu.</p>}
      {quotes && quotes.length > 0 && (
        <table className="admin-table pro-table">
          <thead>
            <tr>
              <th>Kitchen</th>
              <th>Client</th>
              <th>Edited</th>
              <th>Valid until</th>
              <th className="num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.projectId}>
                <td>
                  <a href={`#/k/${q.projectId}`}>
                    <b>{q.name}</b>
                  </a>
                  <span className="pro-sub">{q.items} pieces</span>
                </td>
                <td>{q.client || <span className="muted">—</span>}</td>
                <td>{timeAgo(q.updatedAt)}</td>
                <td>{q.validUntil ? new Date(q.validUntil).toLocaleDateString() : <span className="muted">Not set</span>}</td>
                <td className="num mono">{money(q.total)}</td>
                <td className="num">
                  <a className="btn" href={hrefFor({ name: 'pro', rest: `quote/${q.projectId}` })}>
                    Open quote
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
