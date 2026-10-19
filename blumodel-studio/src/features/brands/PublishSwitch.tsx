import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { useDesignStore } from '../../store/useDesignStore';
import { brandApi, type PageStatus, type ProductEntry } from './api';
import { listingStatus } from './logic';
import './brands.css';

export interface PublishSwitchProps {
  entry: ProductEntry;
  pageStatus: PageStatus;
  readOnly: boolean;
  /** Called with the product's new state (and the page's live count) after a change. */
  onChange: (entry: ProductEntry, liveCount: number) => void;
  /** Hide the status tag (the caller shows its own). */
  bare?: boolean;
}

/**
 * "Show on my brand page" (BRAND_PAGE §4): on sends the product to review (or straight back
 * live when the approved version hasn't changed); off takes it off the page at once.
 */
export function PublishSwitch({ entry, pageStatus, readOnly, onChange, bare = false }: PublishSwitchProps) {
  const [busy, setBusy] = useState(false);
  const toast = useDesignStore((s) => s.toast);
  const st = listingStatus(entry.listing, pageStatus);
  const missing = entry.readiness.checks.filter((c) => !c.ok);
  const blocked = !st.on && missing.length > 0;
  const noPage = pageStatus === 'none';

  const flip = async () => {
    setBusy(true);
    try {
      if (st.on) {
        const r = await brandApi.unpublish(entry.id);
        toast(`${entry.name} is off your page. Kitchens that use it keep it.`, 'ok');
        onChange(r.product, r.liveCount);
      } else {
        const r = await brandApi.publish(entry.id);
        toast(r.status === 'published' ? `${entry.name} is back on your page.` : `${entry.name} is in review. It goes live once BluModel Studio approves it.`, 'ok');
        onChange(r.product, r.liveCount);
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work. Try again.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const title = noPage
    ? 'Set up your brand page first.'
    : blocked
      ? `Not ready: ${missing.map((c) => c.label.toLowerCase()).join('; ')}.`
      : st.on
        ? 'Take it off your brand page'
        : 'Show it on your brand page';

  return (
    <span className="brand-switch-wrap">
      <label className={`brand-switch${st.on ? ' is-on' : ''}`} title={title}>
        <input type="checkbox" role="switch" checked={st.on} disabled={busy || readOnly || noPage || blocked} onChange={() => void flip()} aria-label={`Show ${entry.name} on my brand page`} />
        <span className="brand-switch-track" aria-hidden="true">
          <span className="brand-switch-knob" />
        </span>
        <span className="brand-switch-label">Show on my brand page</span>
      </label>
      {!bare && st.label !== 'Not on your page' && <span className={`tag ${st.tone}`}>{st.label}</span>}
    </span>
  );
}
