import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { DesignDoc } from '../../types';
import { MiniPlan } from '../../components/MiniPlan';
import { APPLIANCE_WIDTHS } from '../../../server/llm/photoModel.mjs';
import { wallLen, type ApplianceKind, type PhotoModel, type PhotoWall } from '../../lib/generate/photoModel';
import { formatLength, needsCheck, updateItem, type Units } from '../../lib/generate/edit';

export const KIND_LABEL: Record<ApplianceKind, string> = {
  sink: 'Sink',
  range: 'Range',
  cooktop: 'Cooktop',
  'wall-oven': 'Wall oven',
  fridge: 'Fridge',
  dishwasher: 'Dishwasher',
  hood: 'Hood',
  microwave: 'Microwave',
};

const SHORT: Record<ApplianceKind, string> = {
  sink: 'Sink',
  range: 'Range',
  cooktop: 'Cooktop',
  'wall-oven': 'Oven',
  fridge: 'Fridge',
  dishwasher: 'DW',
  hood: 'Hood',
  microwave: 'MW',
};

const overhead = (k: ApplianceKind) => k === 'hood' || k === 'microwave';
const horizontal = (w: PhotoWall) => w === 'north' || w === 'south';

interface Drag {
  list: 'appliances' | 'openings';
  index: number;
  wall: PhotoWall;
  width: number;
  len: number;
  /** Pointer position minus the item's centre, along the wall, at the start of the drag. */
  grab: number;
  last: number;
}

/**
 * The live plan on "Check the space": the kitchen as it will be built (MiniPlan), with handles
 * for the appliances, windows and doors that drag along their wall. Its overlay uses the same
 * viewBox as MiniPlan so the two line up exactly.
 */
export function SpacePlan({
  model,
  doc,
  units,
  focusKey,
  onChange,
  onFocusKey,
  hasPhotos = false,
}: {
  hasPhotos?: boolean;
  model: PhotoModel;
  doc: DesignDoc;
  units: Units;
  focusKey: string | null;
  onChange: (m: PhotoModel) => void;
  onFocusKey: (key: string | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef(model);
  latest.current = model;

  const W = model.room.widthIn;
  const L = model.room.lengthIn;
  // MiniPlan's own frame (src/components/MiniPlan.tsx).
  const T = Math.max(4, Math.max(W, L) * 0.025);
  const pad = T + 4;
  const fs = Math.max(W, L) * 0.034;
  const ratio = (W + pad * 2) / (L + pad * 2);

  const at = (wall: PhotoWall, along: number, inset: number) =>
    wall === 'north' ? { x: along, y: inset } : wall === 'south' ? { x: along, y: L - inset } : wall === 'west' ? { x: inset, y: along } : { x: W - inset, y: along };

  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = el.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(m.inverse());
  };

  const move = (d: Drag, offset: number) => {
    const next = Math.round(Math.min(Math.max(0, offset), Math.max(0, d.len - d.width)) * 2) / 2;
    if (next === d.last) return;
    d.last = next;
    onChange(updateItem(latest.current, d.list, d.index, { offsetIn: next }));
  };

  const start = (e: PointerEvent<SVGGElement>, list: Drag['list'], index: number, wall: PhotoWall, offsetIn: number, width: number) => {
    const p = svgPoint(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const along = horizontal(wall) ? p.x : p.y;
    drag.current = { list, index, wall, width, len: wallLen(wall, latest.current.room), grab: along - (offsetIn + width / 2), last: offsetIn };
    onFocusKey(`${list}.${index}`);
  };
  const onMove = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = svgPoint(e);
    if (!p) return;
    const along = horizontal(d.wall) ? p.x : p.y;
    move(d, along - d.grab - d.width / 2);
  };
  const end = () => {
    drag.current = null;
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, list: Drag['list'], index: number, wall: PhotoWall, offsetIn: number, width: number) => {
    const step = e.shiftKey ? 6 : 1;
    const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step : 0;
    if (!delta) return;
    e.preventDefault();
    move({ list, index, wall, width, len: wallLen(wall, model.room), grab: 0, last: offsetIn }, offsetIn + delta);
  };

  const handleProps = (list: Drag['list'], index: number, wall: PhotoWall, offsetIn: number, width: number, label: string) => {
    const len = wallLen(wall, model.room);
    const from = horizontal(wall) ? 'west' : 'north';
    return {
      role: 'slider',
      tabIndex: 0,
      'aria-label': `${label} on the ${wall} wall`,
      'aria-valuemin': 0,
      'aria-valuemax': Math.max(0, len - width),
      'aria-valuenow': offsetIn,
      'aria-valuetext': `${formatLength(offsetIn, units)} from the ${from} end`,
      onPointerDown: (e: PointerEvent<SVGGElement>) => start(e, list, index, wall, offsetIn, width),
      onPointerMove: onMove,
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: (e: KeyboardEvent<SVGGElement>) => onKey(e, list, index, wall, offsetIn, width),
      onFocus: () => onFocusKey(`${list}.${index}`),
    };
  };

  return (
    <div className="gen-plan">
      <div className="gen-plan-box" style={{ aspectRatio: `${(W + pad * 2).toFixed(2)} / ${(L + pad * 2).toFixed(2)}`, width: `min(100cqw, calc(100cqh * ${ratio.toFixed(4)}))` }}>
        <MiniPlan doc={doc} className="gen-plan-mini" />
        <svg ref={svg} className="gen-plan-overlay" viewBox={`${-pad} ${-pad} ${W + pad * 2} ${L + pad * 2}`} preserveAspectRatio="xMidYMid meet">
          {model.openings.map((o, i) => {
            const key = `openings.${i}`;
            const c = o.offsetIn + o.widthIn / 2;
            const p = horizontal(o.wall) ? { x: c, y: o.wall === 'north' ? -T / 2 : L + T / 2 } : { x: o.wall === 'west' ? -T / 2 : W + T / 2, y: c };
            const r = T * 1.15;
            const cls = `gen-h gen-h-open${needsCheck(model, key) ? ' check' : ''}${focusKey === key ? ' on' : ''}`;
            return (
              <g key={key} className={cls} {...handleProps('openings', i, o.wall, o.offsetIn, o.widthIn, o.type === 'window' ? 'Window' : 'Door')}>
                <circle cx={p.x} cy={p.y} r={r} />
                <text x={p.x} y={p.y} fontSize={r * 1.1} dominantBaseline="central" textAnchor="middle">
                  {o.type === 'window' ? 'W' : 'D'}
                </text>
              </g>
            );
          })}
          {model.appliances.map((a, i) => {
            if (a.wall === 'island') return null;
            const key = `appliances.${i}`;
            const width = a.widthIn ?? APPLIANCE_WIDTHS[a.kind].def;
            const up = overhead(a.kind);
            const p = at(a.wall, a.offsetIn + width / 2, up ? fs * 0.75 : 14);
            const text = SHORT[a.kind];
            const size = up ? fs * 0.8 : fs;
            const w = text.length * size * 0.6 + size * 0.9;
            const h = size * 1.45;
            const cls = `gen-h gen-h-app${up ? ' up' : ''}${needsCheck(model, key) ? ' check' : ''}${focusKey === key ? ' on' : ''}`;
            return (
              <g key={key} className={cls} {...handleProps('appliances', i, a.wall, a.offsetIn, width, KIND_LABEL[a.kind])}>
                <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={h / 2} />
                <text x={p.x} y={p.y} fontSize={size} dominantBaseline="central" textAnchor="middle">
                  {text}
                </text>
              </g>
            );
          })}
        </svg>
        <span className="gen-wall-label n">{hasPhotos ? 'North · photo 1 faces it' : 'North'}</span>
        <span className="gen-wall-label s">South</span>
        <span className="gen-wall-label w">West</span>
        <span className="gen-wall-label e">East</span>
      </div>
    </div>
  );
}
