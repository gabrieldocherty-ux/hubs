import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check } from '../../components/Icons';
import { hrefFor } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import { brandApi } from '../brands/api';
import { rememberedNear, useShortList, type ContractorCard, type ContractorList } from './api';
import { initials, isExportToast, nextTabbable, placePopover } from './logic';
import './finder.css';

const LeadForm = lazy(() => import('../brands/LeadForm'));

/**
 * Where the link sits, all toward the end of the journey:
 * - `summary`: the bottom of the editor's Overview and Estimate panel;
 * - `export`: for a few seconds under the toast after a successful export;
 * - `share`: the shared-kitchen page's footer.
 */
export type FinderPlace = 'summary' | 'export' | 'share';

export interface ContractorFinderProps {
  where: FinderPlace;
  /** Hide it here (the Checks tab, a selected piece, a kitchen a contractor prepared). */
  hidden?: boolean;
}

/**
 * "Need a contractor?": a quiet text link, never a banner. Hover (mouse), tap, or keyboard focus
 * opens a small popover with up to three verified contractors (View their page, Ask for a quote
 * with this kitchen attached) and See all contractors. It renders nothing when no contractor is
 * listed, when the list can't load, and for contractors themselves.
 */
export default function ContractorFinder({ where, hidden = false }: ContractorFinderProps) {
  const isContractor = useSession((s) => !!s.user?.contractor);
  if (hidden || isContractor) return null;
  return where === 'export' ? <AfterExport /> : <FinderLink where={where} />;
}

// ── after an export ───────────────────────────────────────────────────────

/** At most once every ten minutes per tab, so repeated exports don't repeat the suggestion. */
let lastExportOffer = -Infinity;
const EXPORT_QUIET_MS = 10 * 60_000;
const EXPORT_SHOWN_MS = 12_000;

/** Watches the toasts for an export success and then shows the link under them for a while. */
function AfterExport() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let seen = Math.max(0, ...useDesignStore.getState().toasts.map((t) => t.id));
    return useDesignStore.subscribe((s) => {
      const fresh = s.toasts.filter((t) => t.id > seen);
      if (!fresh.length) return;
      seen = Math.max(seen, ...fresh.map((t) => t.id));
      if (!fresh.some((t) => isExportToast(t.text, t.tone))) return;
      if (Date.now() - lastExportOffer < EXPORT_QUIET_MS) return;
      lastExportOffer = Date.now();
      setShown(true);
    });
  }, []);
  if (!shown) return null;
  return <FinderLink where="export" onExpire={() => setShown(false)} />;
}

// ── the link and its popover ──────────────────────────────────────────────

type OpenBy = 'hover' | 'focus' | 'click';

function FinderLink({ where, onExpire }: { where: FinderPlace; onExpire?: () => void }) {
  const list = useShortList(true);
  const projectId = useSession((s) => (where === 'share' ? null : s.projectId));
  const [open, setOpen] = useState<OpenBy | null>(null);
  const [hovering, setHovering] = useState(false);
  const [lead, setLead] = useState<ContractorCard | null>(null);
  const linkRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number>();
  const closeTimer = useRef<number>();
  /** Focus coming back to the link after Escape mustn't reopen it. */
  const skipFocusOpen = useRef(false);
  const popId = useId();

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const close = useCallback(() => {
    clearTimers();
    setOpen(null);
  }, []);
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen((o) => (o === 'hover' ? null : o)), 260);
  };
  useEffect(() => clearTimers, []);

  // After an export the link fades out on its own, unless someone is using it.
  useEffect(() => {
    if (where !== 'export' || !onExpire || open || hovering || lead) return;
    const id = window.setTimeout(onExpire, EXPORT_SHOWN_MS);
    return () => window.clearTimeout(id);
  }, [where, onExpire, open, hovering, lead]);

  // Outside taps and Escape close it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!linkRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = popRef.current?.contains(document.activeElement) || document.activeElement === linkRef.current;
      close();
      if (inside) {
        skipFocusOpen.current = true;
        linkRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open, close]);

  if (!list || list.total === 0 || list.contractors.length === 0) return null;

  const onLinkPointerEnter = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    setHovering(true);
    window.clearTimeout(closeTimer.current);
    if (!open) openTimer.current = window.setTimeout(() => setOpen((o) => o ?? 'hover'), 140);
  };
  const onPointerLeave = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    setHovering(false);
    window.clearTimeout(openTimer.current);
    if (open === 'hover') closeSoon();
  };
  const onPopPointerEnter = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    setHovering(true);
    window.clearTimeout(closeTimer.current);
  };

  const onClick = () => {
    window.clearTimeout(openTimer.current);
    // A click pins a popover that hover or focus opened; a second click closes it.
    setOpen((o) => (o === 'click' ? null : 'click'));
  };
  const onFocus = () => {
    if (skipFocusOpen.current) {
      skipFocusOpen.current = false;
      return;
    }
    let keyboard = false;
    try {
      keyboard = !!linkRef.current?.matches(':focus-visible');
    } catch {
      keyboard = false;
    }
    if (keyboard) setOpen((o) => o ?? 'focus');
  };
  const onBlur = (e: ReactFocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (!to) return;
    if (linkRef.current?.contains(to) || popRef.current?.contains(to)) return;
    close();
  };
  const focusables = () => Array.from(popRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
  const onLinkKeyDown = (e: ReactKeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen('focus');
      }
      return;
    }
    // The popover lives at the end of the page (a portal): step into it by hand.
    if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown') {
      const first = focusables()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const onPopKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = focusables();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i === 0) {
      e.preventDefault();
      skipFocusOpen.current = true;
      linkRef.current?.focus();
    } else if (!e.shiftKey && i === items.length - 1) {
      e.preventDefault();
      const link = linkRef.current;
      close();
      const next = link ? nextTabbable(link) : null;
      if (next) next.focus();
      else link?.focus();
    }
  };

  const ask = (c: ContractorCard) => {
    close();
    void brandApi.event(c.slug, 'quote_click');
    setLead(c);
  };

  return (
    <div className={`finder finder--${where}`} onPointerEnter={where === 'export' ? onPopPointerEnter : undefined} onPointerLeave={where === 'export' ? onPointerLeave : undefined}>
      <button
        ref={linkRef}
        type="button"
        className="finder-link"
        aria-expanded={!!open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        onPointerEnter={onLinkPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onLinkKeyDown}
      >
        Need a contractor?
      </button>
      {open &&
        createPortal(
          <Popover
            id={popId}
            list={list}
            anchor={linkRef}
            popRef={popRef}
            projectId={projectId}
            onAsk={ask}
            onNavigate={close}
            onPointerEnter={onPopPointerEnter}
            onPointerLeave={onPointerLeave}
            onBlur={onBlur}
            onKeyDown={onPopKeyDown}
          />,
          document.body,
        )}
      {lead &&
        createPortal(
          <Suspense fallback={null}>
            <LeadForm slug={lead.slug} company={lead.name} kitchenId={projectId ?? undefined} onClose={() => setLead(null)} />
          </Suspense>,
          document.body,
        )}
    </div>
  );
}

interface PopoverProps {
  id: string;
  list: ContractorList;
  anchor: RefObject<HTMLElement>;
  popRef: RefObject<HTMLDivElement>;
  projectId: string | null;
  onAsk: (c: ContractorCard) => void;
  onNavigate: () => void;
  onPointerEnter: (e: ReactPointerEvent) => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
  onBlur: (e: ReactFocusEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
}

function Popover({ id, list, anchor, popRef, projectId, onAsk, onNavigate, onPointerEnter, onPointerLeave, onBlur, onKeyDown }: PopoverProps) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);
  const near = list.near ? rememberedNear() : '';

  // Measured, then placed beside the link; kept there while the page scrolls or resizes.
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = popRef.current;
      if (!a || !el) return;
      setPos(placePopover(a, { width: 340, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
    };
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('resize', soon);
    window.addEventListener('scroll', soon, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', soon);
      window.removeEventListener('scroll', soon, true);
    };
  }, [anchor, popRef]);

  const all = projectId ? `#/contractors?kitchen=${encodeURIComponent(projectId)}` : hrefFor({ name: 'contractors' });
  const more = list.total - list.contractors.length;

  return (
    <div
      ref={popRef}
      id={id}
      className={`finder-pop${pos?.above === false ? ' is-below' : ''}`}
      role="dialog"
      aria-label="Verified contractors"
      data-finder-pop=""
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: 0, top: 0, width: 340, visibility: 'hidden' }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <p className="finder-pop-head">
        <Check width={13} height={13} aria-hidden="true" />
        {near ? (
          <span>
            Verified contractors near <b>{near}</b>
          </span>
        ) : (
          <span>Verified contractors on BluModel Studio</span>
        )}
      </p>
      <ul className="finder-list">
        {list.contractors.map((c) => (
          <li key={c.slug} className="finder-item">
            <span className="finder-logo" aria-hidden="true">
              {c.logoUrl ? <img src={c.logoUrl} alt="" /> : <span>{initials(c.name)}</span>}
            </span>
            <span className="finder-main">
              <b className="finder-name">
                {c.name}
                {c.isDemo && !/\(demo\)/i.test(c.name) && <span className="finder-tag">Demo</span>}
              </b>
              {c.serviceArea && <span className="finder-area">Serves {c.serviceArea}</span>}
            </span>
            <span className="finder-actions">
              <a className="finder-btn" href={hrefFor({ name: 'brandPage', slug: c.slug })} onClick={onNavigate} aria-label={`View ${c.name}`}>
                View
              </a>
              {c.leadForm && (
                <button type="button" className="finder-btn finder-btn--ask" onClick={() => onAsk(c)} aria-label={`Ask ${c.name} for a quote`}>
                  Ask for a quote
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <a className="finder-all" href={all} onClick={onNavigate}>
        See all contractors{more > 0 ? ` (${list.total})` : ''} <span aria-hidden="true">→</span>
      </a>
      <p className="finder-fine">Independent businesses. BluModel Studio checks each one is real; it doesn’t do the work itself.</p>
    </div>
  );
}
