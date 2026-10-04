import { useMemo, useState } from 'react';
import type { Room } from '../types';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { TEMPLATES, type TemplateId } from '../data/templates';
import { STYLE_PRESETS, type StylePreset } from '../data/styles';
import { composeDoc } from '../data/compose';
import { DEFAULT_ROOM } from '../data/defaults';
import { prepareDocForSave } from '../lib/doc';
import { MiniPlan } from '../components/MiniPlan';
import { PresetStrip } from '../components/PresetStrip';
import { FeetInchesInput } from '../components/FeetInchesInput';
import { AccountMenu } from '../components/AccountMenu';
import { Check, Logo } from '../components/Icons';
import { feetInches } from '../lib/format';

const STEPS = ['Basics', 'Room', 'Layout', 'Style'] as const;

const SIZES: { label: string; room: Room }[] = [
  { label: 'Compact · 10′ × 10′', room: { widthIn: 120, lengthIn: 120, ceilingIn: 96 } },
  { label: 'Standard · 12′ × 14′', room: { widthIn: 168, lengthIn: 144, ceilingIn: 108 } },
  { label: 'Spacious · 16′8″ × 13′', room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 } },
  { label: 'Open plan · 20′ × 16′', room: { widthIn: 240, lengthIn: 192, ceilingIn: 120 } },
];

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [room, setRoom] = useState<Room>(DEFAULT_ROOM);
  const [templateId, setTemplateId] = useState<TemplateId | null>('l-island');
  const [preset, setPreset] = useState<StylePreset | null>(STYLE_PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fits = (t: (typeof TEMPLATES)[number]) => room.widthIn >= t.minWidth && room.lengthIn >= t.minLength;
  const layoutOk = templateId === null || fits(TEMPLATES.find((t) => t.id === templateId)!);
  const kitchenName = name.trim() || 'My Kitchen';

  const layoutPreviews = useMemo(() => TEMPLATES.map((t) => ({ t, doc: composeDoc('', room, fits(t) ? t.id : null, preset) })), [room, preset]);
  const preview = useMemo(() => composeDoc(kitchenName, room, layoutOk ? templateId : null, preset), [kitchenName, room, templateId, preset, layoutOk]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject(kitchenName, client.trim(), prepareDocForSave(preview));
      navigate({ name: 'kitchen', id: project.id }, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the kitchen. Try again.');
      setBusy(false);
    }
  };

  const canNext = step !== 2 || layoutOk;

  return (
    <div className="wizard">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <span className="wordmark">Mise</span>
        </a>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <button onClick={() => i < step && setStep(i)} disabled={i > step}>
                <span className="dot">{i < step ? <Check width={12} height={12} /> : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>
        <AccountMenu />
      </header>

      <main className="wizard-main">
        <section className="wizard-form">
          {step === 0 && (
            <>
              <h1>Let’s set up a new kitchen.</h1>
              <p className="wizard-sub">Give it a name you’ll recognise on your projects page.</p>
              <label className="field">
                <span>Kitchen name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maple Street Remodel" autoFocus maxLength={120} />
              </label>
              <label className="field">
                <span>Who it’s for <em>· optional</em></span>
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client or household" maxLength={120} />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h1>How big is the room?</h1>
              <p className="wizard-sub">Measure wall to wall. You can fine-tune this any time.</p>
              <div className="size-picks">
                {SIZES.map((s) => (
                  <button key={s.label} className={s.room.widthIn === room.widthIn && s.room.lengthIn === room.lengthIn ? 'chip on' : 'chip'} onClick={() => setRoom(s.room)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="dims">
                <FeetInchesInput label="Width (E–W)" valueIn={room.widthIn} min={72} max={480} onCommit={(v) => setRoom({ ...room, widthIn: v })} />
                <FeetInchesInput label="Length (N–S)" valueIn={room.lengthIn} min={72} max={480} onCommit={(v) => setRoom({ ...room, lengthIn: v })} />
                <FeetInchesInput label="Ceiling" valueIn={room.ceilingIn} min={90} max={144} onCommit={(v) => setRoom({ ...room, ceilingIn: v })} />
              </div>
              <p className="wizard-note mono">{Math.round((room.widthIn * room.lengthIn) / 144)} sq ft</p>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Pick a starting layout.</h1>
              <p className="wizard-sub">Filled with real cabinet sizes for a {feetInches(room.widthIn)} × {feetInches(room.lengthIn)} room.</p>
              <div className="layout-picks">
                {layoutPreviews.map(({ t, doc }) => {
                  const ok = fits(t);
                  return (
                    <button key={t.id} className={templateId === t.id ? 'layout-pick on' : 'layout-pick'} disabled={!ok} onClick={() => setTemplateId(t.id)}>
                      <MiniPlan doc={doc} />
                      <b>{t.name}</b>
                      <span>{ok ? t.blurb : `Needs ${Math.ceil(t.minWidth / 12)}′ × ${Math.ceil(t.minLength / 12)}′`}</span>
                    </button>
                  );
                })}
                <button className={templateId === null ? 'layout-pick on' : 'layout-pick'} onClick={() => setTemplateId(null)}>
                  <MiniPlan doc={{ name: '', room, surfaces: preview.surfaces, items: [] }} />
                  <b>Blank room</b>
                  <span>Start from scratch and drag everything in.</span>
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1>Choose a style.</h1>
              <p className="wizard-sub">Sets cabinets, counters, tile, floor and paint together. Change any of it later.</p>
              <div className="presets wide">
                {STYLE_PRESETS.map((p) => (
                  <button key={p.id} className={preset?.id === p.id ? 'preset on' : 'preset'} onClick={() => setPreset(p)}>
                    <PresetStrip preset={p} />
                    <b>{p.name}</b>
                    <small>{p.blurb}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <div className="auth-error">{error}</div>}

          <div className="wizard-nav">
            {step > 0 ? (
              <button className="btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
            ) : (
              <a className="btn" href="#/">
                Cancel
              </a>
            )}
            {step < STEPS.length - 1 ? (
              <button className="btn primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continue
              </button>
            ) : (
              <button className="btn primary" onClick={create} disabled={busy}>
                {busy ? 'Creating…' : 'Create kitchen'}
              </button>
            )}
          </div>
        </section>

        <aside className="wizard-preview" aria-label="Preview">
          <div className="wizard-card">
            <MiniPlan doc={preview} />
            <div className="wizard-card-meta">
              <b>{kitchenName}</b>
              <span>
                {client.trim() ? `${client.trim()} · ` : ''}
                {feetInches(room.widthIn)} × {feetInches(room.lengthIn)} · {preview.items.length} pieces
              </span>
              {preset && <span className="muted">{preset.name}</span>}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
