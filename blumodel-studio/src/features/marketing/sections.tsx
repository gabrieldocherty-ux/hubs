import type { MouseEvent, ReactNode } from 'react';
import { useLegal } from '../../lib/config';
import { PriceSplit } from './art';
import { BookCallForm } from './BookCallForm';
import { CheckIcon, CubeIcon, DemoLink, GlobeIcon, InboxIcon, PhoneIcon, PRICES, SectionHead, ServerIcon, SparkIcon, TeamIcon, scrollIfHere } from './parts';

/* The sections the landing page and the pricing page share. */

// ── What's included ─────────────────────────────────────────────────────────

const INCLUDED: { title: string; body: ReactNode; icon: JSX.Element }[] = [
  {
    title: 'Your own web address',
    body: (
      <>
        <b>yourcompany.blumodel.studio</b> from day one. Own a domain? Point one at us, like showroom.yourcompany.ca, and we connect it at no extra charge.
      </>
    ),
    icon: <GlobeIcon />,
  },
  {
    title: 'Hosting and updates',
    body: 'We run the servers, back them up every day and keep improving the software. There is nothing to install, update or maintain on your side.',
    icon: <ServerIcon />,
  },
  {
    title: 'Your products, modelled',
    body: `We model your starting range in 3D at true size: up to ${PRICES.includedProducts} of your products with the license. New products are added when you need them, quoted first.`,
    icon: <CubeIcon />,
  },
  {
    title: 'A lead inbox',
    body: 'Every design a customer sends comes in with the plan, the product list and their contact details. Track each one from new to won, add notes and export to CSV.',
    icon: <InboxIcon />,
  },
  {
    title: 'Team accounts',
    body: 'Invite your designers and sales staff by email. Owners manage the showroom and the plan; staff work the leads and use the showroom with customers.',
    icon: <TeamIcon />,
  },
  {
    title: 'Photoreal AI renders',
    body: `Turn any design into a photoreal rendering for the customer. ${PRICES.credits} of rendering credits every month, and unused credits roll over for ${PRICES.rolloverMonths} months.`,
    icon: <SparkIcon />,
  },
];

export function Included() {
  return (
    <section className="mk-section" id="included" aria-labelledby="included-title">
      <SectionHead id="included-title" eyebrow="What’s included" title="Everything a showroom needs, run by us" center>
        One license and one monthly plan cover all of it. No per-lead fees, and nothing for your customers to pay.
      </SectionHead>
      <ul className="mk-grid mk-grid--3">
        {INCLUDED.map((x) => (
          <li key={x.title} className="mk-card">
            <span className="mk-card-icon">{x.icon}</span>
            <h3>{x.title}</h3>
            <p>{x.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────────

const LICENSE_COVERS = [
  'The showroom software for a year',
  'Setup: your name, logo, colours, welcome text and product lines',
  `3D modelling of your starting range, up to ${PRICES.includedProducts} products`,
  'Accounts for your team, set up with you',
];
const MONTHLY_COVERS = [
  'Hosting and running your showroom, every day',
  'Your own web address, or your own domain connected',
  'Updates, fixes and daily backups',
  `${PRICES.credits} of AI rendering credits each month`,
];

export function PricingCards({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="mk-prices">
      <article className="mk-price" aria-labelledby="price-license">
        <span className="mk-price-kicker">Once a year</span>
        <H id="price-license">Showroom license</H>
        <p className="mk-price-amount">
          <span className="mk-price-from">from</span> <b>{PRICES.license}</b> <span>CAD / year</span>
        </p>
        <p className="mk-price-tag">Including setup and up to {PRICES.includedProducts} of your products modelled.</p>
        <ul className="mk-ticks">
          {LICENSE_COVERS.map((x) => (
            <li key={x}>
              <CheckIcon />
              {x}
            </li>
          ))}
        </ul>
        <p className="mk-price-fine">Set per company when we sign, and invoiced. More products are quoted separately.</p>
      </article>
      <span className="mk-price-plus" aria-hidden>
        +
      </span>
      <article className="mk-price mk-price--monthly" aria-labelledby="price-monthly">
        <span className="mk-price-kicker">Every month</span>
        <H id="price-monthly">Monthly plan</H>
        <p className="mk-price-amount">
          <b>{PRICES.monthly}</b> <span>CAD / month</span>
        </p>
        <PriceSplit />
        <ul className="mk-ticks">
          {MONTHLY_COVERS.map((x) => (
            <li key={x}>
              <CheckIcon />
              {x}
            </li>
          ))}
        </ul>
        <p className="mk-price-fine">Paid by card through Stripe. Cancel any time; it stops at the end of the month you’ve paid for.</p>
      </article>
    </div>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────

export const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Do we need to install anything?',
    a: 'No. Your showroom is a website we host and run. Your customers open it in the browser on a phone, tablet or computer, and your team uses the same site in the showroom or at the customer’s table.',
  },
  {
    q: 'Can we use our own domain?',
    a: 'Yes, and it’s included. Every showroom gets yourcompany.blumodel.studio from day one. If you own a domain, for example showroom.yourcompany.ca, point it at us and we connect it at no extra charge. Your blumodel.studio address keeps working too.',
  },
  {
    q: 'What if we add products?',
    a: `Send us what’s new (spec sheets, photos or the UPC from the box) and we model it in 3D at true size. The license covers your starting range of up to ${PRICES.includedProducts} products; anything beyond that is quoted before we start.`,
  },
  {
    q: 'Is it a CAD tool?',
    a: 'No. It’s a sales tool: a fast, believable 3D draft of the customer’s kitchen or bathroom, with your products, that helps you win the job. Your designer still measures the space and does the final drawings.',
  },
  {
    q: 'Who owns the leads?',
    a: 'You do. Leads from your showroom go to your team only. We store them for you, we never sell or share them, and we never market to your customers. Export them as a spreadsheet any time.',
  },
  {
    q: 'Can we cancel?',
    a: 'Yes. Cancel the monthly plan any time and it stops at the end of the month you’ve paid for. The yearly license runs for the term you signed. If you stop, your showroom goes offline, and we keep your data for you in case you come back.',
  },
  {
    q: 'What do our customers pay?',
    a: 'Nothing. Designing, saving, sharing and downloading a design are free on your showroom. A customer’s design is your lead.',
  },
  {
    q: 'What are the rendering credits for?',
    a: `Photoreal AI renderings of a design, made from the 3D view. Each paid month adds ${PRICES.credits} of credits. Unused credits roll over for ${PRICES.rolloverMonths} months, then expire, oldest first, and you can see your balance and history at any time.`,
  },
  {
    q: 'I’m a homeowner. Can I design my kitchen here?',
    a: (
      <>
        BluModel Studio builds showrooms for kitchen and bath companies, so the place to design is your kitchen company’s own showroom: ask them for the link. To see what it’s like,{' '}
        <DemoLink className="mk-inline-link">try the demo showroom</DemoLink>.
      </>
    ),
  },
];

export function Faq({ id = 'faq' }: { id?: string }) {
  return (
    <section className="mk-section mk-faq" id={id} aria-labelledby={`${id}-title`}>
      <SectionHead id={`${id}-title`} eyebrow="Questions" title="Straight answers" center />
      <div className="mk-faq-list">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ── Book a call ─────────────────────────────────────────────────────────────

export function BookSection({ id = 'book' }: { id?: string }) {
  const legal = useLegal();
  return (
    <section className="mk-section mk-book" id={id} aria-labelledby={`${id}-title`}>
      <div className="mk-book-inner">
        <div className="mk-book-copy">
          <span className="mk-eyebrow">Book a call</span>
          <h2 id={`${id}-title`}>See your showroom before you sign anything</h2>
          <p>Leave your details and we’ll call to walk you through the demo showroom, talk about your product range and tell you what your showroom would cost.</p>
          <ul className="mk-book-points">
            <li>
              <CheckIcon /> A walk-through of a live showroom
            </li>
            <li>
              <CheckIcon /> What we’d model from your range
            </li>
            <li>
              <CheckIcon /> A price for your company
            </li>
          </ul>
          {legal.supportEmail && (
            <p className="mk-book-alt">
              <PhoneIcon /> Rather write? <a href={`mailto:${legal.supportEmail}`}>{legal.supportEmail}</a>
            </p>
          )}
        </div>
        <div className="mk-book-form">
          <BookCallForm headingId={`${id}-title`} />
        </div>
      </div>
    </section>
  );
}

// ── closing call to action ──────────────────────────────────────────────────

export function FinalCta() {
  return (
    <section className="mk-final" aria-labelledby="final-title">
      <h2 id="final-title">Click around a real showroom first.</h2>
      <p>Northline Kitchen &amp; Bath is a made-up company with a working showroom. Design a kitchen on it the way your customers would.</p>
      <div className="mk-ctas mk-ctas--center">
        <DemoLink className="btn big mk-btn-light" />
        <a className="btn big mk-btn-ghost" href="#/book" onClick={scrollToBookIfHere}>
          Book a call
        </a>
      </div>
    </section>
  );
}

/** On the landing page, Book a call scrolls to its form; elsewhere it opens #/book. */
function scrollToBookIfHere(e: MouseEvent) {
  const here = location.hash.replace(/\?.*$/, '') || '#/';
  if (here === '#/' || here === '#' || here === '#/welcome') scrollIfHere(e, 'book');
}
