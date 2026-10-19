// Per-address limits on the public reads a copier would script: the catalog, product pages, model
// and image files, brand pages, share links and a showroom's config (docs/handoff/protect.md).
//
// Token buckets (server/auth/rateLimit.mjs take), keyed by the visitor's real address
// (app.mjs clientIp: CF-Connecting-IP only with TRUST_PROXY and a loopback peer). Each group has a
// per-minute bucket, generous for a person (a showroom visit loads one catalog and some 40
// thumbnails; a designer opening the editor again and again is still far below it), and a
// per-day bucket that holds a script copying everything to a crawl. Routes in one group share
// their buckets. A request over budget is a 429 with Retry-After. RATE_LIMITS=off (development
// and tests only; refused in production) turns them all off.

const MIN = 60_000;
const DAY = 86_400_000;

const pair = (name, burst, perMin, perDay) => [
  { name: `${name}-min`, burst, refill: perMin, everyMs: MIN, by: 'ip' },
  { name: `${name}-day`, burst: perDay, refill: perDay, everyMs: DAY, by: 'ip' },
];

export const READ_LIMITS = Object.freeze({
  /** GET /api/catalog (paged), /api/catalog/brands, /api/catalog/retailers. */
  catalog: pair('catalog-read', 60, 30, 1_500),
  /** GET /api/catalog/products/:id, /api/files/:id. */
  product: pair('product-read', 120, 60, 4_000),
  /** GET /files/:name (public models and images) and /api/files/:id/content. */
  files: pair('files-read', 600, 300, 20_000),
  /** GET /api/brands/by-slug/:slug (a partner brand's page with its products). */
  brand: pair('brand-read', 60, 30, 1_500),
  /** GET /api/share/:token. */
  share: pair('share-read-bucket', 60, 30, 1_500),
  /** GET /api/showroom (a showroom's public config: every page load asks once). */
  showroom: pair('showroom-read', 120, 60, 5_000),
  /** GET /api/catalog/retail: BluModel staff only, and still limited. */
  retail: [{ name: 'retail-data', burst: 20, refill: 20, everyMs: 3_600_000, by: 'ip+user' }],
});

/** The most products one GET /api/catalog page carries; the client follows `next`. */
export const CATALOG_PAGE_MAX = 100;

/** Model, image and file responses: no search or image index, and no AI training (docs/handoff/protect.md). */
export const NO_INDEX = Object.freeze({ 'X-Robots-Tag': 'noindex, noimageindex, noai, noimageai' });
