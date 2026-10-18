/**
 * Admin > System > All websites: the site-wide switch (server/ops/sitesSwitch.mjs). OFF makes every
 * site (the sales site, www, the demo, every showroom and custom domain) answer "We'll be right
 * back"; signed-in admins keep the sales site and this page, so this same button turns it back on.
 * The same switch is on the server face (127.0.0.1:8799 on the machine) and `blumodel sites`.
 */
import { useState } from 'react';
import { timeAgo } from '../../store/useSession';
import { adminApi } from './api';
import type { SitesState } from './types';
import { Notice, Pill, Section, dateTime, errorText } from './ui';

const VIA: Record<string, string> = { face: 'the server face', admin: 'Admin', cli: 'the command line' };

export default function SitesCard({ sites, onChange }: { sites: SitesState; onChange: (s: SitesState) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = async (on: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      onChange((await adminApi.setSites(on)).sites);
      setConfirm(false);
    } catch (e) {
      setErr(errorText(e, 'Could not change it.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="All websites" id="adm-sites">
      {!sites.on && (
        <Notice tone="bad">
          Every site is <b>OFF</b>: visitors see “We’ll be right back”. Only signed-in admins can use the sales site and this page.
        </Notice>
      )}
      <div className="adm-actions">
        {sites.on ? <Pill tone="ok">ON</Pill> : <Pill tone="bad">OFF (maintenance)</Pill>}
        <span className="adm-sub">
          blumodel.studio, www, the demo and every company’s showroom
          {sites.since ? ` · switched ${dateTime(sites.since)} (${timeAgo(sites.since)})${sites.via ? ` from ${VIA[sites.via] ?? sites.via}` : ''}${sites.by && sites.via === 'admin' ? ` by ${sites.by}` : ''}` : ''}
        </span>
      </div>
      <div className="adm-actions" style={{ marginTop: 12 }}>
        {sites.on ? (
          confirm ? (
            <>
              <button type="button" className="btn danger small" disabled={busy} onClick={() => void flip(false)}>
                {busy ? 'Turning off…' : 'Yes, turn every site off'}
              </button>
              <button type="button" className="btn small" disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <span className="adm-sub">Nothing is deleted. Turn them on again here, on the server face, or with blumodel sites on.</span>
            </>
          ) : (
            <button type="button" className="btn small" onClick={() => setConfirm(true)}>
              Turn all sites off
            </button>
          )
        ) : (
          <button type="button" className="btn small" disabled={busy} onClick={() => void flip(true)}>
            {busy ? 'Turning on…' : 'Turn all sites on'}
          </button>
        )}
      </div>
      {err && (
        <p className="auth-error" role="alert" style={{ marginTop: 8 }}>
          {err}
        </p>
      )}
    </Section>
  );
}
