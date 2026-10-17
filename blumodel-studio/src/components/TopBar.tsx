import { useEffect, useRef, useState } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { useEstimate } from '../store/derived';
import { WallsIcon, CubeIcon, Download, Logo, Wordmark, PlanIcon, Redo, SplitIcon, Undo, Upload, Chevron, Lock } from './Icons';
import { downloadDataUrl, downloadText, exportImage, slug } from '../lib/exporters';
import { feetInches } from '../lib/format';
import type { DesignDoc, ViewMode } from '../types';
import type { ExportKind } from '../types/platform';
import { useSession, timeAgo } from '../store/useSession';
import { AccountMenu } from './AccountMenu';
import { useShowEstimator } from '../lib/prefs';
import { Check } from './Icons';
import { RenderButton } from '../features/viewer';
import { PhotorealButton } from '../features/renders';
import { ShareButton } from '../features/share';
import { requestExport, useEntitlements, useResumeExport, type ExportFile, type ExportRunner } from '../features/billing';
import { openQuote, PresentButton, usePriceBook } from '../features/contractors';
import { shortName, SiteMark, useShowroom } from '../features/showroom';

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
  /** The phone layout: the view switch moves to the bottom bar and Export shrinks to an icon. */
  compact?: boolean;
  /** View mode: no Export menu at all (a contractor's share: an export would save a copy to the visitor's account). */
  hideExport?: boolean;
}

export function TopBar({ mode = 'edit', showPrices = true, projectId = null, compact = false, hideExport = false }: TopBarProps) {
  const view = mode === 'view';
  const name = useDesignStore((s) => s.doc.name);
  const viewMode = useDesignStore((s) => s.ui.viewMode);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const { setName, setUI, undo, redo, toast, importDoc } = useDesignStore.getState();
  const est = useEstimate();
  // The Est. chip is the cost estimator: a setting, off by default (Account settings > Preferences).
  // A shared kitchen (view) follows its link's own price setting.
  const showEstimator = useShowEstimator();
  const signedIn = useSession((s) => s.status === 'signedIn' && !!s.projectId);
  const hasUser = useSession((s) => !!s.user);
  // On a company's showroom the mark is the company's.
  const showroom = useShowroom();
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(name);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(name), [name]);
  useEffect(() => {
    if (!menu) return;
    // pointerdown, not mousedown: a tap on the canvas sends no mouse events on a touch screen.
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const views: [ViewMode, string, JSX.Element][] = [
    ['plan', 'Plan', <PlanIcon key="p" />],
    ['split', 'Split', <SplitIcon key="s" />],
    ['3d', '3D', <CubeIcon key="c" />],
    ['walls', 'Walls', <WallsIcon key="w" />],
  ];

  const exportPng = async (kind: 'plan' | 'scene') => {
    const needs = kind === 'plan' ? viewMode === 'plan' || viewMode === 'split' : viewMode === '3d' || viewMode === 'split';
    if (!needs) {
      setUI({ viewMode: 'split' });
      await new Promise((r) => setTimeout(r, 900));
    }
    const raw = await exportImage(kind);
    if (!raw) return toast('Could not capture that view. Try again in a moment.', 'warn');
    // On a showroom the PNG carries the company's logo, name and contact details (lazy: not in the main chunk).
    const url = showroom ? await import('../features/showroom/downloads').then((m) => m.brandedPng(raw, showroom, name, location.host)).catch(() => raw) : raw;
    downloadDataUrl(url, `${slug(name)}-${kind === 'plan' ? 'floor-plan' : '3d'}.png`);
    toast(kind === 'plan' ? 'Floor plan saved as PNG.' : '3D view saved as PNG.', 'ok');
  };

  // Every export goes through requestExport (free since the showroom pivot): the server records it,
  // and makes the CSV and the project file itself.
  const saveFile = (done: string) => (file?: ExportFile) => {
    if (!file) return;
    downloadText(file.content, file.filename, file.contentType);
    toast(done, 'ok');
  };
  // On a showroom: the product list as a printable page in the company's colours, with its contact details.
  const productList = async () => {
    if (!showroom) return;
    const [{ productListHtml }, planShot] = await Promise.all([import('../features/showroom/downloads'), viewMode === 'plan' || viewMode === 'split' ? exportImage('plan') : Promise.resolve(null)]);
    const doc = useDesignStore.getState().doc;
    const logo = showroom.branding.logoUrl ? new URL(showroom.branding.logoUrl, location.origin).href : null;
    const html = productListHtml({
      tenant: showroom,
      designName: doc.name,
      roomText: `${feetInches(doc.room.widthIn)} × ${feetInches(doc.room.lengthIn)} · ${Math.round((doc.room.widthIn * doc.room.lengthIn) / 144)} sq ft`,
      lines: est.lines.filter((l) => l.productId || l.fixtureId),
      showPrices,
      total: est.lines.filter((l) => l.productId || l.fixtureId).reduce((n, l) => n + l.total, 0),
      logoUrl: logo,
      planImage: planShot,
      host: location.host,
      at: new Date(),
    });
    downloadText(html, `${slug(doc.name)}-product-list.html`, 'text/html');
    toast('Product list saved. Open it to print or save as PDF.', 'ok');
  };
  const runners: Partial<Record<ExportKind, ExportRunner>> = {
    plan_png: () => exportPng('plan'),
    scene_png: () => exportPng('scene'),
    ...(showroom ? { quote: productList } : {}),
    csv: saveFile('Shopping list saved as CSV.'),
    json: saveFile('Project saved. Open it later with Import.'),
  };
  const exportProject = view ? null : projectId;
  const { canExport } = useEntitlements(exportProject);
  const { isContractor } = usePriceBook();
  useResumeExport(exportProject, runners);
  const doExport = (kind: ExportKind) => {
    setMenu(false);
    void requestExport(exportProject, kind, runners[kind]!);
  };
  const lock = canExport ? null : <Lock width={13} height={13} aria-label="Sign in first" />;

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
    <header className={compact ? 'topbar topbar--compact' : 'topbar'}>
      <div className="brand">
        {signedIn ? (
          <a className="back-link" href="#/" title={showroom ? 'Back to my designs' : 'Back to my kitchens'}>
            {showroom ? <SiteMark compact /> : <Logo />}
            <span className="back-label">{showroom ? 'Designs' : 'Kitchens'}</span>
          </a>
        ) : showroom ? (
          <SiteMark />
        ) : (
          <>
            <Logo />
            <Wordmark />
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

      {!compact && (
        <div className="views" role="tablist" aria-label="View">
          {views.map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={viewMode === id} className={viewMode === id ? 'on' : ''} onClick={() => setUI({ viewMode: id })}>
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="actions">
        {view ? (
          <span className="save-chip local" title="You can look around, but not change this kitchen.">View only</span>
        ) : (
          <>
            <SaveStatus />
            <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo width={compact ? 20 : 16} height={compact ? 20 : 16} /></button>
            <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo width={compact ? 20 : 16} height={compact ? 20 : 16} /></button>
          </>
        )}
        {showPrices && (view || showEstimator) && (
          <button className="total-chip" onClick={() => setUI({ rightTab: 'estimate' })} title="Open the estimate">
            <span>Est.</span>
            <b className="mono">{est.total.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</b>
          </button>
        )}
        <RenderButton />
        <PhotorealButton />
        {!view && <ShareButton projectId={projectId} />}
        {!view && <PresentButton compact={compact} />}
        {!(view && hideExport) && (
          <div className="menu-wrap" ref={menuRef}>
            {compact ? (
              <button className="icon-btn export-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Export" title="Export">
                <Download width={20} height={20} />
              </button>
            ) : (
              <button className="btn primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
                <Download /> Export <Chevron width={14} height={14} />
              </button>
            )}
            {menu && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => doExport('plan_png')}>
                  <b>{lock}Floor plan</b><span>PNG, print-ready with dimensions</span>
                </button>
                <button role="menuitem" onClick={() => doExport('scene_png')}>
                  <b>{lock}3D render</b><span>PNG of the current camera</span>
                </button>
                {showroom && (
                  <button role="menuitem" onClick={() => doExport('quote')}>
                    <b>{lock}Product list</b><span>Printable, with {shortName(showroom)}’s details</span>
                  </button>
                )}
                {showPrices && (
                  <button role="menuitem" onClick={() => doExport('csv')}>
                    <b>{lock}Shopping list</b><span>CSV with every product and surface</span>
                  </button>
                )}
                {!view && (
                  <>
                    <button role="menuitem" onClick={() => doExport('json')}>
                      <b>{lock}Project file</b><span>.kitchen.json to share or reopen</span>
                    </button>
                    {isContractor && projectId && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(false);
                          void openQuote(projectId);
                        }}
                      >
                        <b>Quote</b><span>Branded and printable, at your prices</span>
                      </button>
                    )}
                    {!canExport && (
                      <p className="menu-note">
                        <Lock width={12} height={12} /> Downloads are free. Sign in and save this kitchen to your account to download it.
                      </p>
                    )}
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
        )}
        {(!view || hasUser) && <AccountMenu />}
      </div>
    </header>
  );
}
