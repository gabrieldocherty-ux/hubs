// The sales page's slideshow pictures: their photoreal versions live in <data folder>/marketing/
// (made by server/scripts/render-marketing.mjs, served by GET /api/marketing/photoreal/<name>).

import path from 'node:path';

const REAL = 'Ultra-realistic professional interior photograph, as if taken by a real-estate photographer with a 24mm lens: natural window light, soft realistic shadows, true-to-life materials with subtle texture and reflections. Keep the exact layout, cabinets, appliances and camera angle.';

/** What each 3D picture shows, for the render service. Keys are the picture names (kitchen-<n>). */
export const MARKETING_PROMPTS = Object.freeze({
  'kitchen-1':
    'Photorealistic interior photograph of a bright luxury kitchen: white shaker cabinets with brass hardware, a long marble waterfall island with four oak stools, brass dome pendants, zellige tile backsplash, herringbone oak floor, soft natural daylight. Keep the exact layout, cabinets and camera angle.',
  'kitchen-2': `A bright spa-like ensuite bathroom: a curbless walk-in shower recessed into a tiled alcove behind one fixed frameless glass panel from floor to ceiling, a linear drain, a ceiling rain head, a warm wood double vanity with brass taps and a mirror, a classic white two-piece toilet, a tall wood linen cabinet, a casement window (not a door), small white hexagon floor tiles, soft grey walls. ${REAL}`,
  // The approved look (2026-10-21), now with the uppers wrapping around the corners.
  'kitchen-4':
    'Photorealistic interior photograph of a modern U-shaped kitchen: matte charcoal slab cabinets with brass bar pulls, a continuous row of upper cabinets wrapping around the corners, dark stone countertops, a stainless chimney hood over a professional range, white tile backsplash, a window over the undermount sink, large white porcelain floor tiles, warm daylight. Keep the exact layout and camera angle.',
  'kitchen-5': `A warm galley kitchen with an island: smoked walnut cabinets, a light stone countertop, brass hardware, pendants over the island, a range and hood, wood floors. ${REAL}`,
  'kitchen-6': `A classic L-shaped kitchen with an island: deep navy blue shaker cabinets with brass hardware, white marble countertops, a white tile backsplash, a farmhouse sink under a window, pendants over the island, oak floors. ${REAL}`,
  'kitchen-7': `A calm primary bathroom: a white freestanding soaking tub with a floor-mounted filler under a large picture window, a warm wood double vanity with brass taps and a mirror, a tall wood linen cabinet, a fig plant, marble floor tiles, soft warm walls. ${REAL}`,
});

export const MARKETING_NAMES = Object.freeze(Object.keys(MARKETING_PROMPTS));

/** Where the photoreal pictures are kept for this database, or null (an in-memory one). */
export const marketingDir = (dbPath) => (!dbPath || dbPath === ':memory:' ? null : path.join(path.dirname(path.resolve(dbPath)), 'marketing'));
