import { useHashQuery } from '../../lib/router';
import { LeadCard, ShowroomMock } from './art';
import { DemoLink, MarketingFooter, MarketingHeader, PRICES, scrollIfHere, SectionHead, usePendingScroll, useTitle } from './parts';
import { BookSection, Faq, FinalCta, Included, PricingCards } from './sections';
import { MODELLED_BRANDS } from './brands';
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
        <WeModel />
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
      <SectionHead id="how-title" eyebrow="How it works" title="We built a design engine for your custom and professional work" center>
        Let your customers interact, design and inspire themselves while getting familiar with your business.
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


/** We model their own cabinetry and what they supply; and the brands already in the library. */
function WeModel() {
  const items: [string, string][] = [
    ['Custom cabinetry', 'Your own lines and made-to-order work: boxes, door styles, finishes and hardware, at their true sizes.'],
    ['What you supply', 'The appliances, sinks, faucets, vanities and fixtures you sell, from your suppliers, modelled to the spec sheet.'],
    ['New products as you add them', 'A new line or a new supplier: send it over and we model it, quoted first.'],
  ];
  return (
    <section className="mk-section mk-model" id="we-model" aria-labelledby="model-title">
      <SectionHead id="model-title" eyebrow="Your products, in 3D" title="We model your custom cabinetry and everything you supply" center>
        So what your customers design is exactly what you can build, order and install.
      </SectionHead>
      <ul className="mk-grid mk-grid--3">
        {items.map(([t, b]) => (
          <li key={t} className="mk-card">
            <h3>{t}</h3>
            <p>{b}</p>
          </li>
        ))}
      </ul>
      <div className="mk-brands">
        <p className="mk-brands-title">Already modelled, ready for your showroom</p>
        <ul className="mk-brand-list" aria-label="Brands already modelled">
          {MODELLED_BRANDS.map((b) => (
            <li key={b}>{b}</li>
          ))}
          <li className="mk-brand-more">and more</li>
        </ul>
        <p className="mk-brands-fine">Products from these brands are already in our library at their real sizes. Brand names belong to their owners; listing them doesn’t mean they endorse BluModel Studio.</p>
      </div>
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
  { title: 'Contractors & renovators', body: 'Show clients the finished room before the first wall comes down, and win the job on the first visit.' },
  { title: 'Cabinet makers & millwork', body: 'Your door styles, finishes and custom pieces, in your customer’s own layout, at true size.' },
  { title: 'Showrooms & suppliers', body: 'Your showroom, open around the clock. Customers explore your products from home and come in knowing what they want.' },
  { title: 'Kitchen & bath designers', body: 'Start every project from a design your customer helped create, and spend your time on the details that matter.' },
];

function WhoFor() {
  return (
    <section className="mk-section mk-who" id="who" aria-labelledby="who-title">
      <SectionHead id="who-title" eyebrow="Who it’s for" title="For everyone who builds, installs or sells what goes into a home">
        If your customers need to picture it before they buy it, let them see it: in their own space, with your products, under your name.
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
