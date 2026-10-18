/**
 * A prospect trial in Admin > Companies (server/routes/quickSetup.mjs): days left, Extend 7 days,
 * End trial, and in the company's page Convert to paying customer (once a license is recorded and
 * the monthly plan is paid or complimentary). Every action is audited on the server.
 */
import { useState } from 'react';
import { showroomApi } from './showroomApi';
import type { AdminTenant } from './showroomTypes';
import { Notice, Pill, Section, day, errorText } from './ui';
import './quick-setup.css';

const daysText = (n: number) => (n === 1 ? '1 day left' : `${n} days left`);

/** "Trial · 9 days left", or "Trial ended" once it has lapsed. */
export function TrialPill({ t }: { t: AdminTenant }) {
  if (!t.trial) return null;
  return t.trial.active ? <Pill tone={t.trial.daysLeft <= 3 ? 'warn' : 'info'}>{`Trial · ${daysText(t.trial.daysLeft)}`}</Pill> : <Pill tone="warn">Trial ended</Pill>;
}

type Msg = { tone: 'ok' | 'bad'; text: string };

/** `onMessage`: where the outcome is said when the caller shows it (a converted trial's section goes away). */
function useTrialActions(t: AdminTenant, onChange: (t: AdminTenant) => void, onMessage?: (m: Msg | null) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [own, setOwn] = useState<Msg | null>(null);
  const msg = onMessage ? null : own;
  const setMsg = (m: Msg | null) => (onMessage ? onMessage(m) : setOwn(m));
  const run = async (name: string, fn: () => Promise<{ tenant: AdminTenant }>, ok: (t: AdminTenant) => string) => {
    setBusy(name);
    setMsg(null);
    try {
      const out = await fn();
      onChange(out.tenant);
      setMsg({ tone: 'ok', text: ok(out.tenant) });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e, 'That didn’t work. Try again.') });
    } finally {
      setBusy(null);
    }
  };
  const extend = () => run('extend', () => showroomApi.trialExtend(t.id, 7), (n) => `${t.name}’s trial now runs until ${day(n.trial?.endsAt)}.`);
  const end = () => run('end', () => showroomApi.trialEnd(t.id), () => `${t.name}’s trial has ended: visitors see “temporarily unavailable”. Nothing is deleted.`);
  const convert = () => run('convert', () => showroomApi.trialConvert(t.id), () => `${t.name} is a paying customer now, and live. Everything is kept.`);
  return { busy, msg, extend, end, convert };
}

/** The list row's buttons: Extend 7 days and End trial (with a confirmation). */
export function TrialRowActions({ t, onChange }: { t: AdminTenant; onChange: (t: AdminTenant) => void }) {
  const { busy, msg, extend, end } = useTrialActions(t, onChange);
  const [confirm, setConfirm] = useState(false);
  if (!t.trial) return null;
  return (
    <span className="adm-actions adm-trial-actions">
      <button type="button" className="btn small" disabled={!!busy} onClick={() => void extend()} aria-label={`Extend ${t.name}’s trial by 7 days`}>
        {busy === 'extend' ? 'Extending…' : 'Extend 7 days'}
      </button>
      {t.trial.active &&
        (confirm ? (
          <>
            <button type="button" className="btn danger small" disabled={!!busy} onClick={() => void end().then(() => setConfirm(false))}>
              Yes, end it
            </button>
            <button type="button" className="btn small" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn small" disabled={!!busy} onClick={() => setConfirm(true)} aria-label={`End ${t.name}’s trial`}>
            End trial
          </button>
        ))}
      {msg && (
        <span className={msg.tone === 'bad' ? 'qs-bad' : 'adm-sub'} role={msg.tone === 'bad' ? 'alert' : 'status'}>
          {msg.text}
        </span>
      )}
    </span>
  );
}

/** The company page's Trial section. */
export function TrialSection({ t, onChange, onMessage }: { t: AdminTenant; onChange: (t: AdminTenant) => void; onMessage: (m: Msg | null) => void }) {
  const { busy, msg, extend, end, convert } = useTrialActions(t, onChange, onMessage);
  const [confirm, setConfirm] = useState(false);
  if (!t.trial) return null;
  const s = t.standing;
  const missing = [...(s?.licenseCurrent ? [] : ['record the license']), ...(s?.monthlyPaid ? [] : ['get the monthly plan paid or make it complimentary'])];
  return (
    <Section title="Trial" id="adm-co-trial">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <dl className="adm-kv">
        <dt>Now</dt>
        <dd>
          <TrialPill t={t} />
        </dd>
        <dt>{t.trial.active ? 'Ends' : 'Ended'}</dt>
        <dd>{day(t.trial.endsAt)}</dd>
        <dt>Charged</dt>
        <dd>Nothing: a trial never charges.</dd>
      </dl>
      <p className="adm-note">
        {t.trial.active
          ? 'Visitors can use the showroom now. When the trial ends it shows “temporarily unavailable” until they buy; nothing is ever deleted.'
          : 'Visitors see “temporarily unavailable”. Everything is kept: extend it, or convert it once they buy.'}
      </p>
      <div className="adm-actions">
        <button type="button" className="btn primary" disabled={!!busy || missing.length > 0} onClick={() => void convert()}>
          {busy === 'convert' ? 'Converting…' : 'Convert to paying customer'}
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void extend()}>
          {busy === 'extend' ? 'Extending…' : 'Extend 7 days'}
        </button>
        {t.trial.active &&
          (confirm ? (
            <>
              <button type="button" className="btn danger" disabled={!!busy} onClick={() => void end().then(() => setConfirm(false))}>
                Yes, end the trial now
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirm(true)}>
              End trial
            </button>
          ))}
      </div>
      <p className="adm-note">{missing.length ? `To convert, first ${missing.join(' and ')} (below). Everything they have is kept.` : 'License and monthly plan are in place: converting keeps everything and makes it live.'}</p>
    </Section>
  );
}
