// A model bench, not a regression test: every BluModel Basics product drawn on its product page's
// studio stage (#/p/<id>), one picture each, for judging the procedural models side by side and
// finding the weakest to improve next. Nothing is asserted beyond the stage drawing.
// Run: node scripts/qa.mjs --pkg models --port 8992   (pictures in .qa/models/)

const IDS = [
  'base', 'drawer-base', 'corner', 'wall', 'wall-glass', 'pantry', 'island', 'shelf',
  'range-30', 'induction-30', 'pro-36', 'heritage-36', 'hood-chimney', 'hood-plaster',
  'fridge-36', 'fridge-column', 'fridge-retro', 'oven-tower', 'dishwasher', 'microwave', 'wine-24',
  'sink-under', 'sink-farm', 'sink-double',
  'pendant-dome', 'pendant-globe', 'pendant-cone', 'pendant-woven', 'linear',
  'stool', 'stool-backed', 'table-round', 'table-rect', 'chair',
  'vanity', 'vanity-double', 'vanity-floating', 'toilet', 'toilet-wall', 'tub', 'tub-free',
  'shower', 'shower-glass', 'shower-corner', 'shower-walkin', 'mirror', 'medicine-cabinet',
  'rug-area', 'olive-tree', 'fig',
];

export default IDS.map((id) => ({
  name: `model-${id}`,
  path: `#/p/${id}`,
  as: 'anon',
  viewport: { w: 1100, h: 800 },
  waitFor: ['canvas'],
  check: async (h) => {
    // The stage settles (environment, shadows) before the picture.
    await h.sleep(1800);
  },
}));
