import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '../../../store/useCatalog';
import { useDesignStore } from '../../../store/useDesignStore';
import { splitHash } from '../../../lib/router';
import { QA } from '../../../lib/qa';
import { waitForStillRenderer } from '../../viewer/studio';
import { useShowroom } from '../useShowroom';
import { featuredLines, showroomLines } from '../lines';
import { shortName } from '../site';
import { showroomScenes, type CameraView, type Scene, type Shot } from './scenes';
import { imagesApi, type ImageTarget } from './api';
import './images.css';

const SceneView = lazy(() => import('../../../components/three/SceneView').then((m) => ({ default: m.SceneView })));

type Row = { id: string; label: string; state: 'waiting' | 'rendering' | 'done' | 'skipped' | 'failed'; note?: string; previews: string[] };
type Phase = 'checking' | 'denied' | 'ready' | 'running' | 'done';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((r) => c.toBlob(r, type, q));
}

/** WebP when the browser can make it (every current one but old Safari), else JPEG. */
async function encode(c: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(c, 'image/webp', 0.82);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob(c, 'image/jpeg', 0.86);
  if (!jpeg) throw new Error('This browser couldn’t save the picture.');
  return jpeg;
}

/**
 * `#/showroom-images` on a showroom: makes the showroom's pictures (the landing page's hero, one
 * per product line and a gallery of finished kitchens) with the app's own 3D renderer, in this
 * browser, and uploads each one. Opened by the company's team (workspace, Showroom tab) or by an
 * admin from Admin > Companies with a ticket (`?ticket=`), so the server never renders anything:
 * it works the same on any computer the showroom runs on. `?auto=1` starts at once (the demo's
 * script, scripts/make-showroom-images.mjs).
 */
export default function ShowroomImagesPage() {
  const t = useShowroom();
  const { query } = splitHash(location.hash);
  const ticket = query.get('ticket') || undefined;
  const auto = query.get('auto') === '1';
  const products = useCatalog((s) => s.products);
  const status = useCatalog((s) => s.status);
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    void useCatalog.getState().load();
    imagesApi
      .access(ticket)
      .then(() => setPhase('ready'))
      .catch((e: Error) => {
        setError(e.message);
        setPhase('denied');
      });
  }, [ticket]);

  const lines = useMemo(() => showroomLines(products), [products]);
  const scenes = useMemo<Scene[]>(() => (t && lines.length ? showroomScenes(lines, featuredLines(lines, t.branding.featuredLines), { keepBasics: t.features.fillGaps }) : []), [lines, t]);

  useEffect(() => {
    setRows(scenes.map((s) => ({ id: s.id, label: s.label, state: s.problems.length ? 'skipped' : 'waiting', note: s.problems.length ? `Layout problem: ${s.problems[0]}` : undefined, previews: [] })));
  }, [scenes]);

  const patchRow = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p, previews: p.previews ? [...r.previews, ...p.previews] : r.previews } : r)));

  /** Loads a scene into the 3D view and renders one shot of it. */
  const renderShot = useCallback(async (scene: Scene, shot: Pick<Shot, 'width' | 'height'> & { view: CameraView }) => {
    const store = useDesignStore.getState();
    if (store.doc !== scene.doc) {
      store.loadDoc(scene.doc);
      store.select(null);
      await nextFrame();
      await nextFrame();
    }
    const reg = await waitForStillRenderer(20_000);
    if (!reg) throw new Error('The 3D view didn’t start. Try another browser, or a computer with a graphics card.');
    return reg.render({ width: shot.width, height: shot.height, camera: 'current', quality: 'high', toneMap: 'neutral', view: shot.view });
  }, []);

  const run = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setPhase('running');
    setError(null);
    let made = 0;
    let failed = 0;
    for (const scene of scenes) {
      if (scene.problems.length) continue;
      setCurrent(scene.label);
      patchRow(scene.id, { state: 'rendering' });
      try {
        for (const shot of scene.shots) {
          const canvas = await renderShot(scene, shot);
          const blob = await encode(canvas);
          const target: ImageTarget = { slot: shot.slot, source: 'render', ...(shot.line ? { line: shot.line } : {}), ...(shot.index ? { index: shot.index, title: shot.title ?? '' } : {}) };
          await imagesApi.upload(blob, target, ticket);
          const thumb = document.createElement('canvas');
          const k = 320 / canvas.width;
          thumb.width = 320;
          thumb.height = Math.round(canvas.height * k);
          thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
          patchRow(scene.id, { previews: [thumb.toDataURL('image/jpeg', 0.8)] });
          made++;
        }
        patchRow(scene.id, { state: 'done' });
      } catch (e) {
        failed++;
        patchRow(scene.id, { state: 'failed', note: e instanceof Error ? e.message : 'It didn’t render.' });
      }
    }
    setCurrent(null);
    setPhase('done');
    // An admin's Quick setup follows this run by its ticket: tell it the pictures are made.
    if (ticket) void imagesApi.done(ticket, made, failed).catch(() => undefined);
    (window as unknown as { __showroomImages?: Record<string, unknown> }).__showroomImages = { ...((window as unknown as { __showroomImages?: object }).__showroomImages ?? {}), done: true, made, failed };
  }, [scenes, ticket, renderShot]);

  // QA and the demo's script: the scenes, and a way to try a camera without uploading.
  useEffect(() => {
    const w = window as unknown as { __showroomImages?: Record<string, unknown> };
    w.__showroomImages = {
      ...(w.__showroomImages ?? {}),
      scenes: scenes.map((s) => ({ id: s.id, label: s.label, problems: s.problems, shots: s.shots.map((x) => ({ slot: x.slot, line: x.line, index: x.index, width: x.width, height: x.height, view: x.view })), doc: s.doc })),
      ...(QA
        ? {
            preview: async (id: string, i = 0, view?: CameraView, size?: { width: number; height: number }) => {
              const s = scenes.find((x) => x.id === id);
              if (!s) throw new Error(`no scene ${id}`);
              const shot = s.shots[i];
              const c = await renderShot(s, { width: size?.width ?? shot.width, height: size?.height ?? shot.height, view: view ?? shot.view });
              return c.toDataURL('image/webp', 0.86);
            },
          }
        : {}),
    };
  }, [scenes, renderShot]);

  const ready = phase === 'ready' && status === 'ready' && scenes.length > 0;
  useEffect(() => {
    if (auto && ready) void run();
  }, [auto, ready, run]);

  if (!t) return <div className="screen-msg">Loading…</div>;
  const name = shortName(t);
  const done = rows.filter((r) => r.state === 'done').length;

  return (
    <div className="sri-page" data-state={phase} data-scenes={scenes.length}>
      <header className="sri-head">
        <h1>Showroom pictures for {name}</h1>
        <p>
          Renders a finished kitchen for the top of the showroom, one picture per product line and a gallery of sample kitchens, all made with {name}’s own products by this
          app’s 3D renderer, in this browser. Each picture is uploaded as soon as it is made. Photos the team uploaded in the workspace stay in front of these.
        </p>
      </header>

      {phase === 'denied' && (
        <p className="sri-msg sri-msg--bad" role="alert">
          {error}
        </p>
      )}
      {phase !== 'denied' && status === 'ready' && !scenes.length && <p className="sri-msg">This showroom has no products yet, so there is nothing to render.</p>}

      {phase !== 'denied' && scenes.length > 0 && (
        <>
          <div className="sri-actions">
            <button className="btn primary big" onClick={() => void run()} disabled={!ready}>
              {phase === 'running' ? 'Making the pictures…' : phase === 'done' ? 'Done' : `Make ${scenes.reduce((n, s) => n + (s.problems.length ? 0 : s.shots.length), 0)} pictures`}
            </button>
            <p role="status" aria-live="polite">
              {phase === 'running' ? `Rendering ${current ?? ''}… keep this tab open.` : phase === 'done' ? `${done} of ${rows.length} finished. The showroom shows them now.` : 'It takes a minute or two. Keep this tab in front while it runs.'}
            </p>
          </div>
          <div className="sri-body">
            <div className="sri-stage" aria-hidden>
              <Suspense fallback={null}>{(phase === 'running' || QA) && <SceneView />}</Suspense>
            </div>
            <ol className="sri-list">
              {rows.map((r) => (
                <li key={r.id} data-state={r.state}>
                  <b>{r.label}</b>
                  <span className="sri-state">{{ waiting: 'Waiting', rendering: 'Rendering…', done: 'Uploaded', skipped: 'Skipped', failed: 'Failed' }[r.state]}</span>
                  {r.note && <span className="sri-note">{r.note}</span>}
                  {r.previews.length > 0 && (
                    <span className="sri-previews">
                      {r.previews.map((src, i) => (
                        <img key={i} src={src} alt="" />
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
          {t.url && (
            <p className="sri-foot">
              <a className="btn" href={`${t.url}/#/welcome`}>
                Open the showroom
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
