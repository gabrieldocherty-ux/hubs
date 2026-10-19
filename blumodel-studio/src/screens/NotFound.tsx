import { useEffect } from 'react';
import { SiteMark, useShowroom } from '../features/showroom';
import { demoShowroomUrl } from '../features/marketing/logic';
import { useConfig } from '../lib/config';
import { LegalLinks } from '../features/legal/LegalLinks';
import { useSession } from '../store/useSession';

/** Any address the app doesn't know: a friendly way back instead of a blank or the wrong page. */
export function NotFound() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const showroom = useShowroom();
  const baseDomain = useConfig((s) => s.config?.baseDomain ?? null);
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
            {signedIn ? (showroom ? 'Go to my designs' : 'Go to my account') : 'Go to the home page'}
          </a>
          {/* A showroom's visitors design with the company; the sales site shows companies the demo. */}
          {showroom ? (
            <a className="btn big" href="#/new">
              Design your kitchen
            </a>
          ) : (
            <a className="btn big" href={demoShowroomUrl(baseDomain, location)} data-demo-link>
              See a live demo showroom
            </a>
          )}
        </div>
        <LegalLinks />
      </main>
    </div>
  );
}
