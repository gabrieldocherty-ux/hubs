// The sales page's slideshow pictures: their photoreal versions live in <data folder>/marketing/
// (made by server/scripts/render-marketing.mjs, served by GET /api/marketing/photoreal/<name>).

import path from 'node:path';

/** What each 3D picture shows, for the render service. Keys are the picture names (kitchen-<n>). */
export const MARKETING_PROMPTS = Object.freeze({
  'kitchen-1':
    'Photorealistic interior photograph of a bright luxury kitchen: white shaker cabinets with brass hardware, a long marble waterfall island with four oak stools, brass dome pendants, zellige tile backsplash, herringbone oak floor, soft natural daylight. Keep the exact layout, cabinets and camera angle.',
  'kitchen-2':
    'Photorealistic interior photograph of a bright luxury kitchen seen from a breakfast bay: white shaker cabinets, a long marble waterfall island with oak stools, brass pendants, an open dining room with an oak table and chairs beyond, herringbone oak floor, soft natural daylight. Keep the exact layout and camera angle.',
  'kitchen-3':
    'Photorealistic interior photograph of a modern U-shaped kitchen: matte charcoal slab cabinets with brass bar pulls, dark stone countertops, white tile backsplash, stainless steel French-door fridge and range, large white porcelain floor tiles, a window over the sink, warm daylight. Keep the exact layout and camera angle.',
  'kitchen-4':
    'Photorealistic interior photograph of a modern U-shaped kitchen: matte charcoal slab cabinets with brass bar pulls, dark stone countertops, a stainless chimney hood over a professional range, white tile backsplash, a window over the undermount sink, large white porcelain floor tiles, warm daylight. Keep the exact layout and camera angle.',
});

export const MARKETING_NAMES = Object.freeze(Object.keys(MARKETING_PROMPTS));

/** Where the photoreal pictures are kept for this database, or null (an in-memory one). */
export const marketingDir = (dbPath) => (!dbPath || dbPath === ':memory:' ? null : path.join(path.dirname(path.resolve(dbPath)), 'marketing'));
