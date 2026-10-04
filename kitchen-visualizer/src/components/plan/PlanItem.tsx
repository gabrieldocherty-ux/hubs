import { memo, useMemo, type ReactNode } from 'react';
import { Circle, Ellipse, Group, Line, Rect, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import type { PlacedItem, PlanStyle, Surfaces } from '../../types';
import { resolve } from '../../lib/geometry';
import { resolveFinish, cabinetFinish } from '../../lib/finish';
import { productCode } from '../../data/catalog';
import { farmhouseSink } from '../../lib/fronts';
import { COUNTERTOPS, byId } from '../../data/finishes';
import { hashString, luminance, mulberry32, shade } from '../../lib/color';
import { ACCENT, BAD, FONT_MONO, INK, INK_SOFT, PAPER, WALL_T, patternFill } from './planStyle';

export interface DragResult {
  x: number;
  y: number;
  rotation: number;
}

interface Props {
  item: PlacedItem;
  selected: boolean;
  hovered: boolean;
  problem: boolean;
  style: PlanStyle;
  k: number;
  surfaces: Surfaces;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => DragResult | null;
  onDragEnd: (id: string) => void;
}

const hair = { stroke: INK, strokeWidth: 1, strokeScaleEnabled: false } as const;

function steel(hex: string, w: number) {
  return {
    fillLinearGradientStartPoint: { x: -w / 2, y: 0 },
    fillLinearGradientEndPoint: { x: w / 2, y: 0 },
    fillLinearGradientColorStops: [0, shade(hex, -0.12), 0.45, shade(hex, 0.18), 1, shade(hex, -0.1)],
  };
}

export const PlanItem = memo(function PlanItem(p: Props) {
  const r = useMemo(() => resolve(p.item), [p.item]);
  if (!r) return null;
  const { product, w, d } = r;
  const { item, k, style, surfaces } = p;
  const rendered = style === 'rendered';
  const finish = resolveFinish(item, product, surfaces);
  const counter = byId(COUNTERTOPS, surfaces.countertopId);
  const counterFill = rendered ? patternFill(counter.pattern) : { fill: '#ffffff' };
  const labelInk = rendered && luminance(counter.hex) < 0.25 ? '#f2eee8' : INK;
  const dash = [5 * k, 4 * k];
  const x0 = -w / 2;
  const y0 = -d / 2;
  const shadow = rendered
    ? { shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.18, shadowOffsetX: 1.5, shadowOffsetY: 2.5, shadowForStrokeEnabled: false }
    : {};
  const code = productCode(product, w);
  const nodes: ReactNode[] = [];
  let label: string | null = code;
  let labelColor = INK;

  const counterSlab = (key: string, extra: object = {}) => (
    <Rect key={key} x={x0} y={y0} width={w} height={d} {...counterFill} {...hair} strokeWidth={0.9} {...shadow} {...extra} />
  );
  const finishStrip = (key: string, atBack = false) =>
    rendered ? (
      <Rect key={key} x={x0 + 0.5} y={atBack ? y0 : d / 2 - 1.4} width={w - 1} height={1.4} fill={finish.hex} opacity={0.95} listening={false} />
    ) : null;

  switch (product.kind) {
    case 'base':
    case 'dishwasher':
    case 'wine': {
      nodes.push(counterSlab('slab'));
      if (product.kind === 'base') nodes.push(finishStrip('strip'));
      if (product.kind === 'dishwasher') {
        const panel = finish.id === 'panel' ? cabinetFinish(surfaces).hex : finish.hex;
        if (rendered) nodes.push(<Rect key="strip" x={x0 + 0.5} y={d / 2 - 1.4} width={w - 1} height={1.4} fill={panel} listening={false} />);
        nodes.push(<Rect key="dw" x={x0 + 2} y={y0 + 2} width={w - 4} height={d - 4} {...hair} stroke={labelInk} opacity={0.5} dash={dash} listening={false} />);
        label = 'DW';
      }
      if (product.kind === 'wine') {
        if (rendered) nodes.push(<Rect key="strip" x={x0 + 0.5} y={d / 2 - 1.4} width={w - 1} height={1.4} fill={finish.hex} listening={false} />);
        nodes.push(<Rect key="wc" x={x0 + 2} y={y0 + 2} width={w - 4} height={d - 4} {...hair} stroke={labelInk} opacity={0.5} dash={dash} listening={false} />);
      }
      labelColor = labelInk;
      break;
    }
    case 'corner': {
      nodes.push(counterSlab('slab'));
      nodes.push(<Circle key="ls" x={x0 + 20} y={y0 + 20} radius={13} {...hair} stroke={labelInk} opacity={0.45} dash={dash} listening={false} />);
      labelColor = labelInk;
      break;
    }
    case 'island': {
      nodes.push(counterSlab('slab'));
      nodes.push(finishStrip('strip', true));
      nodes.push(<Line key="oh" points={[x0 + 1, d / 2 - 12, -x0 - 1, d / 2 - 12]} {...hair} stroke={labelInk} opacity={0.5} dash={dash} listening={false} />);
      labelColor = labelInk;
      break;
    }
    case 'sink': {
      nodes.push(counterSlab('slab'));
      nodes.push(finishStrip('strip'));
      const basin = { fill: rendered ? finish.hex : '#fff', stroke: INK, strokeWidth: 0.9, strokeScaleEnabled: false, listening: false } as const;
      const inner = rendered ? { shadowColor: '#000', shadowBlur: 5, shadowOpacity: 0.35, shadowOffsetY: 1.5 } : {};
      let drainY = y0 + 14;
      if (product.variant === 'farmhouse') {
        // Same proportions as the 3D model: square-ish back corners, rounder apron corners at the front.
        const s = farmhouseSink(w, d);
        const t = s.wall;
        nodes.push(<Rect key="b" x={-s.bw / 2} y={s.back} width={s.bw} height={s.depth} cornerRadius={[0.35, 0.35, s.cornerR, s.cornerR]} {...basin} {...inner} />);
        nodes.push(<Rect key="bi" x={-s.bw / 2 + t} y={s.back + t} width={s.bw - t * 2} height={s.depth - t * 2} cornerRadius={1.5} stroke={INK} strokeWidth={0.6} strokeScaleEnabled={false} opacity={0.4} listening={false} />);
        drainY = (s.front + s.back) / 2;
      } else if (product.variant === 'double') {
        const bw = (w - 9) / 2;
        nodes.push(<Rect key="b1" x={-bw - 1.5} y={y0 + 5} width={bw} height={16} cornerRadius={2.5} {...basin} {...inner} />);
        nodes.push(<Rect key="b2" x={1.5} y={y0 + 5} width={bw} height={16} cornerRadius={2.5} {...basin} {...inner} />);
        nodes.push(<Circle key="dr2" x={1.5 + bw / 2} y={y0 + 15} radius={1.2} fill={INK} opacity={0.6} listening={false} />);
        nodes.push(<Circle key="dr1" x={-1.5 - bw / 2} y={y0 + 15} radius={1.2} fill={INK} opacity={0.6} listening={false} />);
      } else {
        const bw = product.variant === 'prep' ? Math.min(12, w - 4) : Math.min(w - 7, 30);
        const bd = product.variant === 'prep' ? 12 : 16;
        nodes.push(<Rect key="b" x={-bw / 2} y={y0 + 5} width={bw} height={bd} cornerRadius={2.5} {...basin} {...inner} />);
      }
      if (product.variant !== 'double') nodes.push(<Circle key="drain" x={0} y={drainY} radius={1.3} fill={INK} opacity={0.55} listening={false} />);
      nodes.push(<Circle key="fa" x={0} y={y0 + 2.4} radius={1.3} fill={INK} listening={false} />);
      nodes.push(<Line key="fs" points={[0, y0 + 2.4, 0, y0 + 8]} stroke={INK} strokeWidth={2} strokeScaleEnabled={false} lineCap="round" listening={false} />);
      label = null;
      break;
    }
    case 'range': {
      const body = rendered
        ? finish.material === 'metal'
          ? steel(finish.hex, w)
          : { fill: finish.hex }
        : { fill: '#fff' };
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} {...body} {...hair} {...shadow} />);
      const topY = y0 + 1.5;
      const topH = d - 5;
      const induction = product.variant === 'induction';
      nodes.push(
        <Rect key="top" x={x0 + 1.5} y={topY} width={w - 3} height={topH} fill={rendered ? (induction ? '#141414' : '#262626') : '#fff'} {...hair} strokeWidth={0.7} cornerRadius={induction ? 1.5 : 0.5} listening={false} />,
      );
      const griddle = product.variant === 'griddle';
      const cookW = griddle ? (w - 3) * 0.66 : w - 3;
      const cols = induction ? 2 : product.variant === 'gas-4' ? 2 : 3;
      const rows = 2;
      for (let c = 0; c < cols; c++) {
        for (let rr = 0; rr < rows; rr++) {
          const cx = x0 + 1.5 + (cookW / cols) * (c + 0.5);
          const cy = topY + (topH / rows) * (rr + 0.5);
          const rad = Math.min(cookW / cols, topH / rows) * (induction ? (c + rr) % 2 === 0 ? 0.42 : 0.34 : 0.3);
          if (induction) {
            nodes.push(<Circle key={`b${c}${rr}`} x={cx} y={cy} radius={rad} stroke={rendered ? '#6d6d6d' : INK} strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
          } else {
            nodes.push(<Circle key={`b${c}${rr}`} x={cx} y={cy} radius={rad} stroke={rendered ? '#8a8a8a' : INK} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />);
            nodes.push(<Circle key={`c${c}${rr}`} x={cx} y={cy} radius={rad * 0.42} fill={rendered ? '#4a4a4a' : '#fff'} stroke={rendered ? '#999' : INK} strokeWidth={0.8} strokeScaleEnabled={false} listening={false} />);
          }
        }
      }
      if (!induction && rendered) {
        const gl: number[] = [];
        for (let g = 1; g < cols; g++) gl.push(x0 + 1.5 + (cookW / cols) * g);
        nodes.push(
          <Shape
            key="grates"
            listening={false}
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              for (const gx of gl) {
                ctx.moveTo(gx, topY);
                ctx.lineTo(gx, topY + topH);
              }
              ctx.moveTo(x0 + 1.5, topY + topH / 2);
              ctx.lineTo(x0 + 1.5 + cookW, topY + topH / 2);
              ctx.strokeShape(shape);
            }}
            stroke="#5a5a5a"
            strokeWidth={1}
            strokeScaleEnabled={false}
          />,
        );
      }
      if (griddle) {
        nodes.push(<Rect key="grid" x={x0 + 1.5 + cookW + 1} y={topY + 2} width={w - 3 - cookW - 2} height={topH - 4} fill={rendered ? '#9a9da1' : '#fff'} {...hair} strokeWidth={0.7} listening={false} />);
      }
      const knobs = Math.max(4, Math.round(w / 6));
      for (let i = 0; i < knobs; i++) {
        const kx = x0 + (w / knobs) * (i + 0.5);
        nodes.push(<Circle key={`k${i}`} x={kx} y={d / 2 - 1.7} radius={0.9} fill={rendered ? (product.brand === 'Aurelle' ? '#c6a15b' : '#dcdcdc') : '#fff'} stroke={INK} strokeWidth={0.6} strokeScaleEnabled={false} listening={false} />);
      }
      label = null;
      break;
    }
    case 'fridge': {
      const body = rendered ? (finish.material === 'metal' ? steel(finish.hex, w) : { fill: finish.hex }) : { fill: '#fff' };
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} {...body} {...hair} strokeWidth={1.2} {...shadow} cornerRadius={product.variant === 'retro' ? 3 : 0} />);
      nodes.push(<Rect key="inset" x={x0 + 1.5} y={y0 + 1.5} width={w - 3} height={d - 4} {...hair} opacity={0.35} listening={false} />);
      const doors = product.variant === 'french' ? 2 : 1;
      const leaf = w / doors;
      for (let i = 0; i < doors; i++) {
        const hingeX = doors === 2 ? (i === 0 ? x0 : -x0) : item.mirrored ? -x0 : x0;
        const dir = hingeX < 0 ? 1 : -1;
        nodes.push(
          <Shape
            key={`sw${i}`}
            listening={false}
            opacity={p.selected || p.hovered ? 0.7 : 0.28}
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              ctx.moveTo(hingeX, d / 2);
              ctx.lineTo(hingeX, d / 2 + leaf);
              if (dir > 0) ctx.arc(hingeX, d / 2, leaf, Math.PI / 2, 0, true);
              else ctx.arc(hingeX, d / 2, leaf, Math.PI / 2, Math.PI, false);
              ctx.strokeShape(shape);
            }}
            stroke={INK}
            strokeWidth={0.8}
            strokeScaleEnabled={false}
            dash={dash}
          />,
        );
      }
      if (doors === 2) nodes.push(<Line key="split" points={[0, d / 2 - 6, 0, d / 2]} {...hair} listening={false} />);
      label = 'REF';
      labelColor = rendered && luminance(finish.hex) < 0.2 ? '#eee' : INK;
      break;
    }
    case 'tall':
    case 'oven-tower': {
      const hex = product.kind === 'oven-tower' ? cabinetFinish(surfaces).hex : finish.hex;
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} fill={rendered ? hex : '#fff'} {...hair} strokeWidth={1.2} {...shadow} />);
      nodes.push(<Line key="x1" points={[x0, y0, -x0, -y0]} {...hair} opacity={0.45} listening={false} />);
      nodes.push(<Line key="x2" points={[-x0, y0, x0, -y0]} {...hair} opacity={0.45} listening={false} />);
      if (product.kind === 'oven-tower' && rendered) nodes.push(<Rect key="ov" x={x0 + 2} y={d / 2 - 2} width={w - 4} height={1.5} {...steel(finish.hex, w)} listening={false} />);
      labelColor = rendered && luminance(hex) < 0.2 ? '#eee' : INK;
      break;
    }
    case 'wall': {
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} fill={rendered ? finish.hex : '#fff'} opacity={rendered ? 0.5 : 0.85} listening={true} />);
      nodes.push(<Rect key="o" x={x0} y={y0} width={w} height={d} {...hair} strokeWidth={1.1} dash={dash} listening={false} />);
      if (product.variant === 'bridge') nodes.push(<Line key="x" points={[x0, y0, -x0, -y0]} {...hair} opacity={0.3} dash={dash} listening={false} />);
      break;
    }
    case 'hood': {
      const fill = rendered ? (finish.material === 'metal' ? steel(finish.hex, w) : { fill: finish.hex }) : { fill: '#fff' };
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} {...fill} opacity={0.72} />);
      nodes.push(<Rect key="o" x={x0} y={y0} width={w} height={d} {...hair} strokeWidth={1.1} dash={dash} listening={false} />);
      const dw = Math.min(12, w * 0.35);
      nodes.push(<Rect key="duct" x={-dw / 2} y={y0} width={dw} height={Math.min(10, d * 0.5)} {...hair} opacity={0.6} dash={dash} listening={false} />);
      nodes.push(<Line key="l1" points={[x0, d / 2, -dw / 2, y0 + Math.min(10, d * 0.5)]} {...hair} opacity={0.4} listening={false} />);
      nodes.push(<Line key="l2" points={[-x0, d / 2, dw / 2, y0 + Math.min(10, d * 0.5)]} {...hair} opacity={0.4} listening={false} />);
      label = 'HOOD';
      break;
    }
    case 'microwave': {
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} fill={rendered ? finish.hex : '#fff'} opacity={0.6} />);
      nodes.push(<Rect key="o" x={x0} y={y0} width={w} height={d} {...hair} dash={dash} listening={false} />);
      label = 'MW';
      break;
    }
    case 'shelf': {
      nodes.push(<Rect key="body" x={x0} y={y0} width={w} height={d} {...(rendered ? patternFill({ type: 'wood', base: finish.hex }) : { fill: '#fff' })} opacity={0.75} />);
      nodes.push(<Rect key="o" x={x0} y={y0} width={w} height={d} {...hair} dash={dash} listening={false} />);
      label = null;
      break;
    }
    case 'stool': {
      const rad = Math.min(w, d) / 2;
      if (product.variant === 'backed') {
        nodes.push(
          <Shape
            key="back"
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              ctx.arc(0, 0, rad, Math.PI * 1.1, Math.PI * 1.9);
              ctx.strokeShape(shape);
            }}
            stroke={rendered ? shade(finish.hex, -0.3) : INK}
            strokeWidth={2.6}
            lineCap="round"
            listening={false}
          />,
        );
      }
      nodes.push(<Circle key="seat" x={0} y={0} radius={rad - 1.5} fill={rendered ? finish.hex : '#fff'} {...hair} {...shadow} />);
      nodes.push(<Circle key="in" x={0} y={0} radius={rad - 4.5} stroke={rendered ? shade(finish.hex, 0.25) : INK} strokeWidth={0.8} strokeScaleEnabled={false} opacity={0.6} listening={false} />);
      label = null;
      break;
    }
    case 'chair': {
      nodes.push(<Rect key="seat" x={x0 + 1} y={y0 + 3} width={w - 2} height={d - 4} cornerRadius={3} fill={rendered ? finish.hex : '#fff'} {...hair} {...shadow} />);
      nodes.push(<Rect key="back" x={x0 + 1} y={y0} width={w - 2} height={2.5} cornerRadius={1.2} fill={rendered ? shade(finish.hex, -0.25) : '#fff'} {...hair} listening={false} />);
      label = null;
      break;
    }
    case 'table': {
      const top = rendered ? (finish.material === 'stone' ? patternFill({ type: 'marble', base: finish.hex, vein: '#9a948a', intensity: 0.6 }) : patternFill({ type: 'wood', base: finish.hex })) : { fill: '#fff' };
      if (product.variant === 'round') nodes.push(<Circle key="top" x={0} y={0} radius={w / 2} {...top} {...hair} strokeWidth={1.1} {...shadow} />);
      else nodes.push(<Rect key="top" x={x0} y={y0} width={w} height={d} cornerRadius={2} {...top} {...hair} strokeWidth={1.1} {...shadow} />);
      label = null;
      break;
    }
    case 'pendant': {
      if (product.variant === 'linear') {
        if (rendered) nodes.push(<Rect key="glow" x={x0 - 8} y={y0 - 10} width={w + 16} height={d + 20} cornerRadius={12} fillRadialGradientStartPoint={{ x: 0, y: 0 }} fillRadialGradientEndPoint={{ x: 0, y: 0 }} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={w / 2 + 8} fillRadialGradientColorStops={[0, 'rgba(255,196,110,0.28)', 1, 'rgba(255,196,110,0)']} listening={false} />);
        nodes.push(<Rect key="bar" x={x0} y={y0} width={w} height={d} fill={rendered ? finish.hex : '#fff'} opacity={0.8} />);
        nodes.push(<Rect key="o" x={x0} y={y0} width={w} height={d} {...hair} dash={dash} listening={false} />);
        for (let i = 0; i < 4; i++) nodes.push(<Circle key={`l${i}`} x={x0 + (w / 4) * (i + 0.5)} y={0} radius={1.2} fill={INK} listening={false} />);
      } else {
        const rad = w / 2;
        if (rendered) nodes.push(<Circle key="glow" x={0} y={0} radius={rad + 14} fillRadialGradientStartPoint={{ x: 0, y: 0 }} fillRadialGradientEndPoint={{ x: 0, y: 0 }} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={rad + 14} fillRadialGradientColorStops={[0, 'rgba(255,196,110,0.34)', 1, 'rgba(255,196,110,0)']} listening={false} />);
        nodes.push(<Circle key="shade" x={0} y={0} radius={rad} fill={rendered ? finish.hex : '#fff'} opacity={rendered ? 0.85 : 1} />);
        nodes.push(<Circle key="o" x={0} y={0} radius={rad} {...hair} dash={dash} listening={false} />);
        nodes.push(<Line key="c1" points={[-rad * 0.7, -rad * 0.7, rad * 0.7, rad * 0.7]} {...hair} opacity={0.55} listening={false} />);
        nodes.push(<Line key="c2" points={[rad * 0.7, -rad * 0.7, -rad * 0.7, rad * 0.7]} {...hair} opacity={0.55} listening={false} />);
      }
      label = null;
      break;
    }
    case 'rug': {
      nodes.push(<Rect key="base" x={x0} y={y0} width={w} height={d} fill={rendered ? finish.hex : '#fff'} opacity={rendered ? 0.92 : 1} {...hair} strokeWidth={0.7} />);
      nodes.push(<Rect key="border" x={x0 + 3} y={y0 + 3} width={w - 6} height={d - 6} stroke={rendered ? shade(finish.hex, 0.35) : INK} strokeWidth={1.5} strokeScaleEnabled={false} opacity={0.8} listening={false} />);
      const rng = mulberry32(hashString(item.id));
      const bands = Math.floor((d - 12) / 8);
      for (let b = 0; b < bands; b++) {
        const yy = y0 + 8 + b * 8 + rng() * 2;
        nodes.push(<Line key={`s${b}`} points={[x0 + 6, yy, -x0 - 6, yy]} stroke={rendered ? shade(finish.hex, b % 2 ? -0.25 : 0.3) : INK} strokeWidth={b % 3 === 0 ? 2 : 1} strokeScaleEnabled={false} opacity={0.6} listening={false} />);
      }
      label = null;
      break;
    }
    case 'plant': {
      const rng = mulberry32(hashString(item.id + product.id));
      nodes.push(<Circle key="pot" x={0} y={0} radius={Math.min(w, d) * 0.3} fill={rendered ? finish.hex : '#fff'} {...hair} {...shadow} />);
      const olive = product.variant === 'olive';
      const leaves = olive ? 46 : 14;
      for (let i = 0; i < leaves; i++) {
        const a = rng() * Math.PI * 2;
        const dist = Math.sqrt(rng()) * (w / 2 - (olive ? 2 : 4));
        const lx = Math.cos(a) * dist;
        const ly = Math.sin(a) * dist;
        const green = olive ? ['#7f8f6a', '#9aa784', '#6b7a58'][i % 3] : ['#3f6b3a', '#4f7f45', '#35592f'][i % 3];
        nodes.push(
          <Ellipse
            key={`lf${i}`}
            x={lx}
            y={ly}
            radiusX={olive ? 2.6 : 5.5}
            radiusY={olive ? 1 : 3.2}
            rotation={(a * 180) / Math.PI + rng() * 40}
            fill={rendered ? green : '#fff'}
            stroke={rendered ? shade(green, -0.3) : INK}
            strokeWidth={0.5}
            strokeScaleEnabled={false}
            opacity={0.95}
            listening={false}
          />,
        );
      }
      label = null;
      break;
    }
    case 'window': {
      const frame = rendered ? finish.hex : '#fff';
      nodes.push(<Rect key="gap" x={x0} y={-WALL_T} width={w} height={WALL_T} fill={PAPER} />);
      nodes.push(<Rect key="frame" x={x0} y={-WALL_T} width={w} height={WALL_T} fill={frame} opacity={0.25} {...hair} />);
      nodes.push(<Line key="g1" points={[x0, -WALL_T * 0.62, -x0, -WALL_T * 0.62]} {...hair} listening={false} />);
      nodes.push(<Line key="g2" points={[x0, -WALL_T * 0.38, -x0, -WALL_T * 0.38]} {...hair} listening={false} />);
      nodes.push(<Rect key="sill" x={x0 - 1.5} y={0} width={w + 3} height={1.2} fill={rendered ? '#fff' : '#fff'} {...hair} strokeWidth={0.8} listening={false} />);
      if (product.variant === 'casement') nodes.push(<Line key="m" points={[0, -WALL_T, 0, 0]} {...hair} listening={false} />);
      label = null;
      break;
    }
    case 'door': {
      nodes.push(<Rect key="gap" x={x0} y={-WALL_T} width={w} height={WALL_T + 0.2} fill={PAPER} />);
      nodes.push(<Line key="j1" points={[x0, -WALL_T, x0, 0]} {...hair} strokeWidth={1.4} listening={false} />);
      nodes.push(<Line key="j2" points={[-x0, -WALL_T, -x0, 0]} {...hair} strokeWidth={1.4} listening={false} />);
      if (product.variant !== 'opening') {
        const leaves: [number, number][] =
          product.variant === 'double' ? [[x0, w / 2], [-x0, w / 2]] : [[item.mirrored ? -x0 : x0, w]];
        leaves.forEach(([hx, len], i) => {
          const right = hx > 0;
          nodes.push(<Line key={`leaf${i}`} points={[hx, 0, hx, len]} stroke={INK} strokeWidth={2} strokeScaleEnabled={false} listening={false} />);
          nodes.push(
            <Shape
              key={`arc${i}`}
              listening={false}
              sceneFunc={(ctx, shape) => {
                ctx.beginPath();
                if (right) ctx.arc(hx, 0, len, Math.PI / 2, Math.PI, false);
                else ctx.arc(hx, 0, len, 0, Math.PI / 2, false);
                ctx.strokeShape(shape);
              }}
              stroke={INK}
              strokeWidth={0.8}
              strokeScaleEnabled={false}
              opacity={0.7}
            />,
          );
        });
      }
      label = null;
      break;
    }
  }

  const highlight = p.problem ? BAD : p.selected ? ACCENT : p.hovered ? INK_SOFT : null;
  const box = product.kind === 'window' || product.kind === 'door' ? { x: x0, y: -WALL_T, w, h: WALL_T + (product.kind === 'door' ? 4 : 1.5) } : { x: x0, y: y0, w, h: d };
  const round = product.kind === 'stool' || (product.kind === 'table' && product.variant === 'round') || (product.kind === 'pendant' && product.variant !== 'linear');

  return (
    <Group
      x={item.x}
      y={item.y}
      rotation={item.rotation}
      draggable
      onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true;
      }}
      onClick={() => p.onSelect(item.id)}
      onTap={() => p.onSelect(item.id)}
      onMouseEnter={(e) => {
        p.onHover(item.id);
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = 'grab';
      }}
      onMouseLeave={(e) => {
        p.onHover(null);
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = '';
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        p.onDragStart(item.id);
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const node = e.target;
        const res = p.onDragMove(item.id, node.x(), node.y());
        if (res) {
          node.position({ x: res.x, y: res.y });
          node.rotation(res.rotation);
        }
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        p.onDragEnd(item.id);
      }}
    >
      {nodes}
      {p.problem && (
        <Rect x={box.x} y={box.y} width={box.w} height={box.h} fill={BAD} opacity={0.14} listening={false} />
      )}
      {highlight &&
        (round ? (
          <Circle x={0} y={0} radius={Math.max(w, d) / 2 + 1.5} stroke={highlight} strokeWidth={p.selected ? 2.2 : 1.5} strokeScaleEnabled={false} listening={false} />
        ) : (
          <Rect x={box.x - 1} y={box.y - 1} width={box.w + 2} height={box.h + 2} stroke={highlight} strokeWidth={p.selected ? 2.2 : 1.5} strokeScaleEnabled={false} listening={false} cornerRadius={0.5} />
        ))}
      {label && Math.min(w, d) / k > 26 && (
        <Group y={r.z0 < 40 && d >= 20 && product.kind !== 'island' ? d / 4 : 0} listening={false}>
        <Group rotation={-item.rotation} listening={false}>
          <Text
            text={label}
            fontFamily={FONT_MONO}
            fontSize={9.5 * k}
            fontStyle="500"
            fill={labelColor}
            opacity={0.8}
            width={120 * k}
            x={-60 * k}
            y={-5 * k}
            align="center"
          />
        </Group>
        </Group>
      )}
    </Group>
  );
});

export function isOverheadKind(kind: string): boolean {
  return kind === 'wall' || kind === 'hood' || kind === 'microwave' || kind === 'shelf' || kind === 'pendant';
}

export { PAPER };
