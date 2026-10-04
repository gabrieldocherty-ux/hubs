import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { ADMIN_TABS, hrefFor, navigate, type AdminTab } from '../lib/router';
import { timeAgo, useSession } from '../store/useSession';
import type { AdminOverview, AdminUser, Role } from '../types/platform';
import { AccountMenu } from '../components/AccountMenu';
import { Logo, Search } from '../components/Icons';
import { AdminBrandsTab, AdminModerationTab } from '../features/brands';
import { AdminRevenueTab, AdminStudioTab } from '../features/orders';

const LABELS: Record<AdminTab, string> = {
  overview: 'Overview',
  moderation: 'Moderation',
  brands: 'Brands',
  studio: 'Studio',
  revenue: 'Revenue',
  users: 'Users',
};

const STUDIO_TABS: AdminTab[] = ['studio'];
const NO_TABS: AdminTab[] = [];

/** Tabs a role may open. The server enforces every rule; this only hides what isn't yours. */
export function adminTabsFor(role: Role | undefined): AdminTab[] {
  if (role === 'admin') return ADMIN_TABS;
  if (role === 'studio') return STUDIO_TABS;
  return NO_TABS;
}

/** `#/admin/:tab`: admins see every tab; the studio role sees only the studio queue. */
export default function AdminScreen({ tab }: { tab: AdminTab }) {
  const user = useSession((s) => s.user);
  const tabs = adminTabsFor(user?.role);
  const allowed = tabs.includes(tab);

  useEffect(() => {
    if (!allowed && tabs.length) navigate({ name: 'admin', tab: tabs[0] }, true);
  }, [allowed, tabs]);

  if (!tabs.length)
    return (
      <div className="screen-msg">
        <p>This area is for Mise staff.</p>
        <a className="btn" href="#/">Back to my kitchens</a>
      </div>
    );

  return (
    <div className="admin">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
          {tabs.map((t) => (
            <a key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'chip on' : 'chip'} href={hrefFor({ name: 'admin', tab: t })}>
              {LABELS[t]}
            </a>
          ))}
        </nav>
        <AccountMenu />
      </header>
      <main className="admin-main">
        {allowed && (
          <Suspense fallback={<div className="screen-msg">Loading…</div>}>
            {tab === 'overview' && <OverviewTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'moderation' && <AdminModerationTab />}
            {tab === 'brands' && <AdminBrandsTab />}
            {tab === 'studio' && <AdminStudioTab />}
            {tab === 'revenue' && <AdminRevenueTab />}
          </Suspense>
        )}
      </main>
    </div>
  );
}

function Counts({ title, counts }: { title: string; counts: Partial<Record<string, number>> | undefined }) {
  const entries = Object.entries(counts ?? {});
  return (
    <section className="admin-card">
      <span className="eyebrow">{title}</span>
      {entries.length === 0 ? (
        <p className="empty-note">None yet.</p>
      ) : (
        <dl className="admin-counts">
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt>{k.replace(/_/g, ' ')}</dt>
              <dd className="mono">{v ?? 0}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function OverviewTab() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .adminOverview()
      .then((d) => live && setData(d))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Could not load the overview.'));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <div className="auth-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading the overview…</div>;
  return (
    <div className="admin-overview">
      <h1>Overview</h1>
      <div className="admin-grid">
        <section className="admin-card">
          <span className="eyebrow">Users</span>
          <b className="admin-big mono">{data.users?.total ?? 0}</b>
          <dl className="admin-counts">
            {Object.entries(data.users?.byRole ?? {}).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="mono">{v ?? 0}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="admin-card">
          <span className="eyebrow">Kitchens</span>
          <b className="admin-big mono">{data.projects?.total ?? 0}</b>
        </section>
        <Counts title="Brands by status" counts={data.brands} />
        <Counts title="Products by status" counts={data.products} />
      </div>
      <section className="admin-card">
        <span className="eyebrow">Latest signups</span>
        {(data.latestUsers ?? []).length === 0 ? (
          <p className="empty-note">No signups yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.latestUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.createdAt ? timeAgo(u.createdAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const ROLES: Role[] = ['customer', 'studio', 'admin'];

function UsersTab() {
  const me = useSession((s) => s.user);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const search = async (query: string) => {
    setError(null);
    try {
      setUsers((await api.adminUsers(query.trim())).users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.');
    }
  };

  useEffect(() => {
    void search('');
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void search(q);
  };

  const setRole = async (u: AdminUser, role: Role) => {
    if (role === u.role) return;
    setSaving(u.id);
    setError(null);
    try {
      const { user } = await api.adminSetRole(u.id, role);
      setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, ...user } : x)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the role.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="admin-users">
      <h1>Users</h1>
      <form className="home-search" onSubmit={submit} role="search">
        <Search />
        <input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <button className="btn" type="submit">Search</button>
      </form>
      {error && <div className="auth-error">{error}</div>}
      {users === null ? (
        <div className="screen-msg">Loading users…</div>
      ) : users.length === 0 ? (
        <p className="empty-note">No users match.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Joined</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.createdAt ? timeAgo(u.createdAt) : '—'}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={saving === u.id || u.id === me?.id}
                    title={u.id === me?.id ? 'You can’t change your own role.' : undefined}
                    onChange={(e) => void setRole(u, e.target.value as Role)}
                    aria-label={`Role for ${u.email}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
