import { useEffect, useRef, useState } from 'react';
import { useSession } from '../store/useSession';
import { navigate } from '../lib/router';

interface ShowroomMembership {
  tenantId: string;
  role: 'owner' | 'staff' | null;
}

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
  // On a showroom the server adds `showroom: { tenantId, role }` (docs/handoff/tenancy.md §2).
  const showroom = (user as (typeof user & { showroom?: ShowroomMembership | null }) | null)?.showroom ?? null;
  const signOut = useSession((s) => s.signOut);
  const [open, setOpen] = useState(false);
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
        Sign in<span className="signin-tail"> to save</span>
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
          {/* On a showroom: its team opens the company workspace; nobody there has a plan to bill. */}
          {showroom?.role && (
            <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'studio', rest: '' }))}>
              <b>Company workspace</b>
              <span>{showroom.role === 'owner' ? 'Owner' : 'Staff'}</span>
            </button>
          )}
          {!showroom && (
            <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'billing' }))}>
              <b>Billing</b>
              <span>{user.plan.id === 'free' ? 'Free plan' : `${user.plan.id === 'contractor' ? 'Contractor' : 'Unlimited'} plan`}</span>
            </button>
          )}
          {/* A contractor from before the showroom pivot keeps their workspace on the sales site
              until their plan ends; their earlier model requests are linked from it. */}
          {!showroom && (user.plan.id === 'contractor' || user.contractor) && (
            <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'pro', rest: '' }))}>
              <b>Contractor workspace</b>
              {user.contractor && <span>{user.contractor.company}{user.contractor.active ? '' : ' · plan lapsed'}</span>}
            </button>
          )}
          {(user.role === 'admin' || user.role === 'studio') && (
            <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'admin', tab: user.role === 'admin' ? 'overview' : 'studio' }))}>
              <b>Admin</b>
            </button>
          )}
          <div className="menu-sep" />
          <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'account' }))}>
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
          <div className="menu-legal">
            <a href="#/terms" target="_blank" rel="noopener">
              Terms
            </a>
            <a href="#/privacy" target="_blank" rel="noopener">
              Privacy
            </a>
            <a href="#/refunds" target="_blank" rel="noopener">
              Refunds
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
