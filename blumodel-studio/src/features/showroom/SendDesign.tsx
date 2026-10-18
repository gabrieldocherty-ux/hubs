import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRoute } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import { useShowroom } from './useShowroom';
import { useVisitor } from './visitor';
import { shortName } from './site';
import { isDownloadToast, sentAt } from './send';
import { CLAIM_DRAFT_HREF } from './links';
import './send.css';

const SendDialog = lazy(() => import('./SendDialog'));

/** Where "Send this design to <Company>" sits: the editor's summary/estimate footer, after a download, the share page. */
export type SendPlace = 'summary' | 'export' | 'share';

export interface SendDesignProps {
  where: SendPlace;
  /** Hide it here (the Checks tab, a selected piece). */
  hidden?: boolean;
  /** On the share page: the link being looked at, sent with the lead instead of a kitchen of one's own. */
  shareToken?: string;
  /** The design's name on the share page (the editor reads it from the open kitchen). */
  designName?: string;
}

/** The signed-in person's role on this showroom's team, if any (the server adds `showroom: { tenantId, role }`). */
function useTeamRole(): 'owner' | 'staff' | null {
  return useSession(
    (s) =>
      (
        s.user as {
          showroom?: { role?: 'owner' | 'staff' | null } | null;
        } | null
      )?.showroom?.role ?? null,
  );
}

/**
 * "Send this design to <Company>" (docs/SHOWROOM_PIVOT.md §5): toward the end of a visitor's
 * journey, clear but calm. A card at the foot of the editor's Overview and Estimate, the same card
 * for a while under a download's toast, and a button on the share page. It opens the lazy form
 * (SendDialog), which posts to POST /api/leads with a view-only link to the design.
 *
 * Only on a showroom and only for visitors: the company's own team never sees it (they are the
 * ones it sends to), and on the sales site it renders nothing.
 */
export function SendDesign({ where, hidden = false, shareToken, designName }: SendDesignProps): JSX.Element | null {
  const showroom = useShowroom();
  const team = useTeamRole();
  const projectId = useSession((s) => (where === 'share' ? null : s.projectId));
  const signedIn = useSession((s) => s.status === 'signedIn');
  // A visitor who gave their details ("Before you start") sends their saved design without an account.
  const visitor = useVisitor();
  const known = signedIn || !!visitor;
  const [open, setOpen] = useState(false);
  const docName = useDesignStore((s) => s.doc.name);
  const key = shareToken ? `s:${shareToken}` : projectId ? `k:${projectId}` : null;
  const [sent, setSent] = useState<number | null>(() => (key ? sentAt(key) : null));
  useEffect(() => setSent(key ? sentAt(key) : null), [key]);

  // A design kept on this device by a browser the showroom doesn't know yet: making an account keeps it.
  if (showroom && !team && !hidden && where === 'summary' && !known && !projectId) {
    const n = shortName(showroom);
    return (
      <section className="sr-send-card" aria-labelledby="sr-send-title" data-testid="send-design">
        <h3 id="sr-send-title">Happy with your design?</h3>
        <p>Create a free account to send it to {n}. Your design comes with you, and {n} gets back to you about making it real.</p>
        <a className="btn primary" href={CLAIM_DRAFT_HREF}>
          Send this design to {n}
        </a>
      </section>
    );
  }
  if (!showroom || team || hidden || !key) return null;
  // In the editor the design must be one's own saved design; the share page needs no account.
  if (where !== 'share' && !known) return null;
  if (where === 'export') return <AfterDownload onOpen={() => setOpen(true)} name={shortName(showroom)} open={open} dialog={dialog()} />;

  function dialog() {
    // On <body>: the toast stack and the side panel would otherwise clip and shift the modal.
    return open
      ? createPortal(
          <Suspense fallback={null}>
            <SendDialog
              tenant={showroom!}
              design={shareToken ? { shareToken } : { projectId: projectId! }}
              designName={designName ?? docName}
              sentKey={key!}
              onSent={(at) => setSent(at)}
              onClose={() => setOpen(false)}
            />
          </Suspense>,
          document.body,
        )
      : null;
  }

  const name = shortName(showroom);
  if (where === 'share')
    return (
      <>
        <button type="button" className="btn primary sr-send-btn" onClick={() => setOpen(true)} data-testid="send-design">
          <span className="share-long">{sent ? `Send again to ${name}` : `Send this design to ${name}`}</span>
          <span className="share-short">Send to {name}</span>
        </button>
        {dialog()}
      </>
    );

  return (
    <section className="sr-send-card" aria-labelledby="sr-send-title" data-testid="send-design">
      <h3 id="sr-send-title">{sent ? `Sent to ${name}` : `Happy with your design?`}</h3>
      <p>
        {sent
          ? `${name} has a view-only link, so the changes you make show up there too. Send it again with anything new to tell them.`
          : `Send it to ${name} with your contact details and they’ll get back to you about making it real. It’s free, with no obligation.`}
      </p>
      <button type="button" className={sent ? 'btn' : 'btn primary'} onClick={() => setOpen(true)}>
        {sent ? 'Send an update' : `Send this design to ${name}`}
      </button>
      {dialog()}
    </section>
  );
}

/** How long the card stays under a download's toast, and how often it may come back. */
const SHOWN_MS = 14_000;
const QUIET_MS = 10 * 60_000;
let lastOffer = -Infinity;

/** Watches the toasts for a download in the editor and shows the card under them for a while. */
function AfterDownload({ onOpen, name, open, dialog }: { onOpen: () => void; name: string; open: boolean; dialog: ReactNode }) {
  const route = useRoute();
  const inEditor = route.name === 'kitchen';
  const [shown, setShown] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!inEditor) return;
    let seen = Math.max(0, ...useDesignStore.getState().toasts.map((t) => t.id));
    return useDesignStore.subscribe((s) => {
      const fresh = s.toasts.filter((t) => t.id > seen);
      if (!fresh.length) return;
      seen = Math.max(seen, ...fresh.map((t) => t.id));
      if (!fresh.some((t) => isDownloadToast(t.text, t.tone))) return;
      if (Date.now() - lastOffer < QUIET_MS) return;
      lastOffer = Date.now();
      setShown(true);
    });
  }, [inEditor]);
  useEffect(() => {
    if (!shown || hover || open) return;
    const id = window.setTimeout(() => setShown(false), SHOWN_MS);
    return () => window.clearTimeout(id);
  }, [shown, hover, open]);
  if (!inEditor || (!shown && !open)) return dialog;
  return (
    <>
      {shown && (
        <div className="sr-send-toast" role="status" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} data-testid="send-after-download">
          <span>Ready to talk about it? {name} can take it from here.</span>
          <button type="button" className="btn primary" onClick={() => (setShown(false), onOpen())}>
            Send this design to {name}
          </button>
          <button type="button" className="sr-send-toast-x" aria-label="Not now" onClick={() => setShown(false)}>
            ×
          </button>
        </div>
      )}
      {dialog}
    </>
  );
}
