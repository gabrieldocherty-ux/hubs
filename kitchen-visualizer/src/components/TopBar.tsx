import { useEffect, useRef, useState } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { useEstimate } from '../store/derived';
import { WallsIcon, CubeIcon, Download, Logo, PlanIcon, Redo, SplitIcon, Undo, Upload, Chevron } from './Icons';
import { downloadDataUrl, downloadText, exportImage, slug } from '../lib/exporters';
import { estimateCsv } from '../lib/csv';
import { prepareDocForSave } from '../lib/doc';
import type { DesignDoc, ViewMode } from '../types';
import { useSession, timeAgo } from '../store/useSession';
import { AccountMenu } from './AccountMenu';
import { Check } from './Icons';
import { RenderButton } from '../features/viewer';
import { ShareButton } from '../features/share';

function SaveStatus() {
  const projectId = useSession((s) => s.projectId);
  const state = useSession((s) => s.saveState);
  const lastSavedAt = useSession((s) => s.lastSavedAt);
  const conflict = useSession((s) => s.conflict);
  const setConflict = useSession((s) => s.setConflict);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!projectId) return <span className="save-chip local" title="Saved in this browser only. Sign in to keep it in your account.">On this device</span>;
  if (state === 'conflict')
    return (
      <button className="save-chip error" onClick={() => conflict && setConflict({ ...conflict, open: true })} title="This kitchen was changed elsewhere. Choose which version to keep.">
        Not saved · changed elsewhere
      </button>
    );
  const label =
    state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes' : state === 'error' ? 'Offline, retrying' : lastSavedAt ? `Saved ${timeAgo(lastSavedAt)}` : 'Saved';
  return (
    <span className={`save-chip ${state}`} role="status" aria-live="polite" title="Your work saves automatically. Ctrl+S saves now.">
      {state === 'saved' && <Check width={13} height={13} />}
      {label}
    </span>
  );
}

function isDoc(v: unknown): v is DesignDoc {
  const d = v as DesignDoc;
  return !!d && typeof d === 'object' && !!d.room && typeof d.room.widthIn === 'number' && Array.isArray(d.items) && !!d.surfaces;
}

export interface TopBarProps {
  /** `'view'`: no renaming, undo, import or save status; exports limited to images (and CSV with prices). */
  mode?: 'edit' | 'view';
  showPrices?: boolean;
  /** The saved project, for the Share slot; null in device-only and view mode. */
  projectId?: string | null;
}

export function TopBar({ mode = 'edit', showPrices = true, projectId = null }: TopBarProps) {
  const view = mode === 'view';
  const name = useDesignStore((s) => s.doc.name);
  const viewMode = useDesignStore((s) => s.ui.viewMode);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const { setName, setUI, undo, redo, toast, importDoc } = useDesignStore.getState();
  const est = useEstimate();
  const signedIn = useSession((s) => s.status === 'signedIn' && !!s.projectId);
  const hasUser = useSession((s) => !!s.user);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(name);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(name), [name]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const views: [ViewMode, string, JSX.Element][] = [
    ['plan', 'Plan', <PlanIcon key="p" />],
    ['split', 'Split', <SplitIcon key="s" />],
    ['3d', '3D', <CubeIcon key="c" />],
    ['walls', 'Walls', <WallsIcon key="w" />],
  ];

  const exportPng = async (kind: 'plan' | 'scene') => {
    setMenu(false);
    const needs = kind === 'plan' ? viewMode === 'plan' || viewMode === 'split' : viewMode === '3d' || viewMode === 'split';
    if (!needs) {
      setUI({ viewMode: 'split' });
      await new Promise((r) => setTimeout(r, 900));
    }
    const url = await exportImage(kind);
    if (!url) return toast('Could not capture that view. Try again in a moment.', 'warn');
    downloadDataUrl(url, `${slug(name)}-${kind === 'plan' ? 'floor-plan' : '3d'}.png`);
    toast(kind === 'plan' ? 'Floor plan saved as PNG.' : '3D view saved as PNG.', 'ok');
  };

  const onImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const doc = parsed.doc ?? parsed;
      if (!isDoc(doc)) throw new Error('bad');
      // Every item is kept: unknown products become placeholders (and snapshots in the file restore them).
      importDoc(doc);
      toast(`Opened “${doc.name}”.`, 'ok');
    } catch {
      toast('That file is not a kitchen project.', 'warn');
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        {signedIn ? (
          <a className="back-link" href="#/" title="Back to my kitchens">
            <Logo />
            <span className="back-label">Kitchens</span>
          </a>
        ) : (
          <>
            <Logo />
            <span className="wordmark">Mise</span>
          </>
        )}
        <span className="divider" />
        {view ? (
          <span className="project-name project-name--static" title={name}>
            {name}
          </span>
        ) : (
          <input
            className="project-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => (draft.trim() && draft !== name ? setName(draft.trim()) : setDraft(name))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Project name"
            spellCheck={false}
          />
        )}
      </div>

      <div className="views" role="tablist" aria-label="View">
        {views.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={viewMode === id} className={viewMode === id ? 'on' : ''} onClick={() => setUI({ viewMode: id })}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="actions">
        {view ? (
          <span className="save-chip local" title="You can look around, but not change this kitchen.">View only</span>
        ) : (
          <>
            <SaveStatus />
            <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo /></button>
            <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo /></button>
          </>
        )}
        {showPrices && (
          <button className="total-chip" onClick={() => setUI({ rightTab: 'estimate' })} title="Open the estimate">
            <span>Est.</span>
            <b className="mono">{est.total.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</b>
          </button>
        )}
        <RenderButton />
        {!view && <ShareButton projectId={projectId} />}
        <div className="menu-wrap" ref={menuRef}>
          <button className="btn primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Download /> Export <Chevron width={14} height={14} />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => exportPng('plan')}>
                <b>Floor plan</b><span>PNG, print-ready with dimensions</span>
              </button>
              <button role="menuitem" onClick={() => exportPng('scene')}>
                <b>3D render</b><span>PNG of the current camera</span>
              </button>
              {showPrices && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    downloadText(estimateCsv(useDesignStore.getState().doc, est), `${slug(name)}-shopping-list.csv`, 'text/csv');
                  }}
                >
                  <b>Shopping list</b><span>CSV with every product and surface</span>
                </button>
              )}
              {!view && (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      const doc = prepareDocForSave(useDesignStore.getState().doc);
                      downloadText(JSON.stringify({ app: 'mise-kitchen', version: 2, doc }, null, 2), `${slug(name)}.kitchen.json`, 'application/json');
                      toast('Project saved. Open it later with Import.', 'ok');
                    }}
                  >
                    <b>Project file</b><span>.kitchen.json to share or reopen</span>
                  </button>
                  <div className="menu-sep" />
                  <button role="menuitem" onClick={() => fileRef.current?.click()}>
                    <b><Upload width={14} height={14} /> Import project…</b><span>Open a .kitchen.json</span>
                  </button>
                </>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
              setMenu(false);
            }}
          />
        </div>
        {(!view || hasUser) && <AccountMenu />}
      </div>
    </header>
  );
}
