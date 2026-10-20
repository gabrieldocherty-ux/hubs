import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { EdgeStyle, PlacedItem } from '../../types';
import { getProduct, isOpening } from '../../data/catalog';
import { feetInches } from '../../lib/format';
import { flushSeg, resolve, type WallSeg } from '../../lib/geometry';
import { EDGE_STYLES, EDGE_STYLE_ORDER, allOutlines, floorOutlines, spaces, closeDrawing, outlineProblem, parseLengthIn, planBounds, rectFromCorners, snapDrawPoint, wallSegs, type DrawSnap, type Pt } from '../../lib/outline';
import { ROOM_KINDS } from '../../lib/roomKinds';
import { addRoom, addRoomOfKind, bumpWall, isError, moveWallTo, openingWidth, placeOpening, removeRoom, renameRoom, setEdgeStyle, setMainOutline, setSpaceStyle, setWallLength, type Draft } from '../../lib/roomEdit';
import { FeetInchesInput } from '../FeetInchesInput';
import './sketch.css';

/**
 * "Draw your room": the walls are drawn, not picked. Click corners (they snap square, to the grid and
 * to each other), type a length to be exact, close the loop; drag a wall to move it; drop doorways,
 * doors and windows on a wall; add more rooms beside the first. It edits a `Draft` (the room and what
 * stands in it) and reports every finished change through `onChange`, so the setup wizard and the
 * editor's "Walls & rooms" dialog share it. Nothing here chooses a "type" of room.
 */
type Tool = 'select' | 'draw' | 'rect' | 'room' | 'zone' | 'walkway' | 'doorway' | 'door' | 'window';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Click a wall to set its length or push a section in or out. Drag a wall to move it. Click a door or window to change it.' },
  { id: 'draw', label: 'Draw walls', hint: 'Click each corner. Type a length and press Enter to be exact. Click the first corner (or press Enter) to close the room. Backspace removes the last wall, Esc cancels.' },
  { id: 'rect', label: 'Rectangle', hint: 'Drag from one corner to the opposite corner.' },
  { id: 'room', label: 'Draw a room', hint: 'Draw another room beside this one, sharing a wall. Click corners as before.' },
  { id: 'zone', label: 'Open area', hint: 'Mark the kitchen (or a living or dining area) inside open space. Draw its border, then pick what stands along each edge: open, half wall, bar wall, railing, glass or a dropped beam.' },
  { id: 'walkway', label: 'Walkway', hint: 'Click a wall to open a wide passage with no door, 4′ to 12′ across: how a kitchen runs into a hall, dining room or living room. Pick its width afterwards.' },
  { id: 'doorway', label: 'Doorway', hint: 'Click a wall to cut a doorway (a cased opening with no door).' },
  { id: 'door', label: 'Door', hint: 'Click a wall to hang a door.' },
  { id: 'window', label: 'Window', hint: 'Click a wall to set a window.' },
];

const OPENING_FOR: Partial<Record<Tool, string>> = { walkway: 'walkway', doorway: 'opening', door: 'door', window: 'window' };
const WALL_T = 5;

interface Props {
  draft: Draft;
  onChange: (d: Draft) => void;
  /** Start drawing straight away (a new design with nothing drawn yet). */
  startDrawing?: boolean;
  /** Show the tools for doors and windows. */
  openings?: boolean;
  /** The first room is being replaced: drawing it starts from a clean canvas. */
  height?: number;
}

export function RoomSketcher({ draft, onChange, startDrawing = false, openings = true, height = 420 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>(startDrawing ? 'draw' : 'select');
  const [pts, setPts] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<DrawSnap | null>(null);
  const [typed, setTyped] = useState('');
  const [selWall, setSelWall] = useState<number | null>(null);
  const [selItem, setSelItem] = useState<string | null>(null);
  const [hoverWall, setHoverWall] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ kind: 'wall'; id: number; start: Draft; to: number } | { kind: 'item'; id: string; start: Draft } | { kind: 'rect'; from: Pt } | null>(null);
  const [past, setPast] = useState<Draft[]>([]);
  const [cw, setCw] = useState(600);
  const [bump, setBump] = useState({ from: '', width: "3'", depth: "1'" });

  // What the canvas shows while a drag is live; `draft` itself changes only when it ends.
  const shown = useMemo<Draft>(() => {
    if (drag?.kind === 'wall') {
      const out = moveWallTo(drag.start, drag.id, drag.to);
      return isError(out) ? drag.start : out;
    }
    return draft;
  }, [drag, draft]);
  const room = shown.room;
  const segs = useMemo(() => wallSegs(room), [room]);
  const outlines = useMemo(() => allOutlines(room), [room]);
  const floors = useMemo(() => floorOutlines(room), [room]);
  const zones = useMemo(() => spaces(room).filter((sp) => sp.zone), [room]);
  const empty = pts.length === 0;
  const drawingMain = tool === 'draw';
  const drawsNew = tool === 'draw' || tool === 'room' || tool === 'zone';

  const commit = useCallback(
    (next: Draft) => {
      setPast((p) => [...p.slice(-40), draft]);
      onChange(next);
      setError(null);
    },
    [draft, onChange],
  );
  const apply = (out: ReturnType<typeof setWallLength>, keep?: { wall?: number; item?: string }) => {
    if (isError(out)) {
      setError(out.error);
      return false;
    }
    commit(out);
    setSelWall(keep?.wall ?? null);
    setSelItem(keep?.item ?? null);
    return true;
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    onChange(prev);
    setSelWall(null);
    setSelItem(null);
    setError(null);
  };

  // ── view: the plan plus room to draw beside it ──
  const view = useMemo(() => {
    const pb = planBounds(drawingMain && empty ? { ...room, outline: undefined, widthIn: 0, lengthIn: 0, extra: undefined } : room);
    const base = drawingMain && empty ? { minX: 0, minY: 0, maxX: 420, maxY: 300 } : { minX: Math.min(0, pb.minX), minY: Math.min(0, pb.minY), maxX: Math.max(pb.maxX, 240), maxY: Math.max(pb.maxY, 180) };
    const pad = drawsNew ? 150 : 72;
    const w = base.maxX - base.minX + pad * 2;
    const h = base.maxY - base.minY + pad * 2;
    // Keep the canvas to the box's proportions so nothing letterboxes oddly.
    const target = 1.5;
    const vw = Math.max(w, h * target);
    const vh = Math.max(h, w / target);
    const cx = (base.minX + base.maxX) / 2;
    const cy = (base.minY + base.maxY) / 2;
    return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh };
  }, [room, drawingMain, empty, tool]);

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };

  // Drawing the main room starts afresh, so only its own corners attract; a new room lines up with every wall.
  const corners = useMemo<Pt[]>(() => (drawingMain ? pts : [...outlines.flat(), ...pts]), [outlines, pts, drawingMain]);
  const px = view.w / cw; // one screen pixel, in plan inches
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => setCw(Math.max(200, el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── choosing a wall under the pointer ──
  const wallAt = (p: Pt, reach = 12 * px): WallSeg | null => {
    let best: WallSeg | null = null;
    let bd = reach;
    for (const s of segs) {
      const along = s.wall === 'north' || s.wall === 'south' ? p[0] : p[1];
      const across = s.wall === 'north' || s.wall === 'south' ? p[1] : p[0];
      const off = Math.max(s.a0 - along, 0, along - s.a1);
      const d = Math.hypot(off, Math.abs(across - s.at));
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };
  const itemAt = (p: Pt): PlacedItem | null => {
    for (const it of shown.items) {
      const r = resolve(it);
      if (!r || !isOpening(r.product)) continue;
      const b = r.box;
      const m = 10 * px;
      if (p[0] >= b.minX - m && p[0] <= b.maxX + m && p[1] >= b.minY - m && p[1] <= b.maxY + m) return it;
    }
    return null;
  };

  // ── drawing ──
  const finishDrawing = (closeAt?: Pt[]) => {
    const path = closeDrawing(closeAt ?? pts);
    const bad = outlineProblem(path);
    if (bad) {
      setError(bad);
      return;
    }
    const out = tool === 'room' ? addRoom(draft, path) : tool === 'zone' ? addRoom(draft, path, undefined, 'zone') : setMainOutline(draft, path);
    if (isError(out)) {
      setError(out.error);
      return;
    }
    commit(out);
    setPts([]);
    setCursor(null);
    setTyped('');
    setTool('select');
  };

  const lengthDir = (from: Pt, to: Pt): [number, number] => (Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0] >= from[0] ? 1 : -1, 0] : [0, to[1] >= from[1] ? 1 : -1]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    box.current?.focus();
    const raw = toPlan(e);
    if (drawsNew) {
      const snap = snapDrawPoint(raw, pts[pts.length - 1] ?? null, corners, 12 * px);
      const p = snap.point;
      if (pts.length >= 3 && p[0] === pts[0][0] && p[1] === pts[0][1]) return finishDrawing();
      if (pts.length && p[0] === pts[pts.length - 1][0] && p[1] === pts[pts.length - 1][1]) return;
      setPts((a) => [...a, p]);
      setTyped('');
      setError(null);
      return;
    }
    if (tool === 'rect') {
      const p = snapDrawPoint(raw, null, corners, 12 * px).point;
      svgRef.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: 'rect', from: p });
      setPts([p]);
      return;
    }
    if (OPENING_FOR[tool]) {
      const w = wallAt(raw, 28 * px);
      if (!w) return setError('Click on a wall.');
      const along = w.wall === 'north' || w.wall === 'south' ? raw[0] : raw[1];
      const out = placeOpening(draft, OPENING_FOR[tool]!, w.id, along);
      if (apply(out, { item: isError(out) ? undefined : out.id })) setTool('select');
      return;
    }
    // select
    const it = itemAt(raw);
    if (it) {
      setSelItem(it.id);
      setSelWall(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: 'item', id: it.id, start: draft });
      return;
    }
    const w = wallAt(raw);
    if (w) {
      setSelWall(w.id);
      setSelItem(null);
      svgRef.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: 'wall', id: w.id, start: draft, to: w.at });
      return;
    }
    setSelWall(null);
    setSelItem(null);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const raw = toPlan(e);
    if (drawsNew) {
      setCursor(snapDrawPoint(raw, pts[pts.length - 1] ?? null, corners, 12 * px));
      return;
    }
    if (drag?.kind === 'rect') {
      const p = snapDrawPoint(raw, null, corners, 12 * px).point;
      setCursor({ point: p, kind: 'grid' });
      return;
    }
    if (drag?.kind === 'wall') {
      const s = wallSegs(drag.start.room).find((q) => q.id === drag.id)!;
      const horizontal = s.wall === 'north' || s.wall === 'south';
      const v = horizontal ? raw[1] : raw[0];
      // Snap to the grid and to other walls' lines.
      const lines = wallSegs(drag.start.room).filter((q) => q.id !== s.id && (q.wall === 'north' || q.wall === 'south') === horizontal).map((q) => q.at);
      let to = Math.round(v / 6) * 6;
      for (const l of lines) if (Math.abs(l - v) < 10 * px) to = l;
      setDrag({ ...drag, to });
      return;
    }
    if (drag?.kind === 'item') {
      const it = drag.start.items.find((i) => i.id === drag.id);
      const w = wallAt(raw, 44 * px);
      if (!it || !w) return;
      const along = w.wall === 'north' || w.wall === 'south' ? raw[0] : raw[1];
      const base: Draft = { room: drag.start.room, items: drag.start.items.filter((i) => i.id !== drag.id) };
      const out = placeOpening(base, it.productId, w.id, along, it.widthIn);
      if (!isError(out)) onChange({ room: out.room, items: out.items.map((i) => (i.id === out.id ? { ...i, id: drag.id, finishIndex: it.finishIndex, mirrored: it.mirrored } : i)) });
      return;
    }
    if (tool === 'select') {
      const w = itemAt(raw) ? null : wallAt(raw);
      setHoverWall(w ? w.id : null);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag?.kind === 'rect') {
      const raw = toPlan(e);
      const p = snapDrawPoint(raw, null, corners, 12 * px).point;
      setDrag(null);
      setPts([]);
      setCursor(null);
      if (Math.abs(p[0] - drag.from[0]) < 12 || Math.abs(p[1] - drag.from[1]) < 12) return;
      const path = rectFromCorners(drag.from, p);
      const out = setMainOutline(draft, path);
      if (isError(out)) setError(out.error);
      else {
        commit(out);
        setTool('select');
      }
      return;
    }
    if (drag?.kind === 'wall') {
      const moved = drag.to !== wallSegs(drag.start.room).find((s) => s.id === drag.id)?.at;
      const final = moveWallTo(drag.start, drag.id, drag.to);
      const id = drag.id;
      setDrag(null);
      if (moved) {
        if (isError(final)) setError(final.error);
        else {
          commit(final);
          setSelWall(id);
        }
      }
      return;
    }
    if (drag?.kind === 'item') {
      // The move was applied live through onChange; bank the start as one undo step.
      const start = drag.start;
      setDrag(null);
      setPast((p) => (start !== draft ? [...p.slice(-40), start] : p));
    }
  };

  // ── keyboard ──
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    if (drawsNew && pts.length) {
      if (e.key === 'Escape') {
        setPts([]);
        setTyped('');
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace') {
        if (typed) setTyped((s) => s.slice(0, -1));
        else setPts((a) => a.slice(0, -1));
        e.preventDefault();
        return;
      }
      if (/^[0-9.'"\s-]$/.test(e.key) || e.key === 'f' || e.key === 'i' || e.key === 'n') {
        setTyped((s) => s + e.key);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const last = pts[pts.length - 1];
        if (typed) {
          const len = parseLengthIn(typed);
          if (!len || len < 12) return setError('Type a length like 12\'6 or 150".');
          const [dx, dy] = lengthDir(last, cursor?.point ?? [last[0] + 1, last[1]]);
          setPts((a) => [...a, [last[0] + dx * len, last[1] + dy * len]]);
          setTyped('');
          setError(null);
        } else if (pts.length >= 3) finishDrawing();
        return;
      }
    }
    if (e.key === 'Escape') {
      setTool('select');
      setPts([]);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selItem) {
        e.preventDefault();
        commit({ room: draft.room, items: draft.items.filter((i) => i.id !== selItem) });
        setSelItem(null);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  };
  useEffect(() => {
    if (tool !== 'draw' && tool !== 'room') {
      setPts([]);
      setTyped('');
      setCursor(null);
    }
  }, [tool]);

  const wall = selWall !== null ? segs.find((s) => s.id === selWall) ?? null : null;
  const item = selItem ? draft.items.find((i) => i.id === selItem) ?? null : null;
  const itemProduct = item ? getProduct(item.productId) : null;
  // Phones and tablets tap; the hints say so.
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  const raw = TOOLS.find((t) => t.id === tool)!.hint;
  const tip = coarse ? raw.replace(/Click/g, 'Tap').replace(/click/g, 'tap').replace(/ Drag a wall to move it\./, ' Drag a wall to move it.') : raw;
  const last = pts[pts.length - 1];
  const live = drawsNew && last && cursor ? cursor.point : null;
  const liveLen = live && last ? Math.abs(live[0] - last[0]) + Math.abs(live[1] - last[1]) : 0;

  const label = (s: WallSeg) => {
    const alongX = s.wall === 'north' || s.wall === 'south';
    const mid = (s.a0 + s.a1) / 2;
    const off = 16 * px;
    const [x, y] = alongX ? [mid, s.wall === 'north' ? s.at - off : s.at + off] : [s.wall === 'west' ? s.at - off : s.at + off, mid];
    return { x, y, text: feetInches(s.a1 - s.a0) };
  };

  return (
    <div className="sk" ref={box} tabIndex={0} onKeyDown={onKeyDown} aria-label="Room sketch">
      <div className="sk-bar" role="toolbar" aria-label="Sketch tools">
        {TOOLS.filter((t) => openings || !OPENING_FOR[t.id]).map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? 'sk-tool on' : 'sk-tool'} onClick={() => setTool(t.id)} aria-pressed={tool === t.id}>
            {t.label}
          </button>
        ))}
        <select
          className="sk-tool sk-kind-pick"
          aria-label="Add a room of a kind"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            apply(addRoomOfKind(draft, e.target.value));
          }}
        >
          <option value="">Add a room…</option>
          {ROOM_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label} · {k.blurb}
            </option>
          ))}
        </select>
        <span className="sk-spacer" />
        <button type="button" className="sk-tool" onClick={undo} disabled={!past.length}>
          Undo
        </button>
      </div>

      <svg
        ref={svgRef}
        className={`sk-canvas sk-tool-${tool}`}
        style={{ height }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHoverWall(null);
          if (drawsNew) setCursor(null);
        }}
        role="img"
        aria-label="Floor plan sketch"
      >
        <defs>
          <pattern id="sk-grid-s" width={12} height={12} patternUnits="userSpaceOnUse">
            <path d="M12 0H0V12" fill="none" stroke="var(--sk-grid)" strokeWidth={0.4} />
          </pattern>
          <pattern id="sk-grid-l" width={60} height={60} patternUnits="userSpaceOnUse">
            <rect width={60} height={60} fill="url(#sk-grid-s)" />
            <path d="M60 0H0V60" fill="none" stroke="var(--sk-grid-l)" strokeWidth={0.8} />
          </pattern>
        </defs>
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#sk-grid-l)" />

        {!drawingMain &&
          floors.map((o, i) => <polygon key={i} points={o.map((p) => p.join(',')).join(' ')} className={i === 0 ? 'sk-floor' : 'sk-floor sk-floor-x'} />)}
        {!drawingMain &&
          zones.map((z) => {
            const xs = z.pts.map((q) => q[0]);
            const ys = z.pts.map((q) => q[1]);
            const fs = 12 * px;
            return (
              <g key={z.id} pointerEvents="none">
                <polygon points={z.pts.map((q) => q.join(',')).join(' ')} className="sk-zone" />
                <text x={(Math.min(...xs) + Math.max(...xs)) / 2} y={(Math.min(...ys) + Math.max(...ys)) / 2 + fs * 0.35} textAnchor="middle" className="sk-zone-name" style={{ fontSize: fs }}>
                  {z.name.toUpperCase()}
                </text>
              </g>
            );
          })}

        {/* Things already in the room, faint, so walls are drawn around what is there. */}
        {(drawingMain ? [] : shown.items).map((it) => {
          const r = resolve(it);
          if (!r || isOpening(r.product)) return null;
          return <rect key={it.id} x={r.box.minX} y={r.box.minY} width={r.box.maxX - r.box.minX} height={r.box.maxY - r.box.minY} className="sk-thing" />;
        })}

        {(drawingMain ? [] : segs).map((sg) => (
          <SketchWall key={sg.id} sg={sg} selected={sg.id === selWall} hover={sg.id === hoverWall && !drag} px={px} />
        ))}

        {(drawingMain ? [] : shown.items).map((it) => {
          const r = resolve(it);
          if (!r || !isOpening(r.product)) return null;
          const sg = flushSeg(r, room);
          const alongX = !sg || sg.wall === 'north' || sg.wall === 'south';
          const w = r.w;
          const sel = it.id === selItem;
          const win = r.product.kind === 'window';
          const gx = alongX ? it.x - w / 2 : it.x - WALL_T - 1;
          const gy = alongX ? it.y - WALL_T - 1 : it.y - w / 2;
          return (
            <g key={it.id} className={sel ? 'sk-open sel' : 'sk-open'}>
              <rect x={gx} y={gy} width={alongX ? w : WALL_T * 2 + 2} height={alongX ? WALL_T * 2 + 2 : w} className="sk-gap" />
              {win ? (
                <line x1={alongX ? it.x - w / 2 : it.x} y1={alongX ? it.y : it.y - w / 2} x2={alongX ? it.x + w / 2 : it.x} y2={alongX ? it.y : it.y + w / 2} className="sk-glass" />
              ) : (
                <path d={doorSymbol(it, w, r.product.variant)} className="sk-door" />
              )}
            </g>
          );
        })}

        {/* The wall lengths, always on, like a plan set. */}
        {!drawingMain &&
          segs.map((s) => {
            const l = label(s);
            const fs = 11 * px;
            const tw = l.text.length * fs * 0.62 + 12 * px;
            // A wall too short to hold its own label shows it in the inspector instead.
            if (s.a1 - s.a0 < tw * 1.15 && s.id !== selWall) return null;
            return (
              <g key={s.id} className="sk-len" pointerEvents="none" style={{ fontSize: fs }}>
                <rect x={l.x - tw / 2} y={l.y - fs * 0.95} width={tw} height={fs * 1.9} rx={fs * 0.95} strokeWidth={0.6 * px} />
                <text x={l.x} y={l.y + fs * 0.35} textAnchor="middle">
                  {l.text}
                </text>
              </g>
            );
          })}

        {/* The wall being drawn. */}
        {pts.length > 0 && (
          <g pointerEvents="none">
            <polyline points={[...pts, ...(live ? [live] : [])].map((p) => p.join(',')).join(' ')} className="sk-draw" />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 && pts.length >= 3 ? 8 * px : 4 * px} className={i === 0 ? 'sk-pt first' : 'sk-pt'} />
            ))}
          </g>
        )}
        {drag?.kind === 'rect' && cursor && (
          <rect x={Math.min(drag.from[0], cursor.point[0])} y={Math.min(drag.from[1], cursor.point[1])} width={Math.abs(cursor.point[0] - drag.from[0])} height={Math.abs(cursor.point[1] - drag.from[1])} className="sk-draw-rect" pointerEvents="none" />
        )}
        {cursor && (drawsNew || drag?.kind === 'rect') && (
          <g pointerEvents="none">
            {cursor.guideX !== undefined && <line x1={cursor.guideX} y1={view.y} x2={cursor.guideX} y2={view.y + view.h} className="sk-guide" />}
            {cursor.guideY !== undefined && <line x1={view.x} y1={cursor.guideY} x2={view.x + view.w} y2={cursor.guideY} className="sk-guide" />}
            <circle cx={cursor.point[0]} cy={cursor.point[1]} r={5 * px} className={cursor.kind === 'corner' ? 'sk-cur corner' : 'sk-cur'} />
            {live && last && liveLen > 1 && (
              <g>
                <rect x={(last[0] + live[0]) / 2 - 36 * px} y={(last[1] + live[1]) / 2 - 30 * px} width={72 * px} height={20 * px} rx={10 * px} className="sk-livelen" />
                <text x={(last[0] + live[0]) / 2} y={(last[1] + live[1]) / 2 - 16 * px} textAnchor="middle" className="sk-livetext" style={{ fontSize: 12 * px }}>
                  {typed || feetInches(liveLen)}
                </text>
              </g>
            )}
          </g>
        )}
        {drag?.kind === 'wall' && (
          <text x={view.x + 10 * px} y={view.y + 22 * px} className="sk-livetext dark" style={{ fontSize: 14 * px }}>
            {feetInches(Math.abs(drag.to - (wallSegs(drag.start.room).find((s) => s.id === drag.id)?.at ?? 0)))} moved
          </text>
        )}
      </svg>

      <p className="sk-hint" role="status">
        {error ? <b className="sk-error">{error}</b> : tip}
        {drawsNew && pts.length >= 3 && (
          <>
            {' '}
            <button type="button" className="sk-link" onClick={() => finishDrawing()}>
              Close the room
            </button>
          </>
        )}
      </p>

      {tool === 'select' && wall && (
        <div className="sk-inspector">
          <b>Wall</b>
          <FeetInchesInput label="Length" valueIn={wall.a1 - wall.a0} min={12} max={1200} onCommit={(v) => apply(setWallLength(draft, wall.id, v), { wall: wall.id })} />
          <label className="sk-field">
            <span>What stands here</span>
            <select value={wall.style} onChange={(e) => apply(setEdgeStyle(draft, wall.id, e.target.value as EdgeStyle), { wall: wall.id })} data-testid="edge-style">
              {EDGE_STYLE_ORDER.map((st) => (
                <option key={st} value={st}>
                  {EDGE_STYLES[st].label}
                </option>
              ))}
            </select>
          </label>
          <p className="sk-style-blurb">{EDGE_STYLES[wall.style].blurb}</p>
          <div className="sk-bump">
            <span className="sk-bump-t">Push a section in or out</span>
            <label>
              <span>Starts</span>
              <input value={bump.from} placeholder={feetInches((wall.a1 - wall.a0) / 3)} onChange={(e) => setBump({ ...bump, from: e.target.value })} aria-label="Bump starts this far along the wall" />
            </label>
            <label>
              <span>Width</span>
              <input value={bump.width} onChange={(e) => setBump({ ...bump, width: e.target.value })} aria-label="Bump width" />
            </label>
            <label>
              <span>Depth</span>
              <input value={bump.depth} onChange={(e) => setBump({ ...bump, depth: e.target.value })} aria-label="Bump depth" />
            </label>
            {(['out', 'in'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                className="btn"
                onClick={() => {
                  const from = parseLengthIn(bump.from || feetInches((wall.a1 - wall.a0) / 3)) ?? (wall.a1 - wall.a0) / 3;
                  const wd = parseLengthIn(bump.width);
                  const dp = parseLengthIn(bump.depth);
                  if (!wd || !dp) return setError('Type the width and depth like 3\' or 18".');
                  apply(bumpWall(draft, wall.id, wall.a0 + from, wall.a0 + from + wd, dir === 'out' ? dp : -dp));
                }}
              >
                {dir === 'out' ? 'Bump out' : 'Notch in'}
              </button>
            ))}
          </div>
        </div>
      )}

      {tool === 'select' && item && itemProduct && (
        <div className="sk-inspector">
          <b>{itemProduct.name}</b>
          <label className="sk-field">
            <span>Width</span>
            <select
              value={openingWidth(item)}
              onChange={(e) => {
                const wdt = Number(e.target.value);
                const sg = flushSeg(resolve(item)!, draft.room);
                const rest: Draft = { room: draft.room, items: draft.items.filter((i) => i.id !== item.id) };
                if (!sg) return;
                const out = placeOpening(rest, item.productId, sg.id, sg.wall === 'north' || sg.wall === 'south' ? item.x : item.y, wdt === itemProduct.widthIn ? undefined : wdt);
                if (isError(out)) return setError(out.error);
                commit({ room: out.room, items: out.items.map((i) => (i.id === out.id ? { ...i, id: item.id, finishIndex: item.finishIndex } : i)) });
              }}
            >
              {(itemProduct.widthOptions ?? [itemProduct.widthIn]).map((o) => (
                <option key={o} value={o}>
                  {feetInches(o)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              commit({ room: draft.room, items: draft.items.filter((i) => i.id !== item.id) });
              setSelItem(null);
            }}
          >
            Remove
          </button>
        </div>
      )}

      {(draft.room.extra?.length ?? 0) > 0 && (
        <ul className="sk-rooms" aria-label="Rooms and open areas in this plan">
          {spaces(draft.room)
            .filter((sp) => sp.index > 0)
            .map((sp) => {
              const uniform = sp.styles.every((x) => x === sp.styles[0]) ? sp.styles[0] : '';
              return (
                <li key={sp.id}>
                  <span className="sk-kind">{sp.zone ? 'Open area' : 'Room'}</span>
                  <input value={sp.name} aria-label={sp.zone ? 'Open area name' : 'Room name'} maxLength={40} onChange={(e) => onChange(renameRoom(draft, sp.id, e.target.value))} />
                  <label className="sk-field sk-inline">
                    <span>{sp.zone ? 'Border' : 'Walls'}</span>
                    <select
                      value={uniform}
                      aria-label={`${sp.name} border`}
                      onChange={(e) => e.target.value && apply(setSpaceStyle(draft, sp.index, e.target.value as EdgeStyle))}
                    >
                      {!uniform && <option value="">Mixed</option>}
                      {EDGE_STYLE_ORDER.map((st) => (
                        <option key={st} value={st}>
                          {EDGE_STYLES[st].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="sk-link" onClick={() => onChange(removeRoom(draft, sp.id))}>
                    Remove
                  </button>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

/** One wall of the sketch, drawn the way its style looks in a plan. */
function SketchWall({ sg, selected, hover, px }: { sg: WallSeg; selected: boolean; hover: boolean; px: number }) {
  const alongX = sg.wall === 'north' || sg.wall === 'south';
  const cls = ['sk-edge', `sk-edge-${sg.style}`, selected ? 'sel' : '', hover ? 'hover' : ''].join(' ');
  const line = alongX ? { x1: sg.a0, y1: sg.at, x2: sg.a1, y2: sg.at } : { x1: sg.at, y1: sg.a0, x2: sg.at, y2: sg.a1 };
  const halo = selected ? <line {...line} className="sk-halo" strokeWidth={9 * px} /> : null;
  if (sg.style === 'wall') {
    const e0 = alongX && sg.convex0 ? WALL_T : 0;
    const e1 = alongX && sg.convex1 ? WALL_T : 0;
    const len = sg.a1 - sg.a0 + e0 + e1;
    const st = sg.a0 - e0;
    const [x, y, w, h] = sg.wall === 'north' ? [st, sg.at - WALL_T, len, WALL_T] : sg.wall === 'south' ? [st, sg.at, len, WALL_T] : sg.wall === 'west' ? [sg.at - WALL_T, st, WALL_T, len] : [sg.at, st, WALL_T, len];
    return <rect x={x} y={y} width={w} height={h} className={['sk-wall', selected ? 'sel' : '', hover ? 'hover' : ''].join(' ')} />;
  }
  if (sg.style === 'half' || sg.style === 'bar') {
    const t = WALL_T;
    const [x, y, w, h] = alongX ? [sg.a0, sg.at - t / 2, sg.a1 - sg.a0, t] : [sg.at - t / 2, sg.a0, t, sg.a1 - sg.a0];
    const ledge = sg.style === 'bar' ? (alongX ? [sg.a0, sg.wall === 'north' ? sg.at - t / 2 - 12 : sg.at + t / 2, sg.a1 - sg.a0, 12] : [sg.wall === 'west' ? sg.at - t / 2 - 12 : sg.at + t / 2, sg.a0, 12, sg.a1 - sg.a0]) : null;
    return (
      <g>
        {halo}
        {ledge && <rect x={ledge[0]} y={ledge[1]} width={ledge[2]} height={ledge[3]} className="sk-ledge" />}
        <rect x={x} y={y} width={w} height={h} className={cls} />
      </g>
    );
  }
  if (sg.style === 'rail') {
    return (
      <g>
        {halo}
        <line {...line} className={cls} strokeWidth={2.2} />
      </g>
    );
  }
  if (sg.style === 'glass') {
    return (
      <g>
        {halo}
        <line {...line} className={cls} strokeWidth={3.4} />
      </g>
    );
  }
  if (sg.style === 'beam') {
    const t = 10;
    const [x, y, w, h] = alongX ? [sg.a0, sg.at - t / 2, sg.a1 - sg.a0, t] : [sg.at - t / 2, sg.a0, t, sg.a1 - sg.a0];
    return (
      <g>
        {halo}
        <rect x={x} y={y} width={w} height={h} className={cls} />
      </g>
    );
  }
  return (
    <g>
      {halo}
      <line {...line} className={cls} strokeWidth={1.6} />
    </g>
  );
}

/** The swing of a door (quarter-circle) or the open casing of a doorway, drawn on its gap. */
function doorSymbol(it: PlacedItem, w: number, variant?: string): string {
  const sign = it.mirrored ? -1 : 1;
  // Local frame: along the wall is +u, into the room is +v. Rotated into plan coordinates by the wall's facing.
  const rot = it.rotation;
  const map = (u: number, v: number): [number, number] => {
    switch (rot) {
      case 0:
        return [it.x + u, it.y + v];
      case 90:
        return [it.x - v, it.y + u];
      case 180:
        return [it.x - u, it.y - v];
      default:
        return [it.x + v, it.y - u];
    }
  };
  if (variant === 'opening') {
    const [a, b] = [map(-w / 2, -WALL_T), map(-w / 2, WALL_T)];
    const [c, d] = [map(w / 2, -WALL_T), map(w / 2, WALL_T)];
    return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}M${c[0]} ${c[1]}L${d[0]} ${d[1]}`;
  }
  const hinge = map(sign * (-w / 2), 0);
  const tip = map(sign * (-w / 2), w);
  const end = map(sign * (w / 2), 0);
  if (variant === 'double') {
    const h2 = map(w / 2, 0);
    const t2 = map(w / 2, w / 2);
    const m = map(0, 0);
    const t1 = map(-w / 2, w / 2);
    return `M${hinge[0]} ${hinge[1]}L${t1[0]} ${t1[1]}A${w / 2} ${w / 2} 0 0 1 ${m[0]} ${m[1]}M${h2[0]} ${h2[1]}L${t2[0]} ${t2[1]}A${w / 2} ${w / 2} 0 0 0 ${m[0]} ${m[1]}`;
  }
  return `M${hinge[0]} ${hinge[1]}L${tip[0]} ${tip[1]}A${w} ${w} 0 0 ${sign > 0 ? 1 : 0} ${end[0]} ${end[1]}`;
}
