import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { FeetInchesInput } from '../../components/FeetInchesInput';
import { fromCm, toCm, type Units } from '../../lib/generate/edit';
import type { PhotoWall } from '../../lib/generate/photoModel';

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A compact length field for list rows: feet + inches, or centimetres. Commits on blur or Enter,
 * clamped to [min, max]; typing never moves anything until it commits.
 */
export function LenInput({ label, valueIn, min, max, units, onCommit, hideLabel = false }: { label: string; valueIn: number; min: number; max: number; units: Units; onCommit: (inches: number) => void; hideLabel?: boolean }) {
  const id = useId();
  const [ft, setFt] = useState('');
  const [inch, setInch] = useState('');
  const [cm, setCm] = useState('');
  useEffect(() => {
    setFt(String(Math.floor(valueIn / 12)));
    setInch(String(Math.round((valueIn % 12) * 2) / 2));
    setCm(String(toCm(valueIn)));
  }, [valueIn, units]);

  const commit = (inches: number) => {
    const v = Math.round(clamp(Number.isFinite(inches) ? inches : valueIn, min, max) * 2) / 2;
    if (v !== valueIn) onCommit(v);
    else {
      setFt(String(Math.floor(valueIn / 12)));
      setInch(String(Math.round((valueIn % 12) * 2) / 2));
      setCm(String(toCm(valueIn)));
    }
  };

  return (
    <div className="gen-len">
      <span className={hideLabel ? 'gen-sr' : 'gen-len-label'} id={id}>
        {label}
      </span>
      {units === 'cm' ? (
        <label className="gen-len-box">
          <input
            inputMode="numeric"
            value={cm}
            onChange={(e) => setCm(e.target.value.replace(/[^0-9.]/g, ''))}
            onBlur={() => commit(fromCm(parseFloat(cm)))}
            onKeyDown={blurOnEnter}
            aria-label={`${label} in centimetres`}
          />
          <span>cm</span>
        </label>
      ) : (
        <div className="gen-len-pair" role="group" aria-labelledby={id}>
          <label className="gen-len-box">
            <input
              inputMode="numeric"
              value={ft}
              onChange={(e) => setFt(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => commit((parseInt(ft, 10) || 0) * 12 + (parseFloat(inch) || 0))}
              onKeyDown={blurOnEnter}
              aria-label={`${label} feet`}
            />
            <span>′</span>
          </label>
          <label className="gen-len-box">
            <input
              inputMode="decimal"
              value={inch}
              onChange={(e) => setInch(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => commit((parseInt(ft, 10) || 0) * 12 + (parseFloat(inch) || 0))}
              onKeyDown={blurOnEnter}
              aria-label={`${label} inches`}
            />
            <span>″</span>
          </label>
        </div>
      )}
    </div>
  );
}

/** Room dimensions: the editor's FeetInchesInput, or a centimetre field with the same ± steps. */
export function RoomLen({ label, valueIn, min, max, units, onCommit }: { label: string; valueIn: number; min: number; max: number; units: Units; onCommit: (inches: number) => void }) {
  const [cm, setCm] = useState(String(toCm(valueIn)));
  useEffect(() => setCm(String(toCm(valueIn))), [valueIn]);
  if (units === 'ftin') return <FeetInchesInput label={label} valueIn={valueIn} min={min} max={max} onCommit={onCommit} />;
  const commit = (v: number) => {
    const c = Math.round(clamp(Number.isFinite(v) ? v : valueIn, min, max) * 2) / 2;
    if (c !== valueIn) onCommit(c);
    else setCm(String(toCm(valueIn)));
  };
  return (
    <div className="fi">
      <span className="fi-label">{label}</span>
      <div className="fi-row">
        <button type="button" className="fi-step" aria-label={`Decrease ${label}`} onClick={() => commit(valueIn - 2)}>
          −
        </button>
        <label className="fi-box gen-cm-box">
          <input inputMode="numeric" value={cm} onChange={(e) => setCm(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={() => commit(fromCm(parseFloat(cm)))} onKeyDown={blurOnEnter} aria-label={`${label} in centimetres`} />
          <span>cm</span>
        </label>
        <button type="button" className="fi-step" aria-label={`Increase ${label}`} onClick={() => commit(valueIn + 2)}>
          +
        </button>
      </div>
    </div>
  );
}

export const WALL_NAMES: Record<PhotoWall, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };

export function WallSelect<V extends string>({ label, value, onChange, island = false, hideLabel = false }: { label: string; value: V; onChange: (w: V) => void; island?: boolean; hideLabel?: boolean }) {
  return (
    <label className="gen-select">
      <span className={hideLabel ? 'gen-sr' : 'gen-len-label'}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as V)}>
        {(Object.keys(WALL_NAMES) as PhotoWall[]).map((w) => (
          <option key={w} value={w}>
            {WALL_NAMES[w]} wall
          </option>
        ))}
        {island && <option value="island">Island</option>}
      </select>
    </label>
  );
}

export interface Swatch {
  id: string;
  name: string;
  hex: string;
}

/** A row of colour swatches (radio group): the name is the label, the colour is never the only cue. */
export function Swatches({ label, items, value, onPick }: { label: string; items: Swatch[]; value: string; onPick: (id: string) => void }) {
  const current = items.find((i) => i.id === value);
  return (
    <fieldset className="gen-swatches">
      <legend>
        {label}
        {current && <span className="gen-swatch-name"> · {current.name}</span>}
      </legend>
      <div className="gen-swatch-row" role="radiogroup" aria-label={label}>
        {items.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === value}
            className={s.id === value ? 'gen-swatch on' : 'gen-swatch'}
            style={{ background: s.hex }}
            title={s.name}
            aria-label={s.name}
            onClick={() => onPick(s.id)}
          />
        ))}
      </div>
    </fieldset>
  );
}
