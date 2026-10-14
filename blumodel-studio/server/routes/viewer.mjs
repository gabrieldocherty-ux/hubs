// Package A (viewer) routes: intentionally none (BUILD_PLAN A-T9). The product page reads
// GET /api/catalog and /api/catalog/products/:id, records analytics through POST /api/events,
// and loads public GLBs from /files/<sha>.glb and the Draco decoders from /draco/ (static,
// served from DIST_DIR). Studio renders are made in the browser; the paywall for downloading
// one is billing's POST /api/projects/:id/exports { kind: 'render' }.

/** @param {any} ctx */
export default function routes(ctx) {
  void ctx;
  return [];
}
