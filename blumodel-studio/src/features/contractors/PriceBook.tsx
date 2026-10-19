import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Download, Search, Upload } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { downloadText } from '../../lib/exporters';
import { money } from '../../lib/format';
import { hrefFor } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import type { PriceBookData, PriceBookRow } from '../../types/platform';
import { cents, parseDollars, proApi, type ImportPreview } from './api';
import { useWorkspace } from './ContractorRoot';
import { loadPriceBook } from './pricing';
import { markupPctFor, quoteFor } from './priceMath';
import { getProduct } from '../../data/catalog';
import type { Product } from '../../types';

const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/**
 * The row's product as the editor resolves it (the registry has built-ins, the brands and the
 * contractor's own catalog), so the table prices with exactly the editor's math (priceMath).
 */
function productOf(row: PriceBookRow): Product {
  return (
    getProduct(row.productId) ?? {
      id: row.productId,
      kind: 'base',
      category: 'cabinets',
      brand: row.brand,
      name: row.name,
      code: row.sku,
      widthIn: row.widthIn,
      depthIn: 24,
      heightIn: 36,
      elevationIn: 0,
      ...(row.widthOptions ? { widthOptions: row.widthOptions } : {}),
      ...(row.brandKey.startsWith('b_') ? { brandId: row.brandKey } : {}),
      ...(row.line ? { line: row.line } : {}),
      price: row.list,
      finishes: 'cabinet',
      blurb: '',
    }
  );
}

/** `#/pro/price-book`: cost and markup for everything the contractor sells (PLANS_AND_CONTRACTORS §4.4). */
export default function PriceBook() {
  const { readOnly } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [rows, setRows] = useState<PriceBookRow[] | null>(null);
  const [data, setData] = useState<PriceBookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'uncosted' | 'own'>('all');
  const [importing, setImporting] = useState<{ csv: string; name: string; preview: ImportPreview } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await proApi.priceBook();
      setRows(r.rows);
      setData(r.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your price book.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!s || `${r.name} ${r.brand} ${r.sku} ${r.line ?? ''}`.toLowerCase().includes(s)) &&
        (only === 'all' || (only === 'own' ? r.source === 'contractor' : r.costCents === null && !r.costByWidth)),
    );
  }, [rows, q, only]);

  const save = async (row: PriceBookRow, patch: { costCents?: number | null; costByWidth?: Record<string, number | null> | null; markupPct?: number | null }) => {
    try {
      const res = await proApi.setPrice(row.productId, patch);
      setRows((list) => list?.map((r) => (r.productId === row.productId ? { ...r, ...res.row } : r)) ?? null);
      setData((d) => (d ? { ...d, rows: { ...d.rows, [row.productId]: res.row } } : d));
      void loadPriceBook(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save that price.', 'warn');
    }
  };

  const pickCsv = async (file: File) => {
    const csv = await file.text();
    try {
      const r = await proApi.importCsv(csv, true);
      setImporting({ csv, name: file.name, preview: r.preview });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That file couldn’t be read.', 'warn');
    }
  };

  const apply = async () => {
    if (!importing) return;
    try {
      const r = await proApi.importCsv(importing.csv, false);
      toast(`Imported ${r.applied} cost${r.applied === 1 ? '' : 's'} from ${importing.name}.`, 'ok');
      setImporting(null);
      await load();
      void loadPriceBook(true);
    } catch (e) {
      const preview = (e as { preview?: ImportPreview }).preview;
      if (preview) setImporting({ ...importing, preview });
      toast(e instanceof Error ? e.message : 'The import didn’t work.', 'warn');
    }
  };

  const exportCsv = async () => {
    try {
      const f = await proApi.exportCsv();
      downloadText(f.content, f.filename, f.contentType);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not export.', 'warn');
    }
  };

  return (
    <div className="pro-pricebook">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Price book · costs are private to you</span>
          <h1>Cost, markup and sell price</h1>
          <p className="muted">
            Sell price = your cost × (1 + markup). Markup comes from the product, else its line or brand (set those in <a href={hrefFor({ name: 'pro', rest: 'brands' })}>Brands I carry</a>), else your default of {data ? pct(data.defaultMarkupPct) : '…'}. With no cost, a product sells at its list price.
          </p>
        </div>
        <div className="pro-head-actions">
          <button className="btn" onClick={exportCsv}>
            <Download /> Export CSV
          </button>
          {!readOnly && (
            <button className="btn primary" onClick={() => fileRef.current?.click()}>
              <Upload /> Import supplier CSV
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => (e.target.files?.[0] && void pickCsv(e.target.files[0]), (e.target.value = ''))} />
        </div>
      </div>
      <div className="pro-toolbar">
        <div className="home-search pro-search">
          <Search />
          <input placeholder="Search by name, SKU, brand or line" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the price book" />
        </div>
        <div className="chips" role="group" aria-label="Show">
          {(
            [
              ['all', 'Everything'],
              ['own', 'My catalog'],
              ['uncosted', 'No cost yet'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={only === k ? 'chip on' : 'chip'} aria-pressed={only === k} onClick={() => setOnly(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!rows && !error && <div className="screen-msg">Loading your price book…</div>}
      {rows && data && (
        <div className="pro-table-wrap">
          <table className="admin-table pro-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th className="num">List</th>
                <th className="num">Your cost</th>
                <th className="num">Markup %</th>
                <th className="num">Sell</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <PriceRow key={r.productId} row={r} data={data} readOnly={readOnly} onSave={(patch) => save(r, patch)} />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="empty-note">Nothing matches.</p>}
        </div>
      )}
      {importing && <ImportDialog name={importing.name} preview={importing.preview} onApply={apply} onClose={() => setImporting(null)} />}
    </div>
  );
}

function PriceRow({ row, data, readOnly, onSave }: { row: PriceBookRow; data: PriceBookData; readOnly: boolean; onSave: (patch: { costCents?: number | null; costByWidth?: Record<string, number | null> | null; markupPct?: number | null }) => void }) {
  const [open, setOpen] = useState(false);
  const q = quoteFor(data, productOf(row), row.widthIn);
  const base = { cost: q.cost ?? null, markup: q.markupPct ?? markupPctFor(data, productOf(row)), sell: q.sell };
  const margin = base.cost === null ? null : base.sell - base.cost;
  const perWidth = !!row.costByWidth && Object.keys(row.costByWidth).length > 0;

  const commitCost = (text: string) => {
    const v = parseDollars(text);
    if (Number.isNaN(v)) return;
    const next = v === null ? null : cents(v);
    if (next !== row.costCents) onSave({ costCents: next });
  };
  const commitMarkup = (text: string) => {
    const t = text.trim();
    const v = t === '' ? null : Number(t);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1000)) return;
    if (v !== row.markupPct) onSave({ markupPct: v });
  };

  return (
    <>
      <tr className={base.cost === null ? 'is-uncosted' : ''}>
        <td>
          <b>{row.name}</b>
          <span className="pro-sub">
            {row.brand}
            {row.line ? ` · ${row.line}` : ''}
            {row.widthOptions && (
              <button className="link-btn pro-widths-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? 'Hide widths' : `${row.widthOptions.length} widths`}
              </button>
            )}
          </span>
        </td>
        <td className="mono">{row.sku || '—'}</td>
        <td className="num mono">{row.list ? money(row.list) : '—'}</td>
        <td className="num">
          {perWidth && !open ? (
            <button className="link-btn" onClick={() => setOpen(true)}>
              Per width
            </button>
          ) : (
            <input
              className="pro-cell"
              defaultValue={row.costCents !== null ? String(row.costCents / 100) : ''}
              placeholder={base.cost !== null && row.costCents === null ? `${base.cost} from list` : 'Cost'}
              title={base.cost !== null && row.costCents === null ? 'Worked out from the brand’s discount off list. Type a cost to override it.' : undefined}
              onBlur={(e) => commitCost(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              disabled={readOnly}
              aria-label={`Your cost for ${row.name}`}
              inputMode="decimal"
            />
          )}
        </td>
        <td className="num">
          <input
            className="pro-cell pro-cell--narrow"
            defaultValue={row.markupPct !== null ? String(row.markupPct) : ''}
            placeholder={String(base.markup)}
            onBlur={(e) => commitMarkup(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            disabled={readOnly}
            aria-label={`Markup for ${row.name}`}
            inputMode="decimal"
          />
        </td>
        <td className="num mono">{money(base.sell)}</td>
        <td className="num mono">{margin === null ? <span className="tag warn">No cost</span> : `${money(margin)} · ${base.sell > 0 ? pct((margin / base.sell) * 100) : '—'}`}</td>
      </tr>
      {open &&
        row.widthOptions?.map((w) => {
          const v = row.costByWidth?.[String(w)];
          return (
            <tr key={w} className="pro-width-row">
              <td colSpan={3} className="pro-sub">
                {row.name} at <span className="mono">{w}″</span>
              </td>
              <td className="num">
                <input
                  className="pro-cell"
                  defaultValue={v !== undefined ? String(v / 100) : ''}
                  placeholder={row.costCents !== null ? 'Scaled from cost' : 'Cost'}
                  onBlur={(e) => {
                    const d = parseDollars(e.target.value);
                    if (Number.isNaN(d)) return;
                    const next = d === null ? null : cents(d);
                    if ((v ?? null) !== next) onSave({ costByWidth: { ...(row.costByWidth ?? {}), [String(w)]: next } });
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  disabled={readOnly}
                  aria-label={`Your cost for ${row.name} at ${w} inches`}
                  inputMode="decimal"
                />
              </td>
              <td colSpan={3} />
            </tr>
          );
        })}
    </>
  );
}

function ImportDialog({ name, preview, onApply, onClose }: { name: string; preview: ImportPreview; onApply: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const changes = preview.added.length + preview.updated.length;
  const dollars = (c: number | null | undefined) => (typeof c === 'number' ? money(c / 100) : '—');
  return (
    <Dialog title={`Import ${name}`} onClose={onClose} wide>
      <p className="dialog-copy">Nothing changes until you apply. Rows are matched to your products by SKU.</p>
      <div className="pro-import-counts">
        <span className="tag ok">{preview.added.length} new costs</span>
        <span className="tag ok">{preview.updated.length} updated</span>
        <span className="tag">{preview.unchanged.length} unchanged</span>
        <span className="tag">{preview.unmatched.length} not in your catalog</span>
        {preview.errors.length > 0 && <span className="tag bad">{preview.errors.length} to fix</span>}
      </div>
      {preview.errors.length > 0 && (
        <section className="pro-import-section">
          <b>Fix these first (nothing is imported while any row has a problem)</b>
          <ul>
            {preview.errors.slice(0, 50).map((e) => (
              <li key={e.line}>
                Line {e.line}
                {e.sku ? ` (${e.sku})` : ''}: {e.error}
              </li>
            ))}
          </ul>
        </section>
      )}
      {changes > 0 && (
        <section className="pro-import-section">
          <b>Changes</b>
          <table className="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th className="num">Was</th>
                <th className="num">Now</th>
              </tr>
            </thead>
            <tbody>
              {[...preview.updated, ...preview.added].slice(0, 100).map((r) => (
                <tr key={r.line}>
                  <td className="mono">{r.sku}</td>
                  <td>
                    {r.name}
                    {r.width ? ` · ${r.width}″` : ''}
                  </td>
                  <td className="num mono">{dollars(r.before)}</td>
                  <td className="num mono">{dollars(r.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {preview.unmatched.length > 0 && (
        <section className="pro-import-section">
          <b>Not in your catalog (skipped)</b>
          <p className="fine">{preview.unmatched.slice(0, 30).map((r) => r.sku).join(', ')}{preview.unmatched.length > 30 ? ', …' : ''}. Quick add them to My catalog with the same SKU, then import again.</p>
        </section>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || changes === 0 || preview.errors.length > 0}
          onClick={async () => {
            setBusy(true);
            await onApply();
            setBusy(false);
          }}
          data-autofocus
        >
          {busy ? 'Importing…' : `Apply ${changes} change${changes === 1 ? '' : 's'}`}
        </button>
      </div>
    </Dialog>
  );
}
