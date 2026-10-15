import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { hrefFor } from '../../lib/router';

/** The parts of `GET /api/orders/allowance` this page shows (the server counts; this only reads). */
interface Standing {
  active: boolean;
  included: number;
  granted: number;
  used: number;
  total: number;
  left: number;
  resetsAt: number;
  supportEmail: string | null;
}
interface Terms {
  perMonth: number;
  finishesPerModel: number;
  revisions: number;
  businessDays: number;
}

function read(raw: unknown): { allowance: Standing; terms: Terms } | null {
  const r = raw as { allowance?: Partial<Standing>; terms?: Partial<Terms> } | null;
  const a = r?.allowance;
  const t = r?.terms;
  if (!a || !t || typeof a.active !== 'boolean' || ![a.left, a.total, a.resetsAt, t.perMonth, t.finishesPerModel, t.revisions].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { allowance: a as Standing, terms: t as Terms };
}

const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/**
 * `#/pro/modelling`: Make custom models for the contractor's own products. The Contractor plan
 * includes 3 custom 3D models a month, made by the BluModel studio (package C's orders, with
 * target "My catalog"): delivered models land privately in My catalog, ready to price.
 */
export default function Modelling() {
  const [data, setData] = useState<{ allowance: Standing; terms: Terms } | null>(null);
  useEffect(() => {
    let live = true;
    call<unknown>('GET', '/api/orders/allowance')
      .then((r) => live && setData(read(r)))
      .catch(() => undefined); // the copy reads fine without the numbers
    return () => {
      live = false;
    };
  }, []);

  const a = data?.allowance;
  const t = data?.terms;
  const n = t?.perMonth ?? 3;

  return (
    <div className="pro-modelling">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Make custom models</span>
          <h1>Have BluModel Studio model your products</h1>
          <p className="muted">
            Your Contractor plan includes {n} custom 3D models a month, made by our studio. List the products, with a UPC, photos or both for each, and we build a true-to-size model of every one
            {t ? `, with up to ${t.finishesPerModel} finishes and ${t.revisions} revision rounds each` : ''}. Delivered models land straight in My catalog, private to your company, ready to price in the price book.
          </p>
        </div>
      </div>
      {a && a.active && (
        <div className={a.left > 0 ? 'pro-allowance' : 'pro-allowance empty'} role="status">
          <b>
            {a.left > 0 ? `${a.left} of ${a.total} models left this month` : 'No models left this month'} - resets {day(a.resetsAt)}
          </b>
          <span>
            {a.granted > 0 ? `Includes ${a.granted} extra from BluModel this month. ` : ''}Unused models don’t carry over.
            {a.left <= 0 && a.supportEmail && (
              <>
                {' '}
                Need more? <a href={`mailto:${a.supportEmail}?subject=${encodeURIComponent('More custom models this month')}`}>Contact us</a>
              </>
            )}
          </span>
        </div>
      )}
      {a && !a.active && (
        <div className="pro-allowance empty" role="status">
          <b>Your plan has lapsed, so new requests are paused.</b>
          <span>
            Requests you already sent are still made and delivered. <a href={hrefFor({ name: 'billing' })}>Renew in Billing</a>
          </span>
        </div>
      )}
      <section className="pro-card">
        <span className="eyebrow">Before you send a request</span>
        <p>Most cabinet lines don’t need modelling: quick add draws cabinets at true size from their widths, door style and finish. Your models are best spent on distinctive pieces: a range hood, a sink, a signature door.</p>
        <div className="pro-head-actions">
          <a className="btn" href={hrefFor({ name: 'pro', rest: 'catalog/new' })}>
            Quick add instead
          </a>
          {(!a || a.active) && (
            <a className="btn primary" href="#/orders/new?target=contractor">
              Make custom models
            </a>
          )}
        </div>
        <p className="fine">
          Your requests and their progress are under <a href={hrefFor({ name: 'orders', rest: '' })}>Make custom models</a> in the account menu.
        </p>
      </section>
    </div>
  );
}
