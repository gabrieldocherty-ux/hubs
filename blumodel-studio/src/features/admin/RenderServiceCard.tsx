/**
 * Admin > System > Render service: the address and key of the AI that makes photoreal renders
 * (server/renders/settings.mjs), pasted here instead of edited into blumodel.env, so it can be done
 * from a phone. The key goes to the server and is never sent back: only its last four characters.
 * Saving asks for the password (and 2FA) again. blumodel.env wins when it sets one.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { timeAgo } from '../../store/useSession';
import { adminApi } from './api';
import type { RenderServiceState } from './types';
import { Notice, Pill, Section, dateTime, errorText } from './ui';

/** Phones: no capitals, corrections or suggestions in a key or an address. */
const RAW = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

export default function RenderServiceCard() {
  const [state, setState] = useState<RenderServiceState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string; ms?: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    adminApi
      .renderService()
      .then((r) => {
        setState(r.renders);
        setEditing(!r.renders.source);
      })
      .catch((e) => setLoadErr(errorText(e, 'Could not load the render service.')));
  }, []);

  if (loadErr) return <Section title="Render service" id="adm-render-service"><p className="auth-error">{loadErr}</p></Section>;
  if (!state) return null;

  const fromEnv = state.source === 'env';
  const working = state.provider === 'architect';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setErr(null);
    setTest(null);
    try {
      const r = await adminApi.setRenderService(key.trim() || undefined);
      setState(r.renders);
      setKey('');
      setEditing(false);
    } catch (e2) {
      const body = (e2 as { body?: { errors?: { field: string; message: string }[] } }).body;
      const first = body?.errors?.[0];
      setErr(first ? { field: first.field, message: first.message } : { message: errorText(e2, 'Could not save it.') });
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      setTest(await adminApi.testRenderService());
    } catch (e) {
      setTest({ ok: false, message: errorText(e, 'Could not run the test.') });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    setErr(null);
    try {
      const r = await adminApi.removeRenderService();
      setState(r.renders);
      setKey('');
      setEditing(true);
      setConfirmRemove(false);
      setTest(null);
    } catch (e) {
      setErr({ message: errorText(e, 'Could not remove it.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Render service" id="adm-render-service">
      <div className="adm-actions">
        {working ? <Pill tone="ok">Photoreal renders on</Pill> : state.provider === 'demo' ? <Pill tone="warn">Demo renders (stamped, no AI)</Pill> : <Pill tone="warn">Not set up</Pill>}
        <span className="adm-sub">MyArchitectAI turns a design’s 3D view into a photoreal picture (“Make it photoreal”). Paste your MyArchitectAI API key and save.</span>
      </div>
      {state.forced === 'off' && <Notice tone="warn">RENDER_PROVIDER=off in blumodel.env: renders stay off whatever is saved here.</Notice>}
      {state.forced === 'demo' && <Notice tone="warn">RENDER_PROVIDER=demo in blumodel.env: renders use the demo, not the service saved here.</Notice>}
      {state.keyUnreadable && (
        <Notice tone="bad">
          The saved key can’t be read on this server (its encryption key file, render-settings.key, isn’t next to the database). Paste the key again.
        </Notice>
      )}

      {state.source && !editing ? (
        <dl className="adm-kv rs-kv">
          <dt>Key</dt>
          <dd className="mono">•••• {state.keyLast4}</dd>
          <dt>Set</dt>
          <dd>{fromEnv ? 'In blumodel.env on the server' : state.updatedAt ? `${dateTime(state.updatedAt)} (${timeAgo(state.updatedAt)})${state.updatedBy ? ` by ${state.updatedBy}` : ''}` : '—'}</dd>
        </dl>
      ) : null}

      {fromEnv ? (
        <p className="adm-sub">It’s set in blumodel.env, which wins over this page. To change it here instead, take the two ARCHITECT_AI lines out of blumodel.env and restart the server.</p>
      ) : editing ? (
        <form className="adm-form rs-form" onSubmit={(e) => void save(e)} noValidate>
          <label className="adm-field">
            <span>MyArchitectAI API key{state.source && !state.keyUnreadable ? ' (leave empty to keep the saved one)' : ''}</span>
            <input type="password" name="render-key" autoComplete="new-password" placeholder={state.keyLast4 && !state.keyUnreadable ? `•••• ${state.keyLast4}` : 'Paste your MyArchitectAI API key'} value={key} onChange={(e) => setKey(e.target.value)} aria-invalid={err?.field === 'key'} {...RAW} />
          </label>
          <p className="adm-note">The key is stored encrypted on the server and is never shown again, only its last four characters. Saving asks for your password.</p>
          <div className="adm-actions rs-buttons">
            <button type="submit" className="btn primary" disabled={!!busy}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            {state.source && (
              <button
                type="button"
                className="btn"
                disabled={!!busy}
                onClick={() => {
                  setEditing(false);
                  setKey('');
                  setErr(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="adm-actions rs-buttons">
          <button type="button" className="btn primary" disabled={!!busy} onClick={() => void runTest()}>
            {busy === 'test' ? 'Testing…' : 'Test it'}
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => setEditing(true)}>
            Change
          </button>
          {confirmRemove ? (
            <>
              <button type="button" className="btn danger" disabled={!!busy} onClick={() => void remove()}>
                {busy === 'remove' ? 'Removing…' : 'Yes, remove it'}
              </button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirmRemove(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
        </div>
      )}
      {fromEnv && (
        <div className="adm-actions rs-buttons">
          <button type="button" className="btn primary" disabled={!!busy} onClick={() => void runTest()}>
            {busy === 'test' ? 'Testing…' : 'Test it'}
          </button>
        </div>
      )}
      {!editing && <p className="adm-note">Test it sends one small picture to the service; that may count as one render on the service’s side. Nothing is charged here.</p>}
      {test && (
        <Notice tone={test.ok ? 'ok' : 'bad'}>
          {test.message}
          {test.ms !== undefined ? ` (${(test.ms / 1000).toFixed(1)} s)` : ''}
        </Notice>
      )}
      {err && (
        <p className="auth-error" role="alert" style={{ marginTop: 8 }}>
          {err.message}
        </p>
      )}
    </Section>
  );
}
