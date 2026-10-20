import { memo, type ReactNode } from 'react';
import type { DoorStyle, Finish, Product, Surfaces } from '../types';
import { baseFronts, farmhouseFronts, farmhouseSink, type FrontSpec } from '../lib/fronts';
import { CABINET_FINISHES, COUNTERTOPS, byId } from '../data/finishes';
import { resolveHardware } from '../lib/fixtures';
import { luminance, shade } from '../lib/color';

const INK = '#2a2622';

interface Props {
  product: Product;
  finish?: Finish;
  surfaces: Surfaces;
  width?: number;
  mirrored?: boolean;
  className?: string;
}

/** Front-elevation drawing of a product, tinted with the kitchen's current finishes. */
export interface ArtResult {
  nodes: ReactNode[];
  /** Drawing height in inches; the drawing's bottom edge is at y = H. */
  H: number;
  w: number;
  color: string;
}

/** Draws a product's front elevation in inch units, origin at its top-left. */
export function drawArt({ product, finish, surfaces, width }: Omit<Props, 'className' | 'mirrored'>): ArtResult {
  const cab = byId(CABINET_FINISHES, surfaces.cabinetFinishId);
  const list = product.finishes === 'cabinet' ? CABINET_FINISHES : product.finishes;
  const f = finish ?? (product.finishes === 'cabinet' ? cab : list[0]);
  const color = f.material === 'panel' ? cab.hex : f.hex;
  const counter = byId(COUNTERTOPS, surfaces.countertopId).hex;
  const hw = resolveHardware(surfaces).hex;
  const style = surfaces.doorStyle;
  const w = width ?? product.widthIn;
  const k = product.kind;

  let H = product.heightIn;
  let top = 0;
  const nodes: ReactNode[] = [];
  const Y = (fromFloor: number) => H - fromFloor;

  if (product.source === 'missing') {
    // Not available (yet): a neutral dashed outline at the item's nominal size.
    nodes.push(<rect key="missing" x={0} y={0} width={w} height={H} fill="#ece7de" stroke={INK} strokeDasharray="3 2" />);
    return { nodes, H, w, color };
  }

  const front = (fr: FrontSpec, fill: string, key: string, offsetX = 0, st: DoorStyle = style) => {
    const x = offsetX + fr.x - fr.w / 2 + 0.2;
    const y = Y(fr.y + fr.h) + 0.2;
    const fw = Math.max(0.1, fr.w - 0.4);
    const fh = Math.max(0.1, fr.h - 0.4);
    const rail = Math.max(1, Math.min(2.6, fw * 0.17, fh * 0.17));
    const pull = fr.pull;
    return (
      <g key={key}>
        <rect x={x} y={y} width={fw} height={fh} fill={fill} stroke={INK} />
        {fr.glass ? (
          <rect x={x + rail} y={y + rail} width={fw - rail * 2} height={fh - rail * 2} fill="#dfe8ea" stroke={INK} opacity={0.9} />
        ) : st === 'shaker' && fw > 5 && fh > 4 ? (
          <rect x={x + rail} y={y + rail} width={fw - rail * 2} height={fh - rail * 2} fill={shade(fill, -0.06)} stroke={INK} strokeOpacity={0.55} />
        ) : st === 'fluted' ? (
          Array.from({ length: Math.floor(fw / 1.4) }).map((_, i) => (
            <line key={i} x1={x + 0.7 + i * 1.4} y1={y + 0.5} x2={x + 0.7 + i * 1.4} y2={y + fh - 0.5} stroke={INK} strokeOpacity={0.28} />
          ))
        ) : null}
        {pull &&
          (pull.dir === 'h' ? (
            <line x1={offsetX + pull.x - pull.len / 2} y1={Y(pull.y)} x2={offsetX + pull.x + pull.len / 2} y2={Y(pull.y)} stroke={hw} strokeWidth={2.2} strokeLinecap="round" />
          ) : (
            <line x1={offsetX + pull.x} y1={Y(pull.y - pull.len / 2)} x2={offsetX + pull.x} y2={Y(pull.y + pull.len / 2)} stroke={hw} strokeWidth={2.2} strokeLinecap="round" />
          ))}
      </g>
    );
  };

  const countertop = (x0: number, x1: number) => <rect key="ct" x={x0} y={Y(36)} width={x1 - x0} height={1.5} fill={counter} stroke={INK} />;
  const toe = <rect key="toe" x={Math.min(1.5, w / 4)} y={Y(4)} width={Math.max(0, w - 2 * Math.min(1.5, w / 4))} height={4} fill="#3a342d" />;
  const steel = (hex: string) => (f.material === 'metal' ? `url(#steel-${hex.slice(1)})` : hex);

  switch (k) {
    case 'base':
    case 'corner':
    case 'island': {
      H = 36;
      if (product.variant !== 'panel') nodes.push(toe);
      nodes.push(<rect key="body" x={0} y={Y(34.5)} width={w} height={30.5} fill={color} stroke={INK} />);
      if (k === 'island') {
        const cols = Math.max(2, Math.round(w / 24));
        const cw = w / cols;
        for (let c = 0; c < cols; c++) baseFronts(cw, c % 2 ? 'drawers' : 'door-drawer').forEach((fr, i) => nodes.push(front(fr, color, `f${c}-${i}`, cw * (c + 0.5))));
      } else if (k === 'corner') {
        nodes.push(front({ x: 12, y: 4, w: 24, h: 30.5, pull: null }, shade(color, -0.04), 'blind', 0));
        nodes.push(front({ x: 30, y: 4, w: 12, h: 30.5, pull: { dir: 'v', x: 26.5, y: 24, len: 5 } }, color, 'door', 0));
      } else baseFronts(w, product.variant).forEach((fr, i) => nodes.push(front(fr, color, `f${i}`, w / 2)));
      nodes.push(countertop(-0.8, w + 0.8));
      break;
    }
    case 'sink': {
      H = 52;
      nodes.push(toe);
      nodes.push(<rect key="body" x={0} y={Y(34.5)} width={w} height={30.5} fill={cab.hex} stroke={INK} />);
      const farm = product.variant === 'farmhouse' ? farmhouseSink(w, product.depthIn) : null;
      (farm ? farmhouseFronts(w, farm) : baseFronts(w, 'door-drawer', { falseTop: true })).forEach((fr, i) => nodes.push(front(fr, cab.hex, `f${i}`, w / 2)));
      nodes.push(countertop(-0.8, w + 0.8));
      if (farm) {
        const ax = (w - farm.bw) / 2;
        nodes.push(<rect key="reveal" x={ax} y={Y(farm.apronY0 + 0.1)} width={farm.bw} height={farm.apronY0 - farm.doorTop + 0.3} fill="#2a2622" />);
        nodes.push(<rect key="apron" x={ax} y={Y(farm.rimY)} width={farm.bw} height={farm.apronH} rx={0.5} fill={color} stroke={INK} />);
        // The rolled lip along the top of the apron.
        nodes.push(<line key="lip" x1={ax + 0.6} y1={Y(farm.rimY - 0.45)} x2={ax + farm.bw - 0.6} y2={Y(farm.rimY - 0.45)} stroke={INK} strokeOpacity={0.3} strokeWidth={0.5} />);
      }
      const fx = w / 2;
      nodes.push(
        <path key="faucet" d={`M${fx} ${Y(36)} V${Y(47)} Q${fx} ${Y(51.5)} ${fx + 4.5} ${Y(50.5)} Q${fx + 8.2} ${Y(49.6)} ${fx + 8.4} ${Y(45.5)}`} fill="none" stroke={hw} strokeWidth={2.4} strokeLinecap="round" />,
      );
      nodes.push(<rect key="fb" x={fx - 1.3} y={Y(37.4)} width={2.6} height={1.4} fill={hw} />);
      break;
    }
    case 'dishwasher':
    case 'wine': {
      H = 36;
      nodes.push(toe);
      const panel = f.material !== 'metal' && k === 'dishwasher' ? cab.hex : color;
      nodes.push(<rect key="body" x={0.2} y={Y(34.4)} width={w - 0.4} height={30.4} fill={k === 'dishwasher' ? steel(panel) : color} stroke={INK} />);
      if (k === 'dishwasher') nodes.push(<line key="h" x1={2.5} y1={Y(31.6)} x2={w - 2.5} y2={Y(31.6)} stroke={f.material === 'metal' ? '#8b8e92' : hw} strokeWidth={2} strokeLinecap="round" />);
      else {
        nodes.push(<rect key="gl" x={2} y={Y(32)} width={w - 4} height={26} fill="#1c2226" stroke={INK} />);
        const cols = Math.max(2, Math.floor((w - 4) / 3.4));
        for (let r = 0; r < 5; r++)
          for (let c = 0; c < cols; c++)
            nodes.push(<circle key={`b${r}${c}`} cx={2 + ((w - 4) / cols) * (c + 0.5)} cy={Y(8.5 + r * 5)} r={1.2} fill={product.variant === 'wine' ? '#35573c' : ['#c9442f', '#e0b33a', '#2f6d8c'][(r + c) % 3]} />);
      }
      nodes.push(countertop(-0.8, w + 0.8));
      break;
    }
    case 'wall': {
      H = product.heightIn;
      nodes.push(<rect key="body" x={0} y={0} width={w} height={H} fill={color} stroke={INK} />);
      // A filler or a panel is one flat board.
      if (product.variant === 'filler' || product.variant === 'panel') break;
      const doors = w > 21 ? 2 : 1;
      for (let i = 0; i < doors; i++) {
        const dw = w / doors;
        const px = doors === 2 ? (i === 0 ? -2 : 2) : w / 2 - 2.2;
        nodes.push(front({ x: -w / 2 + dw * (i + 0.5), y: 0, w: dw, h: H, glass: product.variant === 'glass', pull: { dir: 'v', x: px, y: 4.5, len: product.variant === 'bridge' ? 3.5 : 5 } }, color, `d${i}`, w / 2));
      }
      break;
    }
    case 'tall':
    case 'oven-tower': {
      H = 84;
      nodes.push(toe);
      const body = k === 'oven-tower' ? cab.hex : color;
      nodes.push(<rect key="body" x={0} y={0} width={w} height={80} fill={body} stroke={INK} />);
      if (k === 'tall') {
        const doors = w > 21 ? 2 : 1;
        for (const [ya, yb] of [
          [4, 50],
          [50, 84],
        ]) {
          for (let i = 0; i < doors; i++) {
            const dw = w / doors;
            const px = doors === 2 ? (i === 0 ? -2 : 2) : w / 2 - 2.2;
            nodes.push(front({ x: -w / 2 + dw * (i + 0.5), y: ya, w: dw, h: yb - ya, pull: { dir: 'v', x: px, y: ya === 4 ? 44 : 56, len: 8 } }, color, `t${ya}${i}`, w / 2));
          }
        }
      } else {
        nodes.push(front({ x: 0, y: 4, w, h: 14, pull: { dir: 'h', x: 0, y: 15, len: 10 } }, body, 'dr', w / 2));
        nodes.push(front({ x: 0, y: 70, w, h: 14, pull: { dir: 'h', x: 0, y: 73, len: 10 } }, body, 'tp', w / 2));
        for (const [ya, yb] of [
          [18.2, 43.8],
          [44.2, 69.8],
        ]) {
          nodes.push(<rect key={`o${ya}`} x={0.8} y={Y(yb)} width={w - 1.6} height={yb - ya} fill={steel(color)} stroke={INK} />);
          nodes.push(<rect key={`w${ya}`} x={4} y={Y(ya + (yb - ya) * 0.64)} width={w - 8} height={(yb - ya) * 0.42} fill="#1b1d20" />);
          nodes.push(<line key={`h${ya}`} x1={3.5} y1={Y(yb - 4.2)} x2={w - 3.5} y2={Y(yb - 4.2)} stroke="#8b8e92" strokeWidth={1.8} strokeLinecap="round" />);
        }
      }
      break;
    }
    case 'range': {
      const back = !!product.flags?.backguard;
      const brass = product.flags?.trim === 'brass';
      H = back ? 39.5 : 37.5;
      nodes.push(toe);
      nodes.push(<rect key="body" x={0} y={Y(35)} width={w} height={31} fill={steel(color)} stroke={INK} />);
      nodes.push(<rect key="top" x={-0.2} y={Y(36)} width={w + 0.4} height={1} fill={product.variant === 'induction' ? '#111' : steel(color)} stroke={INK} />);
      if (product.variant !== 'induction') nodes.push(<rect key="gr" x={1} y={Y(37.5)} width={w - 2} height={1.5} fill="#1f1f1f" />);
      if (back) nodes.push(<rect key="bg" x={0} y={Y(39.5)} width={w} height={2} fill={steel(color)} stroke={INK} />);
      const knobs = w <= 30 ? 5 : w <= 36 ? 7 : 9;
      const knob = brass ? '#c6a15b' : luminance(color) < 0.12 ? '#c3c6ca' : '#2b2c2e';
      for (let i = 0; i < knobs; i++) nodes.push(<circle key={`k${i}`} cx={(w / knobs) * (i + 0.5)} cy={Y(32.6)} r={0.95} fill={knob} stroke={INK} strokeWidth={0.5} />);
      const doors = product.variant === 'griddle' ? [w * 0.6, w * 0.4] : [w];
      let cx = 0;
      doors.forEach((dw, i) => {
        nodes.push(<rect key={`d${i}`} x={cx + 0.3} y={Y(29.9)} width={dw - 0.6} height={25} fill={steel(color)} stroke={INK} />);
        nodes.push(<rect key={`g${i}`} x={cx + 3.5} y={Y(21)} width={dw - 7} height={9.5} fill="#1b1d20" />);
        nodes.push(<line key={`h${i}`} x1={cx + 2.5} y1={Y(27.6)} x2={cx + dw - 2.5} y2={Y(27.6)} stroke={brass ? '#c6a15b' : '#8b8e92'} strokeWidth={1.8} strokeLinecap="round" />);
        cx += dw;
      });
      break;
    }
    case 'fridge': {
      H = product.heightIn;
      const fill = steel(color);
      if (product.variant === 'retro') {
        nodes.push(<rect key="b" x={0} y={0} width={w} height={H - 2} rx={3.5} fill={color} stroke={INK} />);
        nodes.push(<line key="s" x1={0.5} y1={Y(44)} x2={w - 0.5} y2={Y(44)} stroke={INK} />);
        nodes.push(<rect key="h1" x={w - 4} y={Y(52)} width={1.4} height={4} rx={0.6} fill="#d9dcdf" stroke={INK} strokeWidth={0.5} />);
        nodes.push(<rect key="h2" x={w - 4} y={Y(38)} width={1.4} height={4} rx={0.6} fill="#d9dcdf" stroke={INK} strokeWidth={0.5} />);
        nodes.push(<rect key="ft1" x={2} y={H - 2} width={2} height={2} fill="#c9ccd0" />);
        nodes.push(<rect key="ft2" x={w - 4} y={H - 2} width={2} height={2} fill="#c9ccd0" />);
      } else if (product.variant === 'column') {
        nodes.push(<rect key="t" x={1.5} y={Y(4)} width={w - 3} height={4} fill="#3a342d" />);
        nodes.push(front({ x: 0, y: 4, w, h: H - 4, pull: { dir: 'v', x: w / 2 - 2.5, y: 44, len: 24 } }, color, 'c', w / 2, f.material === 'metal' ? 'slab' : style));
      } else {
        const split = 30.5;
        nodes.push(<rect key="t" x={0.2} y={0} width={w - 0.4} height={H} fill={fill} stroke={INK} />);
        nodes.push(<line key="v" x1={w / 2} y1={0} x2={w / 2} y2={Y(split)} stroke={INK} />);
        nodes.push(<line key="hz" x1={0} y1={Y(split)} x2={w} y2={Y(split)} stroke={INK} />);
        const hc = f.material === 'metal' ? '#8b8e92' : hw;
        nodes.push(<line key="h1" x1={w / 2 - 1.6} y1={Y(split + 4)} x2={w / 2 - 1.6} y2={Y(split + 28)} stroke={hc} strokeWidth={1.8} strokeLinecap="round" />);
        nodes.push(<line key="h2" x1={w / 2 + 1.6} y1={Y(split + 4)} x2={w / 2 + 1.6} y2={Y(split + 28)} stroke={hc} strokeWidth={1.8} strokeLinecap="round" />);
        nodes.push(<line key="h3" x1={5} y1={Y(split - 3.5)} x2={w - 5} y2={Y(split - 3.5)} stroke={hc} strokeWidth={1.8} strokeLinecap="round" />);
      }
      break;
    }
    case 'hood': {
      H = 40;
      if (product.variant === 'plaster') {
        nodes.push(<path key="c" d={`M-1 ${H - 5} L${w * 0.2} 0 L${w * 0.8} 0 L${w + 1} ${H - 5} Z`} fill={color} stroke={INK} />);
        nodes.push(<rect key="band" x={-1} y={H - 5} width={w + 2} height={5} fill={color} stroke={INK} />);
        nodes.push(<rect key="brass" x={-1.2} y={H - 5.4} width={w + 2.4} height={0.8} fill="#c6a15b" />);
      } else {
        nodes.push(<rect key="ch" x={w / 2 - 5.5} y={0} width={11} height={H - 15} fill={steel(color)} stroke={INK} />);
        nodes.push(<path key="c" d={`M0 ${H - 2.5} L${w / 2 - 5.5} ${H - 15} L${w / 2 + 5.5} ${H - 15} L${w} ${H - 2.5} Z`} fill={steel(color)} stroke={INK} />);
        nodes.push(<rect key="r" x={0} y={H - 2.5} width={w} height={2.5} fill={steel(color)} stroke={INK} />);
      }
      break;
    }
    case 'microwave': {
      H = product.heightIn;
      nodes.push(<rect key="b" x={0} y={0} width={w} height={H} fill={steel(color)} stroke={INK} />);
      nodes.push(<rect key="g" x={2} y={2} width={w * 0.66} height={H - 4} fill="#1b1d20" />);
      nodes.push(<rect key="k" x={w * 0.74} y={2.5} width={w * 0.2} height={H - 5} fill="#111" />);
      break;
    }
    case 'shelf': {
      H = 14;
      nodes.push(<rect key="p" x={0} y={H - 2} width={w} height={2} fill={color} stroke={INK} />);
      let x = 2;
      let i = 0;
      while (x < w - 5) {
        if (i % 3 === 0) nodes.push(<rect key={i} x={x} y={H - 7.5} width={3.6} height={5.5} rx={0.8} fill="#e8eef0" stroke={INK} strokeWidth={0.6} />);
        else if (i % 3 === 1) nodes.push(<rect key={i} x={x} y={H - 11} width={1.4} height={9} fill={['#8a3b2b', '#2f4b5e', '#cdb892'][i % 3]} stroke={INK} strokeWidth={0.6} />);
        else nodes.push(<g key={i}><path d={`M${x} ${H - 2} l0.6 -3.5 h3.6 l0.6 3.5z`} fill="#b9694a" stroke={INK} strokeWidth={0.6} /><circle cx={x + 2.4} cy={H - 8} r={2.8} fill="#58804d" /></g>);
        x += i % 3 === 1 ? 3.5 : 6.5;
        i++;
      }
      break;
    }
    case 'stool': {
      H = product.heightIn;
      const leg = f.material === 'wood' ? color : '#252525';
      nodes.push(<line key="l1" x1={3} y1={H} x2={5} y2={Y(24.5)} stroke={leg} strokeWidth={1.3} />);
      nodes.push(<line key="l2" x1={w - 3} y1={H} x2={w - 5} y2={Y(24.5)} stroke={leg} strokeWidth={1.3} />);
      nodes.push(<line key="fr" x1={3.6} y1={Y(9)} x2={w - 3.6} y2={Y(9)} stroke={leg} strokeWidth={1} />);
      if (product.variant === 'backed') {
        nodes.push(<path key="bk" d={`M2 ${Y(27)} Q1 ${Y(38)} ${w / 2} ${Y(38)} Q${w - 1} ${Y(38)} ${w - 2} ${Y(27)}`} fill={color} stroke={INK} />);
        nodes.push(<rect key="s" x={1} y={Y(27.2)} width={w - 2} height={3.2} rx={1.4} fill={color} stroke={INK} />);
      } else nodes.push(<rect key="s" x={1.2} y={Y(26)} width={w - 2.4} height={1.8} rx={0.9} fill={color} stroke={INK} />);
      break;
    }
    case 'chair': {
      H = product.heightIn;
      nodes.push(<line key="l1" x1={2} y1={H} x2={2} y2={Y(17)} stroke={color} strokeWidth={1.3} />);
      nodes.push(<line key="l2" x1={w - 2} y1={H} x2={w - 2} y2={Y(17)} stroke={color} strokeWidth={1.3} />);
      nodes.push(<rect key="s" x={0.5} y={Y(18.4)} width={w - 1} height={1.6} rx={0.6} fill={color} stroke={INK} />);
      for (let i = 0; i < 5; i++) nodes.push(<line key={`sp${i}`} x1={3 + ((w - 6) / 4) * i} y1={Y(18.4)} x2={3 + ((w - 6) / 4) * i} y2={Y(30.5)} stroke={color} strokeWidth={0.8} />);
      nodes.push(<rect key="t" x={0.5} y={0} width={w - 1} height={2.4} rx={1} fill={color} stroke={INK} />);
      break;
    }
    case 'table': {
      H = 30;
      nodes.push(<rect key="t" x={0} y={0} width={w} height={1.6} rx={0.4} fill={color} stroke={INK} />);
      if (product.variant === 'round') {
        nodes.push(<path key="p" d={`M${w / 2 - 2.5} 1.6 L${w / 2 - 3.2} ${H - 2.5} L${w / 2 + 3.2} ${H - 2.5} L${w / 2 + 2.5} 1.6Z`} fill={color} stroke={INK} />);
        nodes.push(<rect key="b" x={w / 2 - 10} y={H - 2.5} width={20} height={2.5} rx={1} fill={color} stroke={INK} />);
      } else {
        nodes.push(<rect key="a" x={3} y={1.6} width={w - 6} height={3.4} fill={shade(color, -0.08)} stroke={INK} />);
        nodes.push(<rect key="l1" x={3} y={1.6} width={2.6} height={H - 1.6} fill={color} stroke={INK} />);
        nodes.push(<rect key="l2" x={w - 5.6} y={1.6} width={2.6} height={H - 1.6} fill={color} stroke={INK} />);
      }
      break;
    }
    case 'pendant': {
      top = 14;
      H = product.heightIn + top;
      const v = product.variant;
      nodes.push(<line key="cord" x1={w / 2} y1={0} x2={w / 2} y2={top} stroke={INK} strokeWidth={0.8} />);
      nodes.push(<ellipse key="glow" cx={w / 2} cy={H + 2} rx={w * 0.55} ry={4} fill="#ffd79a" opacity={0.45} />);
      if (v === 'linear') {
        nodes.push(<line key="cord2" x1={5} y1={0} x2={5} y2={top} stroke={INK} strokeWidth={0.8} />);
        nodes.push(<line key="cord3" x1={w - 5} y1={0} x2={w - 5} y2={top} stroke={INK} strokeWidth={0.8} />);
        nodes.push(<rect key="bar" x={0} y={top} width={w} height={product.heightIn} fill={color} stroke={INK} />);
      } else if (v === 'globe') {
        nodes.push(<circle key="g" cx={w / 2} cy={top + w / 2} r={w / 2} fill={color} stroke={INK} opacity={0.95} />);
        nodes.push(<circle key="bulb" cx={w / 2} cy={top + w / 2} r={2} fill="#ffe2a8" />);
      } else if (v === 'cone') {
        nodes.push(<path key="c" d={`M${w / 2 - 1} ${top} L0 ${H} L${w} ${H} L${w / 2 + 1} ${top}Z`} fill={color} stroke={INK} />);
      } else {
        nodes.push(<path key="d" d={`M0 ${H} Q0 ${top} ${w / 2} ${top} Q${w} ${top} ${w} ${H}Z`} fill={color} stroke={INK} />);
        if (v === 'woven') for (let i = 1; i < 6; i++) nodes.push(<line key={`wv${i}`} x1={(w / 6) * i} y1={top + 2} x2={(w / 6) * i} y2={H} stroke={shade(color, -0.3)} strokeWidth={0.6} />);
        nodes.push(<ellipse key="bulb" cx={w / 2} cy={H} rx={2.2} ry={1.2} fill="#ffe2a8" />);
      }
      break;
    }
    case 'vanity': {
      const top = product.elevationIn + product.heightIn;
      H = Math.max(H, top);
      const floating = product.variant === 'floating';
      const y0 = floating ? product.elevationIn : 4;
      const bodyH = top - 1.5 - y0;
      if (!floating) nodes.push(<rect key="toe" x={0.5} y={Y(4)} width={w - 1} height={4} fill="#3b3631" />);
      nodes.push(<rect key="body" x={0} y={Y(top - 1.5)} width={w} height={bodyH} fill={color} stroke={INK} />);
      const n = product.variant === 'double' ? 4 : w > 24 ? 2 : 1;
      for (let i = 0; i < n; i++) nodes.push(<rect key={`d${i}`} x={(w / n) * i + 0.4} y={Y(top - 1.5) + 0.4} width={w / n - 0.8} height={bodyH - 0.8} fill={color} stroke={INK} />);
      nodes.push(<rect key="top" x={-0.4} y={Y(top)} width={w + 0.8} height={1.5} fill={counter} stroke={INK} />);
      const centres = product.variant === 'double' ? [w / 2 - Math.min(15, w / 4), w / 2 + Math.min(15, w / 4)] : [w / 2];
      for (const cx of centres) nodes.push(<path key={`f${cx}`} d={`M${cx - 0.8} ${Y(top)} v-6 h4 v1.4`} fill="none" stroke={INK} strokeWidth={1.2} />);
      H = Math.max(H, top + 7);
      break;
    }
    case 'toilet': {
      const wallHung = product.variant === 'wall-hung';
      if (wallHung) {
        nodes.push(<rect key="bowl" x={w / 2 - 7.5} y={Y(16)} width={15} height={7} rx={3} fill={f.hex} stroke={INK} />);
        nodes.push(<rect key="plate" x={w / 2 - 4.5} y={Y(43)} width={9} height={6} fill="#d9dcdf" stroke={INK} />);
        H = Math.max(H, 44);
      } else {
        nodes.push(<rect key="tank" x={w / 2 - 9.5} y={Y(30.5)} width={19} height={15} rx={1.2} fill={f.hex} stroke={INK} />);
        nodes.push(<rect key="bowl" x={w / 2 - 8} y={Y(17)} width={16} height={8} rx={3} fill={f.hex} stroke={INK} />);
        nodes.push(<path key="ped" d={`M${w / 2 - 4} ${Y(9)} L${w / 2 - 5} ${Y(0)} L${w / 2 + 5} ${Y(0)} L${w / 2 + 4} ${Y(9)} Z`} fill={f.hex} stroke={INK} />);
      }
      break;
    }
    case 'tub': {
      const h = product.heightIn;
      if (product.variant === 'freestanding') {
        nodes.push(<path key="tub" d={`M0 ${Y(h)} Q${w / 2} ${Y(h - 4)} ${w} ${Y(h)} L${w - 6} ${Y(0)} L6 ${Y(0)} Z`} fill={f.hex} stroke={INK} />);
      } else {
        nodes.push(<rect key="tub" x={0} y={Y(h)} width={w} height={h} fill={f.hex} stroke={INK} />);
        nodes.push(<line key="rim" x1={0} x2={w} y1={Y(h - 1.5)} y2={Y(h - 1.5)} stroke={INK} strokeWidth={0.4} />);
      }
      break;
    }
    case 'shower': {
      const h = product.heightIn;
      nodes.push(<rect key="base" x={0} y={Y(3)} width={w} height={3} fill="#f2f1ed" stroke={INK} />);
      nodes.push(<rect key="glass" x={0.5} y={Y(h)} width={w - 1} height={h - 3} fill="#dfeaf0" opacity={0.55} stroke={INK} strokeWidth={0.6} />);
      nodes.push(<line key="rail" x1={0} x2={w} y1={Y(h)} y2={Y(h)} stroke={f.hex} strokeWidth={1.2} />);
      if (product.variant === 'alcove') nodes.push(<line key="split" x1={w / 2} x2={w / 2} y1={Y(h)} y2={Y(3)} stroke={INK} strokeWidth={0.5} />);
      break;
    }
    case 'outlet': {
      // Front view, enlarged: the plate and its device on a strip of wall.
      const metal = f.material === 'metal';
      H = 9;
      const pw = 5.2;
      const ph = 8;
      const x = w / 2 - pw / 2;
      nodes.push(<rect key="plate" x={x} y={0.5} width={pw} height={ph} rx={0.4} fill={f.hex} stroke={INK} strokeWidth={0.35} />);
      const dev = metal ? '#f4f2ee' : f.hex;
      nodes.push(<rect key="dev" x={w / 2 - 1.3} y={1.6} width={2.6} height={ph - 2.2} rx={0.25} fill={dev} stroke={INK} strokeWidth={0.25} />);
      const dark = '#2a2a2a';
      if (product.variant === 'switch' || product.variant === 'dimmer') nodes.push(<line key="rk" x1={w / 2 - 1} x2={w / 2 + 1} y1={4.6} y2={4.6} stroke={INK} strokeWidth={0.25} />);
      else
        for (const cy of [3.2, 6.2]) {
          nodes.push(<rect key={`a${cy}`} x={w / 2 - 0.6} y={cy - 0.4} width={0.18} height={0.6} fill={dark} />);
          nodes.push(<rect key={`b${cy}`} x={w / 2 + 0.42} y={cy - 0.45} width={0.18} height={0.7} fill={dark} />);
          nodes.push(<circle key={`g${cy}`} cx={w / 2} cy={cy + 0.5} r={0.18} fill={dark} />);
        }
      if (product.variant === 'gfci') nodes.push(<rect key="rs" x={w / 2 + 0.1} y={4.45} width={0.9} height={0.35} fill="#c9483b" />);
      break;
    }
    case 'mirror': {
      const y0 = product.elevationIn;
      H = Math.max(H, y0 + product.heightIn);
      if (product.variant === 'round') nodes.push(<circle key="m" cx={w / 2} cy={Y(y0 + product.heightIn / 2)} r={w / 2} fill="#cfd8dc" stroke={f.id === 'frameless' ? INK : f.hex} strokeWidth={f.id === 'frameless' ? 0.5 : 1.6} />);
      else nodes.push(<rect key="m" x={0} y={Y(y0 + product.heightIn)} width={w} height={product.heightIn} fill="#cfd8dc" stroke={f.id === 'frameless' ? INK : f.hex} strokeWidth={f.id === 'frameless' ? 0.5 : 1.6} />);
      break;
    }
    case 'window': {
      H = product.heightIn + 6;
      nodes.push(<rect key="cas" x={-3.5} y={0} width={w + 7} height={H - 3} fill={color} stroke={INK} />);
      nodes.push(<rect key="gl" x={1.5} y={3.5} width={w - 3} height={H - 10} fill="#cfe0ea" stroke={INK} />);
      if (product.variant === 'casement') nodes.push(<line key="m" x1={w / 2} y1={3.5} x2={w / 2} y2={H - 6.5} stroke={color} strokeWidth={1.4} />);
      else {
        nodes.push(<line key="m1" x1={w / 3} y1={3.5} x2={w / 3} y2={H - 6.5} stroke={color} strokeWidth={1} />);
        nodes.push(<line key="m2" x1={(w * 2) / 3} y1={3.5} x2={(w * 2) / 3} y2={H - 6.5} stroke={color} strokeWidth={1} />);
        nodes.push(<line key="m3" x1={1.5} y1={(H - 3) * 0.4} x2={w - 1.5} y2={(H - 3) * 0.4} stroke={color} strokeWidth={1} />);
      }
      nodes.push(<rect key="sill" x={-4.5} y={H - 3.5} width={w + 9} height={1.4} fill="#f1ede6" stroke={INK} />);
      break;
    }
    case 'door': {
      H = product.heightIn + 3.5;
      nodes.push(<rect key="cas" x={-3.5} y={0} width={w + 7} height={H} fill={color} stroke={INK} />);
      nodes.push(<rect key="op" x={0} y={3.5} width={w} height={H - 3.5} fill="#e4dccf" stroke={INK} />);
      if (product.variant === 'single') {
        nodes.push(front({ x: 0, y: 0, w, h: H - 3.5, pull: null }, color, 'leaf', w / 2, 'shaker'));
        nodes.push(<circle key="kn" cx={w - 3} cy={Y(36)} r={1.2} fill={hw} />);
      } else if (product.variant === 'double') {
        for (const s of [0, 1]) {
          const x = s * (w / 2) + 0.4;
          nodes.push(<rect key={`lf${s}`} x={x} y={3.9} width={w / 2 - 0.8} height={H - 4.3} fill={color} stroke={INK} />);
          nodes.push(<rect key={`gl${s}`} x={x + 3} y={6.9} width={w / 2 - 6.8} height={H - 16} fill="#cfe0ea" stroke={INK} />);
          for (const t of [0.33, 0.62]) nodes.push(<line key={`m${s}${t}`} x1={x + 3} y1={6.9 + (H - 16) * t} x2={x + w / 2 - 3.8} y2={6.9 + (H - 16) * t} stroke={color} strokeWidth={1} />);
        }
      }
      break;
    }
    case 'rug': {
      H = product.depthIn;
      nodes.push(<rect key="r" x={0} y={0} width={w} height={H} fill={color} stroke={INK} />);
      nodes.push(<rect key="b" x={3} y={3} width={w - 6} height={H - 6} fill="none" stroke={shade(color, 0.4)} strokeWidth={1.5} />);
      for (let y = 10; y < H - 8; y += 10) nodes.push(<path key={y} d={`M${w / 2 - 7} ${y + 4} L${w / 2} ${y} L${w / 2 + 7} ${y + 4} L${w / 2} ${y + 8}Z`} fill={shade(color, y % 20 ? 0.35 : -0.3)} />);
      break;
    }
    case 'plant': {
      H = product.heightIn;
      const potH = 15;
      nodes.push(<path key="pot" d={`M${w * 0.2} ${H - potH} L${w * 0.26} ${H} L${w * 0.74} ${H} L${w * 0.8} ${H - potH}Z`} fill={color} stroke={INK} />);
      nodes.push(<line key="tr" x1={w / 2} y1={H - potH} x2={w / 2} y2={H - potH - 26} stroke="#6d5a48" strokeWidth={1.6} />);
      const olive = product.variant === 'olive';
      const blobs = olive
        ? [[0.5, 0.18, 0.24], [0.28, 0.3, 0.2], [0.72, 0.28, 0.2], [0.4, 0.1, 0.18], [0.62, 0.12, 0.17], [0.5, 0.36, 0.18]]
        : [[0.35, 0.3, 0.13], [0.65, 0.25, 0.14], [0.5, 0.12, 0.14], [0.3, 0.5, 0.12], [0.7, 0.45, 0.13], [0.5, 0.4, 0.12]];
      blobs.forEach(([bx, by, br], i) =>
        nodes.push(<ellipse key={`lf${i}`} cx={w * bx} cy={H * by} rx={w * br * (olive ? 1.2 : 0.9)} ry={w * br * (olive ? 0.9 : 1.3)} fill={olive ? ['#8b9a74', '#9aa784', '#7a8a64'][i % 3] : ['#335f2e', '#3f6f38', '#2c522a'][i % 3]} stroke={INK} strokeWidth={0.5} />),
      );
      break;
    }
  }

  return { nodes, H, w, color };
}

export function SteelGradient({ color }: { color: string }) {
  return (
    <linearGradient id={`steel-${color.slice(1)}`} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stopColor={shade(color, -0.12)} />
      <stop offset="0.45" stopColor={shade(color, 0.2)} />
      <stop offset="1" stopColor={shade(color, -0.08)} />
    </linearGradient>
  );
}

const FLOATING = new Set(['pendant', 'hood', 'wall', 'shelf', 'microwave', 'rug']);

export const ProductArt = memo(function ProductArt({ product, finish, surfaces, width, className }: Props) {
  // Brand products with photography show their thumbnail; everything else is drawn.
  if (product.thumbnailUrl) {
    return <img className={`product-thumb${className ? ` ${className}` : ''}`} src={product.thumbnailUrl} alt="" loading="lazy" draggable={false} />;
  }
  return <DrawnArt product={product} finish={finish} surfaces={surfaces} width={width} className={className} />;
});

function DrawnArt({ product, finish, surfaces, width, className }: Props) {
  const { nodes, H, w, color } = drawArt({ product, finish, surfaces, width });
  const k = product.kind;
  const opening = k === 'window' || k === 'door';
  const pad = Math.max(w, H) * 0.08 + 2;
  const vb = `${-pad - (opening ? 4 : 0)} ${-pad} ${w + pad * 2 + (opening ? 8 : 0)} ${H + pad * 2}`;
  return (
    <svg className={className} viewBox={vb} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <SteelGradient color={color} />
      </defs>
      <g strokeWidth={0.8} style={{ strokeLinejoin: 'round' }}>
        {nodes}
      </g>
      <line x1={-pad} y1={H} x2={w + pad} y2={H} stroke={INK} strokeOpacity={FLOATING.has(k) ? 0 : 0.35} strokeWidth={0.6} />
    </svg>
  );
}
