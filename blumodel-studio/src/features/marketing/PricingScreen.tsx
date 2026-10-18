import { MarketingFooter, MarketingHeader, PRICES, SectionHead, usePendingScroll, useTitle } from './parts';
import { BookSection, Faq, PricingCards } from './sections';
import './marketing.css';

/**
 * `#/pricing` on the sales site (docs/SHOWROOM_PIVOT.md §2 and §6): the yearly license and the
 * monthly plan, what each covers, and how each is paid. No homeowner pricing: homeowners never pay.
 * Prices come from src/data/plans.json, the server's own list.
 */
export default function PricingScreen() {
  usePendingScroll();
  useTitle('Pricing · BluModel Studio');
  return (
    <div className="mk">
      <MarketingHeader active="pricing" />
      <main>
        <section className="mk-pricing-hero" aria-labelledby="pricing-hero-title">
          <span className="mk-eyebrow">Pricing</span>
          <h1 id="pricing-hero-title">{PRICES.monthly} a month, plus a setup quoted for your company.</h1>
          <p className="mk-lede">
            The monthly plan pays for hosting your showroom at your own web address and for AI renderings. The setup and yearly license pay for your showroom, setting it up and
            modelling your products; every company’s range is different, so we quote it on a call. No per-lead fees, and your customers never pay. All prices are in Canadian dollars.
          </p>
        </section>
        <section className="mk-section mk-section--tight" aria-label="Plans">
          <PricingCards headingLevel={2} />
        </section>
        <Billing />
        <Faq />
        <BookSection />
      </main>
      <MarketingFooter />
    </div>
  );
}

const ROWS: { q: string; a: string }[] = [
  {
    q: 'How the setup and license are paid',
    a: 'Setup and yearly license: quoted for your company. Book a call and we’ll price it for your product range, then send an invoice: e-transfer, cheque or card.',
  },
  {
    q: 'How the monthly plan is paid',
    a: 'We send you a secure Stripe checkout link and you pay by card. Receipts and the card on file are in your showroom’s Plan page. We never see your card number.',
  },
  {
    q: `What the ${PRICES.monthly} is made of`,
    a: `${PRICES.hosting} for hosting and running your showroom, including its own web address, and ${PRICES.credits} of AI rendering credits. Unused credits roll over for ${PRICES.rolloverMonths} months.`,
  },
  {
    q: 'If a payment fails',
    a: 'Your showroom stays live for 14 days while the card is retried. After that it shows a polite “temporarily unavailable” page to visitors until the plan is paid. Your products, designs and leads are kept.',
  },
  {
    q: 'Adding products later',
    a: 'Send us what’s new and we quote it before we model anything. Nothing is charged without your OK.',
  },
  {
    q: 'Your own domain',
    a: 'Included. We connect a domain you own, such as showroom.yourcompany.ca, at no extra charge, and your blumodel.studio address keeps working.',
  },
];

function Billing() {
  return (
    <section className="mk-section" id="billing" aria-labelledby="billing-title">
      <SectionHead id="billing-title" eyebrow="Billing" title="How paying works" center />
      <dl className="mk-rows">
        {ROWS.map((r) => (
          <div key={r.q} className="mk-row">
            <dt>{r.q}</dt>
            <dd>{r.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
