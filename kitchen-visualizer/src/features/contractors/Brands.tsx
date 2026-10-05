import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useDesignStore } from '../../store/useDesignStore';
import { proApi, type BrandRow } from './api';
import { useWorkspace } from './ContractorRoot';
import { loadPriceBook } from './pricing';

type Lines = { key: string; name: string; count: number; markupPct: number | null }[];

/** `#/pro/brands`: which brands show while designing, their discount off list, and markups by brand and line (§4.3–4.4). */
export default function Brands() {
  const { readOnly, profile } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [lines, setLines] = useState<Lines>([]);
  const [own, setOwn] = useState<{ count: number; markupPct: number | null }>({ count: 0, markupPct: null });
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await proApi.brands();
      setBrands(r.brands);
      setLines(r.lines);
      setOwn(r.own);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load brands.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const set = async (key: string, patch: { enabled?: boolean; pctOffList?: number | null; markupPct?: number | null }) => {
    try {
      await proApi.setBrand(key, patch);
      await load();
      void loadPriceBook(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save that.', 'warn');
    }
  };

  const numberOrNull = (text: string, max: number): number | null | undefined => {
    const t = text.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
  };

  const pctInput = (label: string, value: number | null, placeholder: string, max: number, onCommit: (v: number | null) => void) => (
    <input
      className="pro-cell pro-cell--narrow"
      defaultValue={value === null ? '' : String(value)}
      placeholder={placeholder}
      aria-label={label}
      inputMode="decimal"
      disabled={readOnly}
      onBlur={(e) => {
        const v = numberOrNull(e.target.value, max);
        if (v !== undefined && v !== value) onCommit(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );

  return (
    <div className="pro-brands">
      <div className="pro-head">
        <div>
          <span className="eyebrow">Brands I carry</span>
          <h1>What shows while you design</h1>
          <p className="muted">Switch off brands you don’t sell: they disappear from your catalog panel (kitchens that already use them are untouched). Set what you pay as a discount off list, and a markup per brand or line.</p>
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!brands && !error && <div className="screen-msg">Loading…</div>}
      {brands && (
        <>
          <section className="pro-card">
            <span className="eyebrow">Brands</span>
            <table className="admin-table pro-table">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Show while designing</th>
                  <th className="num">Your discount off list %</th>
                  <th className="num">Markup %</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.key}>
                    <td>
                      <b>{b.name}</b>
                      <span className="pro-sub">
                        {b.productCount} product{b.productCount === 1 ? '' : 's'}
                        {b.isDemo ? ' · demo brand' : ''}
                        {b.key === 'builtin' ? ' · placeholder brands and prices' : ''}
                      </span>
                    </td>
                    <td>
                      <label className="pro-switch">
                        <input type="checkbox" checked={b.enabled} disabled={readOnly} onChange={(e) => set(b.key, { enabled: e.target.checked })} />
                        <span>{b.enabled ? 'Shown' : 'Hidden'}</span>
                      </label>
                    </td>
                    <td className="num">{pctInput(`Discount off list for ${b.name}`, b.pctOffList, '—', 100, (v) => set(b.key, { pctOffList: v }))}</td>
                    <td className="num">{pctInput(`Markup for ${b.name}`, b.markupPct, String(profile.defaultMarkupPct), 1000, (v) => set(b.key, { markupPct: v }))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="pro-card">
            <span className="eyebrow">My catalog</span>
            <table className="admin-table pro-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="num">Markup %</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Everything in my catalog</b>
                    <span className="pro-sub">{own.count} products · used when a product and its line have no markup</span>
                  </td>
                  <td className="num">{pctInput('Markup for my catalog', own.markupPct, String(profile.defaultMarkupPct), 1000, (v) => set('own', { markupPct: v }))}</td>
                </tr>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <b>{l.name}</b>
                      <span className="pro-sub">
                        {l.count} piece{l.count === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="num">{pctInput(`Markup for ${l.name}`, l.markupPct, own.markupPct !== null ? String(own.markupPct) : String(profile.defaultMarkupPct), 1000, (v) => set(l.key, { markupPct: v }))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length === 0 && <p className="fine">Give products a line name (like “Smith Shaker”) to set a markup for the whole line.</p>}
          </section>
        </>
      )}
    </div>
  );
}
