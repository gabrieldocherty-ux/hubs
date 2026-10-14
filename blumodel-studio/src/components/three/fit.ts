/**
 * Pure maths for GLB products (no three import, so it can be unit-tested in node).
 *
 * A brand's GLB arrives in glTF units (metres, +Y up, +Z toward the viewer, which is already
 * BluModel Studio's "front"). It is shown at the product's declared footprint: the bounding box is
 * converted to inches and scaled **uniformly** by the smallest of the three ratios, so the
 * model never exceeds the declared W × H × D and is never distorted. It is then centred on x
 * and z with its lowest point on y = 0; the item group adds the elevation.
 */

export const IN_PER_M = 39.3701;

export type V3 = [number, number, number];

export interface BBox3 {
  min: V3;
  max: V3;
}

export interface Dims {
  /** Width (x), height (y) and depth (z), inches. */
  w: number;
  h: number;
  d: number;
}

export interface Fit {
  /** Inches per model unit, the same on every axis. */
  scale: number;
  /** Where to put the scaled model's origin (inches) so it is centred and sits on y = 0. */
  offset: V3;
  /** The fitted model's size, inches. */
  size: Dims;
}

/** Axes thinner than this (model units) don't constrain the fit (a flat rug, a sheet). */
const EPS = 1e-6;

/**
 * The uniform fit of a model whose bounding box is `bbox` (model units) into the declared
 * `target` box (inches). `unitsToInches` is 39.3701 for glTF metres.
 */
export function fitTransform(bbox: BBox3, target: Dims, unitsToInches = IN_PER_M): Fit {
  const ext: V3 = [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]];
  const want: V3 = [target.w, target.h, target.d];
  let ratio = Infinity;
  for (let i = 0; i < 3; i++) {
    if (!(ext[i] > EPS) || !(want[i] > 0)) continue;
    ratio = Math.min(ratio, want[i] / ext[i]);
  }
  // Nothing to fit against (an empty or degenerate model): keep its real size.
  const scale = Number.isFinite(ratio) ? ratio : unitsToInches;
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  return {
    scale,
    offset: [-cx * scale, -bbox.min[1] * scale, -cz * scale],
    size: { w: ext[0] * scale, h: ext[1] * scale, d: ext[2] * scale },
  };
}

/** Applies a fit to a point in model units, giving inches in the item's frame. */
export function applyFit(fit: Fit, p: V3): V3 {
  return [p[0] * fit.scale + fit.offset[0], p[1] * fit.scale + fit.offset[1], p[2] * fit.scale + fit.offset[2]];
}

export type SlotName = 'finish' | 'cabinet' | 'hardware' | 'counter';

// `mise_` is the prefix models used before the product was renamed BluModel Studio; still read.
const SLOT_RE = /^(?:blumodel|mise)_(finish|cabinet|hardware|counter)(?![a-z0-9])/i;

/**
 * The BluModel Studio material slot a GLB material belongs to, from its name: `blumodel_finish` takes the chosen
 * finish, `blumodel_cabinet` the kitchen's cabinet finish, `blumodel_hardware` the hardware and
 * `blumodel_counter` the countertop. Exporter suffixes (`blumodel_finish.001`, `blumodel_finish_2`) still
 * match, and so does the legacy `mise_` prefix; every other material keeps its baked look.
 */
export function slotOf(materialName: string | undefined | null): SlotName | null {
  const m = materialName ? SLOT_RE.exec(materialName) : null;
  return m ? (m[1].toLowerCase() as SlotName) : null;
}

/** True when a mesh is big enough to be worth casting a shadow (largest side, inches). */
export function castsShadow(sizeIn: Dims, minSideIn = 8): boolean {
  const sides = [sizeIn.w, sizeIn.h, sizeIn.d].sort((a, b) => b - a);
  return sides[0] >= minSideIn && sides[1] >= minSideIn / 4;
}
