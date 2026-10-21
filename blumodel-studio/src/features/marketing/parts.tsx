import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Logo, Wordmark } from '../../components/Icons';
import { useConfig } from '../../lib/config';
import { call } from '../../lib/api';
import { LegalLinks } from '../legal/LegalLinks';
import { useSession } from '../../store/useSession';
import plansJson from '../../data/plans.json';
import { amount } from '../../lib/money';
import { demoShowroomUrl } from './logic';
import './marketing.css';

/*
 * The sales site (blumodel.studio itself, docs/SHOWROOM_PIVOT.md §6): pages for the owners and
 * sales managers of kitchen and bath companies. There is no homeowner sign-up funnel here; "Sign
 * in" stays for our admins and for anyone with an account from before the pivot.
 */

// ── prices (src/data/plans.json, the server's own price list) ───────────────

interface ShowroomPlanJson {
  id: string;
  priceCents: number | null;
  creditRolloverMonths?: number;
  breakdown?: { id: string; label: string; cents: number }[];
}

const PLANS = plansJson as unknown as ShowroomPlanJson[];
const MONTHLY = PLANS.find((p) => p.id === 'showroom_monthly');

/**
 * What the sales site quotes, all in CAD. The fallbacks are the prices of docs/SHOWROOM_PIVOT.md §2.
 * The setup and yearly license has no price here on purpose: it is quoted per company on a call
 * (plans.json `quoted`), so the site never shows an amount or a product count for it.
 */
export const PRICES = Object.freeze({
  /** How the site describes the setup and license's price. */
  license: 'quoted for your company',
  /** "$50" a month. */
  monthly: amount(MONTHLY?.priceCents ?? 5000),
});

// ── the demo showroom's address ─────────────────────────────────────────────

let baseDomainAsk: Promise<string | null> | null = null;
function askBaseDomain(): Promise<string | null> {
  baseDomainAsk ??= call<{ baseDomain?: unknown }>('GET', '/api/config')
    .then((c) => (typeof c?.baseDomain === 'string' ? c.baseDomain : null))
    .catch(() => null);
  return baseDomainAsk;
}

/** The demo showroom's URL for links on this page. */
export function useDemoUrl(): string {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void askBaseDomain().then((b) => live && setBase(b));
    return () => {
      live = false;
    };
  }, []);
  return demoShowroomUrl(base, location);
}

/** "See a live demo showroom", opened in a new tab so the sales page stays where it was. */
export function DemoLink({ className = 'btn primary big', children = 'See a live demo showroom' }: { className?: string; children?: ReactNode }) {
  const url = useDemoUrl();
  return (
    <a className={className} href={url} target="_blank" rel="noopener" data-demo-link>
      {children}
      <ArrowOut />
    </a>
  );
}

// ── in-page navigation ──────────────────────────────────────────────────────

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
    else window.scrollTo(0, 0);
  }, []);
}

/** Sets the tab's title while the page is open. */
export function useTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}

export type MarketingPage = 'home' | 'pricing' | 'book';

/** The sales site's top bar: the logo, four links, Sign in (for staff and admins) and Book a call. */
export function MarketingHeader({ active }: { active?: MarketingPage }) {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  // The live sales site has no designer: signed in, the link goes to Admin or the account page.
  const designer = useConfig((s) => s.config?.salesDesigner ?? true);
  const onLanding = active === 'home';
  const demoUrl = useDemoUrl();
  return (
    <header className="mk-bar">
      <div className="mk-bar-inner">
        <a className="brand" href={signedIn ? '#/welcome' : '#/'} aria-label="BluModel Studio home">
          <Logo />
          <Wordmark />
        </a>
        <nav className="mk-nav" aria-label="Site">
          <a href="#/welcome" onClick={(e) => scrollIfHere(e, 'how')}>
            How it works
          </a>
          <a className="mk-nav-included" href="#/welcome" onClick={(e) => scrollIfHere(e, 'included')}>
            Included
          </a>
          <a href="#/pricing" className={active === 'pricing' ? 'on' : ''} aria-current={active === 'pricing' ? 'page' : undefined}>
            Pricing
          </a>
          <a href="#/welcome" onClick={(e) => scrollIfHere(e, 'faq')}>
            FAQ
          </a>
          {/* Gabe, 2026-10-17: the demo must be one obvious click from anywhere on the sales site. */}
          <a className="mk-nav-demo" href={demoUrl} target="_blank" rel="noopener">
            Live demo
          </a>
          {signedIn ? (
            <a className="mk-nav-quiet" href={designer ? '#/' : isAdmin ? '#/admin/overview' : '#/account'}>
              {!designer && isAdmin ? 'Admin' : 'My account'}
            </a>
          ) : (
            <a className="mk-nav-quiet mk-signin" href="#/signin">
              Sign in
            </a>
          )}
        </nav>
        <a
          className="btn primary mk-bar-cta"
          href="#/book"
          aria-current={active === 'book' ? 'page' : undefined}
          onClick={onLanding ? (e) => scrollIfHere(e, 'book') : undefined}
        >
          Book a call
        </a>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  return (
    <footer className="mk-foot">
      <div className="mk-foot-inner">
        <div className="mk-foot-brand">
          <span className="brand">
            <Logo />
            <Wordmark />
          </span>
          <p>Virtual showrooms for kitchen and bath companies. We build them, host them and keep them running.</p>
        </div>
        <nav className="mk-foot-links" aria-label="More">
          <DemoLink className="mk-foot-link">Live demo showroom</DemoLink>
          <a className="mk-foot-link" href="#/pricing">
            Pricing
          </a>
          <a className="mk-foot-link" href="#/book">
            Book a call
          </a>
          <a className="mk-foot-link" href={signedIn ? '#/' : '#/signin'}>
            {signedIn ? 'My account' : 'Sign in'}
          </a>
        </nav>
      </div>
      <p className="mk-fine">All prices are in Canadian dollars. The companies, people and products shown in illustrations on this site are made up.</p>
      <LegalLinks className="mk-legal" />
    </footer>
  );
}

/** A section heading block. */
export function SectionHead({ eyebrow, title, id, children, center }: { eyebrow?: string; title: ReactNode; id: string; children?: ReactNode; center?: boolean }) {
  return (
    <div className={`mk-head${center ? ' mk-head--center' : ''}`}>
      {eyebrow && <span className="mk-eyebrow">{eyebrow}</span>}
      <h2 id={id}>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

// ── small inline icons (stroke = currentColor) ──────────────────────────────

const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const ArrowOut = () => (
  <svg {...svg} width={16} height={16} className="mk-arrow-out">
    <path d="M9 7h8v8M17 7 7 17" />
  </svg>
);
export const GlobeIcon = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
  </svg>
);
export const ServerIcon = () => (
  <svg {...svg}>
    <rect x="3.5" y="4" width="17" height="7" rx="1.5" />
    <rect x="3.5" y="13" width="17" height="7" rx="1.5" />
    <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h6M11 16.5h6" />
  </svg>
);
export const CubeIcon = () => (
  <svg {...svg}>
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
  </svg>
);
export const InboxIcon = () => (
  <svg {...svg}>
    <path d="M4 13.5 6.2 5.6A1.5 1.5 0 0 1 7.6 4.5h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5Z" />
    <path d="M4 13.5h4.5l1 2h5l1-2H20" />
  </svg>
);
export const TeamIcon = () => (
  <svg {...svg}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M15.5 14.3A4.5 4.5 0 0 1 20.5 19" />
  </svg>
);
export const SparkIcon = () => (
  <svg {...svg}>
    <path d="M12 3.5 13.8 9a1.5 1.5 0 0 0 1 1l5.7 2-5.7 2a1.5 1.5 0 0 0-1 1L12 20.5 10.2 15a1.5 1.5 0 0 0-1-1L3.5 12l5.7-2a1.5 1.5 0 0 0 1-1L12 3.5Z" />
  </svg>
);
export const CheckIcon = () => (
  <svg {...svg} width={16} height={16}>
    <path d="m5 12.5 4.2 4L19 7" />
  </svg>
);
export const PhoneIcon = () => (
  <svg {...svg} width={16} height={16}>
    <path d="M6.6 3.5h2.6l1.4 4.1-2 1.4a12 12 0 0 0 6.4 6.4l1.4-2 4.1 1.4v2.6a1.6 1.6 0 0 1-1.7 1.6A16.5 16.5 0 0 1 5 5.2a1.6 1.6 0 0 1 1.6-1.7Z" />
  </svg>
);
