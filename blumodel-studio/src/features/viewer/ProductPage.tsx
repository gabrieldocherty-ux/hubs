/**
 * The product page, `#/p/:id?finish=&w=` (BUILD_PLAN A-T7, PRODUCT_SPEC §5.4).
 *
 * The 3D stage loads as its own chunk (the side panel is useful straight away, drawn from the
 * product's 2D art while three.js arrives). The chosen finish and width live in the URL, so a
 * link shows exactly what was on screen. Works for built-in products (compiled in) and server
 * products (brand, contractor or custom; fetched, then registered in the catalog so Add to a
 * kitchen can place them).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Finish, Product } from '../../types';
import { api, ApiError, isUnreachable, type Project } from '../../lib/api';
import { CATEGORIES, getProduct, isBuiltin, priceFor, productCode } from '../../data/catalog';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { defaultFinishIndex, finishList } from '../../lib/finish';
import { feetInches, money } from '../../lib/format';
import { navigate, navigateHash, signinHref, useHashQuery } from '../../lib/router';
import { track } from '../../lib/track';
import { slug as fileSlug } from '../../lib/exporters';
import { useCatalog } from '../../store/useCatalog';
import { useSession, timeAgo } from '../../store/useSession';
import { initialDoc, loadLocalDraft, saveLocalDraft, useDesignStore } from '../../store/useDesignStore';
import { AccountMenu } from '../../components/AccountMenu';
import { Dialog } from '../../components/Dialog';
import { ProductArt } from '../../components/ProductArt';
import { Toasts } from '../../components/Toasts';
import { QuoteButton } from '../brands';
import { Download, Logo, Wordmark, Plus } from '../../components/Icons';
import { dimText, pickWidth, productHash, widthChoices } from './stageMath';
import type { StageStill } from './ProductStage';
import './viewer.css';

const StageView = lazy(() => import('./ProductStage').then((m) => ({ default: m.StageView })));

type Load = { status: 'loading' } | { status: 'ready'; product: Product } | { status: 'missing' } | { status: 'error'; message: string };

/** The product: built-ins at once; server products from the registry while a fresh copy loads. */
function useProduct(id: string): [Load, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>(() => {
    const known = getProduct(id);
    if (known && (isBuiltin(id) || (known.source !== 'missing' && known.source !== 'snapshot'))) return { status: 'ready', product: known };
    return { status: 'loading' };
  });
  useEffect(() => {
    if (isBuiltin(id)) {
      const p = getProduct(id);
      setLoad(p ? { status: 'ready', product: p } : { status: 'missing' });
      return;
    }
    let live = true;
    api
      .catalogProduct(id)
      .then(({ product }) => {
        if (!live) return;
        useCatalog.getState().register([product]);
        setLoad({ status: 'ready', product: getProduct(id) ?? product });
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setLoad({ status: 'missing' });
        else
          setLoad((cur) =>
            cur.status === 'ready'
              ? cur
              : { status: 'error', message: isUnreachable(e) ? 'BluModel Studio can’t reach its server right now. Check your connection and try again.' : 'This product didn’t load. Try again.' },
          );
      });
    return () => {
      live = false;
    };
  }, [id, attempt]);
  return [load, () => setAttempt((n) => n + 1)];
}

function swatchStyle(f: Finish): React.CSSProperties {
  if (f.swatchUrl) return { backgroundImage: `url(${f.swatchUrl})` };
  if (f.material === 'panel') return { background: 'repeating-linear-gradient(45deg,#cfc8bb 0 4px,#fff 4px 7px)' };
  if (f.material === 'metal') return { background: `linear-gradient(135deg, ${f.hex}, #fff9 45%, ${f.hex} 62%)` };
  if (f.material === 'glass') return { background: `linear-gradient(135deg, ${f.hex}cc, #ffffffcc 55%, ${f.hex}aa)` };
  return { background: f.hex };
}

function PageBar() {
  const user = useSession((s) => s.user);
  return (
    <header className="home-bar">
      <a className="brand" href="#/">
        <Logo />
        <Wordmark />
      </a>
      {user ? (
        <AccountMenu />
      ) : (
        <a className="btn" href={signinHref()}>
          Sign in
        </a>
      )}
    </header>
  );
}

/** A dimension as two lines: feet-and-inches, then centimetres. */
function DimValue({ inches: n }: { inches: number }) {
  const [ftIn, cm] = dimText(n, feetInches).split(' · ');
  return (
    <>
      <span>{ftIn}</span>
      <span className="pp-cm">{cm}</span>
    </>
  );
}

// ── Add to a kitchen ─────────────────────────────────────────────────────

/** Opens the on-device planner with the product added (and the finish and width chosen here). */
function addToDevicePlanner(product: Product, finishId: string, widthIn: number) {
  const store = useDesignStore.getState();
  store.loadDoc(loadLocalDraft() ?? initialDoc());
  const itemId = store.addItem(product.id);
  if (!itemId) {
    store.toast('That product couldn’t be added.', 'warn');
    return;
  }
  store.setFinish(itemId, finishId);
  if (widthIn !== product.widthIn) store.setWidth(itemId, widthIn);
  saveLocalDraft(useDesignStore.getState().doc);
  store.toast(`Added ${product.name}. Drag it into place on the plan.`, 'ok');
  navigate({ name: 'local' });
}

function AddToKitchen({ product, finishId, widthIn, onClose }: { product: Product; finishId: string; widthIn: number; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [projects, setProjects] = useState<Project[] | null | 'error'>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    api
      .listProjects()
      .then((r) => live && setProjects([...r.projects].sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => live && setProjects('error'));
    return () => {
      live = false;
    };
  }, [user?.id]);

  return (
    <Dialog title="Add to a kitchen" onClose={onClose} className="pp-add">
      <p className="dialog-copy">
        <b>{product.name}</b> goes into the kitchen you pick; drag it into place on the plan.
      </p>
      {user ? (
        projects === null ? (
          <p className="pp-add-note">Loading your kitchens…</p>
        ) : projects === 'error' ? (
          <p className="pp-add-note">Your kitchens didn’t load. You can still use the planner on this device.</p>
        ) : projects.length === 0 ? (
          <p className="pp-add-note">You don’t have a saved kitchen yet. Start one, or use the planner on this device.</p>
        ) : (
          <ul className="pp-kitchens" aria-label="Your kitchens">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => navigate({ name: 'kitchen', id: p.id, add: product.id })}>
                  <b>{p.name}</b>
                  <span>{p.client ? `${p.client} · ` : ''}Edited {timeAgo(p.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="pp-add-note">Sign in to add it to a kitchen in your account, or try it in the planner on this device (no account needed).</p>
      )}
      <div className="modal-actions pp-add-actions">
        {user ? (
          <a className="btn" href="#/new">
            New kitchen
          </a>
        ) : (
          <a className="btn" href={signinHref()}>
            Sign in
          </a>
        )}
        <button type="button" className="btn primary" onClick={() => addToDevicePlanner(product, finishId, widthIn)}>
          Use the device planner
        </button>
      </div>
    </Dialog>
  );
}

// ── gallery ──────────────────────────────────────────────────────────────

function Gallery({ product }: { product: Product }) {
  const images = product.images ?? [];
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const shown = open === null ? null : images[open];
  return (
    <section className="pp-gallery" aria-label="Photos">
      <span className="mini-label">Photos from {product.brand}</span>
      <div className="pp-thumbs">
        {images.map((img, i) => (
          <button key={img.url} type="button" className="pp-thumb" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}${img.alt ? `: ${img.alt}` : ''}`}>
            <img src={img.url} alt={img.alt ?? ''} loading="lazy" />
          </button>
        ))}
      </div>
      {shown && (
        <Dialog title={shown.alt || `${product.name}, photo ${open! + 1} of ${images.length}`} onClose={() => setOpen(null)} wide className="pp-photo">
          <img src={shown.url} alt={shown.alt ?? ''} />
          {images.length > 1 && (
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setOpen((open! - 1 + images.length) % images.length)}>
                Previous
              </button>
              <button type="button" className="btn" onClick={() => setOpen((open! + 1) % images.length)}>
                Next
              </button>
            </div>
          )}
        </Dialog>
      )}
    </section>
  );
}

// ── the page ─────────────────────────────────────────────────────────────

function ProductView({ product, finishParam, widthParam }: { product: Product; finishParam?: string; widthParam: string | null }) {
  const brands = useCatalog((s) => s.brands);
  const finishes = finishList(product);
  const fallback = finishes[defaultFinishIndex(product, DEFAULT_SURFACES)] ?? finishes[0];
  const finish = finishes.find((f) => f.id === finishParam) ?? fallback;
  const widths = widthChoices(product.widthIn, product.widthOptions);
  const width = pickWidth(widthParam, product.widthIn, product.widthOptions);
  const brand = product.brandId ? brands.find((b) => b.id === product.brandId) : undefined;
  const category = CATEGORIES.find((c) => c.id === product.category)?.label ?? product.category;
  const price = priceFor(product, width);
  const fromPrice = Math.min(...widths.map((w) => priceFor(product, w)));
  const [dims, setDims] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stageReady, setStageReady] = useState(false);
  const still = useRef<StageStill | null>(null);
  const onStill = useCallback((r: StageStill | null) => {
    still.current = r;
  }, []);
  const isServer = !isBuiltin(product.id);

  useEffect(() => {
    track(product.id, 'view');
    void useCatalog.getState().load();
  }, [product.id]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${product.name} · BluModel Studio`;
    return () => {
      document.title = prev;
    };
  }, [product.name]);

  const setChoice = (next: { finish?: string; width?: number }) =>
    navigateHash(productHash(product.id, next.finish ?? finish.id, next.width ?? width, product.widthIn), true);

  const downloadImage = async () => {
    const render = still.current;
    if (!render || saving) return;
    setSaving(true);
    try {
      const canvas = await render(2048);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('no image');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileSlug(product.name)}-${fileSlug(finish.name)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      track(product.id, 'render');
      useDesignStore.getState().toast('Image saved (2048 px PNG).', 'ok');
    } catch {
      useDesignStore.getState().toast('The image couldn’t be made in this browser.', 'warn');
    } finally {
      setSaving(false);
    }
  };

  const stageHeight = 'var(--pp-stage-h)';
  const art = (
    <div className="product-stage product-stage--art" style={{ height: stageHeight }}>
      <ProductArt product={product} finish={finish} surfaces={DEFAULT_SURFACES} width={width} className="pp-art" />
      <span className="pp-stage-note">Loading 3D…</span>
    </div>
  );

  return (
    <div className="pp-grid">
      <section className="pp-stage-col">
        <div className="pp-stage-wrap">
          <Suspense fallback={art}>
            <StageView product={product} finishId={finish.id} widthIn={width} showDims={dims} height={stageHeight} onStill={onStill} onReady={() => setStageReady(true)} className="pp-stage" />
          </Suspense>
          <div className="pp-stage-tools">
            <button type="button" className={dims ? 'chip on' : 'chip'} aria-pressed={dims} onClick={() => setDims((d) => !d)}>
              Dimensions
            </button>
            <button type="button" className="chip" onClick={downloadImage} disabled={!stageReady || saving}>
              <Download width={13} height={13} /> {saving ? 'Saving…' : 'Download image'}
            </button>
          </div>
        </div>
        <Gallery product={product} />
      </section>

      <aside className="pp-panel">
        <div className="pp-brand">
          {product.brandSlug ? <a href={`#/b/${encodeURIComponent(product.brandSlug)}`}>{product.brand}</a> : <span>{product.brand}</span>}
          {product.isDemo || brand?.isDemo ? <span className="pp-badge pp-badge--demo" title="A fictional demo brand">Demo</span> : null}
          {brand?.verified && !brand.isDemo ? <span className="pp-badge pp-badge--ok">Verified</span> : null}
          {product.visibility === 'private' && <span className="pp-badge" title="Only you can see this product">Private</span>}
        </div>
        <h1 className="pp-name">{product.name}</h1>
        <div className="pp-meta">
          <span className="mono">{productCode(product, width)}</span>
          <span>{category}</span>
        </div>
        <div className="pp-price">
          <b>{money(price)}</b>
          {widths.length > 1 && <span>from {money(fromPrice)} · this is the {width}″ width</span>}
          {product.isDemo && <span>Illustrative price</span>}
        </div>

        <div className="pp-block">
          <span className="mini-label">Finish · {finish.name}</span>
          <div className="swatches" role="radiogroup" aria-label="Finish">
            {finishes.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={f.id === finish.id}
                className={f.id === finish.id ? 'swatch on' : 'swatch'}
                style={swatchStyle(f)}
                title={f.name}
                aria-label={f.name}
                onClick={() => setChoice({ finish: f.id })}
              />
            ))}
          </div>
        </div>

        {widths.length > 1 && (
          <div className="pp-block">
            <span className="mini-label">Width</span>
            <div className="chips" role="radiogroup" aria-label="Width">
              {widths.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={w === width} className={w === width ? 'chip on mono' : 'chip mono'} onClick={() => setChoice({ width: w })}>
                  {w}″
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pp-block">
          <span className="mini-label">Dimensions</span>
          <dl className="pp-dims">
            <div>
              <dt>W</dt>
              <dd>
                <DimValue inches={width} />
              </dd>
            </div>
            <div>
              <dt>D</dt>
              <dd>
                <DimValue inches={product.depthIn} />
              </dd>
            </div>
            <div>
              <dt>H</dt>
              <dd>
                <DimValue inches={product.heightIn} />
              </dd>
            </div>
          </dl>
        </div>

        <div className="pp-actions">
          <button type="button" className="btn primary big" onClick={() => setAdding(true)}>
            <Plus width={15} height={15} /> Add to a kitchen
          </button>
          {product.buyUrl && (
            <a className="btn big" href={product.buyUrl} target="_blank" rel="noopener nofollow" onClick={() => track(product.id, 'buy_click')}>
              Buy from {product.brand}
            </a>
          )}
          <Suspense fallback={null}>
            <QuoteButton product={product} className="btn big" />
          </Suspense>
          <a className="pp-link" href={`#/orders/new?ref=${encodeURIComponent(product.id)}`}>
            Request a custom version
          </a>
        </div>

        {product.blurb && <p className="pp-blurb">{product.blurb}</p>}

        <table className="pp-specs">
          <tbody>
            <tr>
              <th scope="row">Brand</th>
              <td>{product.brand}</td>
            </tr>
            <tr>
              <th scope="row">SKU</th>
              <td className="mono">{productCode(product, width)}</td>
            </tr>
            <tr>
              <th scope="row">Category</th>
              <td>{category}</td>
            </tr>
            <tr>
              <th scope="row">Size</th>
              <td>
                {width}″ W × {product.depthIn}″ D × {product.heightIn}″ H
              </td>
            </tr>
            {product.elevationIn > 0 && (
              <tr>
                <th scope="row">Mounted</th>
                <td>Underside {feetInches(product.elevationIn)} above the floor</td>
              </tr>
            )}
            {widths.length > 1 && (
              <tr>
                <th scope="row">Widths</th>
                <td>{widths.map((w) => `${w}″`).join(', ')}</td>
              </tr>
            )}
            <tr>
              <th scope="row">Finishes</th>
              <td>{finishes.map((f) => f.name).join(', ')}</td>
            </tr>
            <tr>
              <th scope="row">3D model</th>
              <td>{product.model?.url ? `From ${product.brand}` : 'Drawn by BluModel Studio'}</td>
            </tr>
            {product.specSheetUrl && (
              <tr>
                <th scope="row">Spec sheet</th>
                <td>
                  <a href={product.specSheetUrl} target="_blank" rel="noopener nofollow">
                    Open the spec sheet
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {isServer && product.isDemo && <p className="pp-fine">A fictional demo product. Prices and links are illustrative.</p>}
      </aside>

      {adding && <AddToKitchen product={product} finishId={finish.id} widthIn={width} onClose={() => setAdding(false)} />}
    </div>
  );
}

export default function ProductPage({ id, finish }: { id: string; finish?: string }) {
  const [load, retry] = useProduct(id);
  const query = useHashQuery();
  const signedIn = useSession((s) => !!s.user);

  return (
    <div className="product-page">
      <PageBar />
      <main className="pp-main">
        {load.status === 'loading' && <div className="screen-msg">Loading the product…</div>}
        {load.status === 'missing' && (
          <div className="screen-msg pp-missing">
            <h1>We can’t find that product</h1>
            <p>It may have been taken down, or it’s private to someone’s account.{signedIn ? '' : ' If it’s yours, sign in to see it.'}</p>
            <div className="pp-missing-actions">
              {!signedIn && (
                <a className="btn primary" href={signinHref()}>
                  Sign in
                </a>
              )}
              <a className="btn" href="#/">
                Back to BluModel Studio
              </a>
            </div>
          </div>
        )}
        {load.status === 'error' && (
          <div className="screen-msg pp-missing">
            <p>{load.message}</p>
            <button type="button" className="btn" onClick={retry}>
              Try again
            </button>
          </div>
        )}
        {load.status === 'ready' && <ProductView key={load.product.id} product={load.product} finishParam={finish} widthParam={query.get('w')} />}
      </main>
      <Toasts />
    </div>
  );
}
