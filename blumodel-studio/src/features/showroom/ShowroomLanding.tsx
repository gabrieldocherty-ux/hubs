import { lazy, Suspense, useEffect, useMemo } from 'react';
import type { BrandCategory, DesignDoc } from '../../types';
import { useSession } from '../../store/useSession';
import { useCatalog } from '../../store/useCatalog';
import { AccountMenu } from '../../components/AccountMenu';
import { MiniPlan } from '../../components/MiniPlan';
import { ProductThumb } from '../../components/thumbs/ProductThumb';
import { Toasts } from '../../components/Toasts';
import { composeNewKitchen } from '../../data/compose';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { BRAND_CATEGORIES } from '../../lib/generate/brands';
import { finishList } from '../../lib/finish';
import { useShowroom } from './useShowroom';
import { useConfig, useLegal } from '../../lib/config';
import { CompanyLogo, SiteMark } from './SiteMark';
import { featuredLines, showroomLines, showroomPrefs, type ShowroomLine } from './lines';
import { designHref, salesOrigin } from './links';
import { shortName, telHref, type PublicTenant, type ShowroomImages, type ShowroomPic } from './site';
import './showroom.css';

// The demo showroom's pitch to prospects (never on a real showroom), in its own chunk.
const DemoPitch = lazy(() => import('./DemoPitch'));

const SAMPLE_ROOM = { widthIn: 192, lengthIn: 168, ceilingIn: 108 };

/**
 * The demo showroom only (Northline, demo.blumodel.studio): a slim band saying what this is, for
 * prospects arriving from the sales site, with the way back to book a call. Real showrooms never
 * show it (Gabe, 2026-10-17: "I don't want people to not understand").
 */
function DemoBanner() {
  const base = useConfig((s) => s.config?.baseDomain ?? 'blumodel.studio');
  return (
    <aside className="sr-demo-band" aria-label="About this demo">
      <p>
        <b>This is a demo showroom built by BluModel Studio.</b> Your company gets one like it, with your products, your
        brand and your own web address.
      </p>
      <a className="sr-demo-cta" href={`${salesOrigin(base)}/#/book`}>
        Get one for your company
      </a>
    </aside>
  );
}

const categoryLabel = (c: BrandCategory) => BRAND_CATEGORIES.find((x) => x.id === c)?.label ?? c;

/** Scrolls to an in-page section (the header's links), under the header. */
const jump = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/**
 * A showroom's front page (`#/` on <slug>.blumodel.studio, signed out; `#/welcome` for anyone):
 * a full-bleed picture of a finished kitchen made with the company's own products (its own photo
 * when it uploaded one), its featured lines as large pictures, a gallery of kitchens designed in the
 * showroom, how it works, and how to reach the company. No prices, plans or anything of ours to buy.
 * Without pictures yet, the hero shows a plan made of the company's products instead.
 */
export default function ShowroomLanding() {
  const legal = useLegal();
  const t = useShowroom();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const products = useCatalog((s) => s.products);
  useEffect(() => {
    void useCatalog.getState().load();
  }, []);
  const lines = useMemo(() => showroomLines(products), [products]);
  const shown = useMemo(() => (t ? featuredLines(lines, t.branding.featuredLines) : []), [lines, t]);
  // A sample layout made of the company's own products, drawn as a plan (the hero without pictures, step 1).
  const sample = useMemo<DesignDoc | null>(() => (lines.length ? composeNewKitchen('Sample', SAMPLE_ROOM, 'l-island', showroomPrefs(undefined, lines)) : null), [lines]);

  if (!t) return <div className="screen-msg">Loading…</div>;
  const name = shortName(t);
  const title = t.branding.welcomeTitle || `Design your new kitchen with ${name}`;
  const comingSoon = t.status === 'setup';
  const im = t.images;

  return (
    <div className="sr-page">
      {t.isDemo && <DemoBanner />}
      <header className="home-bar sr-bar">
        <a className="brand" href="#/" aria-label={`${name}, showroom home`}>
          <SiteMark />
        </a>
        <nav className="sr-bar-nav" aria-label="Showroom">
          {lines.length > 0 && (
            <a className="sr-bar-link" href="#/welcome" onClick={jump('sr-lines')}>
              Our products
            </a>
          )}
          {im.gallery.length > 0 && (
            <a className="sr-bar-link" href="#/welcome" onClick={jump('sr-gallery')}>
              Kitchens
            </a>
          )}
          <a className="sr-bar-link" href="#/welcome" onClick={jump('sr-contact')}>
            Contact
          </a>
          {signedIn ? (
            <>
              <a className="sr-bar-link sr-bar-link--strong" href="#/">
                Your designs
              </a>
              <AccountMenu />
            </>
          ) : (
            <a className="btn" href="#/signin">
              Sign in
            </a>
          )}
        </nav>
      </header>

      <main>
        <section className={`sr-hero${im.hero ? ' sr-hero--photo' : ''}`} aria-labelledby="sr-title">
          {im.hero && <HeroPicture images={im} name={name} />}
          <div className="sr-hero-inner">
            <div className="sr-hero-copy">
              <p className="sr-kicker">{t.isDemo ? `${name} · a demo showroom` : `${name} · virtual showroom`}</p>
              <h1 id="sr-title">{title}</h1>
              {t.branding.welcomeText && <p className="sr-lede">{t.branding.welcomeText}</p>}
              {comingSoon ? (
                <p className="sr-soon" role="status">
                  {t.contact.phone || t.contact.email ? 'Our virtual showroom opens soon. In the meantime, call or email us below.' : 'Our virtual showroom opens soon.'}
                </p>
              ) : (
                <>
                  <div className="sr-ctas">
                    <a className="sr-cta" href={designHref('kitchen', signedIn)}>
                      Design your kitchen
                    </a>
                    {t.features.bathrooms && (
                      <a className="sr-cta sr-cta--ghost" href={designHref('bathroom', signedIn)}>
                        Design your bathroom
                      </a>
                    )}
                  </div>
                  <p className="sr-reassure">Free, no obligation. Save your design and send it to {name} for a quote.</p>
                </>
              )}
            </div>
            {!im.hero && sample && (
              <figure className="sr-hero-plan" aria-hidden>
                <div className="sr-plan-card">
                  <span className="sr-plan-tag">Sample layout</span>
                  <MiniPlan doc={sample} />
                </div>
                <figcaption>A sample layout made with our products</figcaption>
              </figure>
            )}
          </div>
          {im.hero?.source === 'render' && <p className="sr-hero-note">Rendered in 3D with {name}’s own products</p>}
        </section>

        {shown.length > 0 && (
          <section className="sr-lines sr-section" id="sr-lines" aria-labelledby="sr-lines-title">
            <div className="sr-section-head">
              <div>
                <p className="sr-eyebrow">Our products</p>
                <h2 id="sr-lines-title" className="sr-h2">
                  Our featured lines
                </h2>
              </div>
              <p>Every product in the designer is one we sell and install.</p>
            </div>
            <div className="sr-line-grid">
              {shown.map((l, i) => (
                <LineCard key={l.key} line={l} pic={im.lines[l.key] ?? null} signedIn={signedIn} disabled={comingSoon} wide={i === 0 && shown.length % 3 === 1} />
              ))}
            </div>
          </section>
        )}

        {t.isDemo && (
          <Suspense fallback={null}>
            <DemoPitch tenant={t} />
          </Suspense>
        )}

        {im.gallery.length > 0 && (
          <section className="sr-gallery sr-section" id="sr-gallery" aria-labelledby="sr-gallery-title">
            <div className="sr-section-head">
              <div>
                <p className="sr-eyebrow">Inspiration</p>
                <h2 id="sr-gallery-title" className="sr-h2">
                  Kitchens designed in our showroom
                </h2>
              </div>
              <p>Every one is made with our own products. Open one in 3D and make it yours.</p>
            </div>
            <div className={`sr-gallery-grid sr-gallery-grid--${Math.min(3, im.gallery.length)}`}>
              {im.gallery.map((g, i) => (
                <figure key={g.url} className="sr-shot">
                  <Pic pic={g} alt={g.title} sizes={i === 0 ? '(max-width: 1240px) 100vw, 1200px' : '(max-width: 560px) 100vw, 600px'} />
                  <figcaption>
                    <span>{g.title}</span>
                    {g.design && !comingSoon && (
                      <a className="sr-shot-go" href={`#/s/${g.design}`}>
                        Open in 3D <span aria-hidden>→</span>
                      </a>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <Steps t={t} name={name} sample={sample} lines={shown} />

        <Contact t={t} />
      </main>

      <footer className="sr-foot">
        <span>
          © {new Date().getFullYear()} {name}
        </span>
        <nav aria-label="Legal">
          <a href="#/terms">Terms</a>
          <a href="#/privacy">Privacy</a>
        </nav>
        <span className="sr-foot-by">
          Virtual showroom by BluModel Studio · software © {new Date().getFullYear()} {legal.businessName ?? 'BluModel Studio'}
        </span>
      </footer>
      <Toasts />
    </div>
  );
}

/** The hero's picture: the portrait render on a phone, the wide one elsewhere; fetched first. */
function HeroPicture({ images, name }: { images: ShowroomImages; name: string }) {
  const hero = images.hero!;
  const tall = images.heroTall;
  return (
    <picture className="sr-hero-pic">
      {tall && <source media="(max-width: 700px)" srcSet={tall.url} width={tall.w} height={tall.h} />}
      <img src={hero.url} width={hero.w} height={hero.h} alt={hero.source === 'photo' ? `A kitchen by ${name}` : `A finished kitchen made with ${name}’s products`} fetchPriority="high" decoding="async" />
    </picture>
  );
}

/** A picture below the fold: lazy, with its size reserved so nothing shifts. */
function Pic({ pic, alt, sizes }: { pic: ShowroomPic; alt: string; sizes?: string }) {
  return <img src={pic.url} width={pic.w} height={pic.h} alt={alt} loading="lazy" decoding="async" sizes={sizes} />;
}

function LineCard({ line, pic, signedIn, disabled, wide }: { line: ShowroomLine; pic: ShowroomPic | null; signedIn: boolean; disabled: boolean; wide: boolean }) {
  const finishes = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; hex: string }>();
    for (const p of line.products) for (const f of finishList(p)) if (!seen.has(f.name) && f.hex) seen.set(f.name, { id: f.id, name: f.name, hex: f.hex });
    return [...seen.values()].slice(0, 6);
  }, [line]);
  const n = line.products.length;
  const pics = line.products.slice(0, 3);
  const cats = line.categories.map(categoryLabel).join(', ');
  return (
    <article className={`sr-line${wide ? ' sr-line--wide' : ''}`}>
      <div className="sr-line-media">
        {pic ? (
          <Pic pic={pic} alt={`${line.name}, installed`} sizes="(max-width: 760px) 100vw, 400px" />
        ) : (
          <div className="sr-line-art" style={{ gridTemplateColumns: `repeat(${Math.max(1, pics.length)}, 1fr)` }} aria-hidden>
            {pics.map((p) => (
              <span key={p.id} className="sr-line-pic">
                <ProductThumb product={p} surfaces={DEFAULT_SURFACES} />
              </span>
            ))}
          </div>
        )}
        {cats && <span className="sr-line-chip">{cats}</span>}
      </div>
      <div className="sr-line-body">
        <h3>{line.name}</h3>
        <p className="sr-line-meta">
          {n} product{n === 1 ? '' : 's'}
          {finishes.length > 1 ? ` · ${finishes.length} finishes` : ''}
        </p>
        {finishes.length > 0 && (
          <ul className="sr-swatches" aria-label={`Finishes: ${finishes.map((f) => f.name).join(', ')}`}>
            {finishes.map((f) => (
              <li key={f.name} title={f.name}>
                <i style={{ background: f.hex }} />
                <span>{f.name}</span>
              </li>
            ))}
          </ul>
        )}
        {!disabled && (
          <a className="sr-line-go" href={designHref('kitchen', signedIn, line.name)}>
            Design with {line.name} <span aria-hidden>→</span>
          </a>
        )}
      </div>
    </article>
  );
}

/** How it works, each step with a picture: the plan, the company's products in 3D, the send. */
function Steps({ t, name, sample, lines }: { t: PublicTenant; name: string; sample: DesignDoc | null; lines: ShowroomLine[] }) {
  const im = t.images;
  const productPic = (lines.length ? im.lines[lines[0].key] : undefined) ?? im.gallery[0] ?? null;
  // Pictures on every step, or on none (a showroom with no products yet keeps plain cards).
  const art = !!(sample && productPic);
  return (
    <section className={`sr-steps sr-section${art ? '' : ' sr-steps--plain'}`} aria-labelledby="sr-how">
      <div className="sr-section-head">
        <div>
          <p className="sr-eyebrow">How it works</p>
          <h2 id="sr-how" className="sr-h2">
            From an empty room to a quote
          </h2>
        </div>
      </div>
      <ol>
        <li>
          {art && sample && (
            <div className="sr-step-art sr-step-art--plan" aria-hidden>
              <MiniPlan doc={sample} />
            </div>
          )}
          <span className="sr-step-n" aria-hidden>
            1
          </span>
          <b>Your room</b>
          <span>Enter the room’s size and pick a starting layout. It takes about a minute.</span>
        </li>
        <li>
          {art && productPic && (
            <div className="sr-step-art" aria-hidden>
              <img src={productPic.url} width={productPic.w} height={productPic.h} alt="" loading="lazy" decoding="async" />
            </div>
          )}
          <span className="sr-step-n" aria-hidden>
            2
          </span>
          <b>Our products</b>
          <span>Choose cabinets, sinks, appliances and lighting from {name}’s range, and walk through it in 3D.</span>
        </li>
        <li>
          {art && (
          <div className="sr-step-art sr-step-art--send" aria-hidden>
            <div className="sr-mock">
              <CompanyLogo tenant={t} size={30} />
              <b>Send this design to {name}</b>
              <i />
              <i />
              <span className="sr-mock-btn">Send my design</span>
            </div>
          </div>
          )}
          <span className="sr-step-n" aria-hidden>
            3
          </span>
          <b>Send it to us</b>
          <span>Send your design to {name}. A designer follows up to measure, refine and quote.</span>
        </li>
      </ol>
    </section>
  );
}

function Contact({ t }: { t: PublicTenant }) {
  const c = t.contact;
  const tel = c.phone ? telHref(c.phone) : null;
  const rows = [c.address, c.hours, c.serviceArea ? `Serving ${c.serviceArea}` : ''].filter(Boolean);
  if (!c.phone && !c.email && !c.website && !rows.length) return null;
  return (
    <section className="sr-contact sr-section" id="sr-contact" aria-labelledby="sr-contact-title">
      <div className="sr-contact-card">
        <CompanyLogo tenant={t} size={52} />
        <div className="sr-contact-text">
          <h2 id="sr-contact-title" className="sr-h2">
            Talk to {shortName(t)}
          </h2>
          {rows.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
        <div className="sr-contact-actions">
          {c.phone && (tel ? <a className="btn big" href={tel}>Call {c.phone}</a> : <span className="btn big">{c.phone}</span>)}
          {c.email && (
            <a className="btn big" href={`mailto:${c.email}`}>
              Email us
            </a>
          )}
          {c.website && (
            <a className="btn big" href={c.website} target="_blank" rel="noopener noreferrer">
              Our website
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
