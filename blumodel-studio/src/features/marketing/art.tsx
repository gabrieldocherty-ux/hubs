import { useEffect, useRef, useState, type CSSProperties } from 'react';

/*
 * The sales site's illustrations, drawn in HTML and CSS: a company's showroom in a browser
 * window, a lead as it arrives in the company's inbox, and the monthly plan split in two. Every
 * company, person and product in them is made up (the footer says so).
 */

/**
 * The slideshow's slides: two angles of the white kitchen and one of the dark one, each on a different made-up company's
 * showroom. The 3D picture is in the app (public/marketing/, scripts/make-showroom-images.mjs); a
 * photoreal version, when the server has made one (server/scripts/render-marketing.mjs), replaces it.
 */
const SLIDES: { name: string; title: string; co: { name: string; initials: string; slug: string; color: string; accent: string } }[] = [
  { name: 'kitchen-1', title: 'White shaker kitchen with a waterfall island', co: { name: 'Cedar & Stone Kitchens', initials: 'CS', slug: 'cedarstone', color: '#2f4a3a', accent: '#c9b99a' } },
  { name: 'kitchen-2', title: 'The same kitchen, across the island', co: { name: 'Harbourline Cabinetry', initials: 'HC', slug: 'harbourline', color: '#233a5e', accent: '#9fb6cf' } },
  { name: 'kitchen-4', title: 'Charcoal kitchen with a professional range', co: { name: 'Northfield Design-Build', initials: 'ND', slug: 'northfield', color: '#5a3427', accent: '#d8b48f' } },
];

/** The photoreal versions the server has (name -> address), once asked. */
function usePhotoreal(): Record<string, string> {
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    fetch('/api/marketing/photoreal')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (live && b && typeof b.images === 'object' && b.images) setImages(b.images as Record<string, string>);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return images;
}

/** A showroom under a company's own name and web address: a swipeable slideshow of kitchens. */
export function ShowroomMock() {
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const photo = usePhotoreal();
  const slide = SLIDES[at];
  const go = (i: number) => {
    const t = track.current;
    const n = (i + SLIDES.length) % SLIDES.length;
    if (t) t.scrollTo({ left: n * t.clientWidth, behavior: 'smooth' });
    setAt(n);
  };
  const onScroll = () => {
    const t = track.current;
    if (!t || !t.clientWidth) return;
    const n = Math.round(t.scrollLeft / t.clientWidth);
    if (n !== at && n >= 0 && n < SLIDES.length) setAt(n);
  };
  return (
    <figure
      className="mk-window"
      style={{ '--mk-co': slide.co.color, '--mk-co-2': slide.co.accent } as CSSProperties}
      aria-roledescription="carousel"
      aria-label="Sample showrooms: kitchens designed in BluModel, on made-up companies’ websites"
    >
      <div className="mk-window-bar" aria-hidden>
        <span className="mk-window-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="mk-window-url">
          <LockGlyph /> <b>{slide.co.slug}</b>.blumodel.studio
        </span>
      </div>
      <div className="mk-window-site">
        <div className="mk-window-nav" aria-hidden>
          <span className="mk-window-logo">{slide.co.initials}</span>
          <span className="mk-window-name">{slide.co.name}</span>
          <span className="mk-window-links">
            <i>Kitchens</i>
            <i>Bathrooms</i>
            <i>Visit us</i>
          </span>
        </div>
        <div className="mk-window-stage">
          <div className="mk-slides" ref={track} onScroll={onScroll} data-testid="mk-slides">
            {SLIDES.map((s, i) => (
              <div key={s.name} className="mk-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${SLIDES.length}: ${s.title}`}>
                <img
                  src={photo[s.name] ?? `/marketing/${s.name}.webp`}
                  width={1500}
                  height={1000}
                  alt={s.title}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                  data-photoreal={photo[s.name] ? '1' : '0'}
                />
              </div>
            ))}
          </div>
          <div className="mk-window-welcome" aria-hidden>
            <b>Design your new kitchen</b>
            <span>With our cabinets, counters and fixtures</span>
          </div>
          <button type="button" className="mk-slide-btn mk-slide-prev" onClick={() => go(at - 1)} aria-label="Previous kitchen">
            ‹
          </button>
          <button type="button" className="mk-slide-btn mk-slide-next" onClick={() => go(at + 1)} aria-label="Next kitchen">
            ›
          </button>
          {/* Where you are; swipe or the arrows move (dots are too small to tap on a phone). */}
          <div className="mk-slide-dots" aria-hidden>
            {SLIDES.map((s, i) => (
              <i key={s.name} className={i === at ? 'on' : ''} />
            ))}
          </div>
        </div>
      </div>
      <figcaption>Your showroom, at your own web address, with your name, colours and products. (Sample companies, made up for illustration.)</figcaption>
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


function LockGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
