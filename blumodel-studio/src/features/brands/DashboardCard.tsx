import { useEffect } from 'react';
import { hrefFor } from '../../lib/router';
import { PAGE_STATUS_LABEL, PAGE_STATUS_TONE, pageHash, subHref } from './logic';
import { useBrandSummary } from './summary';
import './brands.css';

/**
 * The Brand page card on the workspace Dashboard (BRAND_PAGE §2): status, this month's page
 * views and leads, and a badge for unread leads.
 */
export function BrandDashboardCard() {
  const summary = useBrandSummary((s) => s.summary);
  useEffect(() => {
    void useBrandSummary.getState().load();
  }, []);

  const ps = summary?.pageStatus ?? 'none';
  const unread = summary?.unread ?? 0;
  return (
    <section className="pro-card brand-dash" aria-labelledby="brand-dash-title">
      <div className="brand-dash-head">
        <span className="eyebrow" id="brand-dash-title">
          Brand page
        </span>
        <span className={`tag ${PAGE_STATUS_TONE[ps]}`}>{summary ? PAGE_STATUS_LABEL[ps] : '…'}</span>
        {summary?.isDemo && <span className="tag">Demo data</span>}
      </div>
      {ps === 'none' ? (
        <>
          <p>
            <b>Get found:</b> put the cabinets you sell in front of homeowners designing their kitchens. They see them in 3D, try them in their own designs, then contact you.
          </p>
          <div>
            <a className="btn primary" href={subHref('settings')}>
              Set up my brand page
            </a>
          </div>
        </>
      ) : (
        <>
          <div className="brand-dash-stats">
            <a href={hrefFor({ name: 'pro', rest: 'brand' })}>
              <b className="mono">{summary?.monthViews ?? 0}</b>
              <span>page views this month</span>
            </a>
            <a href={subHref('leads')}>
              <b className="mono">{summary?.monthLeads ?? 0}</b>
              <span>
                leads this month
                {unread > 0 && <span className="badge bad">{unread} new</span>}
              </span>
            </a>
            <a href={subHref('products')}>
              <b className="mono">{summary?.liveProducts ?? 0}</b>
              <span>products on the page</span>
            </a>
          </div>
          <div className="brand-dash-actions">
            <a className="btn" href={hrefFor({ name: 'pro', rest: 'brand' })}>
              Open Brand page
            </a>
            {ps === 'live' && summary?.slug && (
              <a className="btn" href={pageHash(summary.slug)}>
                View public page
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default BrandDashboardCard;
