import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { timeAgo } from '../../store/useSession';
import { proApi, type Dashboard as DashboardData } from './api';
import { useWorkspace } from './ContractorRoot';

/** `#/pro`: the workspace at a glance, and what to do next. */
export default function Dashboard() {
  const { profile, readOnly } = useWorkspace();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    proApi
      .dashboard()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the dashboard.'));
  }, []);

  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading…</div>;
  const c = data.counts;

  const todo: [string, string, string][] = [];
  if (!readOnly && c.products === 0) todo.push(['Add the cabinets you sell', 'Quick add a line in an afternoon: no 3D modelling needed.', hrefFor({ name: 'pro', rest: 'catalog/new' })]);
  if (!readOnly && c.uncosted > 0) todo.push([`Enter costs for ${c.uncosted} product${c.uncosted === 1 ? '' : 's'}`, 'Until then they sell at list price, and your margin can’t be worked out.', hrefFor({ name: 'pro', rest: 'price-book' })]);
  if (!readOnly && !profile.logoUrl) todo.push(['Add your logo', 'It goes on every quote and share link.', hrefFor({ name: 'pro', rest: 'company' })]);
  if (c.kitchens === 0) todo.push(['Design a client’s kitchen', 'Put their name in the Client field and their kitchens group together.', '#/new']);

  return (
    <div className="pro-dashboard">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Contractor workspace</span>
          <h1>{profile.company}</h1>
        </div>
        <div className="pro-head-actions">
          <a className="btn" href="#/new">
            New client kitchen
          </a>
          {!readOnly && (
            <a className="btn primary" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
              Add a product
            </a>
          )}
        </div>
      </div>
      <div className="pro-stats">
        <a href={hrefFor({ name: 'pro', rest: 'catalog' })}>
          <b className="mono">{c.products}</b>
          <span>products in my catalog</span>
        </a>
        <a href={hrefFor({ name: 'pro', rest: 'catalog' })}>
          <b className="mono">{c.lines}</b>
          <span>product lines</span>
        </a>
        <a href={hrefFor({ name: 'pro', rest: 'quotes' })}>
          <b className="mono">{c.kitchens}</b>
          <span>kitchens</span>
        </a>
        <a href="#/">
          <b className="mono">{c.clients}</b>
          <span>clients</span>
        </a>
      </div>
      {todo.length > 0 && (
        <section className="pro-card" aria-labelledby="todo-title">
          <span className="eyebrow" id="todo-title">
            Next steps
          </span>
          <ul className="pro-todo">
            {todo.map(([title, why, href]) => (
              <li key={title}>
                <a href={href}>
                  <b>{title}</b>
                  <span>{why}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="pro-card" aria-labelledby="recent-title">
        <span className="eyebrow" id="recent-title">
          Recent kitchens
        </span>
        {data.recent.length === 0 ? (
          <p className="empty-note">No kitchens yet.</p>
        ) : (
          <ul className="pro-list">
            {data.recent.map((k) => (
              <li key={k.id}>
                <a href={`#/k/${k.id}`}>
                  <b>{k.name}</b>
                  <span>{k.client || 'No client yet'}</span>
                </a>
                <span className="muted">Edited {timeAgo(k.updatedAt)}</span>
                <a className="btn" href={hrefFor({ name: 'pro', rest: `quote/${k.id}` })}>
                  Quote
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
