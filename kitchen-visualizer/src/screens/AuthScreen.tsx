import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { useSession } from '../store/useSession';
import { buildTemplate } from '../data/templates';
import { DEFAULT_ROOM, DEFAULT_SURFACES } from '../store/useDesignStore';
import { MiniPlan } from '../components/MiniPlan';
import { Logo } from '../components/Icons';

export function AuthScreen({ mode }: { mode: 'signin' | 'signup' }) {
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

  const hero = useMemo(() => ({ name: 'Hero', room: DEFAULT_ROOM, surfaces: DEFAULT_SURFACES, items: buildTemplate('l-island', DEFAULT_ROOM, DEFAULT_SURFACES).items }), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (signup && password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      const { user } = signup ? await api.signup(name, email, password) : await api.login(email, password);
      setUser(user);
      navigate({ name: 'home' }, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-hero" aria-hidden>
        <div className="auth-brand">
          <Logo />
          <span className="wordmark">Mise</span>
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

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn primary wide big" type="submit" disabled={busy || offline}>
            {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
          </button>

          <p className="auth-switch">
            {signup ? 'Already have an account? ' : 'New to Mise? '}
            <a href={signup ? '#/signin' : '#/signup'}>{signup ? 'Sign in' : 'Create an account'}</a>
          </p>

          <div className="auth-or">
            <span>or</span>
          </div>
          <a className="btn wide" href="#/local">
            Design on this device without an account
          </a>
        </form>
      </section>
    </div>
  );
}
