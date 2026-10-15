import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { accountApi, type ResetOptions } from '../lib/accountApi';
import { navigateHash, safeNext, splitHash, useHashQuery } from '../lib/router';
import { useSession } from '../store/useSession';
import { buildTemplate } from '../data/templates';
import { DEFAULT_ROOM, DEFAULT_SURFACES } from '../data/defaults';
import { MiniPlan } from '../components/MiniPlan';
import { Logo, Wordmark } from '../components/Icons';
import { AgreeToSignUp } from '../components/PaymentNotice';
import { LegalLinks } from '../features/legal/LegalLinks';
import './auth.css';

/** How long a reset link works (server/auth/resets.mjs RESET_MINUTES). */
const RESET_MINUTES = 60;
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/**
 * Sign in, sign up, and the two password-reset pages, which live on the sign-in route so they need
 * no session: `#/signin?forgot=1` asks for a link, `#/signin?reset=<token>` (the emailed or
 * admin-made link) chooses the new password.
 */
export function AuthScreen({ mode }: { mode: 'signin' | 'signup' }) {
  const query = useHashQuery();
  const resetToken = mode === 'signin' ? query.get('reset') : null;
  const forgot = mode === 'signin' && !resetToken && query.get('forgot') === '1';
  const next = query.get('next');
  const keepNext = next ? `?next=${encodeURIComponent(next)}` : '';

  const hero = useMemo(() => ({ name: 'Hero', room: DEFAULT_ROOM, surfaces: DEFAULT_SURFACES, items: buildTemplate('l-island', DEFAULT_ROOM, DEFAULT_SURFACES).items }), []);

  return (
    <div className="auth">
      <section className="auth-hero" aria-hidden>
        <div className="auth-brand">
          <Logo />
          <Wordmark />
        </div>
        <div className="auth-plan">
          <MiniPlan doc={hero} />
        </div>
        <div className="auth-pitch">
          <h1>Plan the kitchen before you build it.</h1>
          <p>Drop in real cabinets and appliances at true scale, check the layout against kitchen-planning guidelines, price it, and walk through it in 3D.</p>
        </div>
      </section>

      <section className="auth-panel">
        {resetToken ? <ResetForm key={resetToken} token={resetToken} keepNext={keepNext} /> : forgot ? <ForgotForm keepNext={keepNext} /> : <SignInForm mode={mode} keepNext={keepNext} />}
        <LegalLinks className="auth-legal" />
      </section>
    </div>
  );
}

function SignInForm({ mode, keepNext }: { mode: 'signin' | 'signup'; keepNext: string }) {
  const status = useSession((s) => s.status);
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = status === 'offline';
  const signup = mode === 'signup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (signup && password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      const { user } = signup ? await api.signup(name, email, password) : await api.login(email, password);
      setUser(user);
      navigateHash(safeNext(splitHash(location.hash).query), true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
      <p className="auth-sub">{signup ? 'Save every kitchen you design and pick up where you left off, on any device.' : 'Sign in to open your kitchens.'}</p>

      {offline && (
        <div className="auth-note">
          Accounts aren’t available here right now. You can still design on this device; your work stays in this browser.
        </div>
      )}

      {signup && (
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required disabled={offline} />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required disabled={offline} />
      </label>
      <label className="field">
        <span>
          Password
          {signup && <em> · at least 8 characters</em>}
        </span>
        <div className="pw">
          <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} required disabled={offline} />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      {!signup && !offline && (
        <p className="auth-forgot">
          <a href={`#/signin?forgot=1${keepNext ? `&${keepNext.slice(1)}` : ''}`}>Forgot password?</a>
        </p>
      )}

      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}

      <button className="btn primary wide big" type="submit" disabled={busy || offline}>
        {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
      </button>
      {signup && <AgreeToSignUp />}

      <p className="auth-switch">
        {signup ? 'Already have an account? ' : 'New to BluModel Studio? '}
        <a href={`${signup ? '#/signin' : '#/signup'}${keepNext}`}>{signup ? 'Sign in' : 'Create an account'}</a>
      </p>

      <div className="auth-or">
        <span>or</span>
      </div>
      <a className="btn wide" href="#/local">
        Design on this device without an account
      </a>
    </form>
  );
}

/**
 * "Forgot password?": with an email provider, the person asks for a link and always hears the same
 * answer (the server never says whether an address has an account). With none, resets go through
 * support, and an admin makes the link in Admin > Users.
 */
function ForgotForm({ keepNext }: { keepNext: string }) {
  const status = useSession((s) => s.status);
  const [options, setOptions] = useState<ResetOptions | null>(null);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = status === 'offline';

  useEffect(() => {
    if (offline) return;
    let live = true;
    accountApi
      .resetOptions()
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions({ emailEnabled: false, supportEmail: null }));
    return () => {
      live = false;
    };
  }, [offline]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setError('Enter the email address you sign in with.');
    setBusy(true);
    try {
      await accountApi.forgot(addr);
      setSentTo(addr);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <p className="auth-switch">
      Remembered it? <a href={`#/signin${keepNext}`}>Sign in</a>
    </p>
  );

  if (offline)
    return (
      <div className="auth-form">
        <h2>Reset your password</h2>
        <div className="auth-note">Accounts aren’t available here right now, so passwords can’t be reset. Try again in a little while.</div>
        {back}
      </div>
    );

  if (!options)
    return (
      <div className="auth-form" aria-busy="true">
        <h2>Reset your password</h2>
        <p className="auth-sub">One moment…</p>
      </div>
    );

  if (sentTo)
    return (
      <div className="auth-form">
        <h2>Check your email</h2>
        <div className="auth-ok" role="status">
          If an account uses <strong>{sentTo}</strong>, a link to choose a new password is on its way.
        </div>
        <p className="auth-sub">
          The link works once, for {RESET_MINUTES} minutes. Nothing after a few minutes? Look in your spam folder, or{' '}
          <button type="button" className="auth-linkbtn" onClick={() => setSentTo(null)}>
            ask again
          </button>
          .
        </p>
        <a className="btn primary wide big" href={`#/signin${keepNext}`}>
          Back to sign in
        </a>
      </div>
    );

  if (!options.emailEnabled)
    return (
      <div className="auth-form">
        <h2>Reset your password</h2>
        <p className="auth-sub">Password resets go through our support team for now.</p>
        <div className="auth-help">
          {options.supportEmail ? (
            <p>
              Write to <a href={`mailto:${options.supportEmail}?subject=${encodeURIComponent('Password reset')}`}>{options.supportEmail}</a> from the address you sign in with. We’ll reply with a link to choose a new password; it works once, for {RESET_MINUTES} minutes.
            </p>
          ) : (
            <p>Contact the BluModel Studio team from the address you sign in with. They’ll send you a link to choose a new password; it works once, for {RESET_MINUTES} minutes.</p>
          )}
          <p className="auth-help-small">We’ll never ask for your old password.</p>
        </div>
        {back}
      </div>
    );

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>Reset your password</h2>
      <p className="auth-sub">Enter the email you sign in with and we’ll send you a link to choose a new password.</p>
      <label className="field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
      </label>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary wide big" type="submit" disabled={busy}>
        {busy ? 'One moment…' : 'Email me a link'}
      </button>
      {back}
    </form>
  );
}

/** The link from the email (or from an admin): checks it, then sets the new password and signs in. */
function ResetForm({ token, keepNext }: { token: string; keepNext: string }) {
  const setUser = useSession((s) => s.setUser);
  const [check, setCheck] = useState<'checking' | 'invalid' | 'unreachable' | { email: string }>('checking');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    accountApi
      .checkReset(token)
      .then((r) => live && setCheck(r.valid && r.email ? { email: r.email } : 'invalid'))
      .catch((err) => live && setCheck(err instanceof ApiError && err.status === 0 ? 'unreachable' : 'invalid'));
    return () => {
      live = false;
    };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      const { user } = await accountApi.reset(token, password);
      setUser(user);
      // The token leaves the address bar with this page.
      navigateHash(safeNext(splitHash(location.hash).query), true);
    } catch (err) {
      if (err instanceof ApiError && (err.body as { code?: string } | undefined)?.code === 'reset_invalid') setCheck('invalid');
      else setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (check === 'checking')
    return (
      <div className="auth-form" aria-busy="true">
        <h2>Choose a new password</h2>
        <p className="auth-sub">Checking your link…</p>
      </div>
    );

  if (check === 'unreachable')
    return (
      <div className="auth-form">
        <h2>Choose a new password</h2>
        <div className="auth-note">Accounts aren’t available here right now. Your link still works for {RESET_MINUTES} minutes from when it was made; try it again in a little while.</div>
      </div>
    );

  if (check === 'invalid')
    return (
      <div className="auth-form">
        <h2>This link has expired</h2>
        <p className="auth-sub">A reset link works once, for {RESET_MINUTES} minutes, and only the newest one works. Ask for a new one and use it straight away.</p>
        <a className="btn primary wide big" href={`#/signin?forgot=1${keepNext ? `&${keepNext.slice(1)}` : ''}`}>
          Ask for a new link
        </a>
        <p className="auth-switch">
          Remembered it? <a href={`#/signin${keepNext}`}>Sign in</a>
        </p>
      </div>
    );

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>Choose a new password</h2>
      <p className="auth-sub">
        For <strong>{check.email}</strong>. Saving it signs this account out on every other device.
      </p>
      <label className="field">
        <span>
          New password<em> · at least 8 characters</em>
        </span>
        <div className="pw">
          <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary wide big" type="submit" disabled={busy}>
        {busy ? 'One moment…' : 'Save and sign in'}
      </button>
    </form>
  );
}
