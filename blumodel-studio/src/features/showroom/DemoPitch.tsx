import { useEffect, useState } from 'react';
import type { Product } from '../../types';
import { useConfig } from '../../lib/config';
import { finishList } from '../../lib/finish';
import { shareApi } from '../share/api';
import { salesOrigin } from './links';
import { shortName, type PublicTenant } from './site';
import './pitch.css';

interface Row {
  name: string;
  finish: string;
  qty: number;
}

/** The design's product list, the company's own products only, biggest spend first (at most 5). */
function productRows(items: { productId: string; finishId?: string; finishIndex: number }[], products: Product[]): Row[] {
  const by = new Map(products.map((p) => [p.id, p]));
  const rows = new Map<string, Row & { spend: number }>();
  for (const it of items) {
    const p = by.get(it.productId);
    if (!p || p.source !== 'tenant') continue;
    const list = finishList(p);
    const f = (it.finishId ? list.find((x) => x.id === it.finishId) : undefined) ?? list[it.finishIndex] ?? list[0];
    const key = `${p.id}|${f?.id ?? ''}`;
    const r = rows.get(key) ?? { name: p.name.replace(/ \d+″$/, ''), finish: f?.name ?? '', qty: 0, spend: 0 };
    r.qty++;
    r.spend += p.price;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.spend - a.spend).slice(0, 5);
}

/**
 * The demo showroom only (rendered when tenant.isDemo, like DemoBanner): the company's side of the
 * story for a prospect, after the featured lines. A lead as it lands in the company's inbox (a
 * gallery kitchen's render, its product list read from the real design, and a link that opens that
 * design in 3D), what the company gets in three points, and the way to get one. Real showrooms never
 * show it.
 */
export default function DemoPitch({ tenant }: { tenant: PublicTenant }) {
  const base = useConfig((s) => s.config?.baseDomain ?? 'blumodel.studio');
  const name = shortName(tenant);
  const design = tenant.images.gallery.find((g) => g.design) ?? null;
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!design?.design) return;
    let live = true;
    shareApi
      .read(design.design)
      .then((w) => live && setRows(productRows(w.kitchen.doc.items, w.products)))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [design?.design]);

  return (
    <section className="sr-pitch" aria-labelledby="sr-pitch-title" data-demo-only>
      <div className="sr-pitch-inner">
        <div className="sr-pitch-copy">
          <p className="sr-pitch-eyebrow">For kitchen and bath companies · demo</p>
          <h2 id="sr-pitch-title">What {name} gets from this showroom</h2>
          <p className="sr-pitch-lede">Everything above is what {name}’s customers see. This is what lands on {name}’s side when one of them sends a design.</p>
          <ul className="sr-pitch-points">
            <li>
              <span className="sr-pitch-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
                </svg>
              </span>
              <span>
                <b>Your products, your brand, your web address</b>
                Your own lines and finishes, modelled in 3D, under your name and colours.
              </span>
            </li>
            <li>
              <span className="sr-pitch-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16v12H5.5L4 17.5z" />
                  <path d="M8 9h8M8 12h5" />
                </svg>
              </span>
              <span>
                <b>Every design arrives as a lead with the plan and product list</b>
                Name, phone, budget and timeline, and the design itself, ready to quote.
              </span>
            </li>
            <li>
              <span className="sr-pitch-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                  <path d="M16 5.5a3 3 0 0 1 0 5M18 14.5c1.8.8 3 2.6 3 4.5" />
                </svg>
              </span>
              <span>
                <b>Your team uses it in sales meetings, with photoreal AI renders</b>
                Open any design with the customer, change it live, and make it photoreal.
              </span>
            </li>
          </ul>
          <a className="sr-pitch-cta" href={`${salesOrigin(base)}/#/book`}>
            Get a showroom like this for your company
          </a>
        </div>

        <figure className="sr-lead" aria-label={`Example: a new lead in ${name}’s inbox`}>
          <div className="sr-lead-head">
            <span className="sr-lead-tag">New lead</span>
            <span className="sr-lead-when">{name} inbox · 2 min ago</span>
          </div>
          <div className="sr-lead-who">
            <span className="sr-lead-avatar" aria-hidden>
              AT
            </span>
            <div>
              <b>Avery Thompson</b>
              <span>(519) 555-0173 · N1G 2W1</span>
            </div>
          </div>
          <dl className="sr-lead-facts">
            <div>
              <dt>Budget</dt>
              <dd>$45k to $60k</dd>
            </div>
            <div>
              <dt>Timeline</dt>
              <dd>This spring</dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>Kitchen, 16′ × 15′</dd>
            </div>
          </dl>
          {design && (
            <div className="sr-lead-design">
              <img src={design.url} width={design.w} height={design.h} alt={`The design: ${design.title}`} loading="lazy" decoding="async" />
              <span>{design.title}</span>
            </div>
          )}
          <ul className="sr-lead-lines" aria-label="Products in the design" aria-busy={rows === null}>
            {(rows ?? []).map((r) => (
              <li key={`${r.name}|${r.finish}`}>
                <span>
                  <b>{r.name}</b>
                  {r.finish && <i>{r.finish}</i>}
                </span>
                <span className="sr-lead-qty">×{r.qty}</span>
              </li>
            ))}
            {rows === null && <li className="sr-lead-wait">Loading the product list…</li>}
          </ul>
          <div className="sr-lead-foot">
            {design?.design ? (
              <a className="sr-lead-btn" href={`#/s/${design.design}`}>
                Open the design in 3D
              </a>
            ) : (
              <span className="sr-lead-btn">Open the design in 3D</span>
            )}
            <span className="sr-lead-status" aria-hidden>
              <i className="on">New</i>
              <i>Contacted</i>
              <i>Quoted</i>
              <i>Won</i>
            </span>
          </div>
        </figure>
      </div>
    </section>
  );
}
