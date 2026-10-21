import { useHashQuery } from '../../lib/router';
import { LeadCard, ShowroomMock } from './art';
import { DemoLink, MarketingFooter, MarketingHeader, PRICES, scrollIfHere, SectionHead, usePendingScroll, useTitle } from './parts';
import { BookSection, Faq, FinalCta, Included, PricingCards } from './sections';
import './marketing.css';

export const SALES_TITLE = 'BluModel Studio (blue model) | 3D Kitchen Design Showrooms for Kitchen & Bath Companies';

/**
 * blumodel.studio, the sales site (docs/SHOWROOM_PIVOT.md §6): signed-out `#/` and `#/welcome`.
 * Written for the owner or sales manager of a kitchen and bath company. It says plainly that we
 * build, host and run the showroom for them, what it costs, and how to see one working.
 */
export default function LandingScreen() {
  usePendingScroll();
  useTitle(SALES_TITLE);
  // Account settings → Delete my account lands here with `?deleted=1`.
  const deleted = useHashQuery().get('deleted') === '1';
  return (
    <div className="mk">
      <MarketingHeader active="home" />
      {deleted && (
        <p className="mk-deleted" role="status">
          Your account has been deleted, and you’re signed out everywhere.
        </p>
      )}
      <main>
        <Hero />
        <WeRunIt />
        <HowItWorks />
        <Leads />
        <Included />
        <WhoFor />
        <PricingSummary />
        <Faq />
        <BookSection />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="mk-hero" aria-labelledby="hero-title">
      <div className="mk-hero-copy">
        <span className="mk-eyebrow">3D showrooms for contractors, installers and showrooms</span>
        <h1 id="hero-title">Let your customers see it before it’s installed.</h1>
        <p className="mk-lede">
          We build, host and run a 3D design website under your name, with your actual products. Your customers see exactly what they’re getting, in their own room, before
          anything is ordered or installed, and everyone who signs up to see your products comes to you as a potential customer.
        </p>
        <div className="mk-ctas">
          <DemoLink />
          <a className="btn big" href="#/book" onClick={(e) => scrollIfHere(e, 'book')}>
            Book a call
          </a>
        </div>
        <p className="mk-hero-fine">
          {PRICES.monthly}/month in CAD plus a one-time setup quoted for your company. Nothing to install. No developer, no Blender.
        </p>
      </div>
      <div className="mk-hero-art">
        <ShowroomMock />
        <div className="mk-hero-lead">
          <LeadCard compact />
        </div>
      </div>
    </section>
  );
}

/** The point most worth making: the company never runs anything. */
function WeRunIt() {
  const items: [string, string][] = [
    ['We build it', 'Your name, logo and colours, your welcome text, and your product lines modelled in 3D.'],
    ['We host it', 'On your own web address, backed up every day. Nothing to install, nothing to maintain.'],
    ['We run it', 'Updates, fixes and new products: you tell us, we take care of it.'],
  ];
  return (
    <section className="mk-strip" aria-label="What we do for you">
      <ul className="mk-strip-list">
        {items.map(([t, b]) => (
          <li key={t}>
            <b>{t}.</b> <span>{b}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STEPS: { who: string; title: string; body: string }[] = [
  {
    who: 'Us',
    title: 'We set up your showroom and model your products',
    body: 'Send us your logo, your colours and your product range. We build the showroom under your name and model your cabinets and fixtures in 3D, at their true size, with your finishes.',
  },
  {
    who: 'Your customers',
    title: 'Customers see it on your site, before it’s installed',
    body: 'Homeowners lay out their room with your products, in plan and in 3D, on a phone or a computer, and see the finished result before a single piece goes in. Only your products, never a competitor’s or a big-box store’s.',
  },
  {
    who: 'Your team',
    title: 'You meet potential customers, and your team sells with it',
    body: 'Everyone who signs up to see your products lands in your inbox, and every design they send comes with the plan and the product list. Your staff open the same showroom in sales meetings and turn designs into photoreal renderings.',
  },
];

function HowItWorks() {
  return (
    <section className="mk-section" id="how" aria-labelledby="how-title">
      <SectionHead id="how-title" eyebrow="How it works" title="Three steps, and we do the first one" center>
        You don’t hire a developer or learn 3D software. We do the building; you do the selling.
      </SectionHead>
      <ol className="mk-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="mk-step">
            <span className="mk-step-n" aria-hidden>
              {i + 1}
            </span>
            <span className="mk-step-who">{s.who}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Leads() {
  return (
    <section className="mk-band" id="leads" aria-labelledby="leads-title">
      <div className="mk-band-inner">
        <div className="mk-band-copy">
          <span className="mk-eyebrow mk-eyebrow--light">Potential customers</span>
          <h2 id="leads-title">Everyone who signs up is a potential customer, with their design attached.</h2>
          <p className="mk-band-lede">
            When a customer finishes a design, the last step is <b>Send this design to</b> your company. You get:
          </p>
          <ul className="mk-band-list">
            <li>Their name, email, phone and postal code, with their consent</li>
            <li>Their budget, timeline and notes</li>
            <li>The design itself, to open in 3D, and its product list</li>
            <li>An inbox to track it: new, contacted, quoted, won or lost</li>
          </ul>
          <p className="mk-band-fine">Your potential customers are yours. We never sell or share their details, and we never market to them.</p>
        </div>
        <LeadCard />
      </div>
    </section>
  );
}

const WHO: { title: string; body: string }[] = [
  { title: 'Cabinet showrooms', body: 'Let customers try your door styles and finishes in their own layout before they visit, and come in ready to buy.' },
  { title: 'Kitchen & bath design-build firms', body: 'Show a believable first draft in the first meeting, then hand the details to your designer.' },
  { title: 'Bath and plumbing showrooms', body: 'Vanities, tubs, showers and fixtures, placed in a real bathroom layout under your name.' },
  { title: 'Renovation companies with a showroom', body: 'Turn website visitors into booked consultations, with the design already started.' },
];

function WhoFor() {
  return (
    <section className="mk-section mk-who" id="who" aria-labelledby="who-title">
      <SectionHead id="who-title" eyebrow="Who it’s for" title="Built for companies that sell and install kitchens and bathrooms">
        Contractors, installers and showrooms of any size that want what the big chains have, without building it themselves.
      </SectionHead>
      <ul className="mk-grid mk-grid--4">
        {WHO.map((w) => (
          <li key={w.title} className="mk-card mk-card--who">
            <h3>{w.title}</h3>
            <p>{w.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PricingSummary() {
  return (
    <section className="mk-section mk-pricing-sum" id="pricing" aria-labelledby="pricing-title">
      <SectionHead id="pricing-title" eyebrow="Pricing" title="One monthly plan, plus a setup quoted for you" center>
        All prices in Canadian dollars. Your customers never pay anything.
      </SectionHead>
      <PricingCards />
      <p className="mk-center">
        <a className="mk-link" href="#/pricing">
          Pricing details and how billing works →
        </a>
      </p>
    </section>
  );
}
