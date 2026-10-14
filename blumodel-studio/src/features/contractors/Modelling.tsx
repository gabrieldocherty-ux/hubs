import { hrefFor } from '../../lib/router';

/** `#/pro/modelling`: paid modelling of the contractor's products (package C's orders, target "contractor"). */
export default function Modelling() {
  return (
    <div className="pro-modelling">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Modelling requests</span>
          <h1>Have Mise model your products</h1>
          <p className="muted">
            Send reference photos, dimensions and a spec sheet, and the Mise studio builds an accurate 3D model. One request can hold several products of the same line, each priced per item at the
            normal model tiers, with one checkout. Delivered models land straight in My catalog, linked to their price-book rows.
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
            Request modelling
          </a>
        </div>
        <p className="fine">Custom-model orders are part of the next build (package C). Until it lands, this button opens a placeholder page.</p>
      </section>
    </div>
  );
}
