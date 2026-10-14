import { useState, type ReactNode } from 'react';
import { APPLIANCE_KINDS, APPLIANCE_WIDTHS, FINISH_CHOICES, LIMITS, closestFinish } from '../../../server/llm/photoModel.mjs';
import { CABINET_FINISHES, COUNTERTOPS, BACKSPLASHES, FLOORING, HARDWARE, PAINTS } from '../../data/finishes';
import {
  SEED_LAYOUTS,
  layoutOf,
  rescaleModel,
  seedLayout,
  wallLen,
  type ApplianceKind,
  type CabinetDoor,
  type PhotoModel,
  type PhotoWall,
} from '../../lib/generate/photoModel';
import {
  addAppliance,
  addOpening,
  addRun,
  confirmField,
  formatLength,
  needsCheck,
  removeItem,
  setIsland,
  setRoom,
  setStyle,
  updateItem,
  type Units,
} from '../../lib/generate/edit';
import { Plus, Trash } from '../../components/Icons';
import { KIND_LABEL } from './SpacePlan';
import { LenInput, RoomLen, Swatches, WALL_NAMES, WallSelect } from './inputs';

const DOORS: { id: CabinetDoor; name: string }[] = [
  { id: 'shaker', name: 'Shaker' },
  { id: 'slab', name: 'Slab' },
  { id: 'fluted', name: 'Fluted' },
  { id: 'glass', name: 'Glass uppers' },
];

const from = (wall: PhotoWall | 'island') => (wall === 'island' ? 'from the island’s west end' : wall === 'north' || wall === 'south' ? 'from the west end' : 'from the north end');

/** Human names for the confidence keys ("Check this" list). */
export function fieldName(model: PhotoModel, key: string): string {
  const [head, n] = key.split('.');
  const i = Number(n);
  if (head === 'room') return 'Room size';
  if (head === 'island') return 'Island';
  if (head === 'style') return 'Colours and finishes';
  if (head === 'runs' && model.runs[i]) return `Cabinets, ${model.runs[i].wall} wall`;
  if (head === 'appliances' && model.appliances[i]) return KIND_LABEL[model.appliances[i].kind];
  if (head === 'openings' && model.openings[i]) return `${model.openings[i].type === 'window' ? 'Window' : 'Door'}, ${model.openings[i].wall} wall`;
  return key;
}

function CheckBadge({ model, k, onChange }: { model: PhotoModel; k: string; onChange: (m: PhotoModel) => void }) {
  if (!needsCheck(model, k)) return null;
  return (
    <span className="gen-check">
      <span className="gen-check-label">Check this</span>
      <button type="button" className="gen-check-ok" onClick={() => onChange(confirmField(model, k))}>
        Looks right
      </button>
    </span>
  );
}

function Section({ title, k, model, onChange, children, hint, id }: { title: string; k?: string; model: PhotoModel; onChange: (m: PhotoModel) => void; children: ReactNode; hint?: ReactNode; id: string }) {
  const flagged = k ? needsCheck(model, k) : false;
  return (
    <section className={`gen-sec${flagged ? ' needs-check' : ''}`} id={id} data-key={k}>
      <header className="gen-sec-head">
        <h2>{title}</h2>
        {k && <CheckBadge model={model} k={k} onChange={onChange} />}
      </header>
      {hint && <p className="gen-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Row({ k, model, onChange, focusKey, onFocusKey, children, onRemove, removeLabel }: { k: string; model: PhotoModel; onChange: (m: PhotoModel) => void; focusKey: string | null; onFocusKey: (k: string | null) => void; children: ReactNode; onRemove: () => void; removeLabel: string }) {
  const flagged = needsCheck(model, k);
  return (
    <div className={`gen-row${flagged ? ' needs-check' : ''}${focusKey === k ? ' on' : ''}`} data-key={k} onFocus={() => onFocusKey(k)}>
      <div className="gen-row-fields">{children}</div>
      <div className="gen-row-side">
        <CheckBadge model={model} k={k} onChange={onChange} />
        <button type="button" className="icon-btn gen-remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <Trash />
        </button>
      </div>
    </div>
  );
}

export interface SpaceFormProps {
  model: PhotoModel;
  onChange: (m: PhotoModel) => void;
  units: Units;
  onUnits: (u: Units) => void;
  name: string;
  onName: (n: string) => void;
  focusKey: string | null;
  onFocusKey: (k: string | null) => void;
  /** The analyser's cabinet colour, when it saw one. */
  seenFromPhotos: boolean;
  /** The model has an island but the built kitchen doesn't (no room for walkways). */
  islandLeftOut?: boolean;
}

/** The editable form on "Check the space". */
export function SpaceForm({ model, onChange, units, onUnits, name, onName, focusKey, onFocusKey, seenFromPhotos, islandLeftOut = false }: SpaceFormProps) {
  const [tapeWall, setTapeWall] = useState<PhotoWall>('north');
  const [tapeIn, setTapeIn] = useState<number | null>(null);
  const [scaled, setScaled] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; model: PhotoModel } | null>(null);
  const room = model.room;
  const layout = layoutOf(model);
  const cab = closestFinish(FINISH_CHOICES.cabinet, model.style.cabinetHex);
  const tapeValue = tapeIn ?? wallLen(tapeWall, room);
  const len = (w: PhotoWall | 'island') => (w === 'island' ? (model.island?.widthIn ?? 0) : wallLen(w, room));

  const change = (m: PhotoModel) => {
    setUndo(null);
    onChange(m);
  };

  return (
    <div className="gen-form">
      <div className="gen-units" role="radiogroup" aria-label="Units">
        <span className="gen-len-label">Units</span>
        {(['ftin', 'cm'] as Units[]).map((u) => (
          <button key={u} type="button" role="radio" aria-checked={units === u} className={units === u ? 'chip on' : 'chip'} onClick={() => onUnits(u)}>
            {u === 'ftin' ? 'ft · in' : 'cm'}
          </button>
        ))}
      </div>

      <section className="gen-tape" id="gen-sec-tape" aria-labelledby="gen-tape-title">
        <div className="gen-tape-icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="10" rx="2" />
            <path d="M6 7v4M10 7v3M14 7v4M18 7v3" />
          </svg>
        </div>
        <div className="gen-tape-body">
          <h2 id="gen-tape-title">Measure one wall with a tape and enter it — the rest is scaled from it.</h2>
          <div className="gen-tape-row">
            <WallSelect label="Wall you measured" value={tapeWall} onChange={(w: PhotoWall) => (setTapeWall(w), setTapeIn(null))} />
            <LenInput label="Its length" valueIn={tapeValue} min={LIMITS.room.widthIn[0]} max={LIMITS.room.widthIn[1]} units={units} onCommit={setTapeIn} />
            <button
              type="button"
              className="btn primary gen-tape-go"
              disabled={tapeIn === null || Math.abs(tapeIn - wallLen(tapeWall, room)) < 0.5}
              onClick={() => {
                change(confirmField(rescaleModel(model, tapeWall, tapeValue), 'room'));
                setScaled(`Scaled to a ${formatLength(tapeValue, units)} ${tapeWall} wall.`);
                setTapeIn(null);
              }}
            >
              Scale
            </button>
          </div>
          {scaled && (
            <p className="gen-hint ok" role="status">
              {scaled}
            </p>
          )}
        </div>
      </section>

      <Section id="gen-sec-room" title="Room" k="room" model={model} onChange={change} hint="Wall to wall. North is the wall your first photo faces.">
        <div className="gen-dims">
          <RoomLen label="Width (W–E)" valueIn={room.widthIn} min={LIMITS.room.widthIn[0]} max={LIMITS.room.widthIn[1]} units={units} onCommit={(v) => change(setRoom(model, { widthIn: v }))} />
          <RoomLen label="Length (N–S)" valueIn={room.lengthIn} min={LIMITS.room.lengthIn[0]} max={LIMITS.room.lengthIn[1]} units={units} onCommit={(v) => change(setRoom(model, { lengthIn: v }))} />
          <RoomLen label="Ceiling" valueIn={room.ceilingIn} min={LIMITS.room.ceilingIn[0]} max={LIMITS.room.ceilingIn[1]} units={units} onCommit={(v) => change(setRoom(model, { ceilingIn: v }))} />
        </div>
      </Section>

      <Section id="gen-sec-layout" title="Layout" model={model} onChange={change} hint="Picking one lays out typical cabinet runs and appliances; adjust them below.">
        <div className="gen-chips" role="radiogroup" aria-label="Layout">
          {SEED_LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={layout === l.id}
              className={layout === l.id ? 'chip on' : 'chip'}
              onClick={() => {
                if (layout === l.id) return;
                const before = model;
                onChange(seedLayout(l.id, model));
                setUndo({ label: `Switched to ${l.name}.`, model: before });
              }}
            >
              {l.name}
            </button>
          ))}
        </div>
        {undo && (
          <p className="gen-hint" role="status">
            {undo.label}{' '}
            <button type="button" className="gen-link" onClick={() => (onChange(undo.model), setUndo(null))}>
              Undo
            </button>
          </p>
        )}
      </Section>

      <Section id="gen-sec-runs" title="Cabinet runs" model={model} onChange={change} hint="Each stretch of base cabinets along a wall.">
        {model.runs.map((r, i) => (
          <Row key={i} k={`runs.${i}`} model={model} onChange={change} focusKey={focusKey} onFocusKey={onFocusKey} onRemove={() => change(removeItem(model, 'runs', i))} removeLabel={`Remove the run on the ${r.wall} wall`}>
            <WallSelect label="Wall" value={r.wall} onChange={(w: PhotoWall) => change(updateItem(model, 'runs', i, { wall: w }))} />
            <LenInput label={`Starts ${from(r.wall)}`} valueIn={r.startIn} min={0} max={len(r.wall)} units={units} onCommit={(v) => change(updateItem(model, 'runs', i, { startIn: v }))} />
            <LenInput label="Ends at" valueIn={r.endIn} min={0} max={len(r.wall)} units={units} onCommit={(v) => change(updateItem(model, 'runs', i, { endIn: v }))} />
            <label className="gen-check-field">
              <input type="checkbox" checked={r.upper} onChange={(e) => change(updateItem(model, 'runs', i, { upper: e.target.checked }))} />
              Wall cabinets above
            </label>
          </Row>
        ))}
        {model.runs.length < LIMITS.maxRuns && (
          <button type="button" className="btn gen-add" onClick={() => change(addRun(model))}>
            <Plus /> Add a run
          </button>
        )}
      </Section>

      <Section id="gen-sec-appliances" title="Appliances" model={model} onChange={change} hint="Or drag them along their wall on the plan.">
        {model.appliances.map((a, i) => (
          <Row key={i} k={`appliances.${i}`} model={model} onChange={change} focusKey={focusKey} onFocusKey={onFocusKey} onRemove={() => change(removeItem(model, 'appliances', i))} removeLabel={`Remove the ${KIND_LABEL[a.kind].toLowerCase()}`}>
            <label className="gen-select">
              <span className="gen-len-label">Appliance</span>
              <select value={a.kind} onChange={(e) => change(updateItem(model, 'appliances', i, { kind: e.target.value as ApplianceKind }))}>
                {(APPLIANCE_KINDS as ApplianceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <WallSelect<PhotoWall | 'island'> label="Where" value={a.wall} island={!!model.island} onChange={(w) => change(updateItem(model, 'appliances', i, { wall: w }))} />
            <LenInput label={`At, ${from(a.wall)}`} valueIn={a.offsetIn} min={0} max={Math.max(0, len(a.wall) - (a.widthIn ?? 0))} units={units} onCommit={(v) => change(updateItem(model, 'appliances', i, { offsetIn: v }))} />
            <LenInput label="Width" valueIn={a.widthIn ?? APPLIANCE_WIDTHS[a.kind].def} min={APPLIANCE_WIDTHS[a.kind].min} max={APPLIANCE_WIDTHS[a.kind].max} units={units} onCommit={(v) => change(updateItem(model, 'appliances', i, { widthIn: v }))} />
          </Row>
        ))}
        {model.appliances.length < LIMITS.maxAppliances && (
          <label className="gen-select gen-add-select">
            <span className="gen-sr">Add an appliance</span>
            <select
              value=""
              onChange={(e) => {
                const kind = e.target.value as ApplianceKind;
                if (kind) change(addAppliance(model, kind));
              }}
            >
              <option value="">+ Add an appliance…</option>
              {(APPLIANCE_KINDS as ApplianceKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        )}
      </Section>

      <Section id="gen-sec-openings" title="Windows and doors" model={model} onChange={change}>
        {model.openings.map((o, i) => (
          <Row key={i} k={`openings.${i}`} model={model} onChange={change} focusKey={focusKey} onFocusKey={onFocusKey} onRemove={() => change(removeItem(model, 'openings', i))} removeLabel={`Remove the ${o.type} on the ${o.wall} wall`}>
            <label className="gen-select">
              <span className="gen-len-label">Type</span>
              <select value={o.type} onChange={(e) => change(updateItem(model, 'openings', i, e.target.value === 'window' ? { type: 'window', sillIn: o.sillIn ?? 42, heightIn: 42 } : { type: 'door', heightIn: 80 }))}>
                <option value="window">Window</option>
                <option value="door">Door</option>
              </select>
            </label>
            <WallSelect label="Wall" value={o.wall} onChange={(w: PhotoWall) => change(updateItem(model, 'openings', i, { wall: w }))} />
            <LenInput label={`At, ${from(o.wall)}`} valueIn={o.offsetIn} min={0} max={Math.max(0, len(o.wall) - o.widthIn)} units={units} onCommit={(v) => change(updateItem(model, 'openings', i, { offsetIn: v }))} />
            <LenInput label="Width" valueIn={o.widthIn} min={(o.type === 'window' ? LIMITS.window : LIMITS.door).widthIn[0]} max={(o.type === 'window' ? LIMITS.window : LIMITS.door).widthIn[1]} units={units} onCommit={(v) => change(updateItem(model, 'openings', i, { widthIn: v }))} />
            {o.type === 'window' && <LenInput label="Sill height" valueIn={o.sillIn ?? 42} min={LIMITS.window.sillIn[0]} max={LIMITS.window.sillIn[1]} units={units} onCommit={(v) => change(updateItem(model, 'openings', i, { sillIn: v }))} />}
          </Row>
        ))}
        {model.openings.length < LIMITS.maxOpenings && (
          <div className="gen-add-row">
            <button type="button" className="btn gen-add" onClick={() => change(addOpening(model, 'window'))}>
              <Plus /> Window
            </button>
            <button type="button" className="btn gen-add" onClick={() => change(addOpening(model, 'door'))}>
              <Plus /> Door
            </button>
          </div>
        )}
      </Section>

      <Section id="gen-sec-island" title="Island" k="island" model={model} onChange={change}>
        <label className="gen-check-field">
          <input type="checkbox" checked={!!model.island} onChange={(e) => change(setIsland(model, e.target.checked ? { widthIn: 84, depthIn: 42, seats: 3, pendants: true } : null))} />
          There’s an island
        </label>
        {model.island && (
          <div className="gen-row-fields gen-island">
            <LenInput label="Length" valueIn={model.island.widthIn} min={LIMITS.island.widthIn[0]} max={LIMITS.island.widthIn[1]} units={units} onCommit={(v) => change(setIsland(model, { ...model.island!, widthIn: v }))} />
            <LenInput label="Depth" valueIn={model.island.depthIn} min={LIMITS.island.depthIn[0]} max={LIMITS.island.depthIn[1]} units={units} onCommit={(v) => change(setIsland(model, { ...model.island!, depthIn: v }))} />
            <div className="gen-len">
              <span className="gen-len-label" id="gen-seats">
                Seats
              </span>
              <div className="gen-stepper" role="group" aria-labelledby="gen-seats">
                <button type="button" className="fi-step" aria-label="Fewer seats" disabled={model.island.seats <= 0} onClick={() => change(setIsland(model, { ...model.island!, seats: model.island!.seats - 1 }))}>
                  −
                </button>
                <span className="mono" aria-live="polite">
                  {model.island.seats}
                </span>
                <button type="button" className="fi-step" aria-label="More seats" disabled={model.island.seats >= LIMITS.island.seats[1]} onClick={() => change(setIsland(model, { ...model.island!, seats: model.island!.seats + 1 }))}>
                  +
                </button>
              </div>
            </div>
            <label className="gen-check-field">
              <input type="checkbox" checked={!!model.island.pendants} onChange={(e) => change(setIsland(model, { ...model.island!, pendants: e.target.checked }))} />
              Pendant lights
            </label>
          </div>
        )}
        {model.island && islandLeftOut && (
          <p className="gen-hint warn" role="status">
            It doesn’t fit with 36″ walkways all round, so the kitchen is built without it. Check the room size, or make the island smaller.
          </p>
        )}
      </Section>

      <Section
        id="gen-sec-style"
        title="Colours and finishes"
        k="style"
        model={model}
        onChange={change}
        hint={seenFromPhotos ? 'Matched to the closest BluModel Studio finishes from your photos. Change any of them later in the editor.' : 'Pick what’s there now; change any of it later in the editor.'}
      >
        {seenFromPhotos && (
          <p className="gen-seen">
            <span className="gen-seen-chip" style={{ background: model.style.cabinetHex }} aria-hidden />
            Cabinets in your photos → <b>{cab.name}</b>
          </p>
        )}
        <Swatches label="Cabinets" items={CABINET_FINISHES} value={cab.id} onPick={(id) => change(setStyle(model, { cabinetHex: CABINET_FINISHES.find((f) => f.id === id)!.hex }))} />
        <div className="gen-chips" role="radiogroup" aria-label="Cabinet doors">
          {DOORS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={model.style.cabinetDoor === d.id} className={model.style.cabinetDoor === d.id ? 'chip on' : 'chip'} onClick={() => change(setStyle(model, { cabinetDoor: d.id }))}>
              {d.name}
            </button>
          ))}
        </div>
        <Swatches label="Counter" items={COUNTERTOPS} value={model.style.counter} onPick={(id) => change(setStyle(model, { counter: id }))} />
        <Swatches label="Backsplash" items={BACKSPLASHES} value={model.style.backsplash} onPick={(id) => change(setStyle(model, { backsplash: id }))} />
        <Swatches label="Floor" items={FLOORING} value={model.style.floor} onPick={(id) => change(setStyle(model, { floor: id }))} />
        <Swatches label="Hardware" items={HARDWARE} value={model.style.hardware} onPick={(id) => change(setStyle(model, { hardware: id }))} />
        <Swatches label="Walls" items={PAINTS} value={model.style.wall ?? 'chalk'} onPick={(id) => change(setStyle(model, { wall: id }))} />
      </Section>

      <section className="gen-sec" id="gen-sec-name">
        <label className="field gen-name">
          <span>Name this kitchen</span>
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="My kitchen" maxLength={120} />
        </label>
      </section>
    </div>
  );
}

export { WALL_NAMES };
