/** Pure layout of cabinet doors and drawers, shared by the 3D models and the 2D product art. */

export type PullSpec = { dir: 'h' | 'v'; x: number; y: number; len: number } | null;

export interface FrontSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  pull: PullSpec;
  glass?: boolean;
}

/** Door/drawer layout for a base cabinet between the toe kick and the counter. */
export function baseFronts(w: number, variant: string | undefined, opts: { falseTop?: boolean; noPulls?: boolean } = {}): FrontSpec[] {
  const bottom = 4;
  const top = 34.5;
  const pullLen = (span: number) => Math.min(Math.max(span * 0.45, 4), 12);
  const hPull = (x: number, y: number, span: number): PullSpec => (opts.noPulls ? null : { dir: 'h', x, y, len: pullLen(span) });
  if (variant === 'drawers') {
    const cuts = [bottom, 16.5, 27.9, top];
    return cuts.slice(1).map((c, i) => ({ x: 0, y: cuts[i], w, h: c - cuts[i], pull: hPull(0, c - (i === 2 ? 3.1 : 3), w) }));
  }
  if (variant === 'trash') return [{ x: 0, y: bottom, w, h: top - bottom, pull: hPull(0, top - 3, w) }];
  const fronts: FrontSpec[] = [{ x: 0, y: 28, w, h: top - 28, pull: opts.falseTop ? null : hPull(0, 31.2, w) }];
  const doorTop = 28;
  const pullY = doorTop - 4;
  if (w > 21) {
    const dw = w / 2;
    fronts.push({ x: -dw / 2, y: bottom, w: dw, h: doorTop - bottom, pull: opts.noPulls ? null : { dir: 'v', x: -2, y: pullY - 2, len: 5 } });
    fronts.push({ x: dw / 2, y: bottom, w: dw, h: doorTop - bottom, pull: opts.noPulls ? null : { dir: 'v', x: 2, y: pullY - 2, len: 5 } });
  } else {
    fronts.push({ x: 0, y: bottom, w, h: doorTop - bottom, pull: opts.noPulls ? null : { dir: 'v', x: w / 2 - 2.2, y: pullY - 2, len: 5 } });
  }
  return fronts;
}

/**
 * Proportions of a fireclay apron-front (farmhouse) sink in a base `w` wide and `d` deep, in the
 * item frame: x along the run, y up from the floor, z toward the room, door faces at z = d/2 + 0.75.
 * Shared by the 3D model, the plan symbol and the elevation art so the three always agree.
 */
export function farmhouseSink(w: number, d: number) {
  const bw = w - 3; // 33″ bowl in a 36″ base, 30″ in a 33″, 27″ in a 30″
  const apronH = 10;
  const rimY = 35.875; // 1/8″ below the 36″ counter top
  const apronY0 = rimY - apronH;
  const front = d / 2 + 0.75 + 0.375; // apron face 3/8″ proud of the door faces
  const depth = Math.min(19.5, d - 4.5); // front to back, leaving the faucet a strip of counter
  return {
    bw,
    apronH,
    rimY,
    apronY0,
    front,
    back: front - depth,
    depth,
    /** Doors stop short of the apron, leaving a shadow reveal under it. */
    doorTop: apronY0 - 0.25,
    /** Glaze wall thickness at the rim. */
    wall: 0.75,
    /** Plan radius of the apron's vertical corners. */
    cornerR: 1,
  };
}

export type FarmhouseSink = ReturnType<typeof farmhouseSink>;

/** The pair of doors under a farmhouse apron. */
export function farmhouseFronts(w: number, s: FarmhouseSink): FrontSpec[] {
  const bottom = 4;
  return baseFronts(w, 'door-drawer')
    .filter((f) => f.y < 28)
    .map((f) => ({ ...f, h: s.doorTop - bottom, pull: f.pull && { ...f.pull, y: s.doorTop - 3.8 } }));
}
