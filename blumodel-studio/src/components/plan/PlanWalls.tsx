import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { Room } from '../../types';
import { spaces, wallSegs, type WallSeg } from '../../lib/outline';
import { FONT_MONO, WALL_T, usePlanPalette } from './planStyle';

/** The ledge of a bar wall, deep enough for stools. */
const BAR_LEDGE_IN = 12;

/** The box of a wall's body: outside its line, or centred on it for thin things. */
function body(sg: WallSeg, thick: number, centred: boolean, ownCorner: boolean): [number, number, number, number] {
  const ns = sg.wall === 'north' || sg.wall === 'south';
  // North and south walls own the corners that stick out, so two bodies never overlap there.
  const e0 = ownCorner && ns && sg.convex0 ? thick : 0;
  const e1 = ownCorner && ns && sg.convex1 ? thick : 0;
  const len = sg.a1 - sg.a0 + e0 + e1;
  const start = sg.a0 - e0;
  const off = centred ? thick / 2 : 0;
  switch (sg.wall) {
    case 'north':
      return [start, sg.at - thick + off, len, thick];
    case 'south':
      return [start, sg.at - off, len, thick];
    case 'west':
      return [sg.at - thick + off, start, thick, len];
    case 'east':
      return [sg.at - off, start, thick, len];
  }
}

/** One wall, drawn the way its style stands in a plan: solid, half wall, bar, railing, glass, beam, or just a boundary line. */
function Seg({ sg, k, rendered, hatch }: { sg: WallSeg; k: number; rendered: boolean; hatch: HTMLCanvasElement }) {
  const pal = usePlanPalette();
  const ns = sg.wall === 'north' || sg.wall === 'south';
  const line = ns ? [sg.a0, sg.at, sg.a1, sg.at] : [sg.at, sg.a0, sg.at, sg.a1];
  const fill = rendered ? { fill: pal.wall } : { fillPatternImage: hatch as unknown as HTMLImageElement, fillPatternScale: { x: k, y: k } };
  const stroke = rendered ? pal.wallStroke : pal.ink;
  switch (sg.style) {
    case 'wall': {
      const [x, y, w, h] = body(sg, WALL_T, false, true);
      return <Rect x={x} y={y} width={w} height={h} {...fill} stroke={stroke} strokeWidth={1.2} strokeScaleEnabled={false} />;
    }
    case 'half':
    case 'bar': {
      const [x, y, w, h] = body(sg, WALL_T, true, false);
      const ledge: [number, number, number, number] | null =
        sg.style === 'bar'
          ? ns
            ? [sg.a0, sg.wall === 'north' ? sg.at - WALL_T / 2 - BAR_LEDGE_IN : sg.at + WALL_T / 2, sg.a1 - sg.a0, BAR_LEDGE_IN]
            : [sg.wall === 'west' ? sg.at - WALL_T / 2 - BAR_LEDGE_IN : sg.at + WALL_T / 2, sg.a0, BAR_LEDGE_IN, sg.a1 - sg.a0]
          : null;
      // The ledge faces away from the room (the living side), like the stools it is for.
      return (
        <Group>
          {ledge && <Rect x={ledge[0]} y={ledge[1]} width={ledge[2]} height={ledge[3]} fill={rendered ? pal.paper : pal.sheet} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} />}
          <Rect x={x} y={y} width={w} height={h} fill={rendered ? pal.wall : pal.sheet} stroke={stroke} strokeWidth={1.2} strokeScaleEnabled={false} />
          <Line points={line} stroke={stroke} strokeWidth={0.8} strokeScaleEnabled={false} dash={[4 * k, 3 * k]} opacity={0.7} />
        </Group>
      );
    }
    case 'rail': {
      const posts: number[] = [];
      for (let a = sg.a0; a <= sg.a1 + 0.1; a += 36) posts.push(a);
      if (posts[posts.length - 1] < sg.a1 - 1) posts.push(sg.a1);
      return (
        <Group>
          <Line points={line} stroke={stroke} strokeWidth={2.2} strokeScaleEnabled={false} />
          {posts.map((a, i) => (
            <Rect key={i} x={ns ? a - 1.5 : sg.at - 1.5} y={ns ? sg.at - 1.5 : a - 1.5} width={3} height={3} fill={stroke} />
          ))}
        </Group>
      );
    }
    case 'glass':
      return (
        <Group>
          <Line points={line} stroke="#6d9ec3" strokeWidth={3.2} strokeScaleEnabled={false} opacity={0.55} />
          <Line points={line} stroke="#2f6d99" strokeWidth={1} strokeScaleEnabled={false} />
        </Group>
      );
    case 'beam': {
      const [x, y, w, h] = body(sg, 10, true, false);
      return <Rect x={x} y={y} width={w} height={h} stroke={stroke} strokeWidth={1} strokeScaleEnabled={false} dash={[6 * k, 4 * k]} fill={rendered ? 'rgba(120,100,80,0.10)' : undefined} />;
    }
    case 'open':
    default:
      return <Line points={line} stroke={pal.accent} strokeWidth={1.4} strokeScaleEnabled={false} dash={[10 * k, 6 * k]} opacity={0.85} />;
  }
}

/** Every wall and border of the plan, and a tint and name for each open area. */
export function PlanWalls({ room, k, rendered, hatch }: { room: Room; k: number; rendered: boolean; hatch: HTMLCanvasElement }) {
  const pal = usePlanPalette();
  const segs = wallSegs(room);
  const zones = spaces(room).filter((s) => s.zone);
  return (
    <>
      {zones.map((z) => {
        const xs = z.pts.map((p) => p[0]);
        const ys = z.pts.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const fs = 12 * k;
        return (
          <Group key={z.id} listening={false}>
            <Line points={z.pts.flat()} closed fill={pal.accent} opacity={0.07} />
            <Text text={z.name.toUpperCase()} x={cx - 100 * k} y={cy - fs / 2} width={200 * k} align="center" fontFamily={FONT_MONO} fontSize={fs} letterSpacing={2 * k} fill={pal.accent} opacity={0.7} />
          </Group>
        );
      })}
      {segs.map((sg) => (
        <Seg key={sg.id} sg={sg} k={k} rendered={rendered} hatch={hatch} />
      ))}
      {/* A dot at each corner of an open area so the border reads as one shape. */}
      {zones.flatMap((z) => z.pts.map((p, i) => <Circle key={`${z.id}${i}`} x={p[0]} y={p[1]} radius={2.4 * k} fill={pal.accent} opacity={0.8} />))}
    </>
  );
}

