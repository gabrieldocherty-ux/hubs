import { Group, Line, Rect, Text } from 'react-konva';
import type { Room } from '../../types';
import { feetInches } from '../../lib/format';
import { alongWall, clearToWall, flushSeg, type Resolved, type Wall, type WallSeg } from '../../lib/geometry';
import { planSize, wallSegs } from '../../lib/outline';
import { isOpening } from '../../data/catalog';
import { FONT_MONO, WALL_T, usePlanPalette } from './planStyle';

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
export function Dim({ x1, y1, x2, y2, label, k, color: colorProp, ticks, pill = false, fontPx = 10 }: DimProps) {
  const pal = usePlanPalette();
  const color = colorProp ?? pal.ink;
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
          {pill && <Rect x={-tw / 2} y={-fs * 0.85} width={tw} height={fs * 1.7} cornerRadius={fs * 0.85} fill={pal.paper} stroke={color} strokeWidth={0.8} strokeScaleEnabled={false} />}
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

/** The point `a` along `seg`, `off` outside its line (the dimension strings sit outside the wall). */
function outside(seg: WallSeg, a: number, off: number): [number, number] {
  switch (seg.wall) {
    case 'north':
      return [a, seg.at - off];
    case 'south':
      return [a, seg.at + off];
    case 'west':
      return [seg.at - off, a];
    case 'east':
      return [seg.at + off, a];
  }
}

/**
 * Overall plan size plus a chained string of every piece along each wall, like a real plan set.
 * In a drawn room every wall also gets its own length, so an L or a bump-out reads in full.
 */
export function WallDimensions({ room, all, k }: { room: Room; all: Resolved[]; k: number }) {
  const muted = usePlanPalette().muted;
  const { W, L } = planSize(room);
  const segs = wallSegs(room);
  const drawn = !!room.outline || !!room.extra?.length;
  const chainOff = WALL_T + 16 * k;
  const overallOff = WALL_T + 40 * k;
  const chains = segs
    .filter((seg) => !(seg.zone && (seg.style === 'open' || seg.style === 'beam')))
    .map((seg) => {
      const edges = new Set<number>();
      for (const r of all) {
        if (r.z0 >= 40 && !isOpening(r.product)) continue;
        if (flushSeg(r, room)?.id !== seg.id) continue;
        const [s, e] = alongWall(seg.wall, r.box);
        edges.add(Math.round(s * 2) / 2);
        edges.add(Math.round(e * 2) / 2);
      }
      // A drawn wall always shows its own length, even with nothing against it.
      if (!edges.size && !drawn) return null;
      edges.add(seg.a0);
      edges.add(seg.a1);
      const sorted = [...edges].filter((v) => v >= seg.a0 && v <= seg.a1).sort((a, b) => a - b);
      return { seg, sorted };
    })
    .filter(Boolean) as { seg: WallSeg; sorted: number[] }[];

  return (
    <Group listening={false}>
      <Dim x1={0} y1={-overallOff} x2={W} y2={-overallOff} label={feetInches(W)} k={k} fontPx={11} />
      <Dim x1={-overallOff} y1={0} x2={-overallOff} y2={L} label={feetInches(L)} k={k} fontPx={11} />
      {chains.map(({ seg, sorted }) => (
        <Group key={seg.id}>
          {sorted.slice(1).map((v, i) => {
            const a = sorted[i];
            const [x1, y1] = outside(seg, a, chainOff);
            const [x2, y2] = outside(seg, v, chainOff);
            const label = v - a >= 6 ? feetInches(v - a).replace(/^0' /, '') : undefined;
            return <Dim key={i} x1={x1} y1={y1} x2={x2} y2={y2} label={label} k={k} color={muted} fontPx={9} />;
          })}
        </Group>
      ))}
    </Group>
  );
}

/** Live distances from the selected piece to each wall. */
export function SelectionDimensions({ r, room, k, color }: { r: Resolved; room: Room; k: number; color: string }) {
  if (isOpening(r.product)) {
    const seg = flushSeg(r, room);
    if (!seg) return null;
    const [s, e] = alongWall(seg.wall, r.box);
    const off = 12 * k + 6;
    const at = (a: number): [number, number] =>
      seg.wall === 'north' ? [a, seg.at + off] : seg.wall === 'south' ? [a, seg.at - off] : seg.wall === 'west' ? [seg.at + off, a] : [seg.at - off, a];
    const parts: [number, number][] = [
      [seg.a0, s],
      [e, seg.a1],
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
  const dims: [number, number, number, number, number][] = [];
  for (const dir of ['west', 'east', 'north', 'south'] as Wall[]) {
    const hit = clearToWall(room, b, dir);
    if (!hit || hit.gap <= 0.75) continue;
    dims.push(
      dir === 'west' ? [b.minX - hit.gap, hit.lane, b.minX, hit.lane, hit.gap]
      : dir === 'east' ? [b.maxX, hit.lane, b.maxX + hit.gap, hit.lane, hit.gap]
      : dir === 'north' ? [hit.lane, b.minY - hit.gap, hit.lane, b.minY, hit.gap]
      : [hit.lane, b.maxY, hit.lane, b.maxY + hit.gap, hit.gap],
    );
  }
  return (
    <Group listening={false}>
      {dims.map(([x1, y1, x2, y2, v], i) => (
        <Dim key={i} x1={x1} y1={y1} x2={x2} y2={y2} label={feetInches(v)} k={k} color={color} pill />
      ))}
    </Group>
  );
}
