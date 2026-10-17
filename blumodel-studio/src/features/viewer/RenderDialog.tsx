/**
 * The Studio render dialog (BUILD_PLAN A-T8, §13.3 A; PRODUCT_SPEC §5.5; PLANS_AND_CONTRACTORS §3).
 *
 *  - Options: camera (current / overview / eye level / elevation), size (1080p / 1440p / 4K, the
 *    long side capped at min(4096, the GPU's limits)), quality (High / Fast) and colour (Neutral /
 *    AgX). Remembered on this device.
 *  - The 3D view renders the still offscreen at the exact target size (roomStill.ts); the result
 *    doesn't depend on the canvas on screen, so split view gives the same image as 3D view. If
 *    the 3D view isn't showing, the dialog switches to it first.
 *  - The preview is a scaled copy. Downloading is an export: it goes through
 *    `requestExport(projectId, 'render', …)`, which the server records. Since the showroom pivot
 *    (docs/SHOWROOM_PIVOT.md §3) downloads are free for the kitchen's owner and nothing carries a
 *    watermark.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '../../components/Dialog';
import { Download } from '../../components/Icons';
import { isCompact } from '../../components/MobileState';
import { slug } from '../../lib/exporters';
import { QA } from '../../lib/qa';
import { useDesignStore } from '../../store/useDesignStore';
import { requestExport } from '../billing';
import { STUDIO_SIZES, capSize, renderFilename, stillOptionsFor, useStudioPrefs, waitForStillRenderer, type StudioCamera, type StudioPrefs } from './studio';
import { closeStudioRender, useStudio } from './studioDialog';
import { previewSize } from './preview';
import './viewer.css';

interface Rendered {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** The size asked for, when the GPU's limit made it smaller. */
  cappedFrom: { width: number; height: number } | null;
  /** The prefs it was rendered with (a change makes it stale). */
  key: string;
  ms: number;
}

const CAMERAS: [StudioCamera, string][] = [
  ['current', 'Current view'],
  ['overview', 'Overview'],
  ['eye', 'Eye level'],
  ['front', 'Elevation'],
];

const toast = (text: string, tone: 'ok' | 'warn' | 'info' = 'warn') => useDesignStore.getState().toast(text, tone);

function qaStudio(values: Record<string, unknown>) {
  if (!QA) return;
  const w = window as unknown as { __blumodelQa?: Record<string, unknown> };
  const prev = (w.__blumodelQa?.studio as Record<string, unknown> | undefined) ?? {};
  // In place: the canvas stats on this object are live getters (qaStats.tsx) that a copy would freeze.
  w.__blumodelQa = Object.assign(w.__blumodelQa ?? {}, { studio: { ...prev, ...values } });
}

/** Shows the 3D view if it isn't on screen (split view on a desktop, 3D on a phone). */
function ensure3d() {
  const s = useDesignStore.getState();
  const mode = s.ui.viewMode;
  const compact = isCompact();
  const showing = mode === '3d' || (mode === 'split' && !compact);
  if (!showing) s.setUI({ viewMode: compact ? '3d' : 'split' });
}

/** Lets the browser paint (the "Rendering…" state) before the render holds the main thread. */
const nextPaint = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => setTimeout(r, 0));
    setTimeout(r, 120);
  });

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser couldn’t make the PNG.'))), 'image/png'));
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <div className="studio-opt">
      <span className="studio-opt-label">{label}</span>
      <div className="seg studio-seg" role="radiogroup" aria-label={label}>
        {options.map(([id, text, title]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} title={title} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RenderDialog({ projectId }: { projectId: string | null }) {
  const prefs = useStudioPrefs((s) => s.prefs);
  const setPrefs = useStudioPrefs((s) => s.setPrefs);
  const name = useDesignStore((s) => s.doc.name);
  const [status, setStatus] = useState<'idle' | 'preparing' | 'rendering' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<Rendered | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const prefsKey = JSON.stringify(prefs);
  const stale = !!result && result.key !== prefsKey;
  const busy = status === 'preparing' || status === 'rendering';

  const render = async (): Promise<Rendered | null> => {
    if (running.current) return null;
    running.current = true;
    const p: StudioPrefs = useStudioPrefs.getState().prefs;
    const o = stillOptionsFor(p);
    setError('');
    setStatus('preparing');
    try {
      ensure3d();
      const reg = await waitForStillRenderer(12_000);
      if (!reg) throw new Error('The 3D view didn’t open in time. Switch to 3D, then try again.');
      setStatus('rendering');
      await nextPaint();
      const t0 = performance.now();
      const canvas = await reg.render(o);
      const cap = capSize(o.width, o.height, reg.maxSide);
      const r: Rendered = {
        canvas,
        width: canvas.width,
        height: canvas.height,
        cappedFrom: cap.capped ? { width: o.width, height: o.height } : null,
        key: JSON.stringify(p),
        ms: Math.round(performance.now() - t0),
      };
      if (!alive.current) return null;
      setResult(r);
      setStatus('done');
      qaStudio({ rendered: { width: r.width, height: r.height, ms: r.ms, camera: o.camera, quality: o.quality, toneMap: o.toneMap } });
      return r;
    } catch (e) {
      if (!alive.current) return null;
      setError(e instanceof Error ? e.message : 'The render didn’t work. Try again.');
      setStatus('error');
      return null;
    } finally {
      running.current = false;
    }
  };

  const download = async (r: Rendered | null = result) => {
    if (!r || saving) return;
    useStudio.setState({ autoDownload: false });
    setSaving(true);
    try {
      await requestExport(projectId, 'render', async () => {
        const blob = await toBlob(r.canvas);
        const filename = renderFilename(slug(useDesignStore.getState().doc.name), r.width, r.height);
        saveBlob(blob, filename);
        qaStudio({ downloaded: { filename, width: r.width, height: r.height, bytes: blob.size, watermarked: false } });
        toast(`Studio render saved: ${r.width} × ${r.height} PNG.`, 'ok');
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That download didn’t work. Try again.');
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  // Render once on open with the remembered options; after an unlock, download it too.
  useEffect(() => {
    void (async () => {
      const r = await render();
      if (r && useStudio.getState().autoDownload) await download(r);
    })();
  }, []);

  // The preview: a scaled copy of the render. Downloads are free since the showroom pivot, so no watermark.
  useEffect(() => {
    if (!result) return;
    const s = previewSize(result.width, result.height, 1600);
    const c = document.createElement('canvas');
    c.width = s.width;
    c.height = s.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(result.canvas, 0, 0, s.width, s.height);
    setPreview(c.toDataURL('image/jpeg', 0.9));
    qaStudio({ preview: { width: s.width, height: s.height, watermarked: false } });
  }, [result]);

  const sizeOf = STUDIO_SIZES.find((s) => s.id === prefs.size) ?? STUDIO_SIZES[0];

  const body = (
    <Dialog title="Studio render" onClose={closeStudioRender} wide className="studio-dialog">
      <figure
        className={`studio-preview${busy ? ' is-busy' : ''}${stale ? ' is-stale' : ''}`}
        data-state={status}
        data-width={result?.width ?? 0}
        data-height={result?.height ?? 0}
        data-watermark={result ? '0' : ''}
      >
        {preview && <img src={preview} alt={`Studio render of ${name}`} />}
        {!preview && !busy && status !== 'error' && <span className="studio-preview-note">Your render shows up here.</span>}
        {busy && (
          <span className="studio-preview-note studio-preview-busy" role="status">
            <span className="studio-spinner" aria-hidden="true" />
            {status === 'preparing' ? 'Opening the 3D view…' : `Rendering ${sizeOf.width} × ${sizeOf.height}…`}
          </span>
        )}
        {status === 'error' && (
          <span className="studio-preview-note studio-preview-error" role="alert">
            {error}
          </span>
        )}
      </figure>

      <div className="studio-meta">
        {result && !busy && (
          <span>
            {result.width} × {result.height} px · {(result.ms / 1000).toFixed(1)} s
            {result.cappedFrom && ` · this device tops out at ${Math.max(result.width, result.height)} px, so ${result.cappedFrom.width} × ${result.cappedFrom.height} was scaled down`}
          </span>
        )}
        {stale && !busy && <span className="studio-stale">Options changed: render again to see them.</span>}
      </div>

      <div className="studio-opts">
        <Seg label="Camera" value={prefs.camera} options={CAMERAS} onChange={(camera) => setPrefs({ camera })} />
        <Seg
          label="Size"
          value={prefs.size}
          options={STUDIO_SIZES.map((s) => [s.id, s.label, `${s.width} × ${s.height}`] as [typeof s.id, string, string])}
          onChange={(size) => setPrefs({ size })}
        />
        <Seg
          label="Quality"
          value={prefs.quality}
          options={[
            ['high', 'High', 'Full-resolution ambient occlusion and 8× antialiasing (4× at 4K)'],
            ['fast', 'Fast', 'The on-screen look, quicker'],
          ]}
          onChange={(quality) => setPrefs({ quality })}
        />
        <Seg
          label="Colour"
          value={prefs.toneMap}
          options={[
            ['neutral', 'Neutral', 'True-to-swatch colours (Khronos PBR Neutral)'],
            ['agx', 'AgX', 'Softer highlights, slightly muted colours'],
          ]}
          onChange={(toneMap) => setPrefs({ toneMap })}
        />
      </div>


      <div className="modal-actions studio-actions">
        <button type="button" className="btn" onClick={() => void render()} disabled={busy}>
          {result ? 'Render again' : 'Render'}
        </button>
        <button type="button" className="btn primary" onClick={() => void download()} disabled={!result || busy || stale || saving}>
          <Download width={15} height={15} aria-hidden="true" />
          {saving ? 'Saving…' : 'Download PNG'}
        </button>
      </div>
    </Dialog>
  );

  // Portalled: the TopBar is its own stacking context, and the dialog must cover the whole editor.
  return createPortal(body, document.body);
}
