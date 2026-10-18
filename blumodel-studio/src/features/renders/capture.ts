import { isCompact } from '../../components/MobileState';
import { getProduct } from '../../data/catalog';
import { useDesignStore } from '../../store/useDesignStore';
import { capSize, waitForStillRenderer } from '../viewer/studio';
import type { RenderScene } from './api';
import { buildScene, captureSize } from './model';

/**
 * Captures what the 3D view shows now, for a photoreal render: the Studio render's offscreen still
 * renderer (src/features/viewer/studio.ts) at the current camera, 1600 px on the long side, as a
 * PNG (a JPEG if the PNG is over the server's limit), plus the scene description of the design.
 * Plain TS with no three: the lazy 3D view registers the renderer, this only asks it.
 */

/** Shows the 3D view if it isn't on screen (split view on a desktop, 3D on a phone). */
export function ensure3d() {
  const s = useDesignStore.getState();
  const mode = s.ui.viewMode;
  const compact = isCompact();
  const showing = mode === '3d' || (mode === 'split' && !compact);
  if (!showing) s.setUI({ viewMode: compact ? '3d' : 'split' });
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser couldn’t capture the 3D view.'))), type, quality));
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(new Error('This browser couldn’t read the captured view.'));
    r.readAsDataURL(blob);
  });
}

export interface Captured {
  image: string;
  width: number;
  height: number;
  bytes: number;
  type: string;
  /** A small preview for the dialog while the render runs. */
  previewUrl: string;
  scene: RenderScene;
}

/** Waits for the 3D view, renders the current camera offscreen, and encodes it. */
export async function captureView({ maxBytes }: { maxBytes: number }): Promise<Captured> {
  ensure3d();
  const reg = await waitForStillRenderer(12_000);
  if (!reg) throw new Error('The 3D view didn’t open in time. Switch to 3D, then try again.');
  const vp = document.querySelector('.scene-view canvas, canvas') as HTMLCanvasElement | null;
  const want = captureSize(vp?.clientWidth || 16, vp?.clientHeight || 9);
  const size = capSize(want.width, want.height, reg.maxSide);
  const canvas = await reg.render({ width: size.width, height: size.height, camera: 'current', quality: 'high', toneMap: 'neutral' });
  let blob = await toBlob(canvas, 'image/png');
  if (blob.size > maxBytes) blob = await toBlob(canvas, 'image/jpeg', 0.92);
  if (blob.size > maxBytes) blob = await toBlob(canvas, 'image/jpeg', 0.8);
  if (blob.size > maxBytes) throw new Error('The captured view is too large to send. Try a smaller window.');
  const image = await base64Of(blob);
  const thumb = document.createElement('canvas');
  const k = Math.min(1, 640 / canvas.width);
  thumb.width = Math.round(canvas.width * k);
  thumb.height = Math.round(canvas.height * k);
  thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  const doc = useDesignStore.getState().doc;
  return {
    image,
    width: canvas.width,
    height: canvas.height,
    bytes: blob.size,
    type: blob.type,
    previewUrl: thumb.toDataURL('image/jpeg', 0.85),
    scene: buildScene(doc, getProduct, { width: canvas.width, height: canvas.height }),
  };
}
