import { useEffect, useMemo, useRef, useState } from 'react';
import type { Room } from '../../types';
import { feetInches } from '../../lib/format';
import { allOutlines, closeDrawing, outlineProblem, parseLengthIn, snapDrawPoint, type DrawSnap, type Pt } from '../../lib/outline';
import { planClientToRoom } from '../../lib/interaction';
import type { View } from './usePlanGestures';

/**
 * "Add a room" drawn straight on the plan: click the corners of the new room's walls beside the
 * existing ones (they snap square, to the grid and to the walls already there), type a length to be
 * exact, close the loop. It sits over the plan and takes the pointer while it is on, so panning and
 * dragging pieces pause until it is done or cancelled (Esc).
 */
export function PlanRoomDraw({
  room,
  view,
  size,
  kind,
  onFinish,
  onCancel,
}: {
  room: Room;
  view: View;
  size: { w: number; h: number };
  /** A room has its own floor and walls; an open area is marked inside the rooms (the kitchen part of an open plan). */
  kind: 'room' | 'zone';
  /** The finished outline; returns an error message to show (and keep drawing), or null when it was added. */
  onFinish: (outline: Pt[]) => string | null;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<DrawSnap | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const corners = useMemo<Pt[]>(() => [...allOutlines(room).flat(), ...pts], [room, pts]);

  // Fresh values for the native listeners below.
  const live = useRef({ pts, cursor, typed, view, corners, onFinish, onCancel });
  live.current = { pts, cursor, typed, view, corners, onFinish, onCancel };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const toRoom = (e: PointerEvent): Pt => {
      const r = el.getBoundingClientRect();
      const p = planClientToRoom(e.clientX, e.clientY, r, live.current.view);
      return [p.x, p.y];
    };
    const reach = () => 12 / live.current.view.scale;
    const snap = (e: PointerEvent) => snapDrawPoint(toRoom(e), live.current.pts[live.current.pts.length - 1] ?? null, live.current.corners, reach());

    const finish = (path: Pt[]) => {
      const closed = closeDrawing(path);
      const bad = outlineProblem(closed);
      if (bad) return setError(bad);
      const err = live.current.onFinish(closed);
      if (err) setError(err);
    };

    // The overlay owns the pointer: nothing below it (pan, select, drag) hears these.
    const stop = (e: Event) => e.stopPropagation();
    const down = (e: PointerEvent) => {
      stop(e);
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if ((e.target as HTMLElement).closest('button')) return;
      const p = snap(e).point;
      const { pts: cur } = live.current;
      if (cur.length >= 3 && p[0] === cur[0][0] && p[1] === cur[0][1]) return finish(cur);
      const last = cur[cur.length - 1];
      if (last && p[0] === last[0] && p[1] === last[1]) return;
      setPts([...cur, p]);
      setTyped('');
      setError(null);
    };
    const move = (e: PointerEvent) => {
      stop(e);
      setCursor(snap(e));
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const { pts: cur, typed: tp, cursor: c } = live.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (cur.length) {
          setPts([]);
          setTyped('');
        } else live.current.onCancel();
        return;
      }
      if (!cur.length) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (tp) setTyped(tp.slice(0, -1));
        else setPts(cur.slice(0, -1));
      } else if (/^[0-9.'"\s-]$/.test(e.key)) {
        e.preventDefault();
        setTyped(tp + e.key);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const last = cur[cur.length - 1];
        if (tp) {
          const len = parseLengthIn(tp);
          if (!len || len < 12) return setError('Type a length like 12\'6 or 150".');
          const to = c?.point ?? [last[0] + 1, last[1]];
          const horizontal = Math.abs(to[0] - last[0]) >= Math.abs(to[1] - last[1]);
          const dir = horizontal ? [to[0] >= last[0] ? 1 : -1, 0] : [0, to[1] >= last[1] ? 1 : -1];
          setPts([...cur, [last[0] + dir[0] * len, last[1] + dir[1] * len]]);
          setTyped('');
          setError(null);
        } else if (cur.length >= 3) finish(cur);
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', stop);
    el.addEventListener('wheel', stop);
    window.addEventListener('keydown', key, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  const px = (p: Pt) => `${view.x + p[0] * view.scale},${view.y + p[1] * view.scale}`;
  const last = pts[pts.length - 1];
  const tip = cursor && last ? cursor.point : null;
  const len = tip && last ? Math.abs(tip[0] - last[0]) + Math.abs(tip[1] - last[1]) : 0;
  const mid = tip && last ? ([(view.x + ((last[0] + tip[0]) / 2) * view.scale), view.y + ((last[1] + tip[1]) / 2) * view.scale] as const) : null;

  return (
    <div ref={ref} className="plan-draw" style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none', zIndex: 5 }} data-testid="plan-room-draw">
      <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {cursor?.guideX !== undefined && <line x1={view.x + cursor.guideX * view.scale} x2={view.x + cursor.guideX * view.scale} y1={0} y2={size.h} stroke="var(--accent)" strokeDasharray="4 4" opacity={0.55} />}
        {cursor?.guideY !== undefined && <line y1={view.y + cursor.guideY * view.scale} y2={view.y + cursor.guideY * view.scale} x1={0} x2={size.w} stroke="var(--accent)" strokeDasharray="4 4" opacity={0.55} />}
        {pts.length > 0 && (
          <>
            <polyline points={[...pts, ...(tip ? [tip] : [])].map(px).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={5} opacity={0.85} />
            {pts.map((p, i) => (
              <circle key={i} cx={view.x + p[0] * view.scale} cy={view.y + p[1] * view.scale} r={i === 0 && pts.length >= 3 ? 8 : 4} fill={i === 0 ? 'var(--card)' : 'var(--accent)'} stroke="var(--accent)" strokeWidth={2} />
            ))}
          </>
        )}
        {cursor && <circle cx={view.x + cursor.point[0] * view.scale} cy={view.y + cursor.point[1] * view.scale} r={5} fill={cursor.kind === 'corner' ? 'var(--accent)' : 'var(--card)'} stroke="var(--accent)" strokeWidth={2} />}
        {mid && len > 1 && (
          <g>
            <rect x={mid[0] - 36} y={mid[1] - 30} width={72} height={20} rx={10} fill="var(--accent)" />
            <text x={mid[0]} y={mid[1] - 16} textAnchor="middle" fill="#fff" fontSize={12} fontFamily="var(--mono)">
              {typed || feetInches(len)}
            </text>
          </g>
        )}
      </svg>
      <div className="plan-draw-hint" role="status" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ background: 'var(--inverse)', color: 'var(--on-inverse)', borderRadius: 10, padding: '8px 12px', fontSize: 13, maxWidth: 640 }}>
          {error ? <b>{error}</b> : pts.length ? 'Click each corner. Type a length and press Enter to be exact. Click the first corner (or press Enter) to close. Esc starts over.' : kind === 'zone' ? 'Mark an open area (your kitchen, say): click where one corner of its border goes. It stays open until you pick what stands along it.' : 'Add a room: click where one corner goes. Start beside an existing wall to share it.'}
        </span>
        <button type="button" className="btn" style={{ pointerEvents: 'auto' }} onClick={() => live.current.onCancel()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
