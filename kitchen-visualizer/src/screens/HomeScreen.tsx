import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Project } from '../lib/api';
import { navigate } from '../lib/router';
import { greeting, timeAgo, useSession } from '../store/useSession';
import { useDesignStore } from '../store/useDesignStore';
import { useCatalog, useCatalogVersion } from '../store/useCatalog';
import { MiniPlan } from '../components/MiniPlan';
import { AccountMenu } from '../components/AccountMenu';
import { Copy, Logo, Plus, Search, Trash } from '../components/Icons';
import { buildEstimate } from '../lib/estimate';
import { feetInches, money } from '../lib/format';
import { Toasts } from '../components/Toasts';

export function HomeScreen() {
  const user = useSession((s) => s.user)!;
  const toast = useDesignStore((s) => s.toast);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const catalogVersion = useCatalogVersion();

  const load = async () => {
    try {
      const list = (await api.listProjects()).projects;
      // Snapshots let the cards draw and price server products that aren't in the catalog any more.
      for (const p of list) if (p.doc?.products) useCatalog.getState().registerSnapshots(p.doc.products);
      setProjects(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your kitchens.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? []).filter((p) => !q || `${p.name} ${p.client}`.toLowerCase().includes(q));
  }, [projects, query]);

  const totals = useMemo(() => new Map((projects ?? []).map((p) => [p.id, buildEstimate(p.doc).total])), [projects, catalogVersion]);

  const rename = async (p: Project, name: string) => {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === p.name) return;
    try {
      const { project } = await api.saveProject(p.id, { name: clean, force: true });
      setProjects((list) => list?.map((x) => (x.id === p.id ? project : x)) ?? null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Rename failed.', 'warn');
    }
  };

  const duplicate = async (p: Project) => {
    try {
      const { project } = await api.duplicateProject(p.id);
      setProjects((list) => [project, ...(list ?? [])]);
      toast(`Duplicated “${p.name}”.`, 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Duplicate failed.', 'warn');
    }
  };

  const remove = async (p: Project) => {
    setConfirmDelete(null);
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
      toast(`Deleted “${p.name}”.`, 'ok');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Delete failed.', 'warn');
    }
  };

  return (
    <div className="home">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <AccountMenu />
      </header>

      <main className="home-main">
        <div className="home-head">
          <div>
            <h1>{greeting(user.name)}.</h1>
            <p>
              {projects === null
                ? 'Loading your kitchens…'
                : projects.length === 0
                  ? 'Let’s design your first kitchen.'
                  : `${projects.length} kitchen${projects.length > 1 ? 's' : ''} in progress. Pick up where you left off.`}
            </p>
          </div>
          <div className="home-cta">
            <button className="btn big" onClick={() => navigate({ name: 'generate' })}>
              Describe your kitchen
            </button>
            <button className="btn primary big" onClick={() => navigate({ name: 'new' })}>
              <Plus /> New kitchen
            </button>
          </div>
        </div>

        {projects && projects.length > 3 && (
          <div className="home-search">
            <Search />
            <input placeholder="Search kitchens or clients" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search kitchens" />
          </div>
        )}

        {error && (
          <div className="auth-error">
            {error} <button className="link-btn" onClick={load}>Try again</button>
          </div>
        )}

        <div className="project-grid">
          <button className="project-card new" onClick={() => navigate({ name: 'new' })}>
            <span className="new-plus">
              <Plus width={22} height={22} />
            </span>
            <b>Start a new kitchen</b>
            <span>Room size, layout and style in four quick steps</span>
          </button>

          {shown.map((p) => (
            <article key={p.id} className="project-card">
              <a className="project-thumb" href={`#/k/${p.id}`} aria-label={`Open ${p.name}`}>
                <MiniPlan doc={p.doc} />
              </a>
              <div className="project-body">
                {renaming === p.id ? (
                  <input
                    className="project-rename"
                    defaultValue={p.name}
                    autoFocus
                    onBlur={(e) => rename(p, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    aria-label="Kitchen name"
                  />
                ) : (
                  <a className="project-name" href={`#/k/${p.id}`} onDoubleClick={(e) => (e.preventDefault(), setRenaming(p.id))}>
                    {p.name}
                  </a>
                )}
                <span className="project-meta">
                  {p.client ? `${p.client} · ` : ''}
                  {feetInches(p.doc.room.widthIn)} × {feetInches(p.doc.room.lengthIn)} · {p.doc.items.length} pieces
                </span>
                <span className="project-foot">
                  <span>Edited {timeAgo(p.updatedAt)}</span>
                  <b className="mono">{money(totals.get(p.id) ?? 0)}</b>
                </span>
              </div>
              <div className="project-actions">
                <button onClick={() => setRenaming(p.id)}>Rename</button>
                <button onClick={() => duplicate(p)} aria-label={`Duplicate ${p.name}`}>
                  <Copy width={14} height={14} />
                </button>
                {confirmDelete === p.id ? (
                  <button className="danger solid" onClick={() => remove(p)}>
                    Delete?
                  </button>
                ) : (
                  <button className="danger" onClick={() => setConfirmDelete(p.id)} aria-label={`Delete ${p.name}`}>
                    <Trash width={14} height={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {projects && query && shown.length === 0 && <p className="empty-note">No kitchens match “{query}”.</p>}
      </main>
      <Toasts />
    </div>
  );
}
