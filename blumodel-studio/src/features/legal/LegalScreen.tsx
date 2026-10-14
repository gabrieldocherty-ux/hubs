import { useEffect, useMemo } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { useAppConfig, NO_LEGAL } from '../../lib/config';
import { useSession } from '../../store/useSession';
import { legalDoc, type LegalDocId } from './content';
import { LegalLinks, LegalUnsetBadge } from './LegalLinks';
import './legal.css';

const DOCS: { id: LegalDocId; label: string }[] = [
  { id: 'terms', label: 'Terms' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'refunds', label: 'Refunds' },
];

/** `#/terms`, `#/privacy`, `#/refunds`: the three legal pages, readable on a phone. */
export default function LegalScreen({ doc }: { doc: LegalDocId }) {
  const config = useAppConfig();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const d = useMemo(() => legalDoc(doc, config?.legal ?? NO_LEGAL), [doc, config]);

  useEffect(() => {
    const before = document.title;
    document.title = `${d.title} · BluModel Studio`;
    window.scrollTo(0, 0);
    return () => {
      document.title = before;
    };
  }, [d.title]);

  return (
    <div className="legal">
      <header className="legal-bar">
        <a className="brand" href="#/" aria-label="BluModel Studio home">
          <Logo />
          <Wordmark />
        </a>
        <nav className="legal-tabs" aria-label="Policies">
          {DOCS.map((x) => (
            <a key={x.id} href={`#/${x.id}`} className={x.id === doc ? 'on' : ''} aria-current={x.id === doc ? 'page' : undefined}>
              {x.label}
            </a>
          ))}
        </nav>
        <a className="btn legal-bar-cta" href={signedIn ? '#/' : '#/signin'}>
          {signedIn ? 'My kitchens' : 'Sign in'}
        </a>
      </header>
      <main className="legal-main">
        <article className="legal-doc" aria-labelledby="legal-title">
          <span className="eyebrow">BluModel Studio</span>
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
