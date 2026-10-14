import { Group, Line, Rect, Text } from 'react-konva';
import type { Room } from '../../types';
import { feetInches } from '../../lib/format';
import { alongWall, flushWall, WALLS, type Resolved, type Wall } from '../../lib/geometry';
import { isOpening } from '../../data/catalog';
import { FONT_MONO, INK, PAPER, WALL_T } from './planStyle';

interface DimProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  k: number;
  color?: string;
  ticks?: number[];
  pill?: boolean;
  fontPx?: number;
}

/** A dimension string with architectural 45° tick marks and a centered label. */
export function Dim({ x1, y1, x2, y2, label, k, color = INK, ticks, pill = false, fontPx = 10 }: DimProps) {
  const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const t = 4 * k;
  const marks = ticks ?? (horizontal ? [x1, x2] : [y1, y2]);
  const fs = fontPx * k;
  const text = label ?? '';
  const tw = text.length * fs * 0.62 + 8 * k;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const len = horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
  const showLabel = !!label && len > tw * 0.9;
  return (
    <Group listening={false}>
      <Line points={[x1, y1, x2, y2]} stroke={color} strokeWidth={0.9} strokeScaleEnabled={false} />
      {marks.map((m, i) => (
        <Line
          key={i}
          points={horizontal ? [m - t, y1 + t, m + t, y1 - t] : [x1 - t, m + t, x1 + t, m - t]}
          stroke={color}
          strokeWidth={1.4}
          strokeScaleEnabled={false}
        />
      ))}
      {showLabel && (
        <Group x={mx} y={my} rotation={horizontal ? 0 : -90}>
          {pill && <Rect x={-tw / 2} y={-fs * 0.85} width={tw} height={fs * 1.7} cornerRadius={fs * 0.85} fill={PAPER} stroke={color} strokeWidth={0.8} strokeScaleEnabled={false} />}
          <Text
            text={text}
            fontFamily={FONT_MONO}
            fontSize={fs}
            fill={color}
            width={tw}
            x={-tw / 2}
            y={pill ? -fs * 0.5 : -fs * 1.45}
            align="center"
          />
        </Group>
      )}
    </Group>
  );
}

/** Overall room size plus a chained string of every piece along each wall, like a real plan set. */
export function WallDimensions({ room, all, k }: { room: Room; all: Resolved[]; k: number }) {
  const W = room.widthIn;
  const L = room.lengthIn;
  const chainOff = WALL_T + 16 * k;
  const overallOff = WALL_T + 40 * k;
  const chains = WALLS.map((wall) => {
    const edges = new Set<number>();
    for (const r of all) {
      if (r.z0 >= 40 && !isOpening(r.product)) continue;
      if (flushWall(r, room) !== wall) continue;
      const [s, e] = alongWall(wall, r.box);
      edges.add(Math.round(s * 2) / 2);
      edges.add(Math.round(e * 2) / 2);
    }
    if (!edges.size) return null;
    const len = wall === 'north' || wall === 'south' ? W : L;
    edges.add(0);
    edges.add(len);
    const sorted = [...edges].filter((v) => v >= 0 && v <= len).sort((a, b) => a - b);
    return { wall, sorted };
  }).filter(Boolean) as { wall: Wall; sorted: number[] }[];

  return (
    <Group listening={false}>
      <Dim x1={0} y1={-overallOff} x2={W} y2={-overallOff} label={feetInches(W)} k={k} fontPx={11} />
      <Dim x1={-overallOff} y1={0} x2={-overallOff} y2={L} label={feetInches(L)} k={k} fontPx={11} />
      {chains.map(({ wall, sorted }) => {
        const segs = sorted.slice(1).map((v, i) => ({ a: sorted[i], b: v }));
        const pos = (a: number): [number, number] => {
          switch (wall) {
            case 'north':
              return [a, -chainOff];
            case 'south':
              return [a, L + chainOff];
            case 'west':
              return [-chainOff, a];
            case 'east':
              return [W + chainOff, a];
          }
        };
        return (
          <Group key={wall}>
            {segs.map(({ a, b }, i) => {
              const [x1, y1] = pos(a);
              const [x2, y2] = pos(b);
              const label = b - a >= 6 ? feetInches(b - a).replace(/^0' /, '') : undefined;
              return <Dim key={i} x1={x1} y1={y1} x2={x2} y2={y2} label={label} k={k} color="#7a7166" fontPx={9} />;
            })}
          </Group>
        );
      })}
    </Group>
  );
}

/** Live distances from the selected piece to each wall. */
export function SelectionDimensions({ r, room, k, color }: { r: Resolved; room: Room; k: number; color: string }) {
  if (isOpening(r.product)) {
    const wall = flushWall(r, room);
    if (!wall) return null;
    const [s, e] = alongWall(wall, r.box);
    const len = wall === 'north' || wall === 'south' ? room.widthIn : room.lengthIn;
    const off = 12 * k + 6;
    const at = (a: number): [number, number] =>
      wall === 'north' ? [a, off] : wall === 'south' ? [a, room.lengthIn - off] : wall === 'west' ? [off, a] : [room.widthIn - off, a];
    const parts: [number, number][] = [
      [0, s],
      [e, len],
    ];
    return (
      <Group listening={false}>
        {parts.filter(([a, b]) => b - a > 0.5).map(([a, b], i) => {
          const [x1, y1] = at(a);
          const [x2, y2] = at(b);
          return <Dim key={i} x1={x1} y1={y1} x2={x2} y2={y2} label={feetInches(b - a)} k={k} color={color} pill />;
        })}
      </Group>
    );
  }
  const b = r.box;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const segs: [number, number, number, number, number][] = [
    [0, cy, b.minX, cy, b.minX],
    [b.maxX, cy, room.widthIn, cy, room.widthIn - b.maxX],
    [cx, 0, cx, b.minY, b.minY],
    [cx, b.maxY, cx, room.lengthIn, room.lengthIn - b.maxY],
  ];
  return (
    <Group listening={false}>
      {segs
        .filter((s) => s[4] > 0.75)
        .map(([x1, y1, x2, y2, v], i) => (
          <Dim key={i} x1={x1} y1={y1} x2={x2} y2={y2} label={feetInches(v)} k={k} color={color} pill />
        ))}
    </Group>
  );
}
