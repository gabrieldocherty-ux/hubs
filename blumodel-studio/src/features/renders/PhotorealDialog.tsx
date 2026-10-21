/**
 * "Make it photoreal" (docs/SHOWROOM_PIVOT.md §5, §7): captures the current 3D view, sends it with
 * a description of the design, and shows the AI rendering when it comes back, with this design's
 * earlier renders underneath. Lazy: loaded on the first click of PhotorealButton.
 *
 *  - The team sees the cost and the showroom's balance; a visitor sees how many are left today.
 *  - Not set up yet (no ARCHITECT_AI_URL / KEY on the server): "Photoreal renders are being set
 *    up", the button is off, and nothing is charged (the server refuses too).
 *  - The credits are reserved when the render starts and charged only when it works; a failed
 *    render says its credits were returned.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '../../components/Dialog';
import { Download, Trash } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { QA } from '../../lib/qa';
import { slug } from '../../lib/exporters';
import { useDesignStore } from '../../store/useDesignStore';
import { rendersApi, type RenderWire, type RendersStatus } from './api';
import { captureView } from './capture';
import { closePhotoreal } from './PhotorealButton';
import { SETTING_UP, cents, freeLine, plural, reasonCopy, rendersLeft, when } from './model';
import { qaOverrideStatus } from './qa';
import './renders.css';

type Phase = 'idle' | 'capturing' | 'sending' | 'rendering' | 'done' | 'failed';

const POLL_MS = 1500;
const POLL_FOR_MS = 6 * 60_000;

function qaRenders(values: Record<string, unknown>) {
  if (!QA) return;
  const w = window as unknown as { __blumodelQa?: Record<string, unknown> };
  const prev = (w.__blumodelQa?.renders as Record<string, unknown> | undefined) ?? {};
  w.__blumodelQa = Object.assign(w.__blumodelQa ?? {}, { renders: { ...prev, ...values } });
}

const filename = (r: RenderWire) => `${slug(r.designName) || 'design'}-photoreal-${new Date(r.createdAt).toISOString().slice(0, 10)}.png`;

export default function PhotorealDialog({ projectId, shareToken, team }: { projectId: string | null; shareToken: string | null; team: boolean }) {
  const name = useDesignStore((s) => s.doc.name);
  const [status, setStatus] = useState<RendersStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [current, setCurrent] = useState<RenderWire | null>(null);
  const [gallery, setGallery] = useState<RenderWire[]>([]);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const loadStatus = useCallback(async () => {
    try {
      const s = qaOverrideStatus(await rendersApi.status());
      if (!alive.current) return;
      setStatus(s);
      setLoadError('');
      qaRenders({ status: { configured: s.configured, canRender: s.canRender, reason: s.reason, demo: s.demo } });
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error ? e.message : 'Couldn’t reach the server.');
    }
  }, []);

  const loadGallery = useCallback(async () => {
    try {
      const r = await rendersApi.list(projectId ? { projectId } : shareToken ? { shareToken } : {});
      if (!alive.current) return;
      setGallery(r.renders);
      setCurrent((c) => c ?? r.renders.find((x) => x.status === 'done' || x.status === 'refunded') ?? null);
      qaRenders({ gallery: r.renders.length });
    } catch {
      /* the gallery is a nicety; the status line says if the server is away */
    }
  }, [projectId, shareToken]);

  useEffect(() => {
    void loadStatus();
    void loadGallery();
  }, [loadStatus, loadGallery]);

  const busy = phase === 'capturing' || phase === 'sending' || phase === 'rendering';

  const poll = async (id: string) => {
    const t0 = Date.now();
    while (alive.current && Date.now() - t0 < POLL_FOR_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!alive.current) return;
      let r: RenderWire;
      try {
        r = (await rendersApi.get(id)).render;
      } catch {
        continue; // a blip: keep asking
      }
      if (r.status === 'pending') continue;
      setCurrent(r);
      setPhase(r.status === 'failed' ? 'failed' : 'done');
      if (r.status === 'failed') setError(r.error ?? 'The render didn’t work. Your credits were returned.');
      qaRenders({ finished: { id: r.id, status: r.status, width: r.width, height: r.height, demo: r.demo } });
      void loadGallery();
      void loadStatus();
      return;
    }
    if (alive.current) {
      setPhase('failed');
      setError('The render is taking longer than usual. It will appear under this design when it’s ready.');
    }
  };

  const start = async () => {
    if (busy || !status?.canRender) return;
    setError('');
    setCurrent(null);
    setPhase('capturing');
    try {
      const shot = await captureView({ maxBytes: (status.maxImageMb || 6) * 1024 * 1024 - 1024 });
      if (!alive.current) return;
      setPreview(shot.previewUrl);
      qaRenders({ captured: { width: shot.width, height: shot.height, bytes: shot.bytes, type: shot.type, products: shot.scene.products.length } });
      setPhase('sending');
      const { render } = await rendersApi.start({ ...(projectId ? { projectId } : { shareToken: shareToken ?? undefined }), image: shot.image, scene: shot.scene });
      if (!alive.current) return;
      setPhase('rendering');
      qaRenders({ started: { id: render.id } });
      void loadStatus();
      await poll(render.id);
    } catch (e) {
      if (!alive.current) return;
      setPhase('failed');
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'The render didn’t start. Nothing was charged.');
      void loadStatus();
    }
  };

  const remove = async (r: RenderWire) => {
    try {
      await rendersApi.hide(r.id);
      if (current?.id === r.id) setCurrent(null);
      setGallery((g) => g.filter((x) => x.id !== r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    }
  };

  const shown = current && (current.status === 'done' || current.status === 'refunded') ? current : null;
  const note = status ? reasonCopy(status.reason, status) : null;
  const notConfigured = status?.reason === 'not_configured';

  const costLine = (() => {
    if (!status || notConfigured) return null;
    // While the account has free renders, the next one is free whoever asks.
    const free = freeLine(status.free);
    if (free) return free;
    if (status.balanceCents != null) {
      const left = rendersLeft(status.balanceCents, status.costCents);
      return `One render uses ${cents(status.costCents)} of credits · ${cents(status.balanceCents)} left (${plural(left, 'render')}).`;
    }
    if (status.visitor.enabled) return `${plural(status.visitor.left, 'photoreal render')} left today on this showroom.`;
    return null;
  })();

  const body = (
    <Dialog title="Make it photoreal" onClose={closePhotoreal} wide className="photoreal-dialog">
      <figure className={`photoreal-stage${busy ? ' is-busy' : ''}`} data-phase={phase} data-render={shown?.id ?? ''} data-demo={shown?.demo ? '1' : '0'}>
        {shown?.imageUrl && <img src={shown.imageUrl} alt={`Photoreal rendering of ${shown.designName || name}`} />}
        {!shown && preview && <img src={preview} alt="The captured 3D view" className="photoreal-capture" />}
        {!shown && !preview && !busy && (
          <span className="photoreal-note">
            {notConfigured ? (
              <>
                <b>{SETTING_UP}.</b>
                <br />
                You’ll be able to turn this view into a photoreal image here soon. Nothing is charged until then.
              </>
            ) : (
              'Frame the 3D view the way you like it, then make it photoreal.'
            )}
          </span>
        )}
        {busy && (
          <span className="photoreal-note photoreal-busy" role="status">
            <span className="photoreal-spinner" aria-hidden="true" />
            {phase === 'capturing' ? 'Capturing the 3D view…' : phase === 'sending' ? 'Sending it to the renderer…' : 'Rendering… this can take a minute.'}
          </span>
        )}
        {shown?.demo && <span className="photoreal-demo-tag">Demo render: the AI isn’t connected on this server</span>}
      </figure>

      {phase === 'failed' && error && (
        <p className="photoreal-error" role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <p className="photoreal-error" role="alert">
          {loadError}
        </p>
      )}

      <div className="photoreal-meta">
        {/* "Being set up" is said once: in the stage when it has nothing else to show, else here. */}
        {note && !(notConfigured && !shown && !preview && !busy) ? <span className={notConfigured ? 'photoreal-setup' : 'photoreal-why'}>{note}</span> : !note && costLine && <span>{costLine}</span>}
        {shown && (
          <span className="photoreal-made">
            {when(shown.createdAt)}
            {shown.width && shown.height ? ` · ${shown.width} × ${shown.height}` : ''}
            {team && shown.byName ? ` · ${shown.byName}` : ''}
          </span>
        )}
      </div>

      <div className="modal-actions photoreal-actions">
        {shown?.imageUrl && (
          <a className="btn" href={shown.imageUrl} download={filename(shown)}>
            <Download width={15} height={15} aria-hidden="true" />
            Download
          </a>
        )}
        <button type="button" className="btn primary" onClick={() => void start()} disabled={!status?.canRender || busy} data-autofocus>
          {busy ? 'Rendering…' : notConfigured ? 'Coming soon' : shown ? 'Render again' : 'Make it photoreal'}
        </button>
      </div>

      {gallery.length > 0 && (
        <section className="photoreal-gallery" aria-label="Renders of this design">
          <h4>Renders of this design</h4>
          <ul>
            {gallery.map((r) => (
              <li key={r.id} className={current?.id === r.id ? 'is-on' : ''}>
                <button type="button" className="photoreal-thumb" onClick={() => setCurrent(r)} disabled={r.status === 'pending'} aria-label={`Show the render from ${when(r.createdAt)}`} aria-pressed={current?.id === r.id}>
                  {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" /> : <span className={`photoreal-thumb-state is-${r.status}`}>{r.status === 'pending' ? 'Rendering…' : 'Didn’t work'}</span>}
                </button>
                {/* Just the time: the narrow caption cut "· demo" to "· de…"; a demo render says so on the large view. */}
                <span className="photoreal-thumb-meta" title={r.demo ? `${when(r.createdAt)} · demo render` : undefined}>
                  {when(r.createdAt)}
                </span>
                {r.status !== 'pending' && (r.mine || team) && (
                  <button type="button" className="icon-btn photoreal-remove" onClick={() => void remove(r)} aria-label={`Remove the render from ${when(r.createdAt)}`} title="Remove from this design">
                    <Trash width={15} height={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );

  // Portalled: the TopBar is its own stacking context, and the dialog must cover the whole editor.
  return createPortal(body, document.body);
}
