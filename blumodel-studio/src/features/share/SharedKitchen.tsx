import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Workspace } from '../../screens/Editor';
import { Dialog } from '../../components/Dialog';
import { ProductArt } from '../../components/ProductArt';
import { Logo, Wordmark } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { navigate, navigateHash, signinHref } from '../../lib/router';
import { track } from '../../lib/track';
import { resolveFinish } from '../../lib/finish';
import { VISUALIZER_DISCLAIMER } from '../../lib/csv';
import { atStoreNote } from '../../lib/estimate';
import { getProduct, isBuiltin } from '../../data/catalog';
import { useDesignStore } from '../../store/useDesignStore';
import { useEstimate } from '../../store/derived';
import { useCatalog } from '../../store/useCatalog';
import { useSession, timeAgo } from '../../store/useSession';
import { setSharedPrices } from '../contractors';
import type { PreparedBy } from '../../types/platform';
import { shareApi, type GoneReason, type SharedWire } from './api';
import './share.css';

type State = { kind: 'loading' } | { kind: 'ready'; wire: SharedWire; resume: boolean } | { kind: 'gone'; reason: GoneReason; message: string } | { kind: 'error'; message: string };

/** Set when a signed-out visitor asks to duplicate: the copy is made once they're back, signed in. */
const DUP_INTENT = 'blumodel-share-duplicate';

/** True once, for a signed-in visitor who asked to duplicate before signing in (and clears the request). */
function takeDuplicateIntent(token: string): boolean {
  try {
    const want = sessionStorage.getItem(DUP_INTENT) === token;
    if (want) sessionStorage.removeItem(DUP_INTENT);
    return want;
  } catch {
    return false;
  }
}

/** `#/s/:token`: a kitchen someone shared, read-only (the editor in view mode). */
export default function SharedKitchen({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    let pricesHidden = false;
    setState({ kind: 'loading' });
    shareApi
      .read(token)
      .then((wire) => {
        if (!live) return;
        pricesHidden = !wire.showPrices;
        // The sharer's sell prices (a contractor's), never the viewer's own price book.
        setSharedPrices(wire.showPrices ? (wire.prices ?? null) : null);
        useSession.getState().openProject(null, 0);
        useDesignStore.getState().openReadOnly(wire.kitchen.doc, wire.products);
        // Back from signing in to duplicate: skip the page and make the copy (see ResumeDuplicate).
        const resume = !wire.hideDuplicate && useSession.getState().status === 'signedIn' && takeDuplicateIntent(token);
        setState({ kind: 'ready', wire, resume });
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) {
          const reason = ((e.body as { reason?: GoneReason } | undefined)?.reason ?? 'missing') as GoneReason;
          setState({ kind: 'gone', reason, message: e.message });
        } else if (e instanceof ApiError && e.status === 429) setState({ kind: 'error', message: 'This link has been opened a lot in the last hour. Try again in a little while.' });
        else if (e instanceof ApiError && e.status === 0) setState({ kind: 'error', message: 'Can’t reach BluModel Studio right now. Check your connection and try again.' });
        else setState({ kind: 'error', message: 'This kitchen couldn’t be opened. Try again in a moment.' });
      });
    return () => {
      live = false;
      setSharedPrices(null);
      // Hidden prices arrive as zeros; reload the catalog so they don't follow the visitor elsewhere.
      if (pricesHidden) void useCatalog.getState().load(true);
    };
  }, [token]);

  if (state.kind === 'loading') return <div className="screen-msg">Opening the shared kitchen…</div>;
  if (state.kind === 'gone') return <GonePage reason={state.reason} />;
  if (state.kind === 'error')
    return (
      <StatePage title="Something went wrong" tone="error">
        <p>{state.message}</p>
        <div className="share-state-actions">
          <button className="btn primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </StatePage>
    );
  const { wire } = state;
  if (state.resume) return <ResumeDuplicate token={token} onFail={() => setState({ ...state, resume: false })} />;
  const sealed = !!wire.hideDuplicate;
  return (
    <div className={`share-page${sealed ? ' share-page--sealed' : ''}`}>
      <Workspace projectId={null} mode="view" showPrices={wire.showPrices} hideExport={sealed} banner={<ShareBar token={token} wire={wire} />} />
    </div>
  );
}

/**
 * Finishes a Duplicate the visitor asked for before signing in. It shows a message instead of the
 * shared kitchen: the copy takes a moment, and opening the page (with its 3D canvas) only to leave it
 * again straight away made react-three-fiber throw from its own onCreated when the canvas was
 * unmounted while still being created.
 */
let resumedFor: string | null = null;
function ResumeDuplicate({ token, onFail }: { token: string; onFail: () => void }) {
  useEffect(() => {
    if (resumedFor === token) return;
    resumedFor = token;
    shareApi
      .duplicate(token)
      .then(({ project }) => {
        resumedFor = null;
        useDesignStore.getState().toast(`“${project.name}” is in your kitchens. Changes you make are yours alone.`, 'ok');
        navigate({ name: 'kitchen', id: project.id });
      })
      .catch((e) => {
        resumedFor = null;
        useDesignStore.getState().toast(e instanceof ApiError ? e.message : 'Could not copy this kitchen. Try again.', 'warn');
        onFail();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return <div className="screen-msg">Making your copy…</div>;
}

// ── the header strip above the editor ─────────────────────────────────────

function ShareBar({ token, wire }: { token: string; wire: SharedWire }) {
  const [products, setProducts] = useState(false);
  const status = useSession((s) => s.status);
  const [dup, setDup] = useState<'idle' | 'busy' | string>('idle');
  const items = useDesignStore((s) => s.doc.items.length);
  const { preparedBy, kitchen } = wire;
  const startedDup = useRef(false);

  const duplicate = async () => {
    if (status !== 'signedIn') {
      try {
        sessionStorage.setItem(DUP_INTENT, token);
      } catch {
        // Storage blocked: they'll press Duplicate again after signing in.
      }
      navigateHash(signinHref());
      return;
    }
    setDup('busy');
    try {
      const { project } = await shareApi.duplicate(token);
      useDesignStore.getState().toast(`“${project.name}” is in your kitchens. Changes you make are yours alone.`, 'ok');
      navigate({ name: 'kitchen', id: project.id });
    } catch (e) {
      setDup(e instanceof ApiError ? e.message : 'Could not copy this kitchen. Try again.');
    }
  };

  // Back from signing in to duplicate: finish what they asked for.
  useEffect(() => {
    if (wire.hideDuplicate || status !== 'signedIn' || startedDup.current) return;
    let want: string | null = null;
    try {
      want = sessionStorage.getItem(DUP_INTENT);
      if (want === token) sessionStorage.removeItem(DUP_INTENT);
    } catch {
      want = null;
    }
    if (want === token) {
      startedDup.current = true;
      void duplicate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token, wire.hideDuplicate]);

  return (
    <div className={`share-bar${preparedBy ? ' share-bar--pro' : ''}`} role="region" aria-label="About this shared kitchen">
      <div className="share-bar-who">
        {preparedBy ? <CompanyMark p={preparedBy} /> : null}
        <div className="share-bar-text">
          <p className="share-bar-line">
            {preparedBy ? (
              <>
                <span className="share-bar-kicker">Prepared by</span> <b>{preparedBy.company}</b>
              </>
            ) : (
              <>
                Shared by <b>{kitchen.sharedBy}</b>
              </>
            )}
            <span className="share-bar-when"> · updated {timeAgo(kitchen.updatedAt)}</span>
          </p>
          <p className="share-bar-note" title={VISUALIZER_DISCLAIMER}>
            View only ·{' '}
            <a href="#/terms" target="_blank" rel="noopener">
              Terms
            </a>{' '}
            ·{' '}
            <a href="#/privacy" target="_blank" rel="noopener">
              Privacy
            </a>{' '}
            · {VISUALIZER_DISCLAIMER}
          </p>
        </div>
      </div>
      <div className="share-bar-actions">
        <button type="button" className="btn" onClick={() => setProducts(true)} aria-haspopup="dialog">
          Products <span className="share-count">{items}</span>
        </button>
        {preparedBy && <ContactButton p={preparedBy} kitchenName={kitchen.name} />}
        {!wire.hideDuplicate && (
          <button type="button" className="btn primary" onClick={duplicate} disabled={dup === 'busy'} title="Make your own copy to change">
            {dup === 'busy' ? (
              'Copying…'
            ) : (
              <>
                <span className="share-long">{status === 'signedIn' ? 'Duplicate to my kitchens' : 'Sign in to duplicate'}</span>
                <span className="share-short">Duplicate</span>
              </>
            )}
          </button>
        )}
      </div>
      {dup !== 'idle' && dup !== 'busy' && (
        <p className="share-bar-error" role="alert">
          {dup}
        </p>
      )}
      {products && <ProductsDialog wire={wire} onClose={() => setProducts(false)} />}
    </div>
  );
}

function CompanyMark({ p }: { p: PreparedBy }) {
  const [broken, setBroken] = useState(false);
  if (p.logoUrl && !broken) return <img className="share-logo" src={p.logoUrl} alt={`${p.company} logo`} onError={() => setBroken(true)} />;
  return (
    <span className="share-logo share-logo--initial" aria-hidden>
      {p.company.trim().charAt(0).toUpperCase() || '·'}
    </span>
  );
}

function ContactButton({ p, kitchenName }: { p: PreparedBy; kitchenName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!p.phone && !p.email && !p.website) return null;
  const subject = encodeURIComponent(`Our kitchen: ${kitchenName}`);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="btn primary" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="share-long">Contact {p.company}</span>
        <span className="share-short">Contact</span>
      </button>
      {open && (
        <div className="menu share-contact" role="menu">
          {p.phone && (
            <a role="menuitem" href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}>
              <b>Call</b>
              <span>{p.phone}</span>
            </a>
          )}
          {p.email && (
            <a role="menuitem" href={`mailto:${p.email}?subject=${subject}`}>
              <b>Email</b>
              <span>{p.email}</span>
            </a>
          )}
          {p.website && /^https?:\/\//i.test(p.website) && (
            <a role="menuitem" href={p.website} target="_blank" rel="noopener noreferrer">
              <b>Website</b>
              <span>{p.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── the products in this kitchen ──────────────────────────────────────────

function ProductsDialog({ wire, onClose }: { wire: SharedWire; onClose: () => void }) {
  const est = useEstimate();
  const doc = useDesignStore((s) => s.doc);
  const pro = wire.preparedBy;
  const lines = useMemo(() => est.lines.filter((l) => l.productId), [est]);
  const total = lines.reduce((n, l) => n + l.total, 0);
  const pieces = lines.reduce((n, l) => n + l.qty, 0);

  return (
    <Dialog title={`In this kitchen (${pieces} piece${pieces === 1 ? '' : 's'})`} onClose={onClose} className="share-products" wide>
      {lines.length === 0 ? (
        <p className="share-empty">No products placed yet.</p>
      ) : (
        <ul className="share-plist">
          {lines.map((l) => {
            const product = getProduct(l.productId!);
            const item = doc.items.find((i) => i.productId === l.productId);
            const finish = product && item ? resolveFinish(item, product, doc.surfaces) : undefined;
            const publicPage = product && (isBuiltin(product.id) || product.source === 'brand');
            const buy = !pro && (l.buyUrl ?? product?.buyUrl);
            return (
              <li key={l.key}>
                <span className="share-plist-art">{product ? <ProductArt product={product} finish={finish} surfaces={doc.surfaces} width={item?.widthIn} /> : null}</span>
                <span className="share-plist-main">
                  <b>{l.label}</b>
                  <span>
                    {l.sub}
                    {l.sku ? ` · ${l.sku}` : ''}
                  </span>
                  <span className="share-plist-links">
                    {publicPage && (
                      <a href={`#/p/${encodeURIComponent(product!.id)}`} onClick={onClose}>
                        See it in 3D
                      </a>
                    )}
                    {buy && (
                      <a href={buy} target="_blank" rel="noopener noreferrer" onClick={() => track(l.productId!, 'buy_click')}>
                        Buy from {product?.brand ?? 'the brand'} ↗
                      </a>
                    )}
                  </span>
                </span>
                <span className="share-plist-qty">×{l.qty}</span>
                {wire.showPrices && <span className={l.atStore ? 'share-plist-price' : 'share-plist-price mono'}>{l.atStore ? 'Price at store' : money(l.total)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {wire.showPrices && lines.length > 0 && (
        <p className="share-plist-total">
          <span>Products</span>
          <b className="mono">{money(total)}</b>
        </p>
      )}
      {wire.showPrices && est.atStore > 0 && <p className="share-plist-note">{atStoreNote(est.atStore)}</p>}
      <p className="share-plist-note">
        {pro
          ? `Prices are ${pro.company}’s. Contact them to order or to change anything.`
          : wire.showPrices
            ? 'Prices are illustrative estimates; no tax, labour or delivery. Built-in demo products use placeholder prices.'
            : 'The person who shared this kitchen chose not to show prices.'}
      </p>
      <p className="share-disclaimer">{VISUALIZER_DISCLAIMER}</p>
      {!pro && (
        <p className="share-plist-cta">
          <a href="#/welcome" onClick={onClose}>
            Made with BluModel Studio. Design your own kitchen free →
          </a>
        </p>
      )}
    </Dialog>
  );
}

// ── friendly dead ends ────────────────────────────────────────────────────

function StatePage({ title, tone, children }: { title: string; tone?: 'error'; children: ReactNode }) {
  return (
    <div className="share-state">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
      </header>
      <main className="share-state-main">
        <div className={`share-state-card${tone ? ` is-${tone}` : ''}`}>
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

function GonePage({ reason }: { reason: GoneReason }) {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const copy: Record<GoneReason, { title: string; body: string }> = {
    revoked: { title: 'This link is no longer available', body: 'Whoever shared this kitchen has turned the link off. If you still need it, ask them to send a new one.' },
    expired: { title: 'This link has expired', body: 'Share links can be set to stop working after a while. Ask whoever sent it for a fresh link.' },
    missing: { title: 'We couldn’t find this kitchen', body: 'The link may be incomplete. Check that you copied all of it, or ask for it again.' },
  };
  const c = copy[reason] ?? copy.missing;
  return (
    <StatePage title={c.title}>
      <p>{c.body}</p>
      <div className="share-state-actions">
        {signedIn ? (
          <a className="btn primary" href="#/">
            Go to my kitchens
          </a>
        ) : (
          <>
            <a className="btn primary" href="#/welcome">
              Design your own kitchen
            </a>
            <a className="btn" href="#/local">
              Try it without an account
            </a>
          </>
        )}
      </div>
    </StatePage>
  );
}
