import { useEffect, useState } from 'react';
import plansJson from '../../data/plans.json';
import { call } from '../../lib/api';
import { useSession } from '../../store/useSession';
import type { ModelTier, Plan, PlanId } from '../../types/platform';
import { MarketingFooter, MarketingHeader, SectionHead, usePaymentsMode, usePendingScroll } from './parts';
import './marketing.css';

const PLANS = plansJson as Plan[];

/**
 * Custom-model tiers as published in PRODUCT_SPEC §7.2. Shown only when `GET /api/orders/tiers`
 * (package C) isn't answering, and labelled as such: the order form is always the real quote.
 */
const FALLBACK_TIERS: ModelTier[] = [
  { id: 'simple', name: 'Simple', for: 'Hardware, faucets, decor, simple lights', priceCents: 12900, businessDays: 7, revisions: 2 },
  { id: 'standard', name: 'Standard', for: 'Appliances, sinks, single cabinets, stools', priceCents: 27900, businessDays: 10, revisions: 2 },
  { id: 'complex', name: 'Complex', for: 'Modular or multi-part products, pro ranges, chandeliers', priceCents: 54900, businessDays: 15, revisions: 2 },
];

/** The add-ons package C publishes next to its tiers (`GET /api/orders/tiers`). */
interface TierExtras {
  includedFinishes: number;
  extraFinishCents: number;
  rushPct: number;
}

type Tiers = { live: true; tiers: ModelTier[]; extras: TierExtras | null } | { live: false; tiers: ModelTier[] } | null;

const FALLBACK_EXTRAS: TierExtras = { includedFinishes: 2, extraFinishCents: 3900, rushPct: 50 };

function readExtras(r: unknown): TierExtras | null {
  const x = r as Partial<TierExtras> | null;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return x && n(x.includedFinishes) && n(x.extraFinishCents) && n(x.rushPct)
    ? { includedFinishes: x.includedFinishes!, extraFinishCents: x.extraFinishCents!, rushPct: x.rushPct! }
    : null;
}

function isTier(t: unknown): t is ModelTier {
  const x = t as ModelTier;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.priceCents === 'number' && Number.isFinite(x.priceCents);
}

/** Live tiers from package C, or the published list when that endpoint isn't there (yet). */
function useTiers(): Tiers {
  const [tiers, setTiers] = useState<Tiers>(null);
  useEffect(() => {
    let live = true;
    call<unknown>('GET', '/api/orders/tiers')
      .then((r) => {
        const list = Array.isArray(r) ? r : (r as { tiers?: unknown })?.tiers;
        const ok = Array.isArray(list) ? list.filter(isTier) : [];
        if (live) setTiers(ok.length ? { live: true, tiers: ok, extras: Array.isArray(r) ? null : readExtras(r) } : { live: false, tiers: FALLBACK_TIERS });
      })
      .catch(() => live && setTiers({ live: false, tiers: FALLBACK_TIERS }));
    return () => {
      live = false;
    };
  }, []);
  return tiers;
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function priceLine(p: Plan): { amount: string; per: string } {
  if (p.priceCents === 0) return { amount: '$0', per: 'free forever' };
  if (p.interval === 'month') return { amount: dollars(p.priceCents), per: 'a month' };
  return { amount: dollars(p.priceCents), per: p.id === 'kitchen_unlock' ? 'once, per kitchen' : 'once' };
}

function useCta(id: PlanId): { label: string; href: string; note?: string; current?: boolean } {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const plan = useSession((s) => s.user?.plan?.id ?? 'free');
  const signup = (next: string) => `#/signup?next=${encodeURIComponent(next)}`;
  switch (id) {
    case 'free':
      return signedIn ? { label: 'Open my kitchens', href: '#/', current: plan === 'free' } : { label: 'Start free', href: '#/signup' };
    case 'kitchen_unlock':
      return { label: signedIn ? 'Choose a kitchen' : 'Start a kitchen', href: signedIn ? '#/' : '#/signup', note: 'Unlock it from the kitchen’s Export menu when you need the files.' };
    case 'unlimited':
      if (plan === 'unlimited') return { label: 'Manage your plan', href: '#/account/billing', current: true };
      return { label: 'Go Unlimited', href: signedIn ? '#/account/billing' : signup('#/account/billing') };
    case 'contractor':
      if (plan === 'contractor') return { label: 'Open your workspace', href: '#/pro', current: true };
      return { label: 'Become a BluModel Studio contractor', href: signedIn ? '#/pro' : signup('#/pro') };
  }
}

/** `#/pricing`: the four plans, the Contractor program, custom models and the FAQ. */
export default function PricingScreen() {
  usePendingScroll();
  const payments = usePaymentsMode();
  const tiers = useTiers();
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
            <p className="mk-demo-note" role="note">
              <b>Demo payments.</b> This server has no payment provider set up, so checkout is a clearly labelled simulation and nothing is charged.
            </p>
          )}
        </section>

        <section className="mk-plans" aria-label="Plans">
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </section>

        <ContractorProgram />
        <CustomModels tiers={tiers} />
        <Faq />
      </main>
      <MarketingFooter />
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const cta = useCta(plan.id);
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
        <a className={`btn wide${pro || plan.id === 'unlimited' ? ' primary' : ''}`} href={cta.href}>
          {cta.label}
        </a>
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
          <span className="mk-eyebrow mk-eyebrow--light">The Contractor program · $40/month</span>
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

function CustomModels({ tiers }: { tiers: Tiers }) {
  return (
    <section className="mk-section" id="models" aria-labelledby="models-title">
      <SectionHead eyebrow="Custom 3D models" title={<span id="models-title">Not in the catalog? We’ll model it.</span>}>
        Send photos, the dimensions and a spec sheet. Our studio builds a true-to-size 3D model that appears in your kitchens. Priced per product; a line of cabinets is one order with one checkout.
      </SectionHead>
      {tiers === null ? (
        <p className="mk-loading">Loading prices…</p>
      ) : (
        <>
          <div className="mk-tiers">
            {tiers.tiers.map((t) => (
              <div key={t.id} className="mk-tier">
                <h3>{t.name}</h3>
                <p className="mk-tier-price">
                  <b>{dollars(t.priceCents)}</b> <span>per product</span>
                </p>
                {t.for && <p className="mk-tier-for">{t.for}</p>}
                <dl>
                  {typeof t.businessDays === 'number' && (
                    <>
                      <dt>Turnaround</dt>
                      <dd>{t.businessDays} business days</dd>
                    </>
                  )}
                  {typeof t.revisions === 'number' && (
                    <>
                      <dt>Revisions</dt>
                      <dd>{t.revisions} rounds included</dd>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
          <p className="mk-tiers-note">{tiersNote(tiers)}</p>
          <div className="mk-center">
            <a className="btn big" href="#/orders/new">
              Request a model
            </a>
          </div>
        </>
      )}
    </section>
  );
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

function tiersNote(t: NonNullable<Tiers>): string {
  const exact = 'The order form always shows the exact amount before you pay.';
  const e = t.live ? t.extras : FALLBACK_EXTRAS;
  if (!e) return `Extra finishes and rush delivery are priced on the order form. ${exact}`;
  const included = NUMBER_WORDS[e.includedFinishes] ?? String(e.includedFinishes);
  const addOns = `+${dollars(e.extraFinishCents)} per extra finish beyond ${included}; rush delivery is +${e.rushPct}% for half the turnaround.`;
  return t.live ? `${addOns} ${exact}` : `Published list prices: ${addOns} ${exact}`;
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
    a: 'Through Stripe’s hosted checkout: BluModel Studio never asks for or sees your card number. On a server without a payment provider, checkout is a clearly labelled demo and nothing is charged.',
  },
  {
    q: 'What do my contractor’s clients see?',
    a: 'The kitchen in 2D and 3D, “Prepared by” your company with a Contact button, and your sell prices if you choose to show them. Never your costs, markups or margins: those stay in your price book.',
  },
  {
    q: 'Custom models: what do you need, and what do I get?',
    a: 'Photos (PNG, JPEG or WebP, up to 8 MB each), the width, depth and height, and a spec sheet or link if you have one. You get a GLB model at true size with your finishes, plus a thumbnail, within the tier’s turnaround in business days. Two rounds of revisions are included.',
  },
  {
    q: 'Who can see a model I paid for?',
    a: 'Only you. It is private to your account: you can place it in your kitchens, and people you share a kitchen with see it in that kitchen while the link works. A contractor’s models land in their private catalog.',
  },
];

function Faq() {
  return (
    <section className="mk-section mk-faq" id="faq" aria-labelledby="faq-title">
      <SectionHead eyebrow="Questions" title={<span id="faq-title">Good questions, straight answers</span>} center />
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
