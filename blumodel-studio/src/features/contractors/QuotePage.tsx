import { useEffect, useMemo, useState } from 'react';
import { MiniPlan } from '../../components/MiniPlan';
import { Toasts } from '../../components/Toasts';
import { ApiError } from '../../lib/api';
import { feetInches } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { PLACEHOLDER_PRICES_NOTE } from '../../lib/csv';
import { useCatalog } from '../../store/useCatalog';
import { useDesignStore } from '../../store/useDesignStore';
import { requestExport } from '../billing';
import { proApi, type Quote } from './api';
import { useWorkspace } from './ContractorRoot';
import { quoteImages } from './quoteCapture';

/** Quotes are to the cent, so the lines add up to the total on paper. */
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const isoDay = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * `#/pro/quote/:projectId`: the branded, printable quote (PLANS_AND_CONTRACTORS §4.6). Sell prices
 * only; printing (or saving as PDF from the print dialog) is an export.
 */
export default function QuotePage({ projectId }: { projectId: string }) {
  const { readOnly } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const images = useMemo(() => quoteImages(projectId), [projectId]);

  useEffect(() => {
    proApi
      .quote(projectId)
      .then((q) => {
        if (q.doc.products) useCatalog.getState().registerSnapshots(q.doc.products);
        setQuote(q);
        setValidUntil(isoDay(q.validUntil));
        setNotes(q.notes);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not prepare the quote.'));
  }, [projectId]);

  const saveSettings = async () => {
    if (!quote) return;
    setSaving(true);
    try {
      const until = validUntil ? new Date(`${validUntil}T23:59:59`).getTime() : null;
      const q = await proApi.saveQuote(projectId, { validUntil: until, notes });
      setQuote(q);
      toast('Quote details saved.', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save.', 'warn');
    } finally {
      setSaving(false);
    }
  };

  const print = () => requestExport(projectId, 'quote', () => window.print());

  if (error)
    return (
      <div className="screen-msg">
        <p>{error}</p>
        <a className="btn" href={hrefFor({ name: 'pro', rest: 'quotes' })}>
          Back to quotes
        </a>
      </div>
    );
  if (!quote) return <div className="screen-msg">Preparing the quote…</div>;
  const pb = quote.preparedBy;
  const dirty = notes !== quote.notes || validUntil !== isoDay(quote.validUntil);

  return (
    <div className="quote-page">
      <div className="quote-toolbar no-print">
        <a className="btn" href={`#/k/${projectId}`}>
          ← Back to the kitchen
        </a>
        <a className="btn" href={hrefFor({ name: 'pro', rest: 'quotes' })}>
          All quotes
        </a>
        <span className="quote-toolbar-fill" />
        <label className="quote-field">
          <span>Valid until</span>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={readOnly} />
        </label>
        {dirty && !readOnly && (
          <button className="btn" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save details'}
          </button>
        )}
        <button className="btn primary" onClick={print}>
          Print or save as PDF
        </button>
      </div>

      <article className="quote-sheet" aria-label="Quote">
        <header className="quote-head">
          <div className="quote-brand">
            {pb?.logoUrl && <img src={pb.logoUrl} alt="" className="quote-logo" />}
            <div>
              <h1>{pb?.company ?? 'Quote'}</h1>
              <p>
                {[pb?.phone, pb?.email, pb?.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')].filter(Boolean).join(' · ')}
                {quote.serviceArea ? <><br />Serving {quote.serviceArea}</> : null}
              </p>
            </div>
          </div>
          <dl className="quote-meta">
            <div>
              <dt>Quote for</dt>
              <dd>{quote.kitchen.client || '—'}</dd>
            </div>
            <div>
              <dt>Kitchen</dt>
              <dd>{quote.kitchen.name}</dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>
                {feetInches(quote.kitchen.room.widthIn)} × {feetInches(quote.kitchen.room.lengthIn)}
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{day(Date.now())}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>{day(quote.validUntil)}</dd>
            </div>
          </dl>
        </header>

        <div className={`quote-images${images?.scene ? '' : ' single'}`}>
          <figure>
            {images?.plan ? <img src={images.plan} alt="Floor plan" /> : <MiniPlan doc={quote.doc} className="quote-miniplan" />}
            <figcaption>Floor plan</figcaption>
          </figure>
          {images?.scene && (
            <figure>
              <img src={images.scene} alt="3D view" />
              <figcaption>3D view</figcaption>
            </figure>
          )}
        </div>

        <table className="quote-lines">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          {quote.groups.map((g) => (
            <tbody key={g.name}>
              <tr className="quote-group">
                <th colSpan={3}>{g.name}</th>
                <th className="num">{usd(g.total)}</th>
              </tr>
              {g.lines.map((l, i) => (
                <tr key={`${g.name}-${i}`}>
                  <td>
                    <b>{l.label}</b>
                    <span>{l.sub}</span>
                  </td>
                  <td className="num">
                    {l.qty} {l.unit}
                  </td>
                  <td className="num">{usd(l.unitPrice)}</td>
                  <td className="num">{usd(l.total)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {/* Not a <tfoot>: printed, a table footer repeats on every page, so page one would show a
            "Total" under half the items. */}
        <dl className="quote-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{usd(quote.subtotal)}</dd>
          </div>
          {quote.taxPct > 0 && (
            <div>
              <dt>Tax ({quote.taxPct}%)</dt>
              <dd>{usd(quote.tax)}</dd>
            </div>
          )}
          <div className="quote-total">
            <dt>Total</dt>
            <dd>{usd(quote.total)}</dd>
          </div>
        </dl>

        <section className={`quote-notes${notes.trim() ? '' : ' quote-notes--empty'}`}>
          <h2>Notes</h2>
          {readOnly ? (
            <p>{notes || '—'}</p>
          ) : (
            <>
              <textarea className="no-print" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What’s included, lead times, payment terms…" rows={3} maxLength={2000} aria-label="Notes on this quote" />
              <p className="print-only">{notes}</p>
            </>
          )}
        </section>

        <footer className="quote-foot">
          {quote.hasBuiltin && <p>{PLACEHOLDER_PRICES_NOTE}</p>}
          <p>{quote.disclaimer}</p>
        </footer>
      </article>
      <Toasts />
    </div>
  );
}
