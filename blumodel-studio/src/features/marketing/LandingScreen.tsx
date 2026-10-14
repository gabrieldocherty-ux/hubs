import { useMemo, useState } from 'react';
import { MiniPlan } from '../../components/MiniPlan';
import { ProductArt } from '../../components/ProductArt';
import { getProduct } from '../../data/catalog';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { initialDoc } from '../../store/useDesignStore';
import type { Finish, Product } from '../../types';
import { MarketingFooter, MarketingHeader, scrollIfHere, SectionHead, usePendingScroll } from './parts';
import './marketing.css';

/**
 * The landing page (signed-out `#/` and `#/welcome`), PRODUCT_SPEC §5.1 as revised: the way in is
 * a photo of the kitchen you have (`#/generate`), not a text description, which Gabe turned down.
 * Everything here is drawn by BluModel Studio itself: the hero is a real render of the starter kitchen, the
 * plan inset and the product drawings are the app's own components. No web fonts, no stock art.
 */
export default function LandingScreen() {
  usePendingScroll();
  return (
    <div className="mk">
      <MarketingHeader active="home" />
      <main>
        <Hero />
        <HowItWorks />
        <Contractors />
        <Brands />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}

function Ctas({ where }: { where: string }) {
  return (
    <div className="mk-ctas" aria-label={`Get started (${where})`}>
      <a className="btn primary big mk-cta-main" href="#/generate">
        <CameraIcon /> Start from a photo of your kitchen
      </a>
      <div className="mk-ctas-row">
        <a className="btn big" href="#/signup">
          Start free
        </a>
        <a className="mk-link" href="#/local">
          Try without an account →
        </a>
      </div>
    </div>
  );
}

function Hero() {
  const doc = useMemo(() => initialDoc(), []);
  const [art, setArt] = useState<'render' | 'plan'>('render');
  return (
    <section className="mk-hero">
      <div className="mk-hero-copy">
        <span className="mk-eyebrow">Kitchen design for the kitchen you have</span>
        <h1>See your new kitchen before anyone picks up a hammer.</h1>
        <p className="mk-lede">
          Start from a photo of your kitchen. Check the measurements, then try cabinets, appliances and finishes at their true size, in plan and in 3D. Designing, saving and sharing are free.
        </p>
        <Ctas where="top" />
        <p className="mk-hero-fine">No card needed. Exports are $5 per kitchen, or $15 a month for every kitchen.</p>
      </div>
      {art === 'render' ? (
        // The render is a real BluModel Studio 3D view of the starter kitchen (public/marketing/hero.webp).
        <figure className="mk-hero-art">
          <img
            className="mk-hero-render"
            src="/marketing/hero.webp"
            width={1200}
            height={800}
            alt="A BluModel Studio 3D view of an L-shaped kitchen with an island, warm white shaker cabinets, brass pendants and a marble countertop."
            onError={() => setArt('plan')}
          />
          <div className="mk-hero-inset" aria-hidden>
            <span className="mk-hero-inset-label">Plan</span>
            <MiniPlan doc={doc} />
          </div>
          <figcaption>The starter kitchen in BluModel Studio: the 3D view, and the same room as a plan.</figcaption>
        </figure>
      ) : (
        // Without the render (a build without public/marketing), the live plan stands in.
        <figure className="mk-hero-art mk-hero-art--plan">
          <div className="mk-hero-render mk-hero-render--plan">
            <MiniPlan doc={doc} />
          </div>
          <figcaption>The starter kitchen in BluModel Studio, as a plan.</figcaption>
        </figure>
      )}
    </section>
  );
}

const STEPS: { n: string; title: string; body: string; icon: JSX.Element }[] = [
  {
    n: '1',
    title: 'Photo',
    body: 'Add a few photos of the kitchen you have now. On a phone, just take them where you stand.',
    icon: <CameraIcon />,
  },
  {
    n: '2',
    title: 'Check the space',
    body: 'Measure one wall with a tape and BluModel Studio scales the rest. Confirm the windows, doors and where the sink and range sit.',
    icon: <TapeIcon />,
  },
  {
    n: '3',
    title: 'Redesign in 2D and 3D with real products',
    body: 'Drag in cabinets, appliances, sinks and lights at their true size. Switch between plan, 3D and wall views; design checks flag tight aisles and missing landing space as you go.',
    icon: <CubeIcon />,
  },
  {
    n: '4',
    title: 'Share',
    body: 'Send a view-only link to your partner, your family or your contractor. They look around in 3D, with or without prices, and can’t change a thing.',
    icon: <ShareIcon />,
  },
];

function HowItWorks() {
  return (
    <section className="mk-section" id="how" aria-labelledby="how-title">
      <SectionHead eyebrow="How it works" title={<span id="how-title">From the kitchen you have to the one you want</span>} center>
        Four steps, and the first two take about ten minutes with a tape measure.
      </SectionHead>
      <ol className="mk-steps">
        {STEPS.map((s) => (
          <li key={s.n} className="mk-step">
            <span className="mk-step-icon">{s.icon}</span>
            <span className="mk-step-n">Step {s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <p className="mk-steps-alt">
        No photo handy? <a href="#/local">Start from a ready-made layout</a> and change the room size to match.
      </p>
    </section>
  );
}

function Contractors() {
  return (
    <section className="mk-band" id="contractors" aria-labelledby="pro-title">
      <div className="mk-band-inner">
        <div className="mk-band-copy">
          <span className="mk-eyebrow mk-eyebrow--light">For kitchen contractors · $40/month</span>
          <h2 id="pro-title">Show your customers the exact cabinets you sell, in their kitchen, at your price.</h2>
          <ul className="mk-ticks">
            <li>Add your own lines in an afternoon: quick-add with no 3D model, upload your own, or have us model them.</li>
            <li>A price book with your cost and markup. Clients only ever see your sell price.</li>
            <li>Branded share links and printable quotes with your logo, phone and email.</li>
            <li>Get found: put the cabinets you sell in front of homeowners designing their kitchens, with a verified brand page and leads.</li>
          </ul>
          <div className="mk-band-ctas">
            <a className="btn big mk-btn-light" href="#/pricing" onClick={(e) => scrollIfHere(e, 'contractor', '#/pricing')}>
              See the Contractor plan
            </a>
            <a className="mk-link mk-link--light" href="#/pro">
              Already a contractor? Open your workspace →
            </a>
          </div>
        </div>
        <ProSample />
      </div>
    </section>
  );
}

/** An illustration of a contractor's share, drawn with fictional names and prices. */
function ProSample() {
  const lines: [string, string, string][] = [
    ['Shaker base 24″', 'Oat · BB24', '$612'],
    ['Shaker wall 30″', 'Oat · BW30', '$448'],
    ['Farmhouse sink 33″', 'Fireclay', '$1,190'],
    ['Installation', 'Labour', '$1,800'],
  ];
  return (
    <figure className="mk-sample" aria-label="Example: what a contractor’s client sees">
      <div className="mk-sample-head">
        <span className="mk-sample-logo" aria-hidden>
          B
        </span>
        <div>
          <span className="mk-sample-kicker">Prepared by</span>
          <b>Birch &amp; Bevel</b>
        </div>
        <span className="mk-sample-contact">Contact</span>
      </div>
      <ul className="mk-sample-lines">
        {lines.map(([a, b, c]) => (
          <li key={a}>
            <span>
              <b>{a}</b>
              <i>{b}</i>
            </span>
            <span className="mono">{c}</span>
          </li>
        ))}
      </ul>
      <div className="mk-sample-total">
        <span>Your price</span>
        <b className="mono">$4,050</b>
      </div>
      <figcaption>Illustration with a made-up company. Your client sees sell prices only: never your cost or margin.</figcaption>
    </figure>
  );
}

const SHOWCASE: [string, string?][] = [['heritage-36', 'sage'], ['fridge-retro', 'cream'], ['sink-farm'], ['hood-plaster'], ['pendant-dome', 'brass'], ['wall-glass']];

function Brands() {
  const items = useMemo(
    () =>
      SHOWCASE.map(([id, finishId]) => {
        const p = getProduct(id);
        if (!p) return null;
        const finish = Array.isArray(p.finishes) ? (p.finishes.find((f) => f.id === finishId) ?? p.finishes[0]) : undefined;
        return { p, finish } as { p: Product; finish?: Finish };
      }).filter((x): x is { p: Product; finish?: Finish } => !!x),
    [],
  );
  return (
    <section className="mk-section mk-brands" id="brands" aria-labelledby="brands-title">
      <div className="mk-split">
        <div>
          <SectionHead eyebrow="Brands and makers" title={<span id="brands-title">Brand products at their real size, ready to drop in</span>}>
            Every product in BluModel Studio has real dimensions, finishes and a price, and brand products carry their SKU and a link to buy. Open any of them on its own page, turn it around in 3D, then drop it into your kitchen.
          </SectionHead>
          <ul className="mk-ticks mk-ticks--dark">
            <li>Brand pages with a <b>Verified</b> badge once we’ve checked the business is real.</li>
            <li>Sell cabinets or fixtures? Your brand page comes with the Contractor plan: publish what you sell and get leads from homeowners.</li>
            <li>
              Can’t find your exact range or sink? <a href="#/orders/new">Have it modelled</a> and it appears in your kitchens, privately.
            </li>
          </ul>
        </div>
        <div className="mk-shelf" aria-label="A few products from the demo catalog">
          {items.map(({ p, finish }) => (
            <div key={p.id} className="mk-shelf-item">
              <span className="mk-shelf-art">
                <ProductArt product={p} finish={finish} surfaces={DEFAULT_SURFACES} />
              </span>
              <span className="mk-shelf-name">{p.name}</span>
              <span className="mk-shelf-brand">{p.brand} (demo)</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mk-final" aria-labelledby="final-title">
      <h2 id="final-title">Your kitchen, redesigned tonight.</h2>
      <p>Free to design, save and share. Pay only if you want the files.</p>
      <Ctas where="bottom" />
    </section>
  );
}

// ── small inline icons (stroke = currentColor) ───────────────────────────

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l1.6-2.4A1.5 1.5 0 0 1 9.85 5h4.3a1.5 1.5 0 0 1 1.25.6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function TapeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="12" r="6" />
      <circle cx="9" cy="12" r="1.6" />
      <path d="M15 15.5h6v3h-6M17 15.5v1.6M19 15.5v1.6" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
      <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
    </svg>
  );
}
