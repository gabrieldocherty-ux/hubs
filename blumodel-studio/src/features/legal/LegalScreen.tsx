import { useEffect, useMemo } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { useAppConfig, NO_LEGAL } from '../../lib/config';
import { navigateHash } from '../../lib/router';
import { SiteMark } from '../showroom';
import { useSession } from '../../store/useSession';
import { legalDoc, type LegalDocId } from './content';
import { LegalLinks, LegalUnsetBadge } from './LegalLinks';
import './legal.css';

const DOCS: { id: LegalDocId; label: string }[] = [
  { id: 'terms', label: 'Agreement' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'refunds', label: 'Refunds' },
];

/** `#/terms` (the service agreement), `#/privacy`, `#/refunds`: the three legal pages, readable on a phone. */
export default function LegalScreen({ doc }: { doc: LegalDocId }) {
  const config = useAppConfig();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const d = useMemo(() => legalDoc(doc, config?.legal ?? NO_LEGAL, config?.payments ?? null), [doc, config]);
  // On a company's showroom the pages keep the company's header; visitors never pay, so there is
  // no refund policy for them, and the terms open at the part written for visitors.
  const tenant = config?.tenant ?? null;
  const company = tenant ? tenant.name.replace(/\s*\((demo|sample)\)\s*$/i, '').trim() || tenant.name : null;
  const docs = tenant ? DOCS.filter((x) => x.id !== 'refunds') : DOCS;

  useEffect(() => {
    if (tenant && doc === 'refunds') navigateHash('#/terms', true);
  }, [tenant, doc]);

  useEffect(() => {
    const before = document.title;
    document.title = `${d.title} · ${company ?? 'BluModel Studio'}`;
    const visitors = tenant && doc === 'terms' ? document.getElementById('legal-visitors') : null;
    if (visitors) visitors.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
    return () => {
      document.title = before;
    };
  }, [d.title, company, tenant, doc]);

  return (
    <div className="legal">
      <header className="legal-bar">
        <a className="brand" href="#/" aria-label={company ? `${company}, showroom home` : 'BluModel Studio home'}>
          {tenant ? (
            <SiteMark />
          ) : (
            <>
              <Logo />
              <Wordmark />
            </>
          )}
        </a>
        <nav className="legal-tabs" aria-label="Policies">
          {docs.map((x) => (
            <a key={x.id} href={`#/${x.id}`} className={x.id === doc ? 'on' : ''} aria-current={x.id === doc ? 'page' : undefined}>
              {x.label}
            </a>
          ))}
        </nav>
        <a className="btn legal-bar-cta" href={signedIn ? '#/' : '#/signin'}>
          {signedIn ? 'My account' : 'Sign in'}
        </a>
      </header>
      <main className="legal-main">
        <article className="legal-doc" aria-labelledby="legal-title">
          <span className="eyebrow">{company ? `${company}’s showroom · run by BluModel Studio` : 'BluModel Studio'}</span>
          <h1 id="legal-title">{d.title}</h1>
          <p className="legal-updated">
            Last updated {d.updated} <LegalUnsetBadge />
          </p>
          <p className="legal-lede">{d.lede}</p>
          <nav className="legal-toc" aria-label="On this page">
            <span className="mini-label">On this page</span>
            <ol>
              {d.sections.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => document.getElementById(`legal-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    {s.heading.replace(/^\d+\.\s*/, '')}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {d.sections.map((s) => (
            <section key={s.id} id={`legal-${s.id}`} aria-labelledby={`legal-${s.id}-h`}>
              <h2 id={`legal-${s.id}-h`}>{s.heading}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </main>
      <footer className="legal-foot">
        <LegalLinks />
      </footer>
    </div>
  );
}
