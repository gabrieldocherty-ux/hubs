import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { markDown } from '../lib/reachability';
import { navigateHash } from '../lib/router';
import { useSession } from '../store/useSession';

/**
 * Account settings, used by the account menu's dialog and the `#/account` page: name and password,
 * then "Your data": Download my data (`GET /api/account/export`) and Delete my account
 * (`POST /api/account/delete` with the password).
 */
export function AccountSettingsForm({ onClose }: { onClose?: () => void }) {
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState(user.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (name.trim() && name.trim() !== user.name) setUser((await api.updateMe(name.trim())).user);
      if (current || next) {
        await api.changePassword(current, next);
        setCurrent('');
        setNext('');
        setMsg({ tone: 'ok', text: 'Saved. Other devices have been signed out.' });
      } else setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: err instanceof ApiError ? err.message : 'Could not save. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="acct">
      <form onSubmit={save} aria-label="Your details">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="field">
          <span>Email</span>
          <input value={user.email} disabled />
        </label>
        <div className="modal-sep">Change password</div>
        <label className="field">
          <span>Current password</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>
            New password <em>· at least 8 characters</em>
          </span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        {msg && <div className={msg.tone === 'ok' ? 'auth-ok' : 'auth-error'}>{msg.text}</div>}
        <div className="modal-actions">
          {onClose && (
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
      <YourData />
    </div>
  );
}

/** The filename from `Content-Disposition: attachment; filename="…"`, if it is a plain one. */
export function attachmentName(header: string | null, fallback: string): string {
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  const name = m ? decodeURIComponent(m[1]!).replace(/[\\/:*?"<>|]+/g, '-').trim() : '';
  return name || fallback;
}

function YourData() {
  const [state, setState] = useState<'idle' | 'downloading' | 'done' | { error: string }>('idle');
  const [deleting, setDeleting] = useState(false);

  const download = async () => {
    setState('downloading');
    try {
      let res: Response;
      try {
        res = await fetch('/api/account/export', { credentials: 'same-origin' });
      } catch {
        markDown();
        throw new Error('Can’t reach the server. Check your connection and try again.');
      }
      const type = res.headers.get('content-type') || '';
      if (!res.ok) {
        const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
        throw new Error(body?.error || 'Your data couldn’t be prepared. Try again in a minute.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachmentName(res.headers.get('content-disposition'), 'blumodel-studio-my-data.json');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState('done');
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : 'Your data couldn’t be prepared. Try again.' });
    }
  };

  return (
    <section className="acct-data" aria-labelledby="acct-data-title">
      <div className="modal-sep" id="acct-data-title">
        Your data
      </div>
      <p className="acct-copy">
        Download everything your account holds as a file: your details, kitchens, share links, orders and, for contractors, your brand page and leads. See the{' '}
        <a href="#/privacy" target="_blank" rel="noopener">
          Privacy policy
        </a>{' '}
        for what is kept and why.
      </p>
      <div className="acct-actions">
        <button type="button" className="btn" onClick={() => void download()} disabled={state === 'downloading'}>
          {state === 'downloading' ? 'Preparing…' : 'Download my data'}
        </button>
        <button type="button" className="btn acct-danger" onClick={() => setDeleting(true)} aria-expanded={deleting}>
          Delete my account
        </button>
      </div>
      {state === 'done' && (
        <div className="auth-ok" role="status">
          Your data file is downloading.
        </div>
      )}
      {typeof state === 'object' && (
        <div className="auth-error" role="alert">
          {state.error}
        </div>
      )}
      {deleting && <DeleteAccount onCancel={() => setDeleting(false)} />}
    </section>
  );
}

function DeleteAccount({ onCancel }: { onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; billing?: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError({ text: 'Type your password to confirm.' });
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      // The server has signed this browser out (cookie cleared). Forget the session here too.
      useSession.setState({ user: null, status: 'signedOut', projectId: null, conflict: null });
      navigateHash('#/?deleted=1', true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { code?: string } | undefined)?.code === 'active_subscription')
        setError({ text: 'Your paid plan still renews. Cancel it in Billing first (you keep it to the end of the period you paid for), then delete your account.', billing: true });
      else setError({ text: err instanceof ApiError ? err.message : 'Your account couldn’t be deleted. Try again.' });
      setBusy(false);
    }
  };

  return (
    <form className="acct-delete" onSubmit={submit} aria-labelledby="acct-delete-title">
      <h4 id="acct-delete-title">Delete your account?</h4>
      <ul>
        <li>Your kitchens, the photos and files only you uploaded, your share links (they stop working) and any leads you received are deleted, and you are signed out everywhere.</li>
        <li>Records of payments and model orders are kept for accounting, without your name or email.</li>
        <li>If you’re on a paid plan that still renews, cancel it in Billing first.</li>
      </ul>
      <p className="acct-copy">This can’t be undone. Download your data first if you want a copy.</p>
      <label className="field">
        <span>Your password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && (
        <div className="auth-error" role="alert">
          {error.text}
          {error.billing && (
            <>
              {' '}
              <a href="#/account/billing">Go to Billing</a>
            </>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Keep my account
        </button>
        <button type="submit" className="btn acct-danger acct-danger--solid" disabled={busy}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </form>
  );
}
