/** The Studio render preview's size (RenderDialog). The watermark it used to carry is gone since the showroom pivot. */

/** The preview's pixel size: the render scaled down so its long side is at most `maxSide`. */
export function previewSize(width: number, height: number, maxSide = 1600): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
