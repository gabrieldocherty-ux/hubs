import { DemoBanner, PaymentsSoon } from '../../components/PaymentNotice';
import plansJson from '../../data/plans.json';
import { planPrice } from '../../lib/money';
import type { PaymentsMode } from '../../lib/config';
import { useSession } from '../../store/useSession';
import type { Plan, PlanId } from '../../types/platform';
import { MarketingFooter, MarketingHeader, SectionHead, usePaymentsMode, usePendingScroll } from './parts';
import './marketing.css';

const PLANS = plansJson as Plan[];
/**
 * The plans this page shows: Free, Unlimited and Contractor. The one-kitchen unlock is not
 * advertised (Gabe, 2026-10-15): a free user is offered it in the export dialog when they try
 * an export, and nowhere else.
 */
// plans.json also lists the showroom plans since the pivot (docs/SHOWROOM_PIVOT.md); this legacy
// page keeps showing only the plans it was written for until the sales site replaces it.
const SHOWN = PLANS.filter((p) => ['free', 'unlimited', 'contractor'].includes(p.id));
const CONTRACTOR = PLANS.find((p) => p.id === 'contractor')!;
/** Custom 3D models a month the Contractor plan includes (src/data/plans.json; checked by the server). */
const INCLUDED = CONTRACTOR.includedModels ?? 3;

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function priceLine(p: Plan): { amount: string; per: string } {
  if (p.priceCents === 0) return { amount: '$0', per: 'free forever' };
  if (p.interval === 'month') return { amount: dollars(p.priceCents), per: 'CAD a month' };
  return { amount: dollars(p.priceCents), per: 'CAD once' };
}

/** A plan card's button. `href: null` is a plan that can't be bought yet (payments not open). */
function useCta(id: PlanId, soon: boolean): { label: string; href: string | null; note?: string; current?: boolean } {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const plan = useSession((s) => s.user?.plan?.id ?? 'free');
  const signup = (next: string) => `#/signup?next=${encodeURIComponent(next)}`;
  switch (id) {
    case 'free':
    case 'kitchen_unlock':
      return signedIn ? { label: 'Open my kitchens', href: '#/', current: plan === 'free' } : { label: 'Start free', href: '#/signup' };
    case 'unlimited':
      if (plan === 'unlimited') return { label: 'Manage your plan', href: '#/account/billing', current: true };
      if (soon) return { label: 'Opens soon', href: null };
      return { label: 'Go Unlimited', href: signedIn ? '#/account/billing' : signup('#/account/billing') };
    case 'contractor':
      if (plan === 'contractor') return { label: 'Open your workspace', href: '#/pro', current: true };
      if (soon) return { label: 'Opens soon', href: null };
      return { label: 'Become a BluModel Studio contractor', href: signedIn ? '#/pro' : signup('#/pro') };
  }
}

/** `#/pricing`: the three plans, the Contractor program, the custom models it includes, and the FAQ. */
export default function PricingScreen() {
  usePendingScroll();
  const payments = usePaymentsMode();
  return (
    <div className="mk">
      <MarketingHeader active="pricing" />
      <main>
        <section className="mk-pricing-hero">
          <span className="mk-eyebrow">Pricing</span>
          <h1>Design for free. Pay when you take it with you.</h1>
          <p className="mk-lede">
            Designing, saving, starting from photos and sharing are free with no limits. Exports are paid: the floor plan with dimensions, the full-size 3D image, the shopping list, the project file and studio renders without a watermark. Prices are in Canadian dollars.
          </p>
          {payments === 'demo' && (
            <div className="mk-pay-note">
              <DemoBanner>This server has no payment provider set up, so checkout is a clearly labelled simulation and nothing is charged.</DemoBanner>
            </div>
          )}
          {payments === 'none' && (
            <div className="mk-pay-note">
              <PaymentsSoon>These are the prices once payments open. Until then designing, saving, starting from photos and sharing are free and work today.</PaymentsSoon>
            </div>
          )}
        </section>

        <section className="mk-plans mk-plans--3" aria-label="Plans">
          {SHOWN.map((p) => (
            <PlanCard key={p.id} plan={p} soon={payments === 'none'} />
          ))}
        </section>

        <ContractorProgram />
        <CustomModels />
        <Faq payments={payments} />
      </main>
      <MarketingFooter />
    </div>
  );
}

function PlanCard({ plan, soon }: { plan: Plan; soon: boolean }) {
  const cta = useCta(plan.id, soon);
  const { amount, per } = priceLine(plan);
  const pro = plan.id === 'contractor';
  return (
    <article className={`mk-plan${pro ? ' mk-plan--pro' : ''}${cta.current ? ' is-current' : ''}`} aria-labelledby={`plan-${plan.id}`}>
      {cta.current && <span className="mk-plan-badge">Your plan</span>}
      <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
      <p className="mk-plan-price">
        <b>{amount}</b> <span>{per}</span>
      </p>
      <p className="mk-plan-tag">{plan.tagline}</p>
      <ul className="mk-plan-list">
        {plan.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {cta.note && <p className="mk-plan-note">{cta.note}</p>}
      <div className="mk-plan-cta">
        {cta.href ? (
          <a className={`btn wide${pro || plan.id === 'unlimited' ? ' primary' : ''}`} href={cta.href}>
            {cta.label}
          </a>
        ) : (
          <button type="button" className="btn wide" disabled title="Payments aren’t open yet">
            {cta.label}
          </button>
        )}
      </div>
    </article>
  );
}

function ContractorProgram() {
  const groups: { title: string; items: string[] }[] = [
    {
      title: 'Your catalog',
      items: ['Quick-add a whole cabinet line with widths, door style and finishes: no 3D model needed', 'Upload your own models, checked for size and detail', `${INCLUDED} custom 3D models a month, made by our studio and delivered straight into your catalog`],
    },
    {
      title: 'Your prices',
      items: ['A price book with your cost and markup, per product, per brand or per line', 'Import your supplier’s price list as CSV', 'Costs and margins stay with you: clients, shares, exports and quotes never carry them'],
    },
    {
      title: 'With your client',
      items: ['Share links that say “Prepared by” your company, with a Contact button', 'Printable, branded quotes with labour lines, tax and a valid-until date', 'Presentation mode for the laptop or TV in their living room'],
    },
    {
      title: 'Your brand page',
      items: ['Get found: put the cabinets you sell in front of homeowners designing their kitchens', 'A Verified contractor badge once we’ve checked your business', 'Leads from homeowners, with their kitchen attached'],
    },
  ];
  return (
    <section className="mk-band" id="contractor" aria-labelledby="contractor-title">
      <div className="mk-band-inner mk-band-inner--stack">
        <div className="mk-band-copy">
          <span className="mk-eyebrow mk-eyebrow--light">The Contractor program · {planPrice(PLANS.find((p) => p.id === 'contractor')!)}</span>
          <h2 id="contractor-title">Show your customers the exact cabinets you sell, in their kitchen, at your price.</h2>
          <p className="mk-band-lede">For kitchen contractors, cabinet shops and remodelers. Everything in Unlimited, plus:</p>
        </div>
        <div className="mk-pro-grid">
          {groups.map((g) => (
            <div key={g.title} className="mk-pro-group">
              <h3>{g.title}</h3>
              <ul className="mk-ticks">
                {g.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Custom 3D models: included in the Contractor plan, made by our studio (docs/PLANS_AND_CONTRACTORS.md
 * §8). Nothing here has a price: they aren't sold on their own.
 */
function CustomModels() {
  const isContractor = useSession((s) => s.user?.plan?.id === 'contractor');
  return (
    <section className="mk-section" id="models" aria-labelledby="models-title">
      <SectionHead eyebrow="Make custom models · Contractor plan" title={<span id="models-title">Not in the catalog? Our studio models it.</span>}>
        The Contractor plan includes {INCLUDED} custom 3D models a month. List the products: a name, the UPC from the box or a photo, and the size if you have it. Our studio builds a true-to-size 3D model of each one, and it lands privately in your catalog.
      </SectionHead>
      <div className="mk-tiers mk-pack">
        <div className="mk-tier mk-pack-main">
          <h3>{INCLUDED} models a month</h3>
          <p className="mk-tier-price">
            <b>Included</b> <span>in the Contractor plan</span>
          </p>
          <p className="mk-tier-for">One 3D model per product, at true size, private to your company.</p>
          <dl>
            <dt>Finishes</dt>
            <dd>Up to 3 per model</dd>
            <dt>Revisions</dt>
            <dd>2 rounds per model</dd>
            <dt>Turnaround</dt>
            <dd>About 15 business days</dd>
          </dl>
        </div>
        <div className="mk-tier mk-pack-more">
          <h3>How the allowance works</h3>
          <p className="mk-tier-for">Each product you send is one model from that month’s allowance.</p>
          <dl>
            <dt>Resets</dt>
            <dd>Every billing month</dd>
            <dt>Unused</dt>
            <dd>Don’t carry over</dd>
            <dt>Changed your mind</dt>
            <dd>Withdraw a request before the studio starts and its models come back</dd>
          </dl>
        </div>
        <div className="mk-tier mk-pack-how">
          <h3>What you send</h3>
          <p className="mk-tier-for">Per product, in one short form:</p>
          <dl>
            <dt>Name</dt>
            <dd>What it is</dd>
            <dt>UPC</dt>
            <dd>Typed, pasted or scanned with your phone</dd>
            <dt>Photos</dt>
            <dd>Front, side, details</dd>
            <dt>Optional</dt>
            <dd>Brand, size, notes</dd>
          </dl>
        </div>
      </div>
      <div className="mk-center">
        {isContractor ? (
          <a className="btn big" href="#/orders/new">
            Make custom models
          </a>
        ) : (
          <a className="btn big" href="#contractor" onClick={(e) => (e.preventDefault(), document.getElementById('contractor')?.scrollIntoView({ behavior: 'smooth' }))}>
            See the Contractor plan
          </a>
        )}
      </div>
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Why are exports paid?',
    a: 'Designing is the part we want everyone to do freely, so it has no limits. The exports are what you take to a contractor or a store: the floor plan with dimensions, the full-size 3D image, the shopping list with SKUs and the project file. That is what pays for BluModel Studio. To be straight with you: anyone can screenshot their screen. What an export gets you is the clean, full-resolution, dimensioned file.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes, any time, from Account → Billing. You keep your plan until the end of the period you’ve paid for, then you’re back on Free with all your kitchens.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. “Try without an account” keeps a kitchen in this browser. A free account keeps your kitchens safe across devices and lets you share them.',
  },
  {
    q: 'How do payments work?',
    a: 'Through Stripe’s hosted checkout: BluModel Studio never asks for or sees your card number. Prices are in Canadian dollars. Cancel a plan any time; you keep it to the end of the period you’ve paid for.',
  },
  {
    q: 'What do my contractor’s clients see?',
    a: 'The kitchen in 2D and 3D, “Prepared by” your company with a Contact button, and your sell prices if you choose to show them. Never your costs, markups or margins: those stay in your price book.',
  },
  {
    q: 'Custom models: what do you need, and what do I get?',
    a: `They come with the Contractor plan: ${INCLUDED} a month, one per product. For each product send its name, the UPC or EAN from the box (type it, paste it, or scan the barcode with your phone), and photos (PNG, JPEG or WebP, up to 8 MB each). The brand, the width, depth and height and notes help but are optional. You get a GLB model at true size in up to three finishes, plus a thumbnail, in about 15 business days. Two rounds of revisions are included per model. Need more than ${INCLUDED} in a month? Contact us.`,
  },
  {
    q: 'Who can see my custom models?',
    a: 'Only you. They are private to your account: a contractor’s land in their private catalog, ready to price and place, and people you share a kitchen with see them in that kitchen while the link works.',
  },
];

/** The payments answer for this server: with real Stripe payments it says nothing about demos. */
function faqFor(payments: PaymentsMode | null): { q: string; a: string }[] {
  const tail =
    payments === 'demo'
      ? ' On this server checkout is a clearly labelled demo instead, and nothing is charged.'
      : payments === 'none'
        ? ' Payments aren’t open yet: until they are, nothing can be bought here, and designing, saving and sharing stay free.'
        : '';
  return FAQ.map((f) => (f.q === 'How do payments work?' ? { ...f, a: f.a + tail } : f));
}

function Faq({ payments }: { payments: PaymentsMode | null }) {
  return (
    <section className="mk-section mk-faq" id="faq" aria-labelledby="faq-title">
      <SectionHead eyebrow="Questions" title={<span id="faq-title">Good questions, straight answers</span>} center />
      <div className="mk-faq-list">
        {faqFor(payments).map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
