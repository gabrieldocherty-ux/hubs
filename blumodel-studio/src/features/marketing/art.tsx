import { useState } from 'react';
import { PRICES } from './parts';

/*
 * The sales site's illustrations, drawn in HTML and CSS: a company's showroom in a browser
 * window, a lead as it arrives in the company's inbox, and the monthly plan split in two. Every
 * company, person and product in them is made up (the footer says so).
 */

/** A showroom under the company's own name and web address, with the 3D render of a kitchen. */
export function ShowroomMock() {
  const [render, setRender] = useState(true);
  return (
    <figure className="mk-window" aria-label="Illustration: a company’s own showroom website at yourcompany.blumodel.studio">
      <div className="mk-window-bar" aria-hidden>
        <span className="mk-window-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="mk-window-url">
          <LockGlyph /> <b>yourcompany</b>.blumodel.studio
        </span>
      </div>
      <div className="mk-window-site" aria-hidden>
        <div className="mk-window-nav">
          <span className="mk-window-logo">YC</span>
          <span className="mk-window-name">Your Company Kitchen &amp; Bath</span>
          <span className="mk-window-links">
            <i>Kitchens</i>
            <i>Bathrooms</i>
            <i>Visit us</i>
          </span>
        </div>
        <div className="mk-window-stage">
          {render && (
            <img
              src="/marketing/hero.webp"
              width={1200}
              height={800}
              alt=""
              onError={() => setRender(false)}
            />
          )}
          <div className="mk-window-welcome">
            <b>Design your new kitchen</b>
            <span>With our cabinets, counters and fixtures</span>
          </div>
          <span className="mk-window-send">Send this design to Your Company</span>
        </div>
      </div>
      <figcaption>Your showroom, at your own web address, with your name, colours and products.</figcaption>
    </figure>
  );
}

const LINES: [string, string, string][] = [
  ['Shaker base cabinet 30″', 'Oat white', '×4'],
  ['Shaker wall cabinet 30″', 'Oat white', '×5'],
  ['Quartz countertop', 'Calacatta', '42 sq ft'],
  ['Farmhouse sink 33″', 'Fireclay', '×1'],
  ['Dome pendant', 'Brass', '×3'],
];

/** A lead in the company's inbox: who, where, budget, and the design with its product list. */
export function LeadCard({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`mk-lead${compact ? ' mk-lead--compact' : ''}`} aria-label="Illustration: a new lead in the company’s inbox">
      <div className="mk-lead-head">
        <span className="mk-lead-tag">New lead</span>
        <span className="mk-lead-when">2 min ago</span>
      </div>
      <div className="mk-lead-who">
        <span className="mk-lead-avatar" aria-hidden>
          JM
        </span>
        <div>
          <b>Jordan Mercer</b>
          <span>(555) 010-0142 · N1G 2W1</span>
        </div>
      </div>
      <dl className="mk-lead-facts">
        <div>
          <dt>Budget</dt>
          <dd>$30k to $45k</dd>
        </div>
        <div>
          <dt>Timeline</dt>
          <dd>This spring</dd>
        </div>
        <div>
          <dt>Design</dt>
          <dd>L-shape with island</dd>
        </div>
      </dl>
      {!compact && (
        <ul className="mk-lead-lines">
          {LINES.map(([a, b, c]) => (
            <li key={a}>
              <span>
                <b>{a}</b>
                <i>{b}</i>
              </span>
              <span className="mono">{c}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mk-lead-foot">
        <span className="mk-lead-btn">Open the design in 3D</span>
        <span className="mk-lead-status" aria-hidden>
          <i className="on">New</i>
          <i>Contacted</i>
          <i>Quoted</i>
          <i>Won</i>
        </span>
      </div>
    </figure>
  );
}

/** The monthly plan as two equal halves: hosting with the web address, and render credits. */
export function PriceSplit() {
  return (
    <div className="mk-split-bar" role="img" aria-label={`${PRICES.monthly} a month: ${PRICES.hosting} for hosting and your web address, and ${PRICES.credits} of AI rendering credits`}>
      <div className="mk-split-half mk-split-half--host">
        <b>{PRICES.hosting}</b>
        <span>Hosting, running and your own web address</span>
      </div>
      <div className="mk-split-half mk-split-half--ai">
        <b>{PRICES.credits}</b>
        <span>AI rendering credits, rolled over for {PRICES.rolloverMonths} months</span>
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
