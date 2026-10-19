import { lazy, Suspense, useState } from 'react';
import { ProductArt } from '../../components/ProductArt';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { inches } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { Check } from '../../components/Icons';
import type { PublicBrand, PublicProduct } from './api';
import { brandApi } from './api';
import { groupByLine, needsDemoTag, priceLabel } from './logic';
import './brands.css';
import { LegalLinks } from '../legal/LegalLinks';

const LeadForm = lazy(() => import('./LeadForm'));
const TryInKitchen = lazy(() => import('./TryInKitchen'));

export interface PublicBrandViewProps {
  brand: PublicBrand;
  products: PublicProduct[];
  /** The owner's (or an admin's) preview: no beacons, and the lead form sends nothing. */
  preview?: boolean;
}

/**
 * The page homeowners see at `#/b/:slug` (BRAND_PAGE §5), also used for the preview: cover, logo,
 * name and badge, service area, tagline and about, products by line (each linking to its product
 * page), Try in my kitchen and Contact.
 */
export function PublicBrandView({ brand, products, preview = false }: PublicBrandViewProps) {
  const [lead, setLead] = useState<{ product: { id: string; name: string } | null } | null>(null);
  const [trying, setTrying] = useState<PublicProduct | null>(null);
  const groups = groupByLine(products);
  const contractor = brand.kind === 'contractor';
  const canContact = contractor && brand.leadForm;

  const contact = (product: PublicProduct | null) => {
    if (!preview) void brandApi.event(brand.slug, 'quote_click', product?.id);
    setLead({ product: product ? { id: product.id, name: product.name } : null });
  };

  const website = brand.website ? brand.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

  return (
    <div className="bp">
      <section className={`bp-hero${brand.coverUrl ? ' has-cover' : ''}`} aria-label={brand.name}>
        {brand.coverUrl ? <img className="bp-cover" src={brand.coverUrl} alt="" /> : <div className="bp-cover bp-cover--plain" aria-hidden="true" />}
        <div className="bp-head">
          <div className="bp-logo" aria-hidden={!brand.logoUrl}>
            {brand.logoUrl ? <img src={brand.logoUrl} alt={`${brand.name} logo`} /> : <span>{initials(brand.name)}</span>}
          </div>
          <div className="bp-title">
            <div className="bp-badges">
              {brand.verified && (
                <span className="bp-verified" title={contractor ? 'BluModel Studio checked that this business is real.' : 'A brand curated by BluModel Studio.'}>
                  <Check width={13} height={13} /> {contractor ? 'Verified contractor' : 'Verified brand'}
                </span>
              )}
              {needsDemoTag(brand) && <span className="tag">Demo</span>}
            </div>
            <h1>{brand.name}</h1>
            {brand.tagline && <p className="bp-tagline">{brand.tagline}</p>}
            <p className="bp-meta">
              {brand.serviceArea && <span>Serves {brand.serviceArea}</span>}
              {website && (
                <a href={brand.website} target="_blank" rel="noopener nofollow noreferrer">
                  {website}
                </a>
              )}
              {brand.phone && <a href={`tel:${brand.phone.replace(/[^0-9+]/g, '')}`}>{brand.phone}</a>}
              {brand.email && <a href={`mailto:${brand.email}`}>{brand.email}</a>}
            </p>
          </div>
          {canContact && (
            <div className="bp-cta">
              <button className="btn primary big" onClick={() => contact(null)}>
                Contact {brand.name}
              </button>
            </div>
          )}
        </div>
      </section>

      {brand.about && (
        <section className="bp-about" aria-label="About">
          <p>{brand.about}</p>
        </section>
      )}

      {products.length === 0 ? (
        <div className="bp-empty">
          <h2>No products yet</h2>
          <p>{preview ? 'Publish products from Brand page → Products. They show here once approved.' : `${brand.name} hasn’t published any products yet.`}</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.line || 'other'} className="bp-line" aria-label={g.label}>
            <h2>
              {g.label} <span>{g.items.length} piece{g.items.length === 1 ? '' : 's'}</span>
            </h2>
            <div className="bp-grid">
              {g.items.map((p) => (
                <article key={p.id} className="bp-card">
                  <a className="bp-card-art" href={hrefFor({ name: 'product', id: p.id })} aria-label={`${p.name}: see it in 3D`}>
                    {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" loading="lazy" /> : <ProductArt product={p} surfaces={DEFAULT_SURFACES} />}
                    {p.model && <span className="bp-3d">3D</span>}
                  </a>
                  <div className="bp-card-body">
                    <a className="bp-card-name" href={hrefFor({ name: 'product', id: p.id })}>
                      {p.name}
                    </a>
                    <span className="muted">
                      {p.widthOptions?.length ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″ wide` : `${inches(p.widthIn)} wide`} · {inches(p.depthIn)} deep · {inches(p.heightIn)} tall
                    </span>
                    <b className="bp-price">{priceLabel(p)}</b>
                  </div>
                  <div className="bp-card-actions">
                    <button className="btn" onClick={() => setTrying(p)}>
                      Try in my kitchen
                    </button>
                    {canContact && (
                      <button className="btn" onClick={() => contact(p)}>
                        Request a quote
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      <footer className="bp-foot">
        <p className="fine">
          {contractor
            ? `Products and prices are set by ${brand.name}. BluModel Studio checked that the business is real; it doesn’t sell or install anything itself.`
            : 'Curated by BluModel Studio. Prices are list prices.'}
        </p>
        <LegalLinks />
      </footer>

      <Suspense fallback={null}>
        {lead && <LeadForm slug={brand.slug} company={brand.name} product={lead.product} preview={preview} onClose={() => setLead(null)} />}
        {trying && <TryInKitchen product={trying} onClose={() => setTrying(null)} />}
      </Suspense>
    </div>
  );
}

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
