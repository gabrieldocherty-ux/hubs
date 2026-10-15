import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Check, Logo, Search, Wordmark } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { hrefFor, navigateHash, signinHref } from '../../lib/router';
import { useSession } from '../../store/useSession';
import { brandApi } from '../brands/api';
import { LegalLinks } from '../legal/LegalLinks';
import { finderApi, rememberNear, rememberedNear, type ContractorCard, type ContractorList } from './api';
import { initials, siteLabel } from './logic';
import './finder.css';

const LeadForm = lazy(() => import('../brands/LeadForm'));

type State = { kind: 'loading' } | { kind: 'ready'; list: ContractorList } | { kind: 'error'; message: string };

/**
 * `#/contractors?near=&kitchen=`: every verified contractor with a live brand page, searchable by
 * city, region or postal code against the areas they serve. `kitchen` (from the editor's popover)
 * is attached to "Ask for a quote" as a view-only link.
 */
export default function ContractorsPage({ near: initialNear = '', kitchen }: { near?: string; kitchen?: string }) {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const isContractor = useSession((s) => !!s.user?.contractor);
  const [query, setQuery] = useState(initialNear || rememberedNear());
  const [searched, setSearched] = useState(query.trim());
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [lead, setLead] = useState<ContractorCard | null>(null);
  const [attempt, setAttempt] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    document.title = 'Find a contractor · BluModel Studio';
    return () => {
      document.title = 'BluModel Studio';
    };
  }, []);

  // Typing searches after a short pause; the address keeps the search so it can be shared.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = window.setTimeout(() => setSearched(query.trim()), 400);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    rememberNear(searched);
    navigateHash(hrefFor({ name: 'contractors', ...(searched ? { near: searched } : {}), ...(kitchen ? { kitchen } : {}) }), true);
    finderApi
      .list({ near: searched, limit: 50 }, ctrl.signal)
      .then((list) => setState({ kind: 'ready', list }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState({
          kind: 'error',
          message: e instanceof ApiError && e.status === 429 ? 'That was a lot of searches. Wait a minute and try again.' : e instanceof ApiError && e.status === 0 ? 'Can’t reach BluModel Studio right now. Check your connection.' : 'The list couldn’t load. Try again in a moment.',
        });
      });
    return () => ctrl.abort();
  }, [searched, kitchen, attempt]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSearched(query.trim());
  };
  const showAll = () => {
    setQuery('');
    setSearched('');
  };
  const ask = (c: ContractorCard) => {
    void brandApi.event(c.slug, 'quote_click');
    setLead(c);
  };

  const list = state.kind === 'ready' ? state.list : null;

  return (
    <div className="fd-screen">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        {signedIn ? (
          <AccountMenu />
        ) : (
          <a className="btn" href={signinHref()}>
            Sign in
          </a>
        )}
      </header>
      <main className="fd-main">
        <section className="fd-intro">
          <h1>Find a contractor</h1>
          <p>Kitchen contractors on BluModel Studio. Each one is a real business we’ve checked. Search by the city or postal code where the kitchen is.</p>
          <form className="fd-search" role="search" onSubmit={submit}>
            <label className="fd-search-box">
              <Search width={16} height={16} aria-hidden="true" />
              <span className="fd-sr">City or postal code</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="City or postal code, e.g. Hamilton or L8P 4R5" maxLength={60} autoComplete="postal-code" enterKeyHint="search" />
            </label>
            <button type="submit" className="btn primary">
              Search
            </button>
          </form>
        </section>

        <div aria-live="polite" className="fd-status">
          {state.kind === 'loading' && <p className="fd-msg">Loading contractors…</p>}
          {state.kind === 'error' && (
            <div className="fd-msg">
              <p>{state.message}</p>
              <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {list && list.total === 0 && (
            <div className="fd-empty">
              <h2>No contractors listed yet</h2>
              <p>Contractors are joining. In the meantime your kitchen design, shopping list and plans are yours to take to any contractor.</p>
            </div>
          )}
          {list && list.total > 0 && list.contractors.length === 0 && (
            <div className="fd-empty">
              <h2>No one lists “{searched}” yet</h2>
              <p>No verified contractor names that place in the area they serve. Try a nearby city, or see everyone.</p>
              <button className="btn" onClick={showAll}>
                Show all {list.total} contractor{list.total === 1 ? '' : 's'}
              </button>
            </div>
          )}
          {list && list.contractors.length > 0 && (
            <p className="fd-count">
              {searched ? `${list.matched} of ${list.total} serve${list.matched === 1 ? 's' : ''} “${searched}”` : `${list.total} verified contractor${list.total === 1 ? '' : 's'}`}
              {searched && (
                <button type="button" className="fd-clear" onClick={showAll}>
                  Show all
                </button>
              )}
            </p>
          )}
        </div>

        {list && list.contractors.length > 0 && (
          <ul className="fd-grid">
            {list.contractors.map((c) => (
              <li key={c.slug} className="fd-card">
                <a className="fd-card-head" href={hrefFor({ name: 'brandPage', slug: c.slug })}>
                  <span className="fd-logo" aria-hidden="true">
                    {c.logoUrl ? <img src={c.logoUrl} alt="" loading="lazy" /> : <span>{initials(c.name)}</span>}
                  </span>
                  <span className="fd-title">
                    <span className="fd-badges">
                      <span className="fd-verified" title="BluModel Studio checked that this business is real.">
                        <Check width={12} height={12} /> Verified contractor
                      </span>
                      {c.isDemo && <span className="finder-tag">Demo</span>}
                    </span>
                    <b className="fd-name">{c.name}</b>
                  </span>
                </a>
                {c.tagline && <p className="fd-tagline">{c.tagline}</p>}
                <p className="fd-meta">
                  {c.serviceArea && <span>Serves {c.serviceArea}</span>}
                  {c.website && (
                    <a href={c.website} target="_blank" rel="noopener nofollow noreferrer">
                      {siteLabel(c.website)}
                    </a>
                  )}
                  {c.phone && <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}>{c.phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                </p>
                <div className="fd-actions">
                  <a className="btn" href={hrefFor({ name: 'brandPage', slug: c.slug })}>
                    View page
                  </a>
                  {c.leadForm && (
                    <button type="button" className="btn primary" onClick={() => ask(c)}>
                      Ask for a quote
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="fd-foot">
          <p className="fine">Contractors are independent businesses. BluModel Studio checks each one is real before their page goes live; it doesn’t sell, install or guarantee their work. Ask for a quote sends your details only to the contractor you pick.</p>
          {!isContractor && (
            <p className="fine">
              Are you a contractor? <a href={hrefFor({ name: 'pricing' })}>Get your business listed with the Contractor plan</a>.
            </p>
          )}
          <LegalLinks />
        </footer>
      </main>
      <Suspense fallback={null}>{lead && <LeadForm slug={lead.slug} company={lead.name} kitchenId={kitchen} onClose={() => setLead(null)} />}</Suspense>
    </div>
  );
}
