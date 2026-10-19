import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, setReauthHandler } from '../lib/api';
import { accountApi, type MfaStatus } from '../lib/accountApi';
import { useSession } from '../store/useSession';
import { Dialog } from './Dialog';

/**
 * Two-factor sign-in (server/auth/mfa.mjs): an authenticator app plus ten one-time recovery codes.
 * Required for BluModel admins (the admin pages show <MfaEnrolScreen> until it is on), optional for
 * everyone else in Account settings > Security. There is no QR code (no encoder without a new
 * dependency): the otpauth:// link opens the authenticator app on the same phone, and the key can
 * be typed in by hand.
 */

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

type Setup = { secret: string; key: string; otpauthUrl: string };

export function TwoFactorSettings({ forced = false, onEnabled }: { forced?: boolean; onEnabled?: () => void }) {
  const refresh = useSession((s) => s.refresh);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'recovery'>('idle');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    accountApi
      .mfaStatus()
      .then(setStatus)
      .catch((e) => setError(errText(e, 'Two-factor sign-in couldn’t be loaded.')));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errText(e, 'That didn’t work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const begin = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await accountApi.mfaSetup(password));
      setPassword('');
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await accountApi.mfaEnable(code.trim());
      setCodes(r.recoveryCodes);
      setStatus(r);
      setSetup(null);
      setCode('');
      await refresh();
      window.dispatchEvent(new Event('blumodel:sessions-changed'));
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setStatus(await accountApi.mfaDisable(password, code.trim()));
      setPassword('');
      setCode('');
      setMode('idle');
      setOk('Two-factor sign-in is off. Your password alone signs you in now.');
      await refresh();
    });
  };
  const newCodes = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await accountApi.mfaRecovery(password, code.trim());
      setCodes(r.recoveryCodes);
      setStatus(r);
      setPassword('');
      setCode('');
      setMode('idle');
    });
  };

  if (!status) return <div className="mfa">{error ? <div className="auth-error">{error}</div> : <p className="set-hint">Loading…</p>}</div>;

  if (codes)
    return (
      <div className="mfa" aria-live="polite">
        <h3 className="set-sub">Your recovery codes</h3>
        <p className="set-hint">
          Each one signs you in once if you lose your phone. Keep them somewhere safe and offline (printed, or in a password manager). They won’t be shown again.
        </p>
        <ol className="mfa-codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ol>
        <div className="set-actions">
          <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).then(() => setOk('Copied.'), () => {})}>
            Copy the codes
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setCodes(null);
              onEnabled?.();
            }}
          >
            I’ve saved them
          </button>
        </div>
        {ok && <div className="auth-ok">{ok}</div>}
      </div>
    );

  if (status.enabled)
    return (
      <div className="mfa">
        <div className="set-row">
          <h3 className="set-sub">
            Two-factor sign-in <span className="set-badge">On</span>
          </h3>
        </div>
        <p className="set-hint">
          Signing in asks for a code from your authenticator app. {status.recoveryLeft} recovery code{status.recoveryLeft === 1 ? '' : 's'} left.
          {status.required ? ' Admins must keep it on.' : ''}
        </p>
        {mode === 'idle' && (
          <div className="set-actions">
            <button type="button" className="btn" onClick={() => setMode('recovery')}>
              New recovery codes
            </button>
            {!status.required && (
              <button type="button" className="btn" onClick={() => setMode('disable')}>
                Turn off
              </button>
            )}
          </div>
        )}
        {mode !== 'idle' && (
          <form onSubmit={mode === 'disable' ? disable : newCodes} noValidate aria-label={mode === 'disable' ? 'Turn off two-factor sign-in' : 'New recovery codes'}>
            <div className="set-grid">
              <label className="field">
                <span>Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </label>
              <label className="field">
                <span>Code from your app (or a recovery code)</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} required />
              </label>
            </div>
            <div className="set-actions">
              <button type="button" className="btn" onClick={() => setMode('idle')}>
                Cancel
              </button>
              <button type="submit" className={mode === 'disable' ? 'btn danger' : 'btn primary'} disabled={busy || !password || !code.trim()}>
                {mode === 'disable' ? 'Turn off two-factor sign-in' : 'Make new codes'}
              </button>
            </div>
          </form>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {ok && <div className="auth-ok" role="status">{ok}</div>}
      </div>
    );

  return (
    <div className="mfa">
      <h3 className="set-sub">Two-factor sign-in</h3>
      {!setup ? (
        <form onSubmit={begin} noValidate aria-label="Set up two-factor sign-in">
          <p className="set-hint">
            {forced
              ? 'Admins must sign in with a code from an authenticator app as well as the password. Set it up now to open the admin pages.'
              : 'Optional. Signing in will also ask for a code from an authenticator app on your phone (1Password, Google Authenticator, Microsoft Authenticator, Authy), so a stolen password isn’t enough.'}
          </p>
          <div className="set-grid">
            <label className="field">
              <span>Your password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
          </div>
          <div className="set-actions">
            <button type="submit" className="btn primary" disabled={busy || !password}>
              {busy ? 'One moment…' : 'Set up'}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate aria-label="Confirm two-factor sign-in">
          <ol className="mfa-steps">
            <li>
              On your phone, <a href={setup.otpauthUrl}>open this link in your authenticator app</a>, or add an account by hand with this key (time-based):
              <div className="mfa-key">
                <code aria-label="Setup key">{setup.key}</code>
                <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => setOk('Key copied.'), () => {})}>
                  Copy
                </button>
              </div>
            </li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="set-grid">
            <label className="field">
              <span>Code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required autoFocus />
            </label>
          </div>
          <div className="set-actions">
            <button type="button" className="btn" onClick={() => setSetup(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6}>
              {busy ? 'Checking…' : 'Turn on'}
            </button>
          </div>
        </form>
      )}
      {error && <div className="auth-error" role="alert">{error}</div>}
      {ok && <div className="auth-ok" role="status">{ok}</div>}
    </div>
  );
}

/** The admin pages for an admin without two-factor sign-in yet: set it up first (the grace flow). */
export function MfaEnrolScreen() {
  const refresh = useSession((s) => s.refresh);
  return (
    <div className="screen-msg mfa-enrol">
      <div className="set-card">
        <h1>Turn on two-factor sign-in</h1>
        <p>An admin can change every company’s account, so the admin pages need a code from your phone as well as your password.</p>
        <TwoFactorSettings forced onEnabled={() => void refresh()} />
      </div>
    </div>
  );
}

/**
 * "Confirm it's you": dangerous admin actions (reset links, deletes, credit and plan grants) answer
 * 401 reauth_required when the password and code weren't given in the last 10 minutes. This asks
 * for them, and the request is sent again (src/lib/api.ts setReauthHandler).
 */
export function ReauthPrompt() {
  const [ask, setAsk] = useState<{ mfa: boolean; done: (ok: boolean) => void } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReauthHandler((mfa) => new Promise<boolean>((done) => setAsk({ mfa, done })));
    return () => setReauthHandler(null);
  }, []);

  if (!ask) return null;
  const close = (ok: boolean) => {
    ask.done(ok);
    setAsk(null);
    setPassword('');
    setCode('');
    setError(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.reauth(password, ask.mfa ? code.trim() : undefined);
      close(true);
    } catch (err) {
      setError(errText(err, 'That didn’t work. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Confirm it’s you" onClose={() => close(false)}>
      <form onSubmit={submit} noValidate className="reauth-form">
        <p>This changes money or someone’s access, so enter your password{ask.mfa ? ' and a code from your authenticator app' : ''} again. It lasts 10 minutes.</p>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required data-autofocus />
        </label>
        {ask.mfa && (
          <label className="field">
            <span>Code from your app (or a recovery code)</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} required />
          </label>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => close(false)}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !password || (ask.mfa && !code.trim())}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
