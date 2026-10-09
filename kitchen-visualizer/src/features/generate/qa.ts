import { MAX_PHOTOS, newPhotoId, type StoredPhoto } from './photos';

/**
 * QA only (the screen calls this only when the page URL has `?qa`): photos for headless runs,
 * which can't drive a file picker. `qaPhotos=synth:N` draws N stand-in kitchen photos;
 * `qaPhotos=<fileId>,<fileId>` loads photos already uploaded through the files API (the QA
 * route uploads a fixture image first), so they count as uploaded.
 */
export async function qaPhotos(spec: string): Promise<StoredPhoto[]> {
  const synth = /^synth(?::(\d))?$/.exec(spec);
  if (synth) {
    const n = Math.min(MAX_PHOTOS, Math.max(1, Number(synth[1] ?? 2)));
    const out: StoredPhoto[] = [];
    for (let i = 0; i < n; i++) {
      const blob = await drawKitchen(i);
      if (blob) out.push({ id: newPhotoId(), blob, name: `qa-kitchen-${i + 1}.jpg` });
    }
    return out;
  }
  const ids = spec.split(',').filter((s) => /^[A-Za-z0-9_-]{1,80}$/.test(s)).slice(0, MAX_PHOTOS);
  const out: StoredPhoto[] = [];
  for (const id of ids) {
    const res = await fetch(`/api/files/${id}/content`, { credentials: 'same-origin' }).catch(() => null);
    if (res?.ok) out.push({ id: newPhotoId(), blob: await res.blob(), name: `fixture-${id.slice(0, 6)}.png`, fileId: id });
  }
  return out;
}

/** A simple drawn "photo": a wall, wall and base cabinets, a window and a range. */
function drawKitchen(i: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 720;
  const g = c.getContext('2d');
  if (!g) return Promise.resolve(null);
  const wall = ['#e9e2d4', '#dfe5e2', '#efe4d2'][i % 3];
  g.fillStyle = wall;
  g.fillRect(0, 0, 960, 720);
  g.fillStyle = '#b8946a';
  g.fillRect(0, 560, 960, 160);
  // Window
  g.fillStyle = '#cfe0ea';
  g.fillRect(380 + i * 40, 120, 200, 170);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.strokeRect(380 + i * 40, 120, 200, 170);
  // Wall cabinets
  g.fillStyle = '#2f3c52';
  for (let x = 40; x < 340; x += 100) g.fillRect(x, 110, 92, 180);
  for (let x = 640; x < 940; x += 100) g.fillRect(x, 110, 92, 180);
  // Counter and base cabinets
  g.fillStyle = '#efebe4';
  g.fillRect(20, 380, 920, 24);
  g.fillStyle = '#2f3c52';
  for (let x = 30; x < 930; x += 112) g.fillRect(x, 404, 104, 156);
  // Range
  g.fillStyle = '#9aa0a6';
  g.fillRect(250, 404, 120, 156);
  g.fillStyle = '#3a3a3a';
  g.fillRect(262, 420, 96, 40);
  g.font = 'bold 28px system-ui, sans-serif';
  g.fillStyle = '#211e1a';
  g.fillText(`QA photo ${i + 1}`, 30, 60);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}
