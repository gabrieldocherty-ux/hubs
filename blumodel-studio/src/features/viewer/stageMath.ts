/**
 * Pure maths for the product stage (no three import, so it is unit-tested in node).
 *
 * A product is shown on its own on the stage, in inches, centred on x and z. Things that hang
 * or mount on a wall in a kitchen (wall cabinets, hoods, windows) are brought down to the floor,
 * where the contact shadow can ground them; a pendant floats a hand's width above it on a short
 * cord. The camera frames the product's bounding *sphere*, so the turntable never turns any part
 * of it out of the picture.
 */

export interface StageDims {
  /** Width (the chosen width option), depth and height, inches. */
  w: number;
  d: number;
  h: number;
  /** Height of the product's underside above the floor in a kitchen, inches. */
  elevationIn: number;
  kind: string;
}

export interface StageFrame {
  /** Added to the model's y (inches): brings its underside to `bottom`. */
  lift: number;
  /** Where the declared box sits on the stage (inches): `bottom` to `top`. */
  bottom: number;
  top: number;
  /** The ceiling the model is drawn under (its own frame, before `lift`): pendants hang from it. */
  ceilingIn: number;
  /** What the camera frames (inches, stage frame): the declared box plus a pendant's cord. */
  box: { min: [number, number, number]; max: [number, number, number] };
}

/** A pendant's shade floats this far above the stage floor, on a cord this long. */
export const PENDANT_FLOAT_IN = 8;
export const PENDANT_CORD_IN = 10;

export function stageFrame(p: StageDims): StageFrame {
  const pendant = p.kind === 'pendant';
  const bottom = pendant ? PENDANT_FLOAT_IN : 0;
  const lift = bottom - p.elevationIn;
  const top = bottom + p.h;
  // The model draws its cord (pendant) or chimney (hood) up to the ceiling: keep that short.
  const ceilingIn = p.elevationIn + p.h + (pendant ? PENDANT_CORD_IN : 0);
  const frameTop = pendant ? top + PENDANT_CORD_IN : top;
  return {
    lift,
    bottom,
    top,
    ceilingIn,
    box: { min: [-p.w / 2, 0, -p.d / 2], max: [p.w / 2, frameTop, p.d / 2] },
  };
}

/** How far the dimension lines sit out from the product, and their end-tick half length (inches). */
export function dimOffsets(w: number, d: number): { off: number; tick: number } {
  const off = Math.max(2.5, Math.min(Math.max(w, d) * 0.09, 6));
  return { off, tick: Math.max(1.2, off * 0.5) };
}

/**
 * The frame with its camera box widened on x and z by the room the dimension lines and their
 * labels need, so toggling the dimensions never pushes a label off the edge (and never reframes).
 */
export function framedForDims(frame: StageFrame, w: number, d: number): StageFrame {
  const { off, tick } = dimOffsets(w, d);
  const pad = off + tick * 1.6;
  const { min, max } = frame.box;
  return { ...frame, box: { min: [min[0] - pad, min[1], min[2] - pad], max: [max[0] + pad, max[1], max[2] + pad] } };
}

/**
 * Camera distance from the centre of a sphere of `radius` so it fits a perspective camera with
 * vertical field of view `fovDeg` at `aspect` (width / height), with `margin` (1 = touching).
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, margin = 1.04): number {
  const v = (fovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * Math.max(0.05, aspect));
  const half = Math.min(v, h);
  return (Math.max(radius, 1e-3) / Math.sin(half)) * margin;
}

/** The default 3/4 view: in front, a little to the right and above (unit vector). */
export const STAGE_VIEW_DIR: [number, number, number] = (() => {
  const v: [number, number, number] = [0.62, 0.42, 1];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

export interface StageCamera {
  /** Camera position and orbit target, in stage units (feet; the stage draws inches at 1/12). */
  position: [number, number, number];
  target: [number, number, number];
  /** Zoom limits for the orbit controls (feet). */
  minDistance: number;
  maxDistance: number;
  /** Bounding-sphere radius (feet). */
  radius: number;
  /** The framing distance (feet). */
  distance: number;
}

export function stageCamera(frame: StageFrame, fovDeg: number, aspect: number, dir = STAGE_VIEW_DIR): StageCamera {
  const { min, max } = frame.box;
  const c: [number, number, number] = [(min[0] + max[0]) / 24, (min[1] + max[1]) / 24, (min[2] + max[2]) / 24];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 24;
  const distance = fitDistance(radius, fovDeg, aspect);
  return {
    position: [c[0] + dir[0] * distance, c[1] + dir[1] * distance, c[2] + dir[2] * distance],
    target: c,
    minDistance: Math.max(radius * 1.15, 0.5),
    maxDistance: distance * 2.6,
    radius,
    distance,
  };
}

/** "2' 6" · 76.2 cm": a dimension in feet-and-inches and centimetres. */
export function dimText(inchesValue: number, feetInches: (n: number) => string): string {
  const cm = inchesValue * 2.54;
  const cmText = cm >= 100 ? `${Math.round(cm)} cm` : `${Math.round(cm * 10) / 10} cm`;
  return `${feetInches(inchesValue)} · ${cmText}`;
}

/** The width options a product page offers, sorted, always including the default width. */
export function widthChoices(widthIn: number, options: number[] | undefined): number[] {
  const set = new Set<number>([widthIn, ...(options ?? [])].filter((n) => Number.isFinite(n) && n > 0));
  return [...set].sort((a, b) => a - b);
}

/** A requested width (from the URL) if the product offers it, else its default width. */
export function pickWidth(requested: string | number | null | undefined, widthIn: number, options: number[] | undefined): number {
  if (requested === null || requested === undefined || requested === '') return widthIn;
  const n = Number(requested);
  return Number.isFinite(n) && widthChoices(widthIn, options).includes(n) ? n : widthIn;
}

/** The product page's own hash: `#/p/:id?finish=&w=` (the width only when it isn't the default). */
export function productHash(id: string, finish: string | undefined, width: number | undefined, defaultWidth: number): string {
  const q = new URLSearchParams();
  if (finish) q.set('finish', finish);
  if (width && width !== defaultWidth) q.set('w', String(width));
  const s = q.toString();
  return `#/p/${encodeURIComponent(id)}${s ? `?${s}` : ''}`;
}
