import { useMemo } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import type { Room } from '../../types';
import type { Resolved } from '../../lib/geometry';
import { feetInches } from '../../lib/format';
import { Dim } from './Dimensions';
import { dragFeedback } from './snapFeedback';
import { ACCENT, BAD, FONT_MONO, GUIDE } from './planStyle';
import { itemRoomBox } from './planHit';

/**
 * Live feedback for the piece being dragged (from the plan or the 3D view): the wall
 * it snapped to, neighbour edges it lines up with, clear distances to the nearest
 * neighbour or wall in ft-in, and a red state where it collides with something.
 * Screen-constant sizes via `k` (= 1 / stage scale), like the rest of the plan chrome.
 */
export function DragFeedback({ me, all, room, k }: { me: Resolved; all: Resolved[]; room: Room; k: number }) {
  const fb = useMemo(() => dragFeedback(me, all, room, 12 * k + 6), [me, all, room, k]);
  const bad = fb.overlaps.length > 0;
  const box = itemRoomBox(me);
  const fs = 10 * k;

  return (
    <Group listening={false}>
      {fb.wallLine && (
        <Line
          points={[fb.wallLine.x1, fb.wallLine.y1, fb.wallLine.x2, fb.wallLine.y2]}
          stroke={GUIDE}
          strokeWidth={4}
          opacity={0.75}
          lineCap="round"
          strokeScaleEnabled={false}
        />
      )}
      {fb.guides.map((g, i) => (
        <Line key={`g${i}`} points={[g.x1, g.y1, g.x2, g.y2]} stroke={GUIDE} strokeWidth={1.4} dash={[4 * k, 3 * k]} strokeScaleEnabled={false} />
      ))}
      {fb.gaps.map((g, i) => (
        <Dim key={`d${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} label={feetInches(g.value)} k={k} color={g.to === 'item' ? GUIDE : ACCENT} pill />
      ))}
      {fb.overlaps.map((o, i) => (
        <Rect
          key={`o${i}`}
          x={o.minX}
          y={o.minY}
          width={Math.max(0.5, o.maxX - o.minX)}
          height={Math.max(0.5, o.maxY - o.minY)}
          fill={BAD}
          opacity={0.38}
          stroke={BAD}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      ))}
      <Rect
        x={box.minX - 1.5 * k}
        y={box.minY - 1.5 * k}
        width={box.maxX - box.minX + 3 * k}
        height={box.maxY - box.minY + 3 * k}
        stroke={bad ? BAD : ACCENT}
        strokeWidth={bad ? 3 : 2}
        dash={bad ? undefined : [6 * k, 4 * k]}
        strokeScaleEnabled={false}
      />
      {bad && (
        <Group x={(box.minX + box.maxX) / 2} y={box.minY - 4 * k - fs}>
          <Rect x={-34 * k} y={-fs * 0.85} width={68 * k} height={fs * 1.7} cornerRadius={fs * 0.85} fill={BAD} />
          <Text text="Overlaps" fontFamily={FONT_MONO} fontSize={fs} fill="#fff" width={68 * k} x={-34 * k} y={-fs * 0.5} align="center" />
        </Group>
      )}
    </Group>
  );
}
