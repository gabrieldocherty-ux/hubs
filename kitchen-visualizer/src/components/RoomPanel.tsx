import { useDesignStore } from '../store/useDesignStore';
import { FeetInchesInput } from './FeetInchesInput';
import { TEMPLATES, type TemplateId } from '../data/templates';
import { BACKSPLASHES, CABINET_FINISHES, COUNTERTOPS, DOOR_STYLES, FLOORING, HARDWARE, PAINTS, type SurfaceOption } from '../data/finishes';
import { patternDataUrl } from '../lib/textures';
import { feetInches, money } from '../lib/format';
import type { DoorStyle, Surfaces } from '../types';

function TemplateGlyph({ id }: { id: TemplateId }) {
  const run = '#2a2622';
  const bars: Record<TemplateId, JSX.Element> = {
    'one-wall': <rect x="4" y="4" width="52" height="9" fill={run} />,
    galley: (
      <>
        <rect x="4" y="4" width="52" height="9" fill={run} />
        <rect x="4" y="31" width="52" height="9" fill={run} />
      </>
    ),
    'l-shape': (
      <>
        <rect x="4" y="4" width="52" height="9" fill={run} />
        <rect x="4" y="4" width="9" height="36" fill={run} />
      </>
    ),
    'u-shape': (
      <>
        <rect x="4" y="4" width="52" height="9" fill={run} />
        <rect x="4" y="4" width="9" height="36" fill={run} />
        <rect x="47" y="4" width="9" height="36" fill={run} />
      </>
    ),
    'l-island': (
      <>
        <rect x="4" y="4" width="52" height="9" fill={run} />
        <rect x="4" y="4" width="9" height="36" fill={run} />
        <rect x="24" y="21" width="24" height="10" fill="#c2542d" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 60 44" aria-hidden>
      <rect x="1" y="1" width="58" height="42" fill="none" stroke="#2a2622" strokeWidth="1.5" />
      {bars[id]}
    </svg>
  );
}

function SurfacePicker({ title, options, value, onPick, unitPrice = true }: { title: string; options: SurfaceOption[]; value: string; onPick: (id: string) => void; unitPrice?: boolean }) {
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <section className="room-section">
      <header>
        <h4>{title}</h4>
        <span className="sub">{current.brand} · {current.name}</span>
      </header>
      <div className="tex-grid">
        {options.map((o) => (
          <button
            key={o.id}
            className={o.id === value ? 'tex on' : 'tex'}
            style={{ backgroundImage: `url(${patternDataUrl(o.pattern)})`, backgroundColor: o.hex }}
            onClick={() => onPick(o.id)}
            title={`${o.brand} ${o.name}${unitPrice ? ` · ${money(o.price)}/${o.unit}` : ''}`}
            aria-label={o.name}
            aria-pressed={o.id === value}
          >
            <span>{o.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DoorGlyph({ style }: { style: DoorStyle }) {
  return (
    <svg viewBox="0 0 30 40" aria-hidden>
      <rect x="2" y="2" width="26" height="36" fill="#efe9dd" stroke="#2a2622" strokeWidth="1.3" />
      {style === 'shaker' && <rect x="7" y="7" width="16" height="26" fill="#e3dccd" stroke="#2a2622" strokeWidth="1" />}
      {style === 'fluted' && Array.from({ length: 9 }).map((_, i) => <line key={i} x1={5 + i * 2.5} y1="4" x2={5 + i * 2.5} y2="36" stroke="#2a2622" strokeOpacity="0.45" strokeWidth="0.9" />)}
      <line x1="23" y1="14" x2="23" y2="22" stroke="#c6a15b" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function RoomPanel() {
  const room = useDesignStore((s) => s.doc.room);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const setRoom = useDesignStore((s) => s.setRoom);
  const setSurfaces = useDesignStore((s) => s.setSurfaces);
  const applyTemplate = useDesignStore((s) => s.applyTemplate);
  const set = (patch: Partial<Surfaces>) => setSurfaces(patch);
  const area = (room.widthIn * room.lengthIn) / 144;

  return (
    <div className="room-panel">
      <section className="room-section">
        <header>
          <h4>Room</h4>
          <span className="sub mono">{area.toFixed(0)} sq ft</span>
        </header>
        <div className="dims">
          <FeetInchesInput label="Width (E–W)" valueIn={room.widthIn} min={72} max={480} onCommit={(v) => setRoom({ widthIn: v })} />
          <FeetInchesInput label="Length (N–S)" valueIn={room.lengthIn} min={72} max={480} onCommit={(v) => setRoom({ lengthIn: v })} />
          <FeetInchesInput label="Ceiling" valueIn={room.ceilingIn} min={90} max={144} onCommit={(v) => setRoom({ ceilingIn: v })} />
        </div>
      </section>

      <section className="room-section">
        <header>
          <h4>Start from a layout</h4>
          <span className="sub">Replaces the current plan · undoable</span>
        </header>
        <div className="templates">
          {TEMPLATES.map((t) => {
            const fits = room.widthIn >= t.minWidth && room.lengthIn >= t.minLength;
            return (
              <button key={t.id} className="template" disabled={!fits} onClick={() => applyTemplate(t.id)} title={fits ? t.blurb : `Needs at least ${feetInches(t.minWidth)} × ${feetInches(t.minLength)}`}>
                <TemplateGlyph id={t.id} />
                <span className="template-name">{t.name}</span>
                <span className="template-blurb">{fits ? t.blurb : `Needs ${Math.ceil(t.minWidth / 12)}′ × ${Math.ceil(t.minLength / 12)}′`}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="room-section">
        <header>
          <h4>Cabinetry</h4>
          <span className="sub">Nordwell · {CABINET_FINISHES.find((f) => f.id === surfaces.cabinetFinishId)?.name}</span>
        </header>
        <div className="swatches">
          {CABINET_FINISHES.map((f) => (
            <button
              key={f.id}
              className={f.id === surfaces.cabinetFinishId ? 'swatch on' : 'swatch'}
              style={f.material === 'wood' ? { backgroundImage: `url(${patternDataUrl({ type: 'wood', base: f.hex }, 48, 6)})`, backgroundSize: 'cover' } : { background: f.hex }}
              title={f.name}
              aria-label={f.name}
              aria-pressed={f.id === surfaces.cabinetFinishId}
              onClick={() => set({ cabinetFinishId: f.id })}
            />
          ))}
        </div>
        <div className="door-styles">
          {DOOR_STYLES.map((d) => (
            <button key={d.id} className={d.id === surfaces.doorStyle ? 'door-style on' : 'door-style'} onClick={() => set({ doorStyle: d.id })} aria-pressed={d.id === surfaces.doorStyle}>
              <DoorGlyph style={d.id} />
              <span>
                <b>{d.name}</b>
                <small>{d.blurb}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="hardware">
          <span className="mini-label">Hardware & faucet</span>
          <div className="swatches small">
            {HARDWARE.map((h) => (
              <button
                key={h.id}
                className={h.id === surfaces.hardwareId ? 'swatch metal on' : 'swatch metal'}
                style={{ background: `linear-gradient(135deg, ${h.hex}, #fff8 45%, ${h.hex} 60%)` }}
                title={`${h.brand} ${h.name}`}
                aria-label={h.name}
                aria-pressed={h.id === surfaces.hardwareId}
                onClick={() => set({ hardwareId: h.id })}
              />
            ))}
          </div>
        </div>
      </section>

      <SurfacePicker title="Countertop" options={COUNTERTOPS} value={surfaces.countertopId} onPick={(id) => set({ countertopId: id })} />
      <SurfacePicker title="Backsplash" options={BACKSPLASHES} value={surfaces.backsplashId} onPick={(id) => set({ backsplashId: id })} />
      <SurfacePicker title="Flooring" options={FLOORING} value={surfaces.flooringId} onPick={(id) => set({ flooringId: id })} />
      <section className="room-section">
        <header>
          <h4>Walls</h4>
          <span className="sub">{PAINTS.find((p) => p.id === surfaces.paintId)?.brand} · {PAINTS.find((p) => p.id === surfaces.paintId)?.name}</span>
        </header>
        <div className="swatches">
          {PAINTS.map((p) => (
            <button key={p.id} className={p.id === surfaces.paintId ? 'swatch on' : 'swatch'} style={{ background: p.hex }} title={p.name} aria-label={p.name} aria-pressed={p.id === surfaces.paintId} onClick={() => set({ paintId: p.id })} />
          ))}
        </div>
      </section>
    </div>
  );
}
