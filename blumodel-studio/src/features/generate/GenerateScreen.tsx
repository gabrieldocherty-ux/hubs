import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { hrefFor, navigate, useHashQuery } from '../../lib/router';
import { prepareDocForSave } from '../../lib/doc';
import { useSession } from '../../store/useSession';
import { loadLocalDraft, saveLocalDraft } from '../../store/useDesignStore';
import { AccountMenu } from '../../components/AccountMenu';
import { Dialog } from '../../components/Dialog';
import { Check, Logo, Wordmark } from '../../components/Icons';
import { buildFromPhotoModel, defaultPhotoModel, photoModelFromDoc, validatePhotoModel, type PhotoModel } from '../../lib/generate/photoModel';
import { uncheckedKeys, type Units } from '../../lib/generate/edit';
import { generateApi } from './api';
import {
  DRAFT_KEY,
  LOCAL_KITCHEN_KEY,
  MAX_PHOTOS,
  PhotoError,
  clearDraft,
  deletePhotos,
  loadDraftState,
  loadPhotos,
  newPhotoId,
  preparePhoto,
  saveDraftState,
  savePhotos,
  type StoredPhoto,
} from './photos';
import { AddPhotos } from './AddPhotos';
import { Lightbox, PhotoCarousel } from './PhotoViewer';
import { SpacePlan } from './SpacePlan';
import { SpaceForm, fieldName } from './SpaceForm';
import { qaPhotos } from './qa';
import './generate.css';

type Step = 'photos' | 'space';
type Photo = StoredPhoto & { url: string };
type Phase = { kind: 'idle' } | { kind: 'preparing' } | { kind: 'uploading'; done: number; total: number } | { kind: 'analysing' } | { kind: 'building' };
interface Notice {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
}

const STEPS = ['Add photos', 'Check the space', 'Build'] as const;
const UNITS_KEY = 'blumodel-units';

function loadUnits(): Units {
  try {
    return localStorage.getItem(UNITS_KEY) === 'cm' ? 'cm' : 'ftin';
  } catch {
    return 'ftin';
  }
}

let llmCache: boolean | null = null;
/** Whether this server can read photos (`/api/config.llm`); null while asking. */
function useLlm(): boolean | null {
  const [llm, setLlm] = useState<boolean | null>(llmCache);
  useEffect(() => {
    if (llmCache !== null) return;
    let live = true;
    api
      .config()
      .then((c) => {
        llmCache = !!c.llm;
        if (live) setLlm(llmCache);
      })
      .catch(() => live && setLlm(false));
    return () => {
      live = false;
    };
  }, []);
  return llm;
}

const withUrl = (p: StoredPhoto): Photo => ({ ...p, url: URL.createObjectURL(p.blob) });
const errText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status !== 0 && err.message ? err.message : fallback);

/** "Start from a photo" (`#/generate`): photos of an existing kitchen → a BluModel Studio kitchen to redesign. */
export default function GenerateScreen({ from }: { q?: string; from?: string }) {
  const status = useSession((s) => s.status);
  const signedIn = status === 'signedIn';
  const llm = useLlm();
  const query = useHashQuery();

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>('photos');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [model, setModel] = useState<PhotoModel>(() => defaultPhotoModel());
  const [source, setSource] = useState<'analysis' | 'manual'>('manual');
  const [analysedIds, setAnalysedIds] = useState('');
  const [name, setName] = useState('');
  const [units, setUnitsState] = useState<Units>(loadUnits);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [pane, setPane] = useState<'photo' | 'plan'>('plan');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const modelRef = useRef(model);
  modelRef.current = model;

  const setUnits = (u: Units) => {
    setUnitsState(u);
    try {
      localStorage.setItem(UNITS_KEY, u);
    } catch {
      // ignore
    }
  };

  // Object URLs live as long as the screen.
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // Start: QA fixtures, a kitchen to re-model (`from`), or the draft in progress.
  useEffect(() => {
    let live = true;
    (async () => {
      // QA only: `qaPhotos` (see qa.ts) and `qaStep=space` start a fresh, known state, ignoring the draft.
      const qaOn = location.search.includes('qa');
      const qa = qaOn ? query.get('qaPhotos') : null;
      const qaStep = qaOn ? query.get('qaStep') : null;
      if (qa || qaStep) {
        const list = qa ? await qaPhotos(qa) : [];
        if (live && list.length) setPhotos(list.map(withUrl));
        if (live && qaStep === 'space') setStep('space');
      } else if (from && signedIn) {
        try {
          const [{ project }, refs] = await Promise.all([api.getProject(from), generateApi.photosOf(from).catch(() => ({ files: [] }))]);
          if (!live) return;
          setModel(photoModelFromDoc(project.doc));
          setName(project.name);
          const got: StoredPhoto[] = [];
          for (const f of refs.files.slice(0, MAX_PHOTOS)) {
            const res = await fetch(f.url, { credentials: 'same-origin' }).catch(() => null);
            if (res?.ok) got.push({ id: newPhotoId(), blob: await res.blob(), name: f.originalName || 'photo.jpg', fileId: f.id });
          }
          if (live) {
            setPhotos(got.map(withUrl));
            setStep('space');
          }
        } catch (err) {
          if (live) setNotice({ tone: 'warn', text: errText(err, 'That kitchen couldn’t be opened, so this starts fresh.') });
        }
      } else {
        const state = loadDraftState();
        const stored = await loadPhotos(DRAFT_KEY);
        if (!live) return;
        if (stored.length) setPhotos(stored.map(withUrl));
        const checked = state ? validatePhotoModel(state.model) : null;
        if (state && checked) {
          setModel(checked.model);
          setSource(state.source);
          setName(state.name);
          setStep(state.step);
        }
        if (stored.length || checked) setRestored(true);
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft, so a reload (or signing up halfway) loses nothing.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => saveDraftState({ step, model, source, name }), 300);
    return () => window.clearTimeout(t);
  }, [ready, step, model, source, name]);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => void savePhotos(DRAFT_KEY, photos), 300);
    return () => window.clearTimeout(t);
  }, [ready, photos]);

  // QA hook (only with ?qa in the page URL).
  useEffect(() => {
    if (!location.search.includes('qa')) return;
    const w = window as unknown as { __blumodelQa?: Record<string, unknown> };
    w.__blumodelQa = { ...(w.__blumodelQa ?? {}), generate: { model: () => modelRef.current, photos: () => photosRef.current.length } };
  }, []);

  const built = useMemo(() => buildFromPhotoModel(model), [model]);
  const toCheck = useMemo(() => uncheckedKeys(model), [model]);
  const notes = useMemo(() => [...new Set([...warnings, ...built.notes])], [warnings, built.notes]);
  const islandLeftOut = !!model.island && !built.doc.items.some((i) => i.productId === 'island');
  const viewer = useMemo(() => photos.map((p) => ({ id: p.id, url: p.url, name: p.name })), [photos]);
  const kitchenName = name.trim() || 'My kitchen';
  const busy = phase.kind !== 'idle';

  // ─── Photos ────────────────────────────────────────────────────────────

  const addFiles = async (files: File[]) => {
    setPhotoError(null);
    const room = MAX_PHOTOS - photosRef.current.length;
    if (files.length > room) setPhotoError(`BluModel Studio uses up to ${MAX_PHOTOS} photos, so ${files.length - room === 1 ? 'one was' : `${files.length - room} were`} left out.`);
    setPhase({ kind: 'preparing' });
    const added: Photo[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        const { blob, name: n } = await preparePhoto(f);
        added.push(withUrl({ id: newPhotoId(), blob, name: n }));
      } catch (err) {
        setPhotoError(err instanceof PhotoError ? err.message : 'That photo couldn’t be read.');
      }
    }
    setPhotos((cur) => [...cur, ...added].slice(0, MAX_PHOTOS));
    setPhase({ kind: 'idle' });
  };

  const removePhoto = (id: string) => {
    setPhotos((cur) => {
      const gone = cur.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((p) => p.id !== id);
    });
    setShown(0);
  };

  const makeMain = (id: string) => setPhotos((cur) => [...cur.filter((p) => p.id === id), ...cur.filter((p) => p.id !== id)]);

  /** Uploads the photos not yet in the account; resolves the full list with file ids. */
  const uploadAll = async (list: Photo[]): Promise<Photo[]> => {
    const out = list.slice();
    const total = out.filter((p) => !p.fileId).length;
    let done = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i].fileId) continue;
      setPhase({ kind: 'uploading', done, total });
      const { file } = await generateApi.uploadPhoto(out[i].blob, out[i].name);
      const id = out[i].id;
      out[i] = { ...out[i], fileId: file.id };
      done++;
      setPhotos((cur) => cur.map((p) => (p.id === id ? { ...p, fileId: file.id } : p)));
    }
    return out;
  };

  const analyse = async (list: Photo[]) => {
    const ids = list.map((p) => p.fileId).filter((x): x is string => !!x);
    if (!ids.length) return;
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'analysing' });
    try {
      const res = await generateApi.analyze(ids, ac.signal);
      const checked = validatePhotoModel(res.model);
      if (!checked) throw new ApiError(502, 'The photo analysis came back in a form BluModel Studio can’t read. Fill in the space by hand.');
      setModel(checked.model);
      setSource('analysis');
      setAnalysedIds(ids.join(','));
      setWarnings([...(res.warnings ?? []), ...checked.warnings]);
      setNotice(null);
    } catch (err) {
      if (ac.signal.aborted) setNotice({ tone: 'warn', text: 'Stopped reading your photos. Fill in the space by hand; your photos are still here to compare.' });
      else setNotice({ tone: 'warn', text: errText(err, 'Photo analysis failed. Fill in the space by hand; your photos are still here to compare.') });
    } finally {
      abort.current = null;
      setPhase({ kind: 'idle' });
    }
  };

  const reanalyse = async () => {
    try {
      await analyse(await uploadAll(photos));
    } catch (err) {
      setPhase({ kind: 'idle' });
      setNotice({ tone: 'warn', text: `Your photos couldn’t be uploaded (${errText(err, 'no connection')}).` });
    }
  };

  const toSpace = async () => {
    setNotice(null);
    setFocusKey(null);
    if (signedIn && photos.length) {
      let list = photos;
      try {
        list = await uploadAll(photos);
      } catch (err) {
        setPhase({ kind: 'idle' });
        setNotice({ tone: 'warn', text: `Your photos couldn’t be uploaded (${errText(err, 'no connection')}). They stay on this device to compare with while you fill in the space.` });
        setStep('space');
        return;
      }
      setStep('space');
      const ids = list.map((p) => p.fileId).join(',');
      if (llm && source !== 'analysis' && ids !== analysedIds) await analyse(list);
      else setPhase({ kind: 'idle' });
      return;
    }
    setStep('space');
  };

  // ─── Build ─────────────────────────────────────────────────────────────

  const build = async (replace = false) => {
    const { doc } = buildFromPhotoModel(model, kitchenName);
    if (!signedIn) {
      if (!replace && loadLocalDraft()) {
        setConfirmReplace(true);
        return;
      }
      setConfirmReplace(false);
      setPhase({ kind: 'building' });
      saveLocalDraft(doc);
      if (photos.length) await savePhotos(LOCAL_KITCHEN_KEY, photos);
      else await deletePhotos(LOCAL_KITCHEN_KEY);
      clearDraft();
      navigate({ name: 'local' });
      return;
    }
    setPhase({ kind: 'building' });
    let list = photos;
    try {
      list = await uploadAll(photos);
    } catch {
      // The kitchen still gets built; the photos just won't come with it.
    }
    setPhase({ kind: 'building' });
    try {
      const { project } = await api.createProject(kitchenName, '', prepareDocForSave(doc));
      const ids = list.map((p) => p.fileId).filter((x): x is string => !!x);
      if (ids.length) await generateApi.attachPhotos(project.id, ids).catch(() => null);
      clearDraft();
      navigate({ name: 'kitchen', id: project.id });
    } catch (err) {
      setPhase({ kind: 'idle' });
      setNotice({ tone: 'bad', text: errText(err, 'The kitchen couldn’t be saved. Check your connection and try again.') });
    }
  };

  const startOver = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setModel(defaultPhotoModel());
    setSource('manual');
    setAnalysedIds('');
    setName('');
    setWarnings([]);
    setNotice(null);
    setRestored(false);
    setStep('photos');
    clearDraft();
  };

  const goToField = useCallback((k: string) => {
    setFocusKey(k);
    const el = document.querySelector<HTMLElement>(`.gen-form [data-key="${k}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, []);

  if (!ready) return <div className="screen-msg">Loading…</div>;

  const stepIndex = phase.kind === 'building' ? 2 : step === 'photos' ? 0 : 1;
  const nextHere = encodeURIComponent(hrefFor({ name: 'generate' }));
  const intro = introFor({ source, signedIn, llm, photos: photos.length, checks: toCheck.length });
  const uploadedIds = photos.map((p) => p.fileId ?? '').join(',');
  const canReanalyse = signedIn && !!llm && photos.length > 0 && !busy && (source !== 'analysis' || uploadedIds !== analysedIds);

  return (
    <div className={`gen gen--${step}`}>
      <header className="home-bar gen-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <ol className="steps" aria-label="Steps">
          {STEPS.map((s, i) => {
            const back = i === 0 && step === 'space' && !busy;
            return (
              <li key={s} className={i === stepIndex ? 'on' : i < stepIndex ? 'done' : ''}>
                <button type="button" onClick={() => back && setStep('photos')} disabled={!back} aria-current={i === stepIndex ? 'step' : undefined}>
                  <span className="dot">{i < stepIndex ? <Check width={12} height={12} /> : i + 1}</span>
                  {s}
                </button>
              </li>
            );
          })}
        </ol>
        <AccountMenu />
      </header>

      {step === 'photos' ? (
        <main className="gen-main gen-main--photos">
          <h1>Start from a photo of your kitchen.</h1>
          <p className="gen-sub">Add photos of the kitchen as it is now. BluModel Studio models the room — its walls, windows and doors, cabinets, appliances, island and look — so you can redesign it.</p>
          {restored && (
            <p className="gen-restored" role="status">
              Picked up where you left off.{' '}
              <button type="button" className="gen-link" onClick={startOver}>
                Start over
              </button>
            </p>
          )}
          <AddPhotos photos={viewer} busy={phase.kind === 'preparing'} error={photoError} onAdd={(f) => void addFiles(f)} onRemove={removePhoto} onMakeMain={makeMain} onOpen={setLightbox} />
          {!signedIn && llm && (
            <div className="gen-account">
              <p>
                <b>Want BluModel Studio to fill in the room for you?</b> With a free account your photos are read for you. Without one, they stay on this device as a reference while you enter the space yourself.
              </p>
              <a className="btn" href={`#/signup?next=${nextHere}`}>
                Create a free account
              </a>
            </div>
          )}
        </main>
      ) : (
        <main className="gen-main gen-main--space">
          <div className="gen-compare">
            {photos.length > 0 && (
              <div className="gen-compare-tabs" role="tablist" aria-label="Show">
                <button type="button" role="tab" aria-selected={pane === 'photo'} className={pane === 'photo' ? 'on' : ''} onClick={() => setPane('photo')}>
                  Photos ({photos.length})
                </button>
                <button type="button" role="tab" aria-selected={pane === 'plan'} className={pane === 'plan' ? 'on' : ''} onClick={() => setPane('plan')}>
                  Plan
                </button>
              </div>
            )}
            {photos.length > 0 && (
              <div className={`gen-pane gen-pane--photo${pane === 'photo' ? ' on' : ''}`}>
                <PhotoCarousel photos={viewer} index={shown} onIndex={setShown} onOpen={setLightbox} fit="contain" caption={(i) => (i === 0 ? 'Photo 1 · faces north' : `Photo ${i + 1}`)} />
              </div>
            )}
            <div className={`gen-pane gen-pane--plan${pane === 'plan' || !photos.length ? ' on' : ''}`}>
              <SpacePlan model={model} doc={built.doc} units={units} focusKey={focusKey} onChange={setModel} onFocusKey={setFocusKey} hasPhotos={photos.length > 0} />
              <p className="gen-plan-help">Drag the labels along a wall to move them.</p>
            </div>
          </div>

          <div className="gen-side">
            <h1>Check the space.</h1>
            <p className={`gen-intro ${intro.tone}`}>{intro.text}</p>
            {!signedIn && llm && (
              <p className="gen-intro-cta">
                <a className="btn" href={`#/signup?next=${nextHere}`}>
                  Create a free account to fill this in from your photos
                </a>
              </p>
            )}
            {notice && (
              <p className={`gen-notice ${notice.tone}`} role={notice.tone === 'bad' ? 'alert' : 'status'}>
                {notice.text}
              </p>
            )}
            {canReanalyse && (
              <button type="button" className="btn gen-reanalyse" onClick={() => void reanalyse()}>
                {source === 'analysis' ? 'Read my photos again (replaces what’s filled in)' : 'Fill this in from my photos'}
              </button>
            )}
            {toCheck.length > 0 && (
              <div className="gen-tocheck">
                <span className="gen-len-label">Check against your photos</span>
                <div className="gen-tocheck-list">
                  {toCheck.map((k) => (
                    <button key={k} type="button" className="chip gen-tocheck-chip" onClick={() => goToField(k)}>
                      {fieldName(model, k)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {notes.length > 0 && (
              <details className="gen-notes">
                <summary>{notes.length === 1 ? 'One thing BluModel Studio adjusted' : `${notes.length} things BluModel Studio adjusted`} to build it with real cabinet sizes</summary>
                <ul>
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            <SpaceForm model={model} onChange={setModel} units={units} onUnits={setUnits} name={name} onName={setName} focusKey={focusKey} onFocusKey={setFocusKey} seenFromPhotos={source === 'analysis'} islandLeftOut={islandLeftOut} />
          </div>
        </main>
      )}

      <footer className="gen-footer">
        {step === 'photos' ? (
          <>
            <a className="btn" href="#/">
              Cancel
            </a>
            <span className="gen-footer-status">{photos.length ? `${photos.length} of ${MAX_PHOTOS} photos` : 'No photos yet'}</span>
            <button type="button" className="btn primary gen-go" onClick={() => void toSpace()} disabled={busy}>
              {photos.length ? 'Continue' : 'Skip photos'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setStep('photos')} disabled={busy}>
              Photos
            </button>
            <span className="gen-footer-status">{toCheck.length ? `${toCheck.length} to check` : `${built.doc.items.length} pieces`}</span>
            <button type="button" className="btn primary gen-go" onClick={() => void build()} disabled={busy}>
              {phase.kind === 'building' ? 'Building…' : 'Build my kitchen'}
            </button>
          </>
        )}
      </footer>

      {(phase.kind === 'uploading' || phase.kind === 'analysing') && (
        <div className="gen-progress" role="status" aria-live="polite">
          <div className="gen-progress-card">
            <div className="gen-spinner" aria-hidden />
            {phase.kind === 'uploading' ? (
              <p>
                Uploading photo {Math.min(phase.done + 1, phase.total)} of {phase.total}…
              </p>
            ) : (
              <>
                <p>
                  <b>Reading your photos…</b>
                </p>
                <p className="gen-hint">This takes up to half a minute.</p>
                <button type="button" className="btn" onClick={() => abort.current?.abort()}>
                  Skip, I’ll fill it in
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {lightbox !== null && photos.length > 0 && <Lightbox photos={viewer} index={Math.min(lightbox, photos.length - 1)} onIndex={setLightbox} onClose={() => setLightbox(null)} />}

      {confirmReplace && (
        <Dialog title="Replace the kitchen on this device?" onClose={() => setConfirmReplace(false)}>
          <p className="gen-dialog-text">Without an account, BluModel Studio keeps one kitchen in this browser. Building this one replaces it. Sign in to keep both.</p>
          <div className="modal-actions">
            <a className="btn" href={`#/signin?next=${nextHere}`}>
              Sign in
            </a>
            <button type="button" className="btn primary" data-autofocus onClick={() => void build(true)}>
              Replace it
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function introFor({ source, signedIn, llm, photos, checks }: { source: 'analysis' | 'manual'; signedIn: boolean; llm: boolean | null; photos: number; checks: number }): Notice {
  if (source === 'analysis')
    return {
      tone: 'ok',
      text: checks ? `Filled in from your photos. Compare it with them: the ${checks === 1 ? 'one thing' : `${checks} things`} marked “Check this” were hard to see.` : 'Filled in from your photos. Compare it with them, then build.',
    };
  if (!photos) return { tone: 'warn', text: 'No photos, so this starts from a typical L-shaped kitchen. Match it to your room; you can add photos any time.' };
  if (signedIn && llm === false) return { tone: 'warn', text: 'Photo analysis isn’t switched on for this server yet, so this starts from a typical L-shaped kitchen. Match it to your photos.' };
  if (!signedIn) return { tone: 'warn', text: 'This starts from a typical L-shaped kitchen. Match it to your photos, which stay on this device.' };
  return { tone: 'warn', text: 'This starts from a typical L-shaped kitchen. Match it to your photos.' };
}
