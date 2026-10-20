import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { useDesignStore, useSelected } from '../../store/useDesignStore';
import { useReport, useResolvedItems } from '../../store/derived';
import { useCatalogVersion } from '../../store/useCatalog';
import { FLOORING, byId } from '../../data/finishes';
import { getProduct } from '../../data/catalog';
import { feetInches } from '../../lib/format';
import { registerExporter } from '../../lib/exporters';
import { qaExpose } from '../../lib/qa';
import { clamp, type Resolved } from '../../lib/geometry';
import { placeAt, planClientToRoom, planRoomToClient, registerDropTarget, useOverlay, usePlacement } from '../../lib/interaction';
import { BAD, FONT_MONO, OK, PLAN_LIGHT, PlanPaletteContext, WARN, patternFill, planPalette, type PlanPalette } from './planStyle';
import { useResolvedTheme } from '../../lib/theme';
import { PlanItem, isOverheadKind } from './PlanItem';
import { SelectionDimensions, WallDimensions } from './Dimensions';
import { DragFeedback } from './DragFeedback';
import { itemRoomBox } from './planHit';
import { MAX_SCALE, MIN_SCALE, usePlanGestures, type View } from './usePlanGestures';
import { fitView } from './planFit';
import { PlanRoomDraw } from './PlanRoomDraw';
import { PlanWalls } from './PlanWalls';
import { BorderPicker } from './BorderPicker';
import { ROOM_KINDS } from '../../lib/roomKinds';
import { floorOutlines, floorSpaces, planSize } from '../../lib/outline';

/** The pane's visible part in client px (on a phone it can be scrolled partly off-screen). */
function visibleRect(el: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const r = el.getBoundingClientRect();
  return {
    left: Math.max(r.left, 0),
    top: Math.max(r.top, 0),
    right: Math.min(r.right, window.innerWidth),
    bottom: Math.min(r.bottom, window.innerHeight),
  };
}

function hatchCanvas(pal: PlanPalette): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = pal.sheet;
  ctx.fillRect(0, 0, 12, 12);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -12; i <= 24; i += 6) {
    ctx.moveTo(i, 12);
    ctx.lineTo(i + 12, 0);
  }
  ctx.stroke();
  return c;
}

/** The plan owns every gesture on it: no page scroll, no browser pinch-zoom, no text selection or iOS callout. */
const WRAP_STYLE: CSSProperties = {
  touchAction: 'none',
  overscrollBehavior: 'contain',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
} as CSSProperties;

export function PlanView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const paperRef = useRef<Konva.Rect>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ scale: 3, x: 60, y: 60 });
  /** Always the transform the stage is about to show; gestures read it between renders. */
  const viewRef = useRef<View>(view);
  const userZoomed = useRef(false);
  const applyView = useCallback((v: View, byUser = false) => {
    viewRef.current = v;
    setView(v);
    if (byUser) userZoomed.current = true;
  }, []);

  const room = useDesignStore((s) => s.doc.room);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const items = useDesignStore((s) => s.doc.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const hoverId = useDesignStore((s) => s.hoverId);
  const dragging = useDesignStore((s) => s.dragging);
  const ui = useDesignStore((s) => s.ui);
  const select = useDesignStore((s) => s.select);
  const hover = useDesignStore((s) => s.hover);
  const setUI = useDesignStore((s) => s.setUI);
  const applyTemplate = useDesignStore((s) => s.applyTemplate);
  const armedId = usePlacement((s) => s.armedProductId);
  const all = useResolvedItems();
  const catalogVersion = useCatalogVersion();
  const readOnly = useDesignStore((s) => s.readOnly);
  const report = useReport();
  const selected = useSelected();
  // The theme's colours (planStyle.ts); an export always draws in PLAN_LIGHT, for paper.
  const theme = useResolvedTheme();
  const [exporting, setExporting] = useState(false);
  const pal = exporting ? PLAN_LIGHT : planPalette(theme);
  const hatch = useMemo(() => hatchCanvas(pal), [pal]);
  const itemsRef = useRef<Resolved[]>(all);
  itemsRef.current = all;
  const selectedRef = useRef<Resolved | null>(selected);
  selectedRef.current = selected;

  usePlanGestures({ wrapRef, stageRef, viewRef, applyView, itemsRef });

  // Headless checks (only with ?qa): where a room point is on screen, and the stage transform.
  useEffect(() => {
    const rect = () => stageRef.current?.container().getBoundingClientRect() ?? null;
    qaExpose({
      plan: {
        view: () => ({ ...viewRef.current }),
        toClient: (x: number, y: number) => {
          const c = rect();
          return c ? planRoomToClient({ x, y }, c, viewRef.current) : null;
        },
        toRoom: (cx: number, cy: number) => {
          const c = rect();
          return c ? planClientToRoom(cx, cy, c, viewRef.current) : null;
        },
      },
    });
    return () => qaExpose({ plan: undefined });
  }, []);

  const k = 1 / view.scale;
  const rendered = ui.planStyle === 'rendered';
  const armed = armedId ? getProduct(armedId) : undefined;

  const fit = useCallback(() => {
    // Room and dimension strings centred in the pane (planFit.ts).
    applyView(fitView(size.w, size.h, planSize(room).W, planSize(room).L, MIN_SCALE, MAX_SCALE));
    userZoomed.current = false;
  }, [size.w, size.h, room.widthIn, room.lengthIn, applyView]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refit when the room changes or the pane resizes, unless the user has zoomed or
  // panned: then a resize keeps the same spot in the middle of the pane.
  const lastFit = useRef<{ w: number; h: number; W: number; L: number } | null>(null);
  useEffect(() => {
    const prev = lastFit.current;
    lastFit.current = { w: size.w, h: size.h, W: room.widthIn, L: room.lengthIn };
    const roomChanged = !prev || prev.W !== room.widthIn || prev.L !== room.lengthIn;
    // A wall being dragged changes the room on every move: refitting then would slide the plan out
    // from under the pointer. Keep the view; the next resize or room change refits as usual.
    if (prev && roomChanged && useDesignStore.getState().dragging) return;
    if (prev && userZoomed.current && !roomChanged) {
      const v = viewRef.current;
      applyView({ ...v, x: v.x + (size.w - prev.w) / 2, y: v.y + (size.h - prev.h) / 2 });
      return;
    }
    fit();
  }, [fit, size.w, size.h, room.widthIn, room.lengthIn, applyView]);

  // Lets the catalog (touch drag, tap-to-place) drop products here; see lib/interaction.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    return registerDropTarget('plan', el, (cx, cy) => {
      const st = stageRef.current;
      if (!st) return null;
      return planClientToRoom(cx, cy, st.container().getBoundingClientRect(), viewRef.current);
    });
  }, []);

  const zoomAt = (factor: number, px: number, py: number) => {
    const v = viewRef.current;
    const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    const wx = (px - v.x) / v.scale;
    const wy = (py - v.y) / v.scale;
    applyView({ scale, x: px - wx * scale, y: py - wy * scale }, true);
  };

  // ── Selection overlay ──
  // Publishes the selected piece's on-screen box (client px, clipped to the visible part
  // of the pane) for the floating toolbar. The plan publishes only while it is the view
  // the user is working in: it was the last view pressed, or no other view has published.
  const planActive = useRef(true);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) planActive.current = true;
      else if (t.closest('.scene-view')) planActive.current = false;
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const publish = useCallback(() => {
    const ov = useOverlay.getState();
    const r = selectedRef.current;
    const st = stageRef.current;
    const el = wrapRef.current;
    if (!r || !st || !el) return ov.clear('plan');
    if (!planActive.current && ov.source !== null && ov.source !== 'plan') return;
    const c = st.container().getBoundingClientRect();
    const v = viewRef.current;
    const b = itemRoomBox(r);
    const a = planRoomToClient({ x: b.minX, y: b.minY }, c, v);
    const z = planRoomToClient({ x: b.maxX, y: b.maxY }, c, v);
    const vis = visibleRect(el);
    const left = Math.max(a.x, vis.left);
    const top = Math.max(a.y, vis.top);
    const right = Math.min(z.x, vis.right);
    const bottom = Math.min(z.y, vis.bottom);
    if (right - left < 1 || bottom - top < 1) return ov.clear('plan');
    ov.set({ rect: { left, top, width: right - left, height: bottom - top }, source: 'plan' });
  }, []);

  useLayoutEffect(() => {
    publish();
  }, [publish, selected, view, size]);

  useEffect(() => {
    let raf = 0;
    const soon = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(publish);
    };
    // A scrolling ancestor (the phone workspace) or a window resize moves the pane.
    window.addEventListener('scroll', soon, true);
    window.addEventListener('resize', soon);
    // Another view withdrew its rect (the 3D view unmounted, say): take over if something is selected.
    const unsub = useOverlay.subscribe((s, prev) => {
      if (s.source === null && prev.source !== null && selectedRef.current) soon();
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', soon, true);
      window.removeEventListener('resize', soon);
      unsub();
      useOverlay.getState().clear('plan');
    };
  }, [publish]);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!readOnly && e.dataTransfer.types.includes('application/x-kitchen-product')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    // Any id the catalog registry resolves (built-in or server product) can be dropped.
    const productId = e.dataTransfer.getData('application/x-kitchen-product');
    if (readOnly || !productId || !getProduct(productId)) return;
    e.preventDefault();
    const st = stageRef.current;
    if (!st) return;
    const p = planClientToRoom(e.clientX, e.clientY, st.container().getBoundingClientRect(), viewRef.current);
    placeAt(productId, p.x, p.y);
  };

  useEffect(() => {
    registerExporter('plan', async () => {
      const stage = stageRef.current;
      const paper = paperRef.current;
      if (!stage || !paper) return null;
      const prevSel = useDesignStore.getState().selectedId;
      select(null);
      hover(null);
      setExporting(true);
      try {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = paper.getClientRect();
        return stage.toDataURL({ ...rect, pixelRatio: Math.min(5, 2600 / rect.width) });
      } finally {
        setExporting(false);
        select(prevSel);
      }
    });
    return () => registerExporter('plan', undefined);
  }, [select, hover]);

  const floor = byId(FLOORING, surfaces.flooringId);
  const { W, L } = planSize(room);
  const outlines = useMemo(() => floorOutlines(room), [room]);
  const drawn = !!room.outline || !!room.extra?.length;
  const [addingRoom, setAddingRoom] = useState<null | 'room' | 'zone'>(null);
  const [styling, setStyling] = useState<string | null>(null);
  const [roomMenu, setRoomMenu] = useState(false);
  const margin = 70;

  const ordered = useMemo(() => {
    // Outlets and switches sit on top, like an electrical plan over the cabinet plan.
    const rank = (kind: string, z0: number) => (kind === 'rug' ? 0 : kind === 'window' || kind === 'door' || kind === 'outlet' ? 4 : kind === 'pendant' ? 3 : isOverheadKind(kind) || z0 >= 48 ? 2 : 1);
    return [...all].sort((a, b) => rank(a.product.kind, a.z0) - rank(b.product.kind, b.z0));
  }, [all]);

  const scaleBar = useMemo(() => {
    const pxPerFt = view.scale * 12;
    const options = [1, 2, 3, 4, 5, 8, 10, 20, 40];
    const ft = options.find((o) => o * pxPerFt >= 90) ?? 40;
    return { ft, px: ft * pxPerFt };
  }, [view.scale]);

  const tri = report.triangle;

  const renderItem = (r: Resolved) => (
    <PlanItem
      key={r.item.id}
      item={r.item}
      selected={r.item.id === selectedId}
      hovered={r.item.id === hoverId}
      problem={report.problemIds.has(r.item.id)}
      style={ui.planStyle}
      k={k}
      surfaces={surfaces}
      catalogVersion={catalogVersion}
    />
  );

  return (
    <div className={`plan-view${armed ? ' is-placing' : ''}`} ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop} style={WRAP_STYLE}>
      {/* Not listening: hit-testing is planHit's job (usePlanGestures), so Konva never builds a hit canvas. */}
      <Stage ref={stageRef} width={size.w} height={size.h} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y} listening={false}>
        <Layer listening={false}>
          <PlanPaletteContext.Provider value={pal}>
          <Group>
            <Rect
              ref={paperRef}
              name="bg"
              x={-margin}
              y={-margin}
              width={W + margin * 2}
              height={L + margin * 2}
              fill={rendered ? pal.paper : pal.sheet}
            />
            {drawn ? (
              floorSpaces(room).map((sp, i) => (
                <Line key={i} name="bg" points={sp.pts.flat()} closed {...(rendered ? patternFill((sp.flooringId ? byId(FLOORING, sp.flooringId) : floor).pattern) : { fill: pal.sheet })} />
              ))
            ) : (
              <>
                <Rect name="bg" x={0} y={0} width={W} height={L} {...(rendered ? patternFill(floor.pattern) : { fill: pal.sheet })} />
                {rendered && <Rect x={0} y={0} width={W} height={L} fill="#f6f1e7" opacity={0.12} />}
              </>
            )}
            {ui.showGrid && (
              <Group
                clipFunc={
                  drawn
                    ? (ctx) => {
                        ctx.beginPath();
                        for (const o of outlines) {
                          o.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
                          ctx.closePath();
                        }
                      }
                    : undefined
                }
              >
              <Shape
                sceneFunc={(ctx, shape) => {
                  ctx.beginPath();
                  for (let x = 12; x < W; x += 12) {
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, L);
                  }
                  for (let y = 12; y < L; y += 12) {
                    ctx.moveTo(0, y);
                    ctx.lineTo(W, y);
                  }
                  ctx.strokeShape(shape);
                }}
                stroke={rendered ? 'rgba(255,255,255,0.28)' : pal.grid}
                strokeWidth={1}
                strokeScaleEnabled={false}
              />
              </Group>
            )}

            {ordered.filter((r) => r.product.kind !== 'window' && r.product.kind !== 'door').map(renderItem)}

            {/* Walls sit above the floor pieces so openings can punch through them. */}
            <Group>
              <PlanWalls room={room} k={k} rendered={rendered} hatch={hatch} />
            </Group>
            {ordered.filter((r) => r.product.kind === 'window' || r.product.kind === 'door').map(renderItem)}

            {ui.showDims && <WallDimensions room={room} all={all} k={k} />}

            {ui.showTriangle && tri && (
              <Group>
                <Line
                  points={tri.points.flat()}
                  closed
                  stroke={tri.ok ? OK : WARN}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                  dash={[8 * k, 6 * k]}
                  fill={tri.ok ? 'rgba(63,125,82,0.07)' : 'rgba(201,138,27,0.08)'}
                />
                {tri.points.map(([px, py], i) => (
                  <Circle key={i} x={px} y={py} radius={4.5 * k} fill={tri.ok ? OK : WARN} stroke="#fff" strokeWidth={1.5} strokeScaleEnabled={false} />
                ))}
                {tri.points.map(([px, py], i) => {
                  const [qx, qy] = tri.points[(i + 1) % 3];
                  const text = feetInches(tri.legs[i]);
                  const fs = 10 * k;
                  const tw = text.length * fs * 0.62 + 10 * k;
                  return (
                    <Group key={`l${i}`} x={(px + qx) / 2} y={(py + qy) / 2}>
                      <Rect x={-tw / 2} y={-fs * 0.9} width={tw} height={fs * 1.8} cornerRadius={fs * 0.9} fill={tri.ok ? OK : WARN} />
                      <Text text={text} fontFamily={FONT_MONO} fontSize={fs} fill="#fff" width={tw} x={-tw / 2} y={-fs * 0.5} align="center" />
                    </Group>
                  );
                })}
              </Group>
            )}

            {report.tightAisles.map((a, i) => {
              const color = a.level === 'bad' ? BAD : WARN;
              const fs = 10 * k;
              const text = feetInches(a.gap);
              const tw = text.length * fs * 0.62 + 10 * k;
              return (
                <Group key={i}>
                  <Line points={[...a.a, ...a.b]} stroke={color} strokeWidth={2.5} strokeScaleEnabled={false} dash={[3 * k, 3 * k]} />
                  <Group x={(a.a[0] + a.b[0]) / 2} y={(a.a[1] + a.b[1]) / 2}>
                    <Rect x={-tw / 2} y={-fs * 0.9} width={tw} height={fs * 1.8} cornerRadius={fs * 0.9} fill={color} />
                    <Text text={text} fontFamily={FONT_MONO} fontSize={fs} fill="#fff" width={tw} x={-tw / 2} y={-fs * 0.5} align="center" />
                  </Group>
                </Group>
              );
            })}

            {/* While any view drags the selection (the 3D view too), swap the wall distances for live snap feedback. */}
            {selected && dragging ? (
              <DragFeedback me={selected} all={all} room={room} k={k} />
            ) : (
              selected && ui.showDims && <SelectionDimensions r={selected} room={room} k={k} color={pal.accent} />
            )}
          </Group>
          </PlanPaletteContext.Provider>
        </Layer>
      </Stage>

      <div className="plan-hud plan-hud--tl">
        <div className="seg">
          <button className={rendered ? 'on' : ''} onClick={() => setUI({ planStyle: 'rendered' })}>Rendered</button>
          <button className={!rendered ? 'on' : ''} onClick={() => setUI({ planStyle: 'drafting' })}>Drafting</button>
        </div>
        <div className="toggles">
          <label><input type="checkbox" checked={ui.showDims} onChange={(e) => setUI({ showDims: e.target.checked })} /> Dimensions</label>
          <label><input type="checkbox" checked={ui.showTriangle} onChange={(e) => setUI({ showTriangle: e.target.checked })} /> Work triangle</label>
          <label><input type="checkbox" checked={ui.showGrid} onChange={(e) => setUI({ showGrid: e.target.checked })} /> 1′ grid</label>
        </div>
        {!readOnly && (
          <div className="plan-add-row">
            <div className="plan-menu">
              <button type="button" className="btn plan-add-room" onClick={() => setRoomMenu((o) => !o)} aria-expanded={roomMenu} aria-haspopup="menu" data-testid="add-room">
                Add a room ▾
              </button>
              {roomMenu && (
                <div className="plan-menu-list" role="menu">
                  {ROOM_KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      role="menuitem"
                      data-testid={`add-room-${k.id}`}
                      onClick={() => {
                        setRoomMenu(false);
                        const out = useDesignStore.getState().addRoomKind(k.id);
                        useDesignStore.getState().toast(out.error ?? `${k.label} added beside your plan. Drag its walls in Room & Finishes → Walls & rooms to resize. Ctrl+Z to undo.`, out.error ? 'warn' : 'ok');
                      }}
                    >
                      <span>{k.label}</span>
                      <small>{k.blurb}</small>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    className="plan-menu-draw"
                    onClick={() => {
                      setRoomMenu(false);
                      setAddingRoom('room');
                    }}
                  >
                    <span>Draw your own…</span>
                    <small>click the corners</small>
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="btn plan-add-room" onClick={() => setAddingRoom((a) => (a === 'zone' ? null : 'zone'))} aria-pressed={addingRoom === 'zone'} data-testid="add-zone" title="Mark the kitchen (or living, dining) inside open space, then pick what stands along its border">
              {addingRoom === 'zone' ? 'Cancel' : 'Open area'}
            </button>
          </div>
        )}
      </div>

      <div className="plan-hud plan-hud--tr" aria-hidden>
        <svg width="34" height="44" viewBox="0 0 34 44">
          <circle cx="17" cy="27" r="13" fill="none" stroke={pal.ink} strokeWidth="1" opacity="0.5" />
          <path d="M17 10 L23 30 L17 26 L11 30 Z" fill={pal.ink} />
          <text x="17" y="8" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fill={pal.ink}>N</text>
        </svg>
      </div>

      <div className="plan-hud plan-hud--bl" style={{ pointerEvents: 'none' }}>
        <div className="scalebar" style={{ pointerEvents: 'none' }}>
          <div className="scalebar-bar" style={{ width: scaleBar.px }}>
            <span style={{ width: scaleBar.px / 2 }} />
          </div>
          <div className="scalebar-labels" style={{ width: scaleBar.px }}>
            <span>0</span>
            <span>{scaleBar.ft}′</span>
          </div>
        </div>
      </div>

      <div className="plan-hud plan-hud--br">
        <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, size.w / 2, size.h / 2)}>−</button>
        <button className="zoom-pct" onClick={fit} title="Fit to room">Fit</button>
        <button aria-label="Zoom in" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}>+</button>
      </div>

      {styling && !readOnly && <BorderPicker id={styling} onDone={() => setStyling(null)} />}

      {addingRoom && !readOnly && (
        <PlanRoomDraw
          room={room}
          view={view}
          size={size}
          kind={addingRoom}
          onCancel={() => setAddingRoom(null)}
          onFinish={(outline) => {
            const out = useDesignStore.getState().addRoom(outline, undefined, addingRoom);
            if (out.error) return out.error;
            setAddingRoom(null);
            // An open area's border is a choice (open, half wall, bar...), so offer it straight away.
            if (addingRoom === 'zone' && out.id) setStyling(out.id);
            else useDesignStore.getState().toast('Room added. Ctrl+Z to undo.', 'ok');
            return null;
          }}
        />
      )}

      {items.length === 0 && !armed && !readOnly && (
        <div className="plan-empty">
          <h3>{drawn ? 'Your room is ready' : `A blank room, ${feetInches(W)} × ${feetInches(L)}`}</h3>
          <p>{drawn ? 'Drag cabinets and appliances in from the catalog. They snap to your walls and to each other. Room & Finishes → Walls & rooms changes the shape.' : 'Start from a proven layout, or drag products in from the catalog.'}</p>
          {!drawn && (
          <div className="plan-empty-actions">
            <button onClick={() => applyTemplate('l-island')}>L + Island</button>
            <button onClick={() => applyTemplate('galley')}>Galley</button>
            <button onClick={() => applyTemplate('u-shape')}>U-Shape</button>
            <button onClick={() => applyTemplate('one-wall')}>One Wall</button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
