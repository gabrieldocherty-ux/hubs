import { useEffect, useState } from 'react';
import { AccountMenu } from '../../components/AccountMenu';
import { Logo, Wordmark } from '../../components/Icons';
import { Toasts } from '../../components/Toasts';
import { ApiError } from '../../lib/api';
import { signinHref } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { useSession } from '../../store/useSession';
import { brandApi, type PublicBrand, type PublicProduct } from './api';
import { PublicBrandView } from './PublicBrandView';
import './brands.css';

type State = 'loading' | 'gone' | { error: string } | { brand: PublicBrand; products: PublicProduct[] };

/** `#/b/:slug`: a live brand page. Unknown, in-review, suspended and lapsed pages all say the same thing. */
export default function BrandPage({ slug }: { slug: string }) {
  const [state, setState] = useState<State>('loading');
  const signedIn = useSession((s) => s.status === 'signedIn');

  useEffect(() => {
    let live = true;
    brandApi
      .page(slug)
      .then((r) => {
        if (!live) return;
        // The cards link to product pages and "Try in my kitchen": make the products resolvable.
        useCatalog.getState().register(r.products);
        setState(r);
        document.title = `${r.brand.name} · BluModel Studio`;
        void brandApi.event(slug, 'brand_view');
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setState('gone');
        else setState({ error: e instanceof ApiError ? e.message : 'Could not open this page.' });
      });
    return () => {
      live = false;
      document.title = 'BluModel Studio';
    };
  }, [slug]);

  return (
    <div className="bp-screen">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        {/* Signed out, "Sign in" (as on a product page): AccountMenu's "Sign in to save" is the editor's words, and wrapped beside the name on a phone. */}
        {signedIn ? (
          <AccountMenu />
        ) : (
          <a className="btn" href={signinHref()}>
            Sign in
          </a>
        )}
      </header>
      <main className="bp-main">
        {state === 'loading' && <div className="screen-msg">Opening the page…</div>}
        {state === 'gone' && (
          <div className="screen-msg bp-gone">
            <p>This page is unavailable.</p>
            <a className="btn" href="#/">
              Back to BluModel Studio
            </a>
          </div>
        )}
        {typeof state === 'object' && 'error' in state && (
          <div className="screen-msg">
            <p>{state.error}</p>
            <button className="btn" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        )}
        {typeof state === 'object' && 'brand' in state && <PublicBrandView brand={state.brand} products={state.products} />}
      </main>
      <Toasts />
    </div>
  );
}
