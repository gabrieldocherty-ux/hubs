import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { hrefFor } from '../../lib/router';

/** The parts of `GET /api/orders/tiers` this page shows. The server is the only price source. */
interface PackOffer {
  priceCents: number;
  productsPerPack: number;
  finishesPerModel: number;
  revisions: number;
}

function readPack(raw: unknown): PackOffer | null {
  const p = (raw as { pack?: Partial<PackOffer> } | null)?.pack;
  if (!p || ![p.priceCents, p.productsPerPack, p.finishesPerModel, p.revisions].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return p as PackOffer;
}

const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 });

/**
 * `#/pro/modelling`: Make custom models for the contractor's own products. The same Model-pack
 * request as everyone's (package C's orders), with target "My catalog": delivered models land
 * privately in My catalog, ready to price.
 */
export default function Modelling() {
  const [pack, setPack] = useState<PackOffer | null>(null);
  useEffect(() => {
    let live = true;
    call<unknown>('GET', '/api/orders/tiers')
      .then((r) => live && setPack(readPack(r)))
      .catch(() => undefined); // the copy reads fine without the numbers
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="pro-modelling">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Make custom models</span>
          <h1>Have BluModel Studio model your products</h1>
          <p className="muted">
            List the products, with a UPC, photos or both for each, and the BluModel 3D studio builds a true-to-size model of every one.{' '}
            {pack
              ? `A Model pack covers up to ${pack.productsPerPack} products for ${money(pack.priceCents)}, with up to ${pack.finishesPerModel} finishes and ${pack.revisions} revision rounds per model; more products add packs, all in one checkout.`
              : 'Products are priced in Model packs, all in one checkout.'}{' '}
            Delivered models land straight in My catalog, private to your company, ready to price in the price book.
          </p>
        </div>
      </div>
      <section className="pro-card">
        <span className="eyebrow">Before you order</span>
        <p>Most cabinet lines don’t need modelling: quick add draws cabinets at true size from their widths, door style and finish. Modelling is worth it for distinctive pieces: a range hood, a sink, a signature door.</p>
        <div className="pro-head-actions">
          <a className="btn" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
            Quick add instead
          </a>
          <a className="btn primary" href="#/orders/new?target=contractor">
            Make custom models
          </a>
        </div>
        <p className="fine">
          Your requests and their progress are under <a href={hrefFor({ name: 'orders', rest: '' })}>Make custom models</a> in the account menu.
        </p>
      </section>
    </div>
  );
}
