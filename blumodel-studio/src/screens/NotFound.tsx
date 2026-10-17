import { useEffect } from 'react';
import { SiteMark } from '../features/showroom';
import { LegalLinks } from '../features/legal/LegalLinks';
import { useSession } from '../store/useSession';

/** Any address the app doesn't know: a friendly way back instead of a blank or the wrong page. */
export function NotFound() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  useEffect(() => {
    const before = document.title;
    document.title = 'Page not found · BluModel Studio';
    return () => {
      document.title = before;
    };
  }, []);
  return (
    <div className="nf">
      <main className="nf-card" aria-labelledby="nf-title">
        <a className="brand" href="#/" aria-label="BluModel Studio home">
          <SiteMark />
        </a>
        <span className="eyebrow">404</span>
        <h1 id="nf-title">We can’t find that page</h1>
        <p>The link may be missing a part, or the page has moved. Shared kitchens stop opening when their owner turns the link off.</p>
        <div className="nf-actions">
          <a className="btn primary big" href="#/">
            {signedIn ? 'Go to my kitchens' : 'Go to the home page'}
          </a>
          <a className="btn big" href="#/local">
            Design a kitchen
          </a>
        </div>
        <LegalLinks />
      </main>
    </div>
  );
}
