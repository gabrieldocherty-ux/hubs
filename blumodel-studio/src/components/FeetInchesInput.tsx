import { useEffect, useState, type KeyboardEvent } from 'react';

interface Props {
  label: string;
  valueIn: number;
  min: number;
  max: number;
  onCommit: (inches: number) => void;
}

/** Feet + inches entry that commits on Enter or blur, with ± buttons stepping by 6″. */
export function FeetInchesInput({ label, valueIn, min, max, onCommit }: Props) {
  const [ft, setFt] = useState(String(Math.floor(valueIn / 12)));
  const [inch, setInch] = useState(String(Math.round(valueIn % 12)));

  useEffect(() => {
    setFt(String(Math.floor(valueIn / 12)));
    setInch(String(Math.round(valueIn % 12)));
  }, [valueIn]);

  const commit = () => {
    const total = (parseInt(ft, 10) || 0) * 12 + (parseFloat(inch) || 0);
    const clamped = Math.min(max, Math.max(min, total));
    if (clamped !== valueIn) onCommit(clamped);
    else {
      setFt(String(Math.floor(valueIn / 12)));
      setInch(String(Math.round(valueIn % 12)));
    }
  };
  const step = (delta: number) => onCommit(Math.min(max, Math.max(min, valueIn + delta)));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="fi">
      <span className="fi-label">{label}</span>
      <div className="fi-row">
        <button type="button" className="fi-step" aria-label={`Decrease ${label}`} onClick={() => step(-6)}>−</button>
        <label className="fi-box">
          <input inputMode="numeric" value={ft} onChange={(e) => setFt(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commit} onKeyDown={onKey} aria-label={`${label} feet`} />
          <span>′</span>
        </label>
        <label className="fi-box">
          <input inputMode="decimal" value={inch} onChange={(e) => setInch(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={commit} onKeyDown={onKey} aria-label={`${label} inches`} />
          <span>″</span>
        </label>
        <button type="button" className="fi-step" aria-label={`Increase ${label}`} onClick={() => step(6)}>+</button>
      </div>
    </div>
  );
}
