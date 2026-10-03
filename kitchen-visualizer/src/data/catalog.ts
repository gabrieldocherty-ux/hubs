import type { CategoryId, Finish, PlacedItem, Product } from '../types';

const STAINLESS: Finish = { id: 'stainless', name: 'Stainless', hex: '#c3c6ca', material: 'metal' };
const BLACK_STEEL: Finish = { id: 'black-steel', name: 'Black Stainless', hex: '#3a3b3d', material: 'metal' };
const MATTE_WHITE: Finish = { id: 'matte-white', name: 'Matte White', hex: '#ecebe6', material: 'paint' };
const PANEL: Finish = { id: 'panel', name: 'Panel-Ready', hex: '#cfc8bb', material: 'panel' };
const ENAMEL: Finish[] = [
  { id: 'sage', name: 'Sage Enamel', hex: '#8ea38a', material: 'paint' },
  { id: 'oxblood', name: 'Oxblood Enamel', hex: '#6d2b2a', material: 'paint' },
  { id: 'cream', name: 'Cream Enamel', hex: '#eee2c9', material: 'paint' },
  { id: 'cobalt', name: 'Cobalt Enamel', hex: '#2c4a8c', material: 'paint' },
];
const WOODS: Finish[] = [
  { id: 'oak', name: 'White Oak', hex: '#c9a57a', material: 'wood' },
  { id: 'walnut', name: 'Walnut', hex: '#6b4630', material: 'wood' },
  { id: 'ebony', name: 'Ebonized Ash', hex: '#2c2a28', material: 'wood' },
];
const FRAME: Finish[] = [
  { id: 'white', name: 'Painted White', hex: '#f3f1ec', material: 'paint' },
  { id: 'black', name: 'Black Steel', hex: '#232323', material: 'metal' },
  { id: 'oak', name: 'Natural Oak', hex: '#c49a6c', material: 'wood' },
];

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'cabinets', label: 'Cabinets' },
  { id: 'appliances', label: 'Appliances' },
  { id: 'sinks', label: 'Sinks' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'seating', label: 'Seating & Tables' },
  { id: 'openings', label: 'Doors & Windows' },
  { id: 'decor', label: 'Decor' },
];

const BASE_WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

export const CATALOG: Product[] = [
  // ─── Cabinets ──────────────────────────────────────────────────────────
  {
    id: 'base', kind: 'base', variant: 'door-drawer', category: 'cabinets', brand: 'Nordwell', name: 'Base Cabinet',
    code: 'B{w}', widthIn: 24, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: BASE_WIDTHS, price: 420,
    finishes: 'cabinet', blurb: 'Top drawer over doors. The workhorse of every run.',
  },
  {
    id: 'drawer-base', kind: 'base', variant: 'drawers', category: 'cabinets', brand: 'Nordwell', name: 'Drawer Base',
    code: 'DB{w}', widthIn: 30, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: [12, 15, 18, 24, 30, 36], price: 560,
    finishes: 'cabinet', blurb: 'Three deep drawers for pots, pans and plates.',
  },
  {
    id: 'trash-base', kind: 'base', variant: 'trash', category: 'cabinets', brand: 'Nordwell', name: 'Trash Pull-Out',
    code: 'BWB{w}', widthIn: 18, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: [15, 18], price: 610,
    finishes: 'cabinet', blurb: 'Twin bins behind a full-height drawer front.',
  },
  {
    id: 'corner', kind: 'corner', category: 'cabinets', brand: 'Nordwell', name: 'Lazy Susan Corner',
    code: 'LS36', widthIn: 36, depthIn: 36, heightIn: 36, elevationIn: 0, price: 780,
    finishes: 'cabinet', blurb: 'Rotating shelves turn the dead corner into storage.',
  },
  {
    id: 'wall', kind: 'wall', variant: 'door', category: 'cabinets', brand: 'Nordwell', name: 'Wall Cabinet',
    code: 'W{w}30', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: BASE_WIDTHS, price: 290,
    finishes: 'cabinet', blurb: 'Hung 18″ above the counter, standard 30″ tall.',
  },
  {
    id: 'wall-glass', kind: 'wall', variant: 'glass', category: 'cabinets', brand: 'Nordwell', name: 'Glass-Front Wall Cabinet',
    code: 'WG{w}30', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30, 36], price: 380,
    finishes: 'cabinet', blurb: 'Reeded glass doors to show off the good glasses.',
  },
  {
    id: 'bridge', kind: 'wall', variant: 'bridge', category: 'cabinets', brand: 'Nordwell', name: 'Over-Fridge Cabinet',
    code: 'W{w}15', widthIn: 36, depthIn: 24, heightIn: 15, elevationIn: 72, widthOptions: [30, 33, 36], price: 260,
    finishes: 'cabinet', blurb: 'Deep bridge cabinet that sits flush above the fridge.',
  },
  {
    id: 'pantry', kind: 'tall', variant: 'pantry', category: 'cabinets', brand: 'Nordwell', name: 'Pantry Tower',
    code: 'U{w}84', widthIn: 24, depthIn: 24, heightIn: 84, elevationIn: 0, widthOptions: [18, 24, 30, 36], price: 1150,
    finishes: 'cabinet', blurb: 'Floor-to-crown storage with roll-out shelves.',
  },
  {
    id: 'island', kind: 'island', category: 'cabinets', brand: 'Haldor', name: 'Kitchen Island',
    code: 'ISL{w}', widthIn: 84, depthIn: 42, heightIn: 36, elevationIn: 0, widthOptions: [60, 72, 84, 96, 108], price: 2400,
    finishes: 'cabinet', blurb: 'Storage on the work side, 12″ seating overhang on the other.',
  },
  {
    id: 'shelf', kind: 'shelf', category: 'cabinets', brand: 'Grainhouse', name: 'Floating Shelf',
    code: 'SH{w}', widthIn: 36, depthIn: 10, heightIn: 2, elevationIn: 62, widthOptions: [24, 30, 36, 48, 60], price: 180,
    finishes: WOODS, blurb: 'Solid-wood open shelf on hidden brackets.',
  },

  // ─── Appliances ────────────────────────────────────────────────────────
  {
    id: 'range-30', kind: 'range', variant: 'gas-4', category: 'appliances', brand: 'Corviq', name: 'Gas Range 30″',
    code: 'R30', widthIn: 30, depthIn: 28, heightIn: 36, elevationIn: 0, price: 1899,
    finishes: [STAINLESS, BLACK_STEEL, MATTE_WHITE], blurb: 'Four sealed burners and a convection oven.',
  },
  {
    id: 'induction-30', kind: 'range', variant: 'induction', category: 'appliances', brand: 'Corviq', name: 'Induction Range 30″',
    code: 'IR30', widthIn: 30, depthIn: 28, heightIn: 36, elevationIn: 0, price: 2699,
    finishes: [BLACK_STEEL, STAINLESS, MATTE_WHITE], blurb: 'Glass cooktop, boils water in about 90 seconds.',
  },
  {
    id: 'pro-36', kind: 'range', variant: 'gas-6', category: 'appliances', brand: 'Halvard Pro', name: 'Pro Dual-Fuel Range 36″',
    code: 'PR36', widthIn: 36, depthIn: 28, heightIn: 36, elevationIn: 0, price: 6490,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Six burners, cast grates, restaurant-grade.',
  },
  {
    id: 'pro-48', kind: 'range', variant: 'griddle', category: 'appliances', brand: 'Halvard Pro', name: 'Pro Range 48″ + Griddle',
    code: 'PR48', widthIn: 48, depthIn: 28, heightIn: 36, elevationIn: 0, price: 9890,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Six burners, a steel griddle and two ovens.',
  },
  {
    id: 'heritage-36', kind: 'range', variant: 'gas-6', category: 'appliances', brand: 'Aurelle', name: 'Heritage Range 36″',
    code: 'HR36', widthIn: 36, depthIn: 27, heightIn: 36, elevationIn: 0, price: 7890,
    finishes: ENAMEL, blurb: 'Enameled statement range with brass knobs.',
  },
  {
    id: 'hood-chimney', kind: 'hood', variant: 'chimney', category: 'appliances', brand: 'Corviq', name: 'Chimney Hood',
    code: 'VH{w}', widthIn: 30, depthIn: 20, heightIn: 18, elevationIn: 66, widthOptions: [30, 36, 48], price: 799,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Wall-mount canopy with a duct cover to the ceiling.',
  },
  {
    id: 'hood-plaster', kind: 'hood', variant: 'plaster', category: 'appliances', brand: 'Aurelle', name: 'Plaster Hood',
    code: 'PH{w}', widthIn: 36, depthIn: 22, heightIn: 24, elevationIn: 64, widthOptions: [30, 36, 48], price: 2400,
    finishes: [
      { id: 'plaster', name: 'Plaster White', hex: '#eee8dd', material: 'paint' },
      { id: 'limewash', name: 'Limewash Stone', hex: '#d5cab8', material: 'paint' },
      { id: 'clay', name: 'Clay', hex: '#b9704f', material: 'paint' },
    ],
    blurb: 'Hand-troweled tapered hood, the kitchen\'s centerpiece.',
  },
  {
    id: 'fridge-36', kind: 'fridge', variant: 'french', category: 'appliances', brand: 'Nordlys', name: 'French Door Fridge 36″',
    code: 'REF36', widthIn: 36, depthIn: 30, heightIn: 70, elevationIn: 0, price: 3299,
    finishes: [STAINLESS, BLACK_STEEL, MATTE_WHITE, PANEL], blurb: 'Counter-depth, bottom freezer drawer.',
  },
  {
    id: 'fridge-column', kind: 'fridge', variant: 'column', category: 'appliances', brand: 'Nordlys', name: 'Column Refrigerator 30″',
    code: 'COL30', widthIn: 30, depthIn: 24, heightIn: 84, elevationIn: 0, price: 6890,
    finishes: [PANEL, STAINLESS], blurb: 'Fully integrated, disappears behind cabinet panels.',
  },
  {
    id: 'fridge-retro', kind: 'fridge', variant: 'retro', category: 'appliances', brand: 'Aurelle', name: 'Retro Fridge 24″',
    code: 'RF24', widthIn: 24, depthIn: 28, heightIn: 60, elevationIn: 0, price: 2190,
    finishes: ENAMEL, blurb: 'Rounded 1950s silhouette, chrome handle.',
  },
  {
    id: 'oven-tower', kind: 'oven-tower', category: 'appliances', brand: 'Corviq', name: 'Double Wall Oven Tower',
    code: 'OV{w}84', widthIn: 30, depthIn: 24, heightIn: 84, elevationIn: 0, widthOptions: [30, 33], price: 3890,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Two convection ovens stacked in a tall cabinet.',
  },
  {
    id: 'dishwasher', kind: 'dishwasher', category: 'appliances', brand: 'Corviq', name: 'Dishwasher 24″',
    code: 'DW24', widthIn: 24, depthIn: 24, heightIn: 36, elevationIn: 0, price: 899,
    finishes: [STAINLESS, BLACK_STEEL, PANEL], blurb: '42 dB, third rack, hidden controls.',
  },
  {
    id: 'microwave', kind: 'microwave', category: 'appliances', brand: 'Corviq', name: 'Over-the-Range Microwave',
    code: 'OTR30', widthIn: 30, depthIn: 16, heightIn: 17, elevationIn: 66, price: 449,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Doubles as a vented hood above a 30″ range.',
  },
  {
    id: 'wine-24', kind: 'wine', variant: 'wine', category: 'appliances', brand: 'Nordlys', name: 'Wine Column 24″',
    code: 'WC24', widthIn: 24, depthIn: 24, heightIn: 36, elevationIn: 0, price: 1499,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Dual-zone, 46 bottles, under the counter.',
  },
  {
    id: 'bev-15', kind: 'wine', variant: 'beverage', category: 'appliances', brand: 'Nordlys', name: 'Beverage Center 15″',
    code: 'BC15', widthIn: 15, depthIn: 24, heightIn: 36, elevationIn: 0, price: 999,
    finishes: [STAINLESS, BLACK_STEEL], blurb: 'Cans, bottles and sparkling water at arm\'s reach.',
  },

  // ─── Sinks ─────────────────────────────────────────────────────────────
  {
    id: 'sink-under', kind: 'sink', variant: 'undermount', category: 'sinks', brand: 'Halbrook', name: 'Undermount Sink Base',
    code: 'SB{w}', widthIn: 33, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: [30, 33, 36], price: 980,
    finishes: [
      { id: 'steel', name: 'Brushed Steel', hex: '#b9bcc0', material: 'metal' },
      { id: 'composite', name: 'Black Composite', hex: '#2a2a2a', material: 'stone' },
      { id: 'fireclay', name: 'White Fireclay', hex: '#f4f2ee', material: 'ceramic' },
    ],
    blurb: 'Single bowl, pull-down faucet, cabinet included.',
  },
  {
    id: 'sink-farm', kind: 'sink', variant: 'farmhouse', category: 'sinks', brand: 'Halbrook', name: 'Farmhouse Apron Sink',
    code: 'FS{w}', widthIn: 36, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: [30, 33, 36], price: 1690,
    finishes: [
      { id: 'fireclay', name: 'White Fireclay', hex: '#f5f3ef', material: 'ceramic' },
      { id: 'black-clay', name: 'Matte Black Fireclay', hex: '#2b2a29', material: 'ceramic' },
      { id: 'copper', name: 'Hammered Copper', hex: '#b5714a', material: 'metal' },
    ],
    blurb: 'Deep apron-front bowl, bridge faucet.',
  },
  {
    id: 'sink-double', kind: 'sink', variant: 'double', category: 'sinks', brand: 'Halbrook', name: 'Double-Bowl Sink Base',
    code: 'DSB{w}', widthIn: 36, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: [33, 36], price: 1240,
    finishes: [
      { id: 'steel', name: 'Brushed Steel', hex: '#b9bcc0', material: 'metal' },
      { id: 'composite', name: 'Black Composite', hex: '#2a2a2a', material: 'stone' },
    ],
    blurb: 'Wash on one side, rinse on the other.',
  },
  {
    id: 'sink-prep', kind: 'sink', variant: 'prep', category: 'sinks', brand: 'Halbrook', name: 'Prep Sink Base',
    code: 'PS{w}', widthIn: 18, depthIn: 24, heightIn: 36, elevationIn: 0, widthOptions: [15, 18], price: 720,
    finishes: [
      { id: 'steel', name: 'Brushed Steel', hex: '#b9bcc0', material: 'metal' },
      { id: 'composite', name: 'Black Composite', hex: '#2a2a2a', material: 'stone' },
    ],
    blurb: 'Small second sink, perfect on an island.',
  },

  // ─── Lighting ──────────────────────────────────────────────────────────
  {
    id: 'pendant-dome', kind: 'pendant', variant: 'dome', category: 'lighting', brand: 'Lumen & Lane', name: 'Dome Pendant',
    code: 'LP-D', widthIn: 14, depthIn: 14, heightIn: 10, elevationIn: 68, price: 289,
    finishes: [
      { id: 'black', name: 'Matte Black', hex: '#222222', material: 'metal' },
      { id: 'brass', name: 'Brushed Brass', hex: '#c6a15b', material: 'metal' },
      { id: 'sage', name: 'Sage Enamel', hex: '#8ea38a', material: 'paint' },
      { id: 'white', name: 'Gloss White', hex: '#f2f0eb', material: 'paint' },
    ],
    blurb: 'Classic enamel dome, 30″ above the counter.',
  },
  {
    id: 'pendant-globe', kind: 'pendant', variant: 'globe', category: 'lighting', brand: 'Lumen & Lane', name: 'Globe Pendant',
    code: 'LP-G', widthIn: 12, depthIn: 12, heightIn: 12, elevationIn: 66, price: 349,
    finishes: [
      { id: 'opal', name: 'Opal + Brass', hex: '#f4efe6', material: 'glass' },
      { id: 'smoke', name: 'Smoked + Black', hex: '#5a5550', material: 'glass' },
    ],
    blurb: 'Hand-blown glass globe with a soft glow.',
  },
  {
    id: 'pendant-cone', kind: 'pendant', variant: 'cone', category: 'lighting', brand: 'Lumen & Lane', name: 'Cone Pendant',
    code: 'LP-C', widthIn: 10, depthIn: 10, heightIn: 13, elevationIn: 66, price: 219,
    finishes: [
      { id: 'terracotta', name: 'Terracotta', hex: '#b9694a', material: 'ceramic' },
      { id: 'black', name: 'Matte Black', hex: '#222222', material: 'metal' },
      { id: 'white', name: 'Gloss White', hex: '#f2f0eb', material: 'paint' },
    ],
    blurb: 'Slim ceramic cone, great in a row of three.',
  },
  {
    id: 'pendant-woven', kind: 'pendant', variant: 'woven', category: 'lighting', brand: 'Lumen & Lane', name: 'Woven Rattan Pendant',
    code: 'LP-W', widthIn: 20, depthIn: 20, heightIn: 14, elevationIn: 64, price: 259,
    finishes: [
      { id: 'natural', name: 'Natural Rattan', hex: '#c9a26b', material: 'fabric' },
      { id: 'dark', name: 'Dark Rattan', hex: '#6b4a2e', material: 'fabric' },
    ],
    blurb: 'Hand-woven shade that throws warm patterned light.',
  },
  {
    id: 'linear', kind: 'pendant', variant: 'linear', category: 'lighting', brand: 'Lumen & Lane', name: 'Linear Chandelier',
    code: 'LC-48', widthIn: 48, depthIn: 6, heightIn: 5, elevationIn: 70, price: 699,
    finishes: [
      { id: 'brass', name: 'Brushed Brass', hex: '#c6a15b', material: 'metal' },
      { id: 'black', name: 'Matte Black', hex: '#222222', material: 'metal' },
    ],
    blurb: 'One long bar of light, made for islands.',
  },

  // ─── Seating & tables ──────────────────────────────────────────────────
  {
    id: 'stool', kind: 'stool', variant: 'counter', category: 'seating', brand: 'Oakhurst', name: 'Counter Stool',
    code: 'CS26', widthIn: 17, depthIn: 17, heightIn: 26, elevationIn: 0, price: 329,
    finishes: [
      { id: 'walnut', name: 'Walnut + Leather', hex: '#6b4630', material: 'wood' },
      { id: 'oak', name: 'Oak + Linen', hex: '#c9a57a', material: 'wood' },
      { id: 'black', name: 'Black Steel', hex: '#252525', material: 'metal' },
    ],
    blurb: 'Backless, tucks fully under a 12″ overhang.',
  },
  {
    id: 'stool-backed', kind: 'stool', variant: 'backed', category: 'seating', brand: 'Oakhurst', name: 'Upholstered Counter Stool',
    code: 'CS26B', widthIn: 19, depthIn: 20, heightIn: 38, elevationIn: 0, price: 449,
    finishes: [
      { id: 'cognac', name: 'Cognac Leather', hex: '#8a5630', material: 'leather' },
      { id: 'boucle', name: 'Oat Bouclé', hex: '#e4dccd', material: 'fabric' },
      { id: 'olive', name: 'Olive Velvet', hex: '#6f7248', material: 'fabric' },
    ],
    blurb: 'Low back and footrest for long conversations.',
  },
  {
    id: 'table-round', kind: 'table', variant: 'round', category: 'seating', brand: 'Oakhurst', name: 'Round Dining Table 48″',
    code: 'TR48', widthIn: 48, depthIn: 48, heightIn: 30, elevationIn: 0, price: 1290,
    finishes: [...WOODS, { id: 'marble', name: 'White Marble', hex: '#eeebe5', material: 'stone' }],
    blurb: 'Pedestal base seats four without knocking knees.',
  },
  {
    id: 'table-rect', kind: 'table', variant: 'rect', category: 'seating', brand: 'Oakhurst', name: 'Farmhouse Table 72″',
    code: 'TF72', widthIn: 72, depthIn: 36, heightIn: 30, elevationIn: 0, price: 1690,
    finishes: WOODS, blurb: 'Solid plank top on turned legs, seats six.',
  },
  {
    id: 'chair', kind: 'chair', category: 'seating', brand: 'Oakhurst', name: 'Dining Chair',
    code: 'DC18', widthIn: 18, depthIn: 20, heightIn: 32, elevationIn: 0, price: 219,
    finishes: WOODS, blurb: 'Spindle back, saddle seat.',
  },

  // ─── Doors & windows ───────────────────────────────────────────────────
  {
    id: 'window', kind: 'window', variant: 'casement', category: 'openings', brand: 'Framewright', name: 'Casement Window',
    code: 'CW{w}', widthIn: 36, depthIn: 6, heightIn: 42, elevationIn: 42, widthOptions: [24, 30, 36, 48], price: 690,
    finishes: FRAME, blurb: 'Snaps into a wall. 42″ sill clears the backsplash.',
  },
  {
    id: 'window-picture', kind: 'window', variant: 'picture', category: 'openings', brand: 'Framewright', name: 'Picture Window',
    code: 'PW{w}', widthIn: 60, depthIn: 6, heightIn: 48, elevationIn: 38, widthOptions: [48, 60, 72], price: 1190,
    finishes: FRAME, blurb: 'Wide fixed pane with slim divided lites.',
  },
  {
    id: 'door', kind: 'door', variant: 'single', category: 'openings', brand: 'Framewright', name: 'Interior Door',
    code: 'D{w}', widthIn: 32, depthIn: 6, heightIn: 80, elevationIn: 0, widthOptions: [28, 30, 32, 36], price: 390,
    finishes: FRAME, blurb: 'Swings into the room. Flip to change the hinge side.',
  },
  {
    id: 'door-french', kind: 'door', variant: 'double', category: 'openings', brand: 'Framewright', name: 'Glazed French Doors',
    code: 'FD{w}', widthIn: 60, depthIn: 6, heightIn: 80, elevationIn: 0, widthOptions: [60, 72], price: 1890,
    finishes: FRAME, blurb: 'A pair of glass doors out to the garden.',
  },
  {
    id: 'opening', kind: 'door', variant: 'opening', category: 'openings', brand: 'Framewright', name: 'Cased Opening',
    code: 'CO{w}', widthIn: 48, depthIn: 6, heightIn: 84, elevationIn: 0, widthOptions: [36, 48, 60], price: 240,
    finishes: FRAME, blurb: 'A trimmed doorway with no door, open to the next room.',
  },

  // ─── Decor ─────────────────────────────────────────────────────────────
  {
    id: 'rug-runner', kind: 'rug', variant: 'runner', category: 'decor', brand: 'Hearth & Vine', name: 'Kilim Runner',
    code: 'RG3x8', widthIn: 30, depthIn: 96, heightIn: 0.5, elevationIn: 0, price: 249,
    finishes: [
      { id: 'rust', name: 'Rust Kilim', hex: '#a9573a', material: 'fabric' },
      { id: 'indigo', name: 'Indigo', hex: '#3b4f7a', material: 'fabric' },
      { id: 'oat', name: 'Oatmeal Stripe', hex: '#d9cdb7', material: 'fabric' },
    ],
    blurb: 'Soft underfoot in the galley aisle.',
  },
  {
    id: 'rug-area', kind: 'rug', variant: 'area', category: 'decor', brand: 'Hearth & Vine', name: 'Area Rug 5×8',
    code: 'RG5x8', widthIn: 96, depthIn: 60, heightIn: 0.5, elevationIn: 0, price: 389,
    finishes: [
      { id: 'oat', name: 'Oatmeal Stripe', hex: '#d9cdb7', material: 'fabric' },
      { id: 'rust', name: 'Rust Kilim', hex: '#a9573a', material: 'fabric' },
      { id: 'sage', name: 'Faded Sage', hex: '#9aa88c', material: 'fabric' },
    ],
    blurb: 'Anchors a dining table in an eat-in kitchen.',
  },
  {
    id: 'olive-tree', kind: 'plant', variant: 'olive', category: 'decor', brand: 'Hearth & Vine', name: 'Potted Olive Tree',
    code: 'PL-O', widthIn: 22, depthIn: 22, heightIn: 62, elevationIn: 0, price: 179,
    finishes: [
      { id: 'terracotta', name: 'Terracotta Pot', hex: '#b9694a', material: 'ceramic' },
      { id: 'white', name: 'White Pot', hex: '#efece6', material: 'ceramic' },
      { id: 'black', name: 'Black Pot', hex: '#2a2a2a', material: 'ceramic' },
    ],
    blurb: 'Silver-green leaves for a sunny corner.',
  },
  {
    id: 'fig', kind: 'plant', variant: 'fig', category: 'decor', brand: 'Hearth & Vine', name: 'Fiddle Leaf Fig',
    code: 'PL-F', widthIn: 20, depthIn: 20, heightIn: 54, elevationIn: 0, price: 149,
    finishes: [
      { id: 'white', name: 'White Pot', hex: '#efece6', material: 'ceramic' },
      { id: 'terracotta', name: 'Terracotta Pot', hex: '#b9694a', material: 'ceramic' },
      { id: 'black', name: 'Black Pot', hex: '#2a2a2a', material: 'ceramic' },
    ],
    blurb: 'Big glossy leaves, loves bright indirect light.',
  },
];

const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

export function getProduct(id: string): Product | undefined {
  return BY_ID.get(id);
}

export function itemWidth(item: PlacedItem, product: Product): number {
  return item.widthIn ?? product.widthIn;
}

export function productCode(product: Product, width: number): string {
  return product.code.replace('{w}', String(width));
}

/** Wider variants cost more, but not linearly: the box, hinges and labor are fixed. */
export function priceFor(product: Product, width: number): number {
  if (!product.widthOptions) return product.price;
  const ratio = width / product.widthIn;
  return Math.round((product.price * (0.45 + 0.55 * ratio)) / 5) * 5;
}

export const isOpening = (p: Product) => p.kind === 'window' || p.kind === 'door';
export const isCabinetry = (p: Product) =>
  p.kind === 'base' || p.kind === 'corner' || p.kind === 'wall' || p.kind === 'tall' || p.kind === 'island';
/** Items that sit under a countertop and get one automatically. */
export const hasCountertop = (p: Product) =>
  p.kind === 'base' || p.kind === 'corner' || p.kind === 'island' || p.kind === 'sink' || p.kind === 'dishwasher' || p.kind === 'wine';
/** Items that make sense flush against a wall and should snap to it. */
export const snapsToWall = (p: Product) =>
  !['island', 'stool', 'pendant', 'table', 'chair', 'rug', 'plant'].includes(p.kind);
export const isOverhead = (p: Product) => p.elevationIn >= 48;
