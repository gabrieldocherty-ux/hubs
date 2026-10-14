import { exportImage, hasExporter } from '../../lib/exporters';
import { navigateHash } from '../../lib/router';
import { flushAutosave } from '../../hooks/useAutosave';
import { useDesignStore } from '../../store/useDesignStore';

/**
 * The quote shows the kitchen's plan and 3D view as the contractor left them. Both are captured in
 * the editor (where the views are live) and handed to the quote page through sessionStorage; the
 * quote page falls back to a drawn plan when they're missing.
 */

const key = (projectId: string) => `mise.quoteImages.${projectId}`;
const MAX_AGE = 6 * 3600 * 1000;

export interface QuoteImages {
  plan: string | null;
  scene: string | null;
  at: number;
}

/** Re-encodes a capture as a JPEG on white, at most `max` px wide, so both fit in sessionStorage. */
function shrink(dataUrl: string, max = 1600, quality = 0.86): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function openQuote(projectId: string): Promise<void> {
  const store = useDesignStore.getState();
  store.toast('Preparing the quote…', 'info');
  await flushAutosave();
  // Each view on its own, full width, so both pictures are landscape like the page.
  const before = store.ui.viewMode;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const capture = async (mode: 'plan' | '3d', kind: 'plan' | 'scene') => {
    if (useDesignStore.getState().ui.viewMode !== mode) {
      useDesignStore.getState().setUI({ viewMode: mode });
      await sleep(300);
    }
    // The 3D view loads on demand: wait (a few seconds at most) for it to be ready to capture.
    for (let i = 0; i < 40 && !hasExporter(kind); i++) await sleep(150);
    await sleep(mode === '3d' ? 900 : 400);
    return exportImage(kind);
  };
  const plan = await capture('plan', 'plan');
  const scene = await capture('3d', 'scene');
  useDesignStore.getState().setUI({ viewMode: before });
  const images: QuoteImages = { plan: plan ? await shrink(plan) : null, scene: scene ? await shrink(scene) : null, at: Date.now() };
  try {
    sessionStorage.setItem(key(projectId), JSON.stringify(images));
  } catch {
    try {
      // Too big for storage: keep the plan, which matters most on a quote.
      sessionStorage.setItem(key(projectId), JSON.stringify({ ...images, scene: null }));
    } catch {
      /* the quote draws its own plan */
    }
  }
  navigateHash(`#/pro/quote/${projectId}`);
}

export function quoteImages(projectId: string): QuoteImages | null {
  try {
    const raw = sessionStorage.getItem(key(projectId));
    const v = raw ? (JSON.parse(raw) as QuoteImages) : null;
    return v && Date.now() - v.at < MAX_AGE ? v : null;
  } catch {
    return null;
  }
}
