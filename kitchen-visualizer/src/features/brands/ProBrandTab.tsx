import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { brandApi, type BrandState, type PagePreview } from './api';
import { BrandTabContext, useBrandTab } from './context';
import { BRAND_SUBS, brandSubOf, PAGE_STATUS_LABEL, PAGE_STATUS_TONE, pageHash, subHref } from './logic';
import { useBrandSummary } from './summary';
import { PublicBrandView } from './PublicBrandView';
import BrandOverview from './BrandOverview';
import BrandProducts from './BrandProducts';
import BrandLeads from './BrandLeads';
import BrandSettings from './BrandSettings';
import './brands.css';

/** The pitch line on the tab and on Pricing (BRAND_PAGE §1). */
export const BRAND_PITCH = 'Get found: put the cabinets you sell in front of homeowners designing their kitchens.';

/**
 * `#/pro/brand[/products|/leads|/settings|/preview]`: the Brand page tab of the Contractor
 * workspace (BRAND_PAGE §2–§8). `rest` is the workspace's whole sub-path ("brand/leads").
 */
export default function ProBrandTab({ rest }: { rest: string }) {
  const [state, setState] = useState<BrandState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unread = useBrandSummary((s) => s.summary?.unread ?? 0);

  const reload = useCallback(async () => {
    try {
      setState(await brandApi.state());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your brand page.');
    }
    void useBrandSummary.getState().load();
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const set = useCallback((s: BrandState) => {
    setState(s);
    void useBrandSummary.getState().load();
  }, []);

  if (error && !state) return <div className="auth-error">{error}</div>;
  if (!state) return <div className="screen-msg">Loading your brand page…</div>;

  if (rest.split('/')[1] === 'preview') return <Preview />;

  const sub = brandSubOf(rest);
  const b = state.brand;
  const ps = b?.pageStatus ?? 'none';

  return (
    <BrandTabContext.Provider value={{ state, readOnly: state.readOnly, setState: set, reload }}>
      <div className="brand-tab">
        <div className="pro-head">
          <div>
            <span className="eyebrow">Brand page · included in your plan</span>
            <h1>{b ? b.name : 'Your brand page'}</h1>
            <p className="muted">{BRAND_PITCH}</p>
          </div>
          <div className="pro-head-actions">
            <span className={`tag ${PAGE_STATUS_TONE[ps]}`}>{PAGE_STATUS_LABEL[ps]}</span>
            {b && ps === 'live' && (
              <a className="btn" href={pageHash(b.slug)}>
                View public page
              </a>
            )}
            {b && ps !== 'live' && (
              <a className="btn" href={hrefFor({ name: 'pro', rest: 'brand/preview' })}>
                Preview
              </a>
            )}
          </div>
        </div>
        <StatusBanner />
        <nav className="brand-subnav" aria-label="Brand page">
          {BRAND_SUBS.map(([k, label]) => (
            <a key={k} href={subHref(k)} className={sub === k ? 'chip on' : 'chip'} aria-current={sub === k ? 'page' : undefined}>
              {label}
              {k === 'leads' && unread > 0 && (
                <span className="badge bad" aria-label={`${unread} new`}>
                  {unread}
                </span>
              )}
            </a>
          ))}
        </nav>
        {sub === 'overview' && <BrandOverview />}
        {sub === 'products' && <BrandProducts />}
        {sub === 'leads' && <BrandLeads />}
        {sub === 'settings' && <BrandSettings />}
      </div>
    </BrandTabContext.Provider>
  );
}

/** One line about where the page stands and what to do next. */
function StatusBanner() {
  const { state } = useBrandTab();
  const b = state.brand;
  const ps = b?.pageStatus ?? 'none';
  const settings = subHref('settings');
  switch (ps) {
    case 'none':
      return (
        <div className="brand-banner">
          <span>
            <b>Set up your page in about two minutes.</b> Most of it comes from your Company profile, so nothing is retyped.
          </span>
          {!state.readOnly && (
            <a className="btn primary" href={settings}>
              Set up my page
            </a>
          )}
        </div>
      );
    case 'draft':
      return (
        <div className="brand-banner">
          <span>
            <b>Not submitted yet.</b> When it looks right, submit it: Mise checks the business is real, then it goes live with a Verified contractor badge.
          </span>
          <a className="btn" href={settings}>
            Finish and submit
          </a>
        </div>
      );
    case 'in_review':
      return (
        <div className="brand-banner warn">
          <span>
            <b>In review.</b> Mise is checking your business details. Your page and products go live together once it’s approved; you can keep adding products meanwhile.
          </span>
          <a className="btn" href={hrefFor({ name: 'pro', rest: 'brand/preview' })}>
            Preview
          </a>
        </div>
      );
    case 'rejected':
      return (
        <div className="brand-banner bad">
          <span>
            <b>Changes requested.</b> {b?.statusNote || 'Mise couldn’t verify the business yet.'} Fix it in Settings and submit again.
          </span>
          <a className="btn" href={settings}>
            Open settings
          </a>
        </div>
      );
    case 'hidden':
      return (
        <div className="brand-banner warn">
          <span>
            <b>Hidden while your plan has lapsed.</b> Homeowners see “This page is unavailable”. Renew and everything that was live comes back, with no new review. Your leads stay readable.
          </span>
          <a className="btn primary" href="#/account/billing">
            Renew
          </a>
        </div>
      );
    case 'suspended':
      return (
        <div className="brand-banner bad">
          <span>
            <b>Suspended by Mise.</b> {b?.statusNote || ''} Your page and products are hidden. Reply to Mise support to sort it out.
          </span>
        </div>
      );
    default:
      return null;
  }
}

/** `#/pro/brand/preview`: exactly what will be public, with the lead form disarmed. */
function Preview() {
  const [data, setData] = useState<PagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    brandApi
      .preview()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the preview.'));
  }, []);
  return (
    <div className="brand-preview">
      <div className="brand-preview-bar" role="status">
        <span>
          <b>Preview.</b> This is what homeowners will see{data?.pageStatus === 'live' ? '' : ' once your page is approved'}. Products in review are included.
        </span>
        <a className="btn" href={hrefFor({ name: 'pro', rest: 'brand' })}>
          Back to Brand page
        </a>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!data && !error && <div className="screen-msg">Loading the preview…</div>}
      {data && <PublicBrandView brand={data.brand} products={data.products} preview />}
    </div>
  );
}
