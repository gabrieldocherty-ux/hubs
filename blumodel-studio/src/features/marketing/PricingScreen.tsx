import { Fragment, useEffect, useState } from 'react';
import { DemoBanner, PaymentsSoon } from '../../components/PaymentNotice';
import plansJson from '../../data/plans.json';
import { call } from '../../lib/api';
import { planPrice } from '../../lib/money';
import type { PaymentsMode } from '../../lib/config';
import { useSession } from '../../store/useSession';
import type { Plan, PlanId } from '../../types/platform';
import { MarketingFooter, MarketingHeader, SectionHead, usePaymentsMode, usePendingScroll } from './parts';
import './marketing.css';

const PLANS = plansJson as Plan[];

/**
 * The custom-model offer: one Model pack (docs/PLANS_AND_CONTRACTORS.md §8). The server's
 * `GET /api/orders/tiers` is the source; this published copy is shown only when that endpoint
 * isn't answering, and labelled as such. The order form is always the real quote.
 */
interface PackOffer {
  priceCents: number;
  productsPerPack: number;
  finishesPerModel: number;
  revisions: number;
  businessDays: number;
  extraPackBusinessDays: number;
  rushPct: number;
}

const FALLBACK_PACK: PackOffer = { priceCents: 12900, productsPerPack: 8, finishesPerModel: 3, revisions: 2, businessDays: 15, extraPackBusinessDays: 5, rushPct: 50 };

type Pack = { live: boolean; pack: PackOffer } | null;

function readPack(r: unknown): PackOffer | null {
  const x = r as { pack?: Partial<PackOffer>; rushPct?: unknown } | null;
  const p = x?.pack;
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!p || !n(p.priceCents) || !n(p.productsPerPack) || p.productsPerPack < 1 || !n(x.rushPct)) return null;
  return {
    priceCents: p.priceCents,
    productsPerPack: p.productsPerPack,
    finishesPerModel: n(p.finishesPerModel) ? p.finishesPerModel : FALLBACK_PACK.finishesPerModel,
    revisions: n(p.revisions) ? p.revisions : FALLBACK_PACK.revisions,
    businessDays: n(p.businessDays) ? p.businessDays : FALLBACK_PACK.businessDays,
    extraPackBusinessDays: n(p.extraPackBusinessDays) ? p.extraPackBusinessDays : FALLBACK_PACK.extraPackBusinessDays,
    rushPct: x.rushPct,
  };
}

/** The live Model pack from the orders API, or the published one when that endpoint isn't there. */
function usePack(): Pack {
  const [pack, setPack] = useState<Pack>(null);
  useEffect(() => {
    let live = true;
    call<unknown>('GET', '/api/orders/tiers')
      .then((r) => {
        const p = readPack(r);
        if (live) setPack(p ? { live: true, pack: p } : { live: false, pack: FALLBACK_PACK });
      })
      .catch(() => live && setPack({ live: false, pack: FALLBACK_PACK }));
    return () => {
      live = false;
    };
  }, []);
  return pack;
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function priceLine(p: Plan): { amount: string; per: string } {
  if (p.priceCents === 0) return { amount: '$0', per: 'free forever' };
  if (p.interval === 'month') return { amount: dollars(p.priceCents), per: 'CAD a month' };
  return { amount: dollars(p.priceCents), per: p.id === 'kitchen_unlock' ? 'CAD once, per kitchen' : 'CAD once' };
}

/** A plan card's button. `href: null` is a plan that can't be bought yet (payments not open). */
function useCta(id: PlanId, soon: boolean): { label: string; href: string | null; note?: string; current?: boolean } {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const plan = useSession((s) => s.user?.plan?.id ?? 'free');
  const signup = (next: string) => `#/signup?next=${encodeURIComponent(next)}`;
  switch (id) {
    case 'free':
      return signedIn ? { label: 'Open my kitchens', href: '#/', current: plan === 'free' } : { label: 'Start free', href: '#/signup' };
    case 'kitchen_unlock':
      return {
        label: signedIn ? 'Choose a kitchen' : 'Start a kitchen',
        href: signedIn ? '#/' : '#/signup',
        note: soon ? 'Design it now; unlock it from the kitchen’s Export menu once payments open.' : 'Unlock it from the kitchen’s Export menu when you need the files.',
      };
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

/** `#/pricing`: the four plans, the Contractor program, custom models and the FAQ. */
export default function PricingScreen() {
  usePendingScroll();
  const payments = usePaymentsMode();
  const pack = usePack();
  return (
    <div className="mk">
      <MarketingHeader active="pricing" />
      <main>
        <section className="mk-pricing-hero">
          <span className="mk-eyebrow">Pricing</span>
          <h1>Design for free. Pay when you take it with you.</h1>
          <p className="mk-lede">
            Designing, saving, starting from photos and sharing are free with no limits. Exports are paid: the floor plan with dimensions, the full-size 3D image, the shopping list, the project file and studio renders without a watermark.
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

        <section className="mk-plans" aria-label="Plans">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} soon={payments === 'none'} />
          ))}
        </section>

        <ContractorProgram />
        <CustomModels pack={pack} soon={payments === 'none'} />
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
      items: ['Quick-add a whole cabinet line with widths, door style and finishes: no 3D model needed', 'Upload your own models, checked for size and detail', 'Or have BluModel Studio model them, delivered straight into your catalog'],
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

function CustomModels({ pack: offer, soon }: { pack: Pack; soon: boolean }) {
  const p = offer?.pack;
  return (
    <section className="mk-section" id="models" aria-labelledby="models-title">
      <SectionHead eyebrow="Make custom models" title={<span id="models-title">Not in the catalog? We’ll model it.</span>}>
        List the products: a name, the UPC from the box or a photo, and the size if you have it. Our studio builds a true-to-size 3D model of each one that appears in your kitchens. A whole cabinet line is one request with one checkout.
      </SectionHead>
      {!offer || !p ? (
        <p className="mk-loading">Loading prices…</p>
      ) : (
        <>
          <div className="mk-tiers mk-pack">
            <div className="mk-tier mk-pack-main">
              <h3>Model pack</h3>
              <p className="mk-tier-price">
                <b>{dollars(p.priceCents)}</b> <span>up to {p.productsPerPack} products</span>
              </p>
              <p className="mk-tier-for">One 3D model per product, at true size, private to you.</p>
              <dl>
                <dt>Finishes</dt>
                <dd>Up to {p.finishesPerModel} per model</dd>
                <dt>Revisions</dt>
                <dd>{p.revisions} rounds per model</dd>
                <dt>Turnaround</dt>
                <dd>
                  {p.businessDays} business days{p.extraPackBusinessDays ? `, +${p.extraPackBusinessDays} per extra pack` : ''}
                </dd>
              </dl>
            </div>
            <div className="mk-tier mk-pack-more">
              <h3>More products, more packs</h3>
              <p className="mk-tier-for">Add products and the request adds packs. One checkout for all of them.</p>
              <dl>
                {[1, 2, 3].map((n) => (
                  <Fragment key={n}>
                    <dt>
                      {(n - 1) * p.productsPerPack + 1}–{n * p.productsPerPack} products
                    </dt>
                    <dd>
                      {n} pack{n === 1 ? '' : 's'}, {dollars(n * p.priceCents)}
                    </dd>
                  </Fragment>
                ))}
                <dt>Rush</dt>
                <dd>+{p.rushPct}%, half the turnaround</dd>
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
          <p className="mk-tiers-note">{packNote(offer)}</p>
          <div className="mk-center">
            {soon ? (
              <button type="button" className="btn big" disabled title="Payments aren’t open yet">
                Custom models open soon
              </button>
            ) : (
              <a className="btn big" href="#/orders/new">
                Make custom models
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function packNote(t: NonNullable<Pack>): string {
  const exact = 'The order form always shows the exact amount before you pay.';
  const same = `A pack costs the same with 1 product or ${t.pack.productsPerPack}.`;
  return t.live ? `${same} ${exact}` : `Published list prices. ${same} ${exact}`;
}

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Why are exports paid?',
    a: 'Designing is the part we want everyone to do freely, so it has no limits. The exports are what you take to a contractor or a store: the floor plan with dimensions, the full-size 3D image, the shopping list with SKUs and the project file. That is what pays for BluModel Studio. To be straight with you: anyone can screenshot their screen. What an export gets you is the clean, full-resolution, dimensioned file.',
  },
  {
    q: 'What does the $5 unlock cover?',
    a: 'Every export of that one kitchen, forever: floor plan, 3D image, shopping list, project file, and studio renders without the watermark. Change the kitchen and export again as often as you like. Renaming it keeps the unlock; a duplicate is a new kitchen and isn’t unlocked.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes, any time, from Account → Billing. You keep your plan until the end of the period you’ve paid for, then you’re back on Free with all your kitchens. Kitchens you unlocked for $5 stay unlocked forever, whatever happens to a plan.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. “Try without an account” keeps a kitchen in this browser. A free account keeps your kitchens safe across devices and lets you share them.',
  },
  {
    q: 'How do payments work?',
    a: 'Through Stripe’s hosted checkout: BluModel Studio never asks for or sees your card number. Cancel a plan any time; you keep it to the end of the period you’ve paid for.',
  },
  {
    q: 'What do my contractor’s clients see?',
    a: 'The kitchen in 2D and 3D, “Prepared by” your company with a Contact button, and your sell prices if you choose to show them. Never your costs, markups or margins: those stay in your price book.',
  },
  {
    q: 'Custom models: what do you need, and what do I get?',
    a: 'For each product: its name, the UPC or EAN from the box (type it, paste it, or scan the barcode with your phone), and photos (PNG, JPEG or WebP, up to 8 MB each). The brand, the width, depth and height and a spec-sheet link help but are optional. You get a GLB model at true size in up to three finishes, plus a thumbnail, within the pack’s turnaround in business days. Two rounds of revisions are included per model.',
  },
  {
    q: 'Who can see a model I paid for?',
    a: 'Only you. It is private to your account: you can place it in your kitchens, and people you share a kitchen with see it in that kitchen while the link works. A contractor’s models land in their private catalog.',
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
