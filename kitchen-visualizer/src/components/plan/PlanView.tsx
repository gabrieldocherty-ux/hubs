import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { useDesignStore, useSelected } from '../../store/useDesignStore';
import { useReport, useResolvedItems } from '../../store/derived';
import { FLOORING, byId } from '../../data/finishes';
import { getProduct } from '../../data/catalog';
import { feetInches } from '../../lib/format';
import { registerExporter } from '../../lib/exporters';
import { planClientToRoom, registerDropTarget } from '../../lib/interaction';
import { ACCENT, BAD, FONT_MONO, INK, OK, PAPER, WALL, WALL_T, WARN, patternFill } from './planStyle';
import { PlanItem, isOverheadKind } from './PlanItem';
import { SelectionDimensions, WallDimensions } from './Dimensions';

interface View {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.8;
const MAX_SCALE = 30;

function hatchCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 12, 12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -12; i <= 24; i += 6) {
    ctx.moveTo(i, 12);
    ctx.lineTo(i + 12, 0);
  }
  ctx.stroke();
  return c;
}

export function PlanView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const worldRef = useRef<Konva.Group>(null);
  const paperRef = useRef<Konva.Rect>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ scale: 3, x: 60, y: 60 });
  const userZoomed = useRef(false);

  const room = useDesignStore((s) => s.doc.room);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const items = useDesignStore((s) => s.doc.items);
  const selectedId = useDesignStore((s) => s.selectedId);
  const hoverId = useDesignStore((s) => s.hoverId);
  const ui = useDesignStore((s) => s.ui);
  const select = useDesignStore((s) => s.select);
  const hover = useDesignStore((s) => s.hover);
  const setUI = useDesignStore((s) => s.setUI);
  const addItem = useDesignStore((s) => s.addItem);
  const dragStart = useDesignStore((s) => s.dragStart);
  const dragMove = useDesignStore((s) => s.dragMove);
  const dragEnd = useDesignStore((s) => s.dragEnd);
  const applyTemplate = useDesignStore((s) => s.applyTemplate);
  const all = useResolvedItems();
  const report = useReport();
  const selected = useSelected();
  const hatch = useMemo(() => hatchCanvas(), []);

  const k = 1 / view.scale;
  const rendered = ui.planStyle === 'rendered';

  const fit = useCallback(() => {
    const m = 72;
    const scale = Math.min((size.w - m * 2) / (room.widthIn + 20), (size.h - m * 2) / (room.lengthIn + 20));
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    setView({ scale: s, x: (size.w - room.widthIn * s) / 2 + 12, y: (size.h - room.lengthIn * s) / 2 + 14 });
    userZoomed.current = false;
  }, [size.w, size.h, room.widthIn, room.lengthIn]);

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

  useEffect(() => {
    fit();
  }, [fit]);

  // Lets the catalog (touch drag, tap-to-place) drop products here; see lib/interaction.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    return registerDropTarget('plan', el, (cx, cy) => {
      const st = stageRef.current;
      if (!st) return null;
      return planClientToRoom(cx, cy, st.container().getBoundingClientRect(), { x: st.x(), y: st.y(), scale: st.scaleX() });
    });
  }, []);

  const zoomAt = (factor: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const wx = (px - v.x) / v.scale;
      const wy = (py - v.y) / v.scale;
      return { scale, x: px - wx * scale, y: py - wy * scale };
    });
    userZoomed.current = true;
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return;
    const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0015));
    zoomAt(factor, p.x, p.y);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-kitchen-product')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const productId = e.dataTransfer.getData('application/x-kitchen-product');
    if (!productId || !getProduct(productId)) return;
    e.preventDefault();
    const stage = stageRef.current;
    const world = worldRef.current;
    if (!stage || !world) return;
    stage.setPointersPositions(e.nativeEvent);
    const pos = world.getRelativePointerPosition();
    if (!pos) return;
    addItem(productId, { x: pos.x, y: pos.y });
  };

  const onItemSelect = useCallback(
    (id: string) => {
      select(id);
      setUI({ rightTab: 'details' });
    },
    [select, setUI],
  );

  useEffect(() => {
    registerExporter('plan', async () => {
      const stage = stageRef.current;
      const paper = paperRef.current;
      if (!stage || !paper) return null;
      const prevSel = useDesignStore.getState().selectedId;
      select(null);
      hover(null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rect = paper.getClientRect();
      const url = stage.toDataURL({ ...rect, pixelRatio: Math.min(5, 2600 / rect.width) });
      select(prevSel);
      return url;
    });
    return () => registerExporter('plan', undefined);
  }, [select, hover]);

  const floor = byId(FLOORING, surfaces.flooringId);
  const W = room.widthIn;
  const L = room.lengthIn;
  const margin = 70;

  const ordered = useMemo(() => {
    const rank = (kind: string, z0: number) => (kind === 'rug' ? 0 : kind === 'window' || kind === 'door' ? 4 : kind === 'pendant' ? 3 : isOverheadKind(kind) || z0 >= 48 ? 2 : 1);
    return [...all].sort((a, b) => rank(a.product.kind, a.z0) - rank(b.product.kind, b.z0));
  }, [all]);

  const scaleBar = useMemo(() => {
    const pxPerFt = view.scale * 12;
    const options = [1, 2, 3, 4, 5, 8, 10, 20];
    const ft = options.find((o) => o * pxPerFt >= 90) ?? 20;
    return { ft, px: ft * pxPerFt };
  }, [view.scale]);

  const tri = report.triangle;

  return (
    <div className="plan-view" ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop}>
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable
        onWheel={onWheel}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage() || e.target.name() === 'bg') select(null);
        }}
        onDragMove={(e) => {
          if (e.target === stageRef.current) {
            setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
            userZoomed.current = true;
          }
        }}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
      >
        <Layer>
          <Group ref={worldRef}>
            <Rect
              ref={paperRef}
              name="bg"
              x={-margin}
              y={-margin}
              width={W + margin * 2}
              height={L + margin * 2}
              fill={rendered ? PAPER : '#ffffff'}
            />
            <Rect name="bg" x={0} y={0} width={W} height={L} {...(rendered ? patternFill(floor.pattern) : { fill: '#ffffff' })} />
            {rendered && <Rect x={0} y={0} width={W} height={L} fill="#f6f1e7" opacity={0.12} listening={false} />}
            {ui.showGrid && (
              <Shape
                listening={false}
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
                stroke={rendered ? 'rgba(255,255,255,0.28)' : 'rgba(41,37,31,0.09)'}
                strokeWidth={1}
                strokeScaleEnabled={false}
              />
            )}

            {ordered
              .filter((r) => r.product.kind !== 'window' && r.product.kind !== 'door')
              .map((r) => (
                <PlanItem
                  key={r.item.id}
                  item={r.item}
                  selected={r.item.id === selectedId}
                  hovered={r.item.id === hoverId}
                  problem={report.problemIds.has(r.item.id)}
                  style={ui.planStyle}
                  k={k}
                  surfaces={surfaces}
                  onSelect={onItemSelect}
                  onHover={hover}
                  onDragStart={dragStart}
                  onDragMove={dragMove}
                  onDragEnd={dragEnd}
                />
              ))}

            {/* Walls sit above the floor pieces so openings can punch through them. */}
            <Group listening={false}>
              {[
                [-WALL_T, -WALL_T, W + WALL_T * 2, WALL_T],
                [-WALL_T, L, W + WALL_T * 2, WALL_T],
                [-WALL_T, 0, WALL_T, L],
                [W, 0, WALL_T, L],
              ].map(([x, y, w, h], i) => (
                <Rect
                  key={i}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  {...(rendered ? { fill: WALL } : { fillPatternImage: hatch as unknown as HTMLImageElement, fillPatternScale: { x: k, y: k } })}
                  stroke={INK}
                  strokeWidth={1.2}
                  strokeScaleEnabled={false}
                />
              ))}
            </Group>
            {ordered
              .filter((r) => r.product.kind === 'window' || r.product.kind === 'door')
              .map((r) => (
                <PlanItem
                  key={r.item.id}
                  item={r.item}
                  selected={r.item.id === selectedId}
                  hovered={r.item.id === hoverId}
                  problem={report.problemIds.has(r.item.id)}
                  style={ui.planStyle}
                  k={k}
                  surfaces={surfaces}
                  onSelect={onItemSelect}
                  onHover={hover}
                  onDragStart={dragStart}
                  onDragMove={dragMove}
                  onDragEnd={dragEnd}
                />
              ))}

            {ui.showDims && <WallDimensions room={room} all={all} k={k} />}

            {ui.showTriangle && tri && (
              <Group listening={false}>
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
                <Group key={i} listening={false}>
                  <Line points={[...a.a, ...a.b]} stroke={color} strokeWidth={2.5} strokeScaleEnabled={false} dash={[3 * k, 3 * k]} />
                  <Group x={(a.a[0] + a.b[0]) / 2} y={(a.a[1] + a.b[1]) / 2}>
                    <Rect x={-tw / 2} y={-fs * 0.9} width={tw} height={fs * 1.8} cornerRadius={fs * 0.9} fill={color} />
                    <Text text={text} fontFamily={FONT_MONO} fontSize={fs} fill="#fff" width={tw} x={-tw / 2} y={-fs * 0.5} align="center" />
                  </Group>
                </Group>
              );
            })}

            {selected && ui.showDims && <SelectionDimensions r={selected} room={room} k={k} color={ACCENT} />}
          </Group>
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
      </div>

      <div className="plan-hud plan-hud--tr" aria-hidden>
        <svg width="34" height="44" viewBox="0 0 34 44">
          <circle cx="17" cy="27" r="13" fill="none" stroke={INK} strokeWidth="1" opacity="0.5" />
          <path d="M17 10 L23 30 L17 26 L11 30 Z" fill={INK} />
          <text x="17" y="8" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fill={INK}>N</text>
        </svg>
      </div>

      <div className="plan-hud plan-hud--bl">
        <div className="scalebar">
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

      {items.length === 0 && (
        <div className="plan-empty">
          <h3>A blank room, {feetInches(W)} × {feetInches(L)}</h3>
          <p>Start from a proven layout, or drag products in from the catalog.</p>
          <div className="plan-empty-actions">
            <button onClick={() => applyTemplate('l-island')}>L + Island</button>
            <button onClick={() => applyTemplate('galley')}>Galley</button>
            <button onClick={() => applyTemplate('u-shape')}>U-Shape</button>
            <button onClick={() => applyTemplate('one-wall')}>One Wall</button>
          </div>
        </div>
      )}
    </div>
  );
}
