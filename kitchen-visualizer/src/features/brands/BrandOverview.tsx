import { useEffect, useRef, useState, type RefObject } from 'react';
import { ApiError } from '../../lib/api';
import { brandApi, type Analytics, type Totals } from './api';
import { useBrandTab } from './context';
import { niceMax, shortDay, subHref } from './logic';

type Metric = keyof Totals;
const METRICS: [Metric, string, string][] = [
  ['brandViews', 'Page views', 'Visits to your brand page'],
  ['productViews', 'Product views', 'Your product pages opened in 3D'],
  ['adds', 'Adds to kitchens', 'Times a homeowner put one in a design'],
  ['quoteClicks', 'Quote clicks', 'Contact and Request a quote taps'],
  ['leads', 'Leads', 'Requests sent to you'],
];
const RANGES = [7, 30, 90] as const;

/** `#/pro/brand`: last 7 / 30 / 90 days (BRAND_PAGE §7), by day, and the top products. */
export default function BrandOverview() {
  const { state } = useBrandTab();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Analytics | null | undefined>(undefined);
  const [metric, setMetric] = useState<Metric>('brandViews');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.brand) {
      setData(null);
      return;
    }
    let live = true;
    setError(null);
    brandApi
      .analytics(days)
      .then((r) => live && setData(r.analytics))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your numbers.'));
    return () => {
      live = false;
    };
  }, [days, state.brand]);

  if (!state.brand) return <SetupPitch />;

  return (
    <div className="brand-overview">
      <div className="brand-toolbar">
        <div className="chips" role="group" aria-label="Period">
          {RANGES.map((d) => (
            <button key={d} className={d === days ? 'chip on' : 'chip'} onClick={() => setDays(d)} aria-pressed={d === days}>
              Last {d} days
            </button>
          ))}
        </div>
        {data?.isDemo && <span className="tag warn">Demo data</span>}
      </div>
      {error && <div className="auth-error">{error}</div>}
      {data === undefined && !error && <div className="screen-msg">Loading your numbers…</div>}
      {data && (
        <>
          <div className="brand-stats" role="tablist" aria-label="Metric to chart">
            {METRICS.map(([k, label, why]) => (
              <button key={k} role="tab" aria-selected={metric === k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)} title={why}>
                <b className="mono">{data.totals[k].toLocaleString()}</b>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <section className="pro-card" aria-label={`${METRICS.find(([k]) => k === metric)![1]} by day`}>
            <span className="eyebrow">
              {METRICS.find(([k]) => k === metric)![1]} by day{data.isDemo ? ' · demo data' : ''}
            </span>
            <DayChart data={data} metric={metric} />
          </section>
          <section className="pro-card" aria-labelledby="top-title">
            <span className="eyebrow" id="top-title">
              Top products
            </span>
            {data.topProducts.length === 0 ? (
              <p className="empty-note">
                No product activity in this period yet. <a href={subHref('products')}>Publish products</a> to start.
              </p>
            ) : (
              <div className="brand-table-wrap">
                <table className="brand-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="num">Views</th>
                      <th className="num">Adds</th>
                      <th className="num">Quote clicks</th>
                      <th className="num">Leads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <a href={`#/p/${p.id}`}>{p.name}</a>
                        </td>
                        <td className="num mono">{p.views}</td>
                        <td className="num mono">{p.adds}</td>
                        <td className="num mono">{p.quoteClicks}</td>
                        <td className="num mono">{p.leads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="fine">Counts are first-party: Mise doesn’t store visitors’ IP addresses, and a page view counts once per visitor per half hour.</p>
        </>
      )}
    </div>
  );
}

/** The rendered width of an element, so the chart draws at real pixels (crisp text on phones). */
function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A plain bar chart: one bar per day and a nice axis, drawn at the container's width. */
function DayChart({ data, metric }: { data: Analytics; metric: Metric }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const values = data.byDay.map((d) => d[metric]);
  const max = niceMax(Math.max(0, ...values));
  const W = Math.max(240, width);
  const H = 190;
  const padL = 30;
  const padB = 22;
  const innerW = W - padL - 4;
  const innerH = H - padB - 10;
  const n = values.length;
  const slot = innerW / n;
  const bar = Math.max(2, Math.min(18, slot * 0.7));
  const ticks = [0, max / 2, max];
  const maxLabels = Math.max(2, Math.floor(innerW / 56));
  const labelEvery = Math.max(1, Math.ceil(n / maxLabels));
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div ref={ref} className="brand-chart-wrap">
      {width > 0 && (
        <svg className="brand-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${total} in the last ${n} days`}>
          {ticks.map((t) => {
            const y = 10 + innerH - (t / max) * innerH;
            return (
              <g key={t}>
                <line x1={padL} x2={W - 4} y1={y} y2={y} className="grid" />
                <text x={padL - 6} y={y + 4} textAnchor="end" className="axis">
                  {Number.isInteger(t) ? t : t.toFixed(1)}
                </text>
              </g>
            );
          })}
          {data.byDay.map((d, i) => {
            const v = d[metric];
            const h = (v / max) * innerH;
            const x = padL + i * slot + (slot - bar) / 2;
            return (
              <g key={d.day}>
                <rect x={x} y={10 + innerH - h} width={bar} height={Math.max(h, v > 0 ? 1 : 0)} rx={Math.min(3, bar / 3)} className="bar">
                  <title>
                    {shortDay(d.day)}: {v}
                  </title>
                </rect>
                {(n - 1 - i) % labelEvery === 0 && (
                  <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="axis">
                    {shortDay(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Before the page exists: what it does, and the way in. */
function SetupPitch() {
  const { readOnly } = useBrandTab();
  return (
    <div className="pro-empty brand-pitch">
      <h2>Homeowners on Mise can find you</h2>
      <ul className="brand-pitch-list">
        <li>They browse your cabinets and products on your own page.</li>
        <li>They see them in realistic 3D, at true size.</li>
        <li>They drop them straight into their own kitchen designs.</li>
        <li>Then they contact you: requests land in your Leads inbox.</li>
      </ul>
      <p>Included in your Contractor plan. Mise checks the business is real before the page goes live, and your costs and markup are never shown.</p>
      {!readOnly && (
        <a className="btn primary big" href={subHref('settings')}>
          Set up my page
        </a>
      )}
    </div>
  );
}
