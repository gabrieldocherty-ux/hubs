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
