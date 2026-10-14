/**
 * The Studio render preview watermark (PLANS_AND_CONTRACTORS §3): a repeated diagonal
 * "BluModel Studio · Preview" at low opacity plus a corner badge. Drawn into the preview's pixels (so a
 * saved preview carries it too), never into the full-resolution render that an entitled user
 * downloads. The on-screen plan and 3D views are never watermarked.
 */

export const WATERMARK_TEXT = 'BluModel Studio · Preview';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** The preview's pixel size: the render scaled down so its long side is at most `maxSide`. */
export function previewSize(width: number, height: number, maxSide = 1600): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Where the diagonal repeats go, in the rotated frame centred on the image: rows `stepY` apart,
 * every other row offset by half a step, covering the whole image whatever the angle.
 */
export function watermarkGrid(width: number, height: number, fontPx: number): { x: number; y: number }[] {
  const stepX = fontPx * 9;
  const stepY = fontPx * 4.2;
  const r = Math.hypot(width, height) / 2 + stepX;
  const out: { x: number; y: number }[] = [];
  let row = 0;
  for (let y = -r; y <= r; y += stepY, row++) {
    for (let x = -r + (row % 2 ? stepX / 2 : 0); x <= r; x += stepX) out.push({ x, y });
  }
  return out;
}

/** Draws the watermark over whatever is already on `ctx` (a `width` × `height` image). */
export function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const unit = Math.max(width, height) / 1280;
  const fontPx = Math.max(12, Math.round(30 * unit));

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.font = `600 ${fontPx}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // White text with a faint dark edge reads on both pale cabinets and dark floors.
  ctx.lineWidth = Math.max(1, fontPx / 14);
  ctx.strokeStyle = 'rgba(33, 30, 26, 0.16)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  for (const p of watermarkGrid(width, height, fontPx)) {
    ctx.strokeText(WATERMARK_TEXT, p.x, p.y);
    ctx.fillText(WATERMARK_TEXT, p.x, p.y);
  }
  ctx.restore();

  // The corner badge, bottom right.
  const bf = Math.max(11, Math.round(17 * unit));
  ctx.save();
  ctx.font = `700 ${bf}px ${FONT}`;
  const padX = bf * 0.8;
  const padY = bf * 0.5;
  const tw = ctx.measureText(WATERMARK_TEXT).width;
  const bw = tw + padX * 2;
  const bh = bf + padY * 2;
  const m = Math.round(16 * unit);
  const x = width - bw - m;
  const y = height - bh - m;
  const rad = bh / 2;
  ctx.fillStyle = 'rgba(33, 30, 26, 0.78)';
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + bw, y, x + bw, y + bh, rad);
  ctx.arcTo(x + bw, y + bh, x, y + bh, rad);
  ctx.arcTo(x, y + bh, x, y, rad);
  ctx.arcTo(x, y, x + bw, y, rad);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fbf9f4';
  ctx.textBaseline = 'middle';
  ctx.fillText(WATERMARK_TEXT, x + padX, y + bh / 2 + bf * 0.04);
  ctx.restore();
}
