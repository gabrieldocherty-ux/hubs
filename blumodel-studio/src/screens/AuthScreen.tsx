import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { accountApi, type ResetOptions } from '../lib/accountApi';
import { navigateHash, safeNext, splitHash, useHashQuery } from '../lib/router';
import { useSession } from '../store/useSession';
import { buildTemplate } from '../data/templates';
import { DEFAULT_ROOM, DEFAULT_SURFACES } from '../data/defaults';
import { MiniPlan } from '../components/MiniPlan';
import { shortName, SiteMark, useShowroom } from '../features/showroom';
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
  const joinToken = mode === 'signin' && !resetToken ? query.get('join') : null;
  const forgot = mode === 'signin' && !resetToken && !joinToken && query.get('forgot') === '1';
  const next = query.get('next');
  const keepNext = next ? `?next=${encodeURIComponent(next)}` : '';

  // On a company's showroom the page is the company's: its mark and its words, never ours.
  const showroom = useShowroom();
  const hero = useMemo(() => ({ name: 'Hero', room: DEFAULT_ROOM, surfaces: DEFAULT_SURFACES, items: buildTemplate('l-island', DEFAULT_ROOM, DEFAULT_SURFACES).items }), []);

  return (
    <div className="auth">
      <section className="auth-hero" aria-hidden>
        <div className="auth-brand">
          <SiteMark />
        </div>
        <div className="auth-plan">
          <MiniPlan doc={hero} />
        </div>
        <div className="auth-pitch">
          {showroom ? (
            <>
              <h1>Design your room with {shortName(showroom)}.</h1>
              <p>Your account keeps every design you make here, free. When you’re happy with one, send it to {shortName(showroom)} and a designer will follow up.</p>
            </>
          ) : (
            <>
              <h1>Your showroom, your products, your leads.</h1>
              <p>Kitchen and bath companies we build showrooms for sign in on their own showroom’s address to manage products, leads and their team. Your customers design on your showroom, never here.</p>
            </>
          )}
        </div>
      </section>

      <section className="auth-panel">
        {resetToken ? <ResetForm key={resetToken} token={resetToken} keepNext={keepNext} /> : joinToken ? <JoinForm key={joinToken} token={joinToken} /> : forgot ? <ForgotForm keepNext={keepNext} /> : <SignInForm mode={mode} keepNext={keepNext} />}
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
  // Two-factor sign-in: the password was right, now the code (a 5-minute ticket holds the first step).
  const [ticket, setTicket] = useState<string | null>(null);
  const offline = status === 'offline';
  const signup = mode === 'signup';
  const showroom = useShowroom();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (signup && password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      if (signup) {
        setUser((await api.signup(name, email, password)).user);
      } else {
        const r = await api.login(email, password);
        if (r.mfa === 'required') {
          setTicket(r.ticket);
          setPassword('');
          return;
        }
        setUser(r.user);
      }
      navigateHash(safeNext(splitHash(location.hash).query), true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (ticket) return <CodeStep ticket={ticket} onRestart={() => setTicket(null)} />;

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
      <p className="auth-sub">
        {showroom
          ? signup
            ? 'Save every design you make here and pick up where you left off, on any device.'
            : 'Sign in to open your designs.'
          : signup
            ? 'An account on BluModel Studio itself. A company’s team signs in on its own showroom.'
            : 'Sign in to BluModel Studio.'}
      </p>

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
        {signup ? 'Already have an account? ' : showroom ? 'New here? ' : 'New to BluModel Studio? '}
        <a href={`${signup ? '#/signin' : '#/signup'}${keepNext}`}>{signup ? 'Sign in' : 'Create an account'}</a>
      </p>

      {/* The sales site is for companies: no homeowner design-without-an-account here. */}
      {!showroom && (
        <>
          <div className="auth-or">
            <span>or</span>
          </div>
          <a className="btn wide" href="#/book">
            Not working with us yet? Book a call
          </a>
        </>
      )}
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
  // The link can be opened in a browser that is signed in already, maybe as someone else.
  const signedInAs = useSession((s) => s.user?.email ?? null);
  const [check, setCheck] = useState<'checking' | 'invalid' | 'unreachable' | { email: string; mfa: boolean }>('checking');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    accountApi
      .checkReset(token)
      .then((r) => live && setCheck(r.valid && r.email ? { email: r.email, mfa: !!r.mfa } : 'invalid'))
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
      const { user } = await accountApi.reset(token, password, typeof check === 'object' && check.mfa ? code.trim() : undefined);
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
      {signedInAs && (
        <div className="auth-note reset-signed-in">
          This browser is signed in as <strong>{signedInAs}</strong>. Saving signs it in to the account this link is for instead.
        </div>
      )}
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
      {check.mfa && (
        <label className="field">
          <span>Code from your authenticator app (or a recovery code)</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} required />
        </label>
      )}
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary wide big" type="submit" disabled={busy || (check.mfa && !code.trim())}>
        {busy ? 'One moment…' : 'Save and sign in'}
      </button>
    </form>
  );
}

/**
 * `#/signin?join=<token>`: a team invite emailed to an address that already has an account on this
 * showroom. The person accepts it with that account's own password; nothing about the account
 * changes except that it joins the team (the person who invited never sees this link).
 */
function JoinForm({ token }: { token: string }) {
  const setUser = useSession((s) => s.setUser);
  const [check, setCheck] = useState<'checking' | 'invalid' | { email: string; role: string; showroom: string }>('checking');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    accountApi
      .checkJoin(token)
      .then((r) => live && setCheck(r.valid && r.email ? { email: r.email, role: r.role ?? 'staff', showroom: r.showroom ?? '' } : 'invalid'))
      .catch(() => live && setCheck('invalid'));
    return () => {
      live = false;
    };
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await accountApi.join(token, password, needCode ? code.trim() : undefined);
      setUser(user);
      navigateHash('#/studio', true);
    } catch (err) {
      const c = err instanceof ApiError ? (err.body as { code?: string } | undefined)?.code : undefined;
      if (c === 'invite_invalid') setCheck('invalid');
      else if (c === 'mfa_required') setNeedCode(true);
      else setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (check === 'checking')
    return (
      <div className="auth-form" aria-busy="true">
        <h2>Join the team</h2>
        <p className="auth-sub">Checking your invitation…</p>
      </div>
    );
  if (check === 'invalid')
    return (
      <div className="auth-form">
        <h2>This invitation has expired</h2>
        <p className="auth-sub">An invitation works once, for 7 days, until it is withdrawn. Ask the showroom’s owner to invite you again.</p>
        <a className="btn primary wide big" href="#/signin">
          Sign in
        </a>
      </div>
    );
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>Join {check.showroom || 'the'} team</h2>
      <p className="auth-sub">
        You’re invited as {check.role === 'owner' ? 'an owner' : 'staff'}. Sign in to <strong>{check.email}</strong> with your own password to accept. Your password doesn’t change.
      </p>
      <label className="field">
        <span>Your password</span>
        <div className="pw">
          <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      {needCode && (
        <label className="field">
          <span>Code from your authenticator app</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} required />
        </label>
      )}
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary wide big" type="submit" disabled={busy || !password}>
        {busy ? 'One moment…' : 'Accept and sign in'}
      </button>
      <p className="auth-forgot">
        <a href="#/signin?forgot=1">Forgot password?</a> The invitation keeps working after you reset it.
      </p>
    </form>
  );
}

/** The second step of a sign-in with two-factor sign-in on: a code from the app, or a recovery code. */
function CodeStep({ ticket, onRestart }: { ticket: string; onRestart: () => void }) {
  const setUser = useSession((s) => s.setUser);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.loginMfa(ticket, code.trim());
      setUser(r.user);
      if (typeof r.recoveryLeft === 'number' && r.recoveryLeft <= 3) alert(`You have ${r.recoveryLeft} recovery code${r.recoveryLeft === 1 ? '' : 's'} left. Make new ones in Account settings > Security.`);
      navigateHash(safeNext(splitHash(location.hash).query), true);
    } catch (err) {
      if (err instanceof ApiError && (err.body as { code?: string } | undefined)?.code === 'mfa_ticket_invalid') onRestart();
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-label="Two-factor sign-in">
      <h2>Enter your code</h2>
      <p className="auth-sub">{recovery ? 'Enter one of the recovery codes you saved when you set up two-factor sign-in. Each works once.' : 'Open your authenticator app and enter the 6-digit code for BluModel Studio.'}</p>
      <label className="field">
        <span>{recovery ? 'Recovery code' : 'Code'}</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={20} required autoFocus />
      </label>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary wide big" type="submit" disabled={busy || !code.trim()}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <p className="auth-forgot">
        <button type="button" className="auth-linkbtn" onClick={() => (setRecovery((v) => !v), setCode(''))}>
          {recovery ? 'Use a code from the app instead' : 'Lost your phone? Use a recovery code'}
        </button>
      </p>
      <p className="auth-switch">
        <button type="button" className="auth-linkbtn" onClick={onRestart}>
          Start again
        </button>
      </p>
    </form>
  );
}
