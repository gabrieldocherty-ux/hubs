// Loads the export kit (server/generated/export-kit.mjs), the browser's estimate, CSV and
// contractor price math bundled by scripts/build-kit.mjs. Loaded on first use so the server
// still starts (and everything else works) on a checkout where it hasn't been built.

import { HttpError } from '../http/respond.mjs';

let kit = null;

export async function loadKit() {
  if (kit) return kit;
  try {
    kit = await import('../generated/export-kit.mjs');
    return kit;
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') throw new HttpError(503, 'Exports aren’t built on this server yet. Run npm run build (or npm run api), then try again.');
    throw err;
  }
}

/** The kit if it has already loaded, else null (for synchronous callers). */
export function kitIfLoaded() {
  return kit;
}
