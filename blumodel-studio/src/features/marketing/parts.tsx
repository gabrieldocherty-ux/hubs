import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { usePayments, type PaymentsMode } from '../../lib/config';
import { VISUALIZER_DISCLAIMER } from '../../lib/csv';
import { LegalLinks } from '../legal/LegalLinks';
import { useSession } from '../../store/useSession';
import './marketing.css';

/** The marketing pages' top bar: logo, a few links, and sign in / start free (or My kitchens). */
export function MarketingHeader({ active }: { active?: 'pricing' | 'home' }) {
  const signedIn = useSession((s) => s.status === 'signedIn');
  return (
    <header className="mk-bar">
      <a className="brand" href={signedIn ? '#/welcome' : '#/'} aria-label="BluModel Studio home">
        <Logo />
        <Wordmark />
      </a>
      <nav className="mk-nav" aria-label="Site">
        <a href="#/welcome" className={active === 'home' ? 'on' : ''} onClick={(e) => scrollIfHere(e, 'how')}>
          How it works
        </a>
        <a href="#/pricing" className={active === 'pricing' ? 'on' : ''} aria-current={active === 'pricing' ? 'page' : undefined}>
          Pricing
        </a>
        <a href="#/pricing" onClick={(e) => scrollIfHere(e, 'contractor', '#/pricing')}>
          For contractors
        </a>
      </nav>
      <div className="mk-bar-actions">
        {signedIn ? (
          <a className="btn primary" href="#/">
            My kitchens
          </a>
        ) : (
          <>
            <a className="btn mk-signin" href="#/signin">
              Sign in
            </a>
            <a className="btn primary" href="#/signup">
              Start free
            </a>
          </>
        )}
      </div>
    </header>
  );
}

/**
 * In-page links: hash routing owns `#`, so sections are reached by scrolling, not anchors. When
 * the link's page is already open, scroll to the section; otherwise go there and scroll after.
 */
export function scrollIfHere(e: MouseEvent, id: string, page = '#/welcome') {
  const here = location.hash.replace(/\?.*$/, '') || '#/';
  const onPage = here === page || (page === '#/welcome' && (here === '#/' || here === '#'));
  e.preventDefault();
  if (onPage) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else {
    pendingScroll = id;
    location.hash = page;
  }
}

let pendingScroll: string | null = null;

/** Scrolls to a section a header link asked for, once the page that holds it has rendered. */
export function usePendingScroll() {
  useEffect(() => {
    const id = pendingScroll;
    pendingScroll = null;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, []);
}

export function MarketingFooter() {
  return (
    <footer className="mk-foot">
      <div className="mk-foot-inner">
        <div className="mk-foot-brand">
          <span className="brand">
            <Logo />
            <Wordmark />
          </span>
          <p>Kitchen design for the kitchen you actually have.</p>
        </div>
        <nav className="mk-foot-links" aria-label="More">
          <a href="#/generate">Start from a photo</a>
          <a href="#/local">Try without an account</a>
          <a href="#/pricing">Pricing</a>
          <a href="#/signin">Sign in</a>
        </nav>
      </div>
      <p className="mk-disclaimer">{VISUALIZER_DISCLAIMER}</p>
      <p className="mk-fine">BluModel Basics are generic sample products. Retailer products list real brands and the stores that sell them, with prices as checked on the date shown. Products from contractors and partner brands appear once an admin has verified them.</p>
      <LegalLinks className="mk-legal" />
    </footer>
  );
}

/** A section heading block. */
export function SectionHead({ eyebrow, title, children, center }: { eyebrow?: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={`mk-head${center ? ' mk-head--center' : ''}`}>
      {eyebrow && <span className="mk-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/**
 * How this server takes payments (`/api/config`, shared with every paying screen): `stripe`, the
 * labelled `demo`, or `none` while payments aren't open yet. Null until known.
 */
export function usePaymentsMode(): PaymentsMode | null {
  return usePayments();
}
