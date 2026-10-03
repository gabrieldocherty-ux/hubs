import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '../store/useSession';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { Close } from './Icons';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function AccountMenu() {
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (!user) {
    return (
      <a className="btn" href="#/signin">
        Sign in to save
      </a>
    );
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account">
        {initials(user.name)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-who">
            <b>{user.name}</b>
            <span>{user.email}</span>
          </div>
          <div className="menu-sep" />
          <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'home' }))}>
            <b>My kitchens</b>
          </button>
          <button role="menuitem" onClick={() => (setOpen(false), setSettings(true))}>
            <b>Account settings</b>
          </button>
          <div className="menu-sep" />
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate({ name: 'signin' }, true);
            }}
          >
            <b>Sign out</b>
          </button>
        </div>
      )}
      {settings && <AccountSettings onClose={() => setSettings(false)} />}
    </div>
  );
}

function AccountSettings({ onClose }: { onClose: () => void }) {
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState(user.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="acct-title">
        <header>
          <h3 id="acct-title">Account settings</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
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
          <span>New password <em>· at least 8 characters</em></span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        {msg && <div className={msg.tone === 'ok' ? 'auth-ok' : 'auth-error'}>{msg.text}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
