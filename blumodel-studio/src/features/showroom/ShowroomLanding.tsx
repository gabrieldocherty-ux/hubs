import { useEffect, useMemo } from 'react';
import type { BrandCategory, DesignDoc } from '../../types';
import { useSession } from '../../store/useSession';
import { useCatalog } from '../../store/useCatalog';
import { AccountMenu } from '../../components/AccountMenu';
import { MiniPlan } from '../../components/MiniPlan';
import { ProductArt } from '../../components/ProductArt';
import { Toasts } from '../../components/Toasts';
import { composeNewKitchen } from '../../data/compose';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { BRAND_CATEGORIES } from '../../lib/generate/brands';
import { finishList } from '../../lib/finish';
import { useShowroom } from './useShowroom';
import { CompanyLogo, SiteMark } from './SiteMark';
import { featuredLines, showroomLines, showroomPrefs, type ShowroomLine } from './lines';
import { designHref } from './links';
import { shortName, telHref, type PublicTenant } from './site';
import './showroom.css';

const SAMPLE_ROOM = { widthIn: 192, lengthIn: 168, ceilingIn: 108 };

const categoryLabel = (c: BrandCategory) => BRAND_CATEGORIES.find((x) => x.id === c)?.label ?? c;

/**
 * A showroom's front page (`#/` on <slug>.blumodel.studio, signed out; `#/welcome` for anyone):
 * the company's welcome, its featured product lines, Design your kitchen (and bathroom, when the
 * company offers it) and how to reach it. No prices, plans or anything of ours to buy.
 */
export default function ShowroomLanding() {
  const t = useShowroom();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const products = useCatalog((s) => s.products);
  useEffect(() => {
    void useCatalog.getState().load();
  }, []);
  const lines = useMemo(() => showroomLines(products), [products]);
  const shown = useMemo(() => (t ? featuredLines(lines, t.branding.featuredLines) : []), [lines, t]);
  // A sample layout made of the company's own products, drawn as a plan for the hero.
  const sample = useMemo<DesignDoc | null>(() => (lines.length ? composeNewKitchen('Sample', SAMPLE_ROOM, 'l-island', showroomPrefs(undefined, lines)) : null), [lines]);

  if (!t) return <div className="screen-msg">Loading…</div>;
  const name = shortName(t);
  const title = t.branding.welcomeTitle || `Design your new kitchen with ${name}`;
  const comingSoon = t.status === 'setup';

  return (
    <div className="sr-page">
      <header className="home-bar sr-bar">
        <a className="brand" href="#/" aria-label={`${name}, showroom home`}>
          <SiteMark />
        </a>
        <nav className="sr-bar-nav" aria-label="Showroom">
          {lines.length > 0 && (
            <a className="sr-bar-link" href="#/welcome" onClick={(e) => (e.preventDefault(), document.getElementById('sr-lines')?.scrollIntoView({ behavior: 'smooth' }))}>
              Our products
            </a>
          )}
          <a className="sr-bar-link" href="#/welcome" onClick={(e) => (e.preventDefault(), document.getElementById('sr-contact')?.scrollIntoView({ behavior: 'smooth' }))}>
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
        <section className="sr-hero" aria-labelledby="sr-title">
          <div className="sr-hero-inner">
            <div className="sr-hero-copy">
              <p className="sr-kicker">{t.isDemo ? `${name} · a demo showroom` : `${name} · virtual showroom`}</p>
              <h1 id="sr-title">{title}</h1>
              {t.branding.welcomeText && <p className="sr-lede">{t.branding.welcomeText}</p>}
              {comingSoon ? (
                <p className="sr-soon" role="status">
                  Our virtual showroom opens soon. In the meantime, call or email us below.
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
            <figure className="sr-hero-plan" aria-hidden>
              <div className="sr-plan-card">{sample ? <MiniPlan doc={sample} /> : <span className="sr-plan-empty" />}</div>
              <figcaption>A sample layout made with our products</figcaption>
            </figure>
          </div>
        </section>

        <section className="sr-steps" aria-labelledby="sr-how">
          <h2 id="sr-how" className="sr-h2">
            How it works
          </h2>
          <ol>
            <li>
              <span className="sr-step-n" aria-hidden>
                1
              </span>
              <b>Your room</b>
              <span>Enter the room’s size and pick a starting layout. It takes about a minute.</span>
            </li>
            <li>
              <span className="sr-step-n" aria-hidden>
                2
              </span>
              <b>Our products</b>
              <span>Choose cabinets, sinks, appliances and lighting from {name}’s range, and walk through it in 3D.</span>
            </li>
            <li>
              <span className="sr-step-n" aria-hidden>
                3
              </span>
              <b>Send it to us</b>
              <span>Send your design to {name}. A designer follows up to measure, refine and quote.</span>
            </li>
          </ol>
        </section>

        {shown.length > 0 && (
          <section className="sr-lines" id="sr-lines" aria-labelledby="sr-lines-title">
            <div className="sr-section-head">
              <h2 id="sr-lines-title" className="sr-h2">
                Our featured lines
              </h2>
              <p>Every product in the designer is one we sell and install.</p>
            </div>
            <div className="sr-line-grid">
              {shown.map((l) => (
                <LineCard key={l.key} line={l} signedIn={signedIn} disabled={comingSoon} />
              ))}
            </div>
          </section>
        )}

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
        <span className="sr-foot-by">Virtual showroom by BluModel Studio</span>
      </footer>
      <Toasts />
    </div>
  );
}

function LineCard({ line, signedIn, disabled }: { line: ShowroomLine; signedIn: boolean; disabled: boolean }) {
  const pics = line.products.slice(0, 3);
  const finishes = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; hex: string }>();
    for (const p of line.products) for (const f of finishList(p)) if (!seen.has(f.name) && f.hex) seen.set(f.name, { id: f.id, name: f.name, hex: f.hex });
    return [...seen.values()].slice(0, 6);
  }, [line]);
  const n = line.products.length;
  return (
    <article className="sr-line">
      <div className="sr-line-art" aria-hidden>
        {pics.map((p) => (
          <span key={p.id} className="sr-line-pic">
            <ProductArt product={p} surfaces={DEFAULT_SURFACES} />
          </span>
        ))}
      </div>
      <div className="sr-line-body">
        <h3>{line.name}</h3>
        <p className="sr-line-meta">
          {n} product{n === 1 ? '' : 's'}
          {line.categories.length ? ` · ${line.categories.map(categoryLabel).join(', ')}` : ''}
        </p>
        {finishes.length > 0 && (
          <p className="sr-swatches" aria-label={`Finishes: ${finishes.map((f) => f.name).join(', ')}`}>
            {finishes.map((f) => (
              <i key={f.name} style={{ background: f.hex }} title={f.name} />
            ))}
          </p>
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

function Contact({ t }: { t: PublicTenant }) {
  const c = t.contact;
  const tel = c.phone ? telHref(c.phone) : null;
  const rows = [c.address, c.hours, c.serviceArea ? `Serving ${c.serviceArea}` : ''].filter(Boolean);
  if (!c.phone && !c.email && !c.website && !rows.length) return null;
  return (
    <section className="sr-contact" id="sr-contact" aria-labelledby="sr-contact-title">
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
