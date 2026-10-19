/**
 * Admin > System > Updates: what the automatic update last did (server/admin/updates.mjs, from the
 * files scripts/host/update.mjs --auto writes in the home) and Update now, which leaves a trigger
 * file for it (Linux: blumodel-update.path starts it at once; Windows: within two minutes). The
 * page never runs anything itself. docs/HOSTING.md, "Automatic updates".
 */
import { useState } from 'react';
import { timeAgo } from '../../store/useSession';
import { adminApi } from './api';
import type { UpdateOutcome, UpdatesStatus } from './types';
import { Notice, Pill, Section, dateTime, errorText } from './ui';

const OUTCOME: Record<UpdateOutcome, { label: string; tone: 'ok' | 'warn' | 'bad' | 'plain' }> = {
  current: { label: 'Up to date', tone: 'ok' },
  updated: { label: 'Updated', tone: 'ok' },
  skipped: { label: 'Skipped (failed before)', tone: 'warn' },
  refused: { label: 'Refused', tone: 'bad' },
  busy: { label: 'Busy (another update or deploy)', tone: 'warn' },
  'rolled-back': { label: 'Rolled back', tone: 'bad' },
  failed: { label: 'Failed', tone: 'bad' },
  down: { label: 'Failed, rollback failed too', tone: 'bad' },
  error: { label: 'Could not check', tone: 'warn' },
};

/** '04:00' -> '4:00 am', '16:30' -> '4:30 pm'. */
export function clockTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : '—');

export default function UpdatesCard({ updates, onChange }: { updates: UpdatesStatus; onChange: (u: UpdatesStatus) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  if (!updates.available) {
    return (
      <Section title="Updates" id="adm-updates">
        <p className="empty-note">This server isn’t running from an installed home (it is a development copy), so it doesn’t update itself. On the Wyse, updates come from GitHub: docs/HOSTING.md, “Automatic updates”.</p>
      </Section>
    );
  }
  const u = updates;
  const canRequest = u.installed && u.enabled && !u.pending;
  const request = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminApi.updateNow();
      onChange(r.updates);
      setMsg({ tone: 'ok', text: 'Requested. The update starts within a couple of minutes: if GitHub has a newer release it is deployed (the site restarts for a few seconds); if not, nothing changes. Check again shortly.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err, 'Could not request the update.') });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const o = u.last ? OUTCOME[u.last.outcome] : null;

  return (
    <Section title="Updates" id="adm-updates">
      {u.rolledBack && u.last && (
        <Notice tone="bad">
          {u.last.outcome === 'down'
            ? `The last update (${short(u.last.to)}) failed its health check and the rollback failed too: check the site now (docs/HOSTING.md, “Roll back”).`
            : `The last update (${short(u.last.to)}) did not go live${u.last.outcome === 'rolled-back' ? ': it failed its health check and was rolled back' : ''}. The site runs ${short(u.deployed)}. That release is not retried until a newer one is published, or until you press Update now.`}
          {u.last.error && <div className="adm-note">{u.last.error}</div>}
        </Notice>
      )}
      <dl className="adm-kv">
        <dt>Automatic updates</dt>
        <dd>
          {!u.installed ? <Pill tone="warn">Not installed</Pill> : u.enabled ? <Pill tone="ok">On</Pill> : <Pill tone="warn">Off</Pill>}{' '}
          {u.installed && u.enabled && <span className="adm-sub">Checks GitHub daily at {clockTime(u.time)}</span>}
        </dd>
        <dt>Branch</dt>
        <dd className="mono">{u.branch ?? '—'}</dd>
        <dt>Deployed commit</dt>
        <dd className="mono">{short(u.deployed)}</dd>
        <dt>GitHub head</dt>
        <dd className="mono">
          {short(u.head)} {u.head && u.deployed && !u.head.startsWith(u.deployed) && !u.deployed.startsWith(u.head) && <Pill tone="warn">not deployed</Pill>}
        </dd>
        {u.source && (
          <>
            <dt>Built from</dt>
            <dd className="mono">{short(u.source)}</dd>
          </>
        )}
        <dt>Last check</dt>
        <dd>{u.lastCheckAt ? `${dateTime(u.lastCheckAt)} (${timeAgo(u.lastCheckAt)})` : 'Not yet'}</dd>
        <dt>Last result</dt>
        <dd>
          {o ? <Pill tone={o.tone}>{o.label}</Pill> : '—'} {u.last?.by === 'update-now' && <span className="adm-sub">(Update now)</span>}
          {u.last?.error && !u.rolledBack && <div className="adm-note">{u.last.error}</div>}
        </dd>
        <dt>Last update</dt>
        <dd>{u.lastUpdate ? `${dateTime(u.lastUpdate.at)}: ${short(u.lastUpdate.from)} → ${short(u.lastUpdate.to)}` : 'None recorded'}</dd>
      </dl>
      <div className="adm-actions" style={{ marginTop: 12 }}>
        {confirm ? (
          <>
            <button type="button" className="btn small" disabled={busy} onClick={() => void request()}>
              {busy ? 'Requesting…' : 'Yes, update now'}
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <span className="adm-sub">If GitHub has a newer release, the site restarts for a few seconds.</span>
          </>
        ) : (
          <button type="button" className="btn small" disabled={!canRequest} onClick={() => setConfirm(true)}>
            {u.pending ? 'Update requested…' : 'Update now'}
          </button>
        )}
        {!u.installed && <span className="adm-sub">Install it with the installer (or register-tasks) on this machine.</span>}
        {u.installed && !u.enabled && <span className="adm-sub">Automatic updates are off on this machine, so Update now has nothing to start.</span>}
      </div>
      {msg && (
        <p className={msg.tone === 'bad' ? 'auth-error' : 'adm-note'} role={msg.tone === 'bad' ? 'alert' : 'status'} style={{ marginTop: 8 }}>
          {msg.text}
        </p>
      )}
    </Section>
  );
}
