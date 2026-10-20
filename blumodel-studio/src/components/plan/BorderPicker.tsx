import { useDesignStore } from '../../store/useDesignStore';
import { EDGE_STYLES, EDGE_STYLE_ORDER, spaces } from '../../lib/outline';
import type { EdgeStyle } from '../../types';

/**
 * "What stands along its border?" for an open area (or any added room) just drawn: one tap sets
 * every edge, and Room & Finishes → Walls & rooms changes a single wall afterwards.
 */
export function BorderPicker({ id, onDone }: { id: string; onDone: () => void }) {
  const room = useDesignStore((s) => s.doc.room);
  const setSpaceStyle = useDesignStore((s) => s.setSpaceStyle);
  const toast = useDesignStore((s) => s.toast);
  const sp = spaces(room).find((x) => x.id === id);
  if (!sp) return null;
  const current = sp.styles.every((x) => x === sp.styles[0]) ? sp.styles[0] : null;
  const pick = (st: EdgeStyle) => {
    const err = setSpaceStyle(sp.index, st);
    if (err) toast(err, 'warn');
  };
  return (
    <div className="border-picker" role="dialog" aria-label={`Border of ${sp.name}`} data-testid="border-picker">
      <div className="border-picker-head">
        <b>{sp.name}</b>
        <span>What stands along its border?</span>
      </div>
      <div className="border-picker-opts">
        {EDGE_STYLE_ORDER.map((st) => (
          <button key={st} type="button" className={current === st ? 'btn on' : 'btn'} aria-pressed={current === st} onClick={() => pick(st)} title={EDGE_STYLES[st].blurb}>
            {EDGE_STYLES[st].label}
          </button>
        ))}
      </div>
      <p className="border-picker-note">{current ? EDGE_STYLES[current].blurb : 'Mixed: each wall has its own style.'} To style one wall, use Room &amp; Finishes → Walls &amp; rooms.</p>
      <button type="button" className="btn primary" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
