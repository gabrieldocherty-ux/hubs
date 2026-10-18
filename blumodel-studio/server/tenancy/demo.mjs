// The demo showroom (docs/SHOWROOM_PIVOT.md §9): slug 'demo', "Northline Kitchen & Bath (Demo)", a
// fictional company. The sales site links to it and Gabe uses it on calls.
//
//   - the tenant, live: a complimentary license (a year from today, renewed when it has ended) and a
//     complimentary monthly plan, plus $25 of render credits once
//   - branding (colours, welcome, featured lines) and contact details, all fictional (555 numbers)
//   - a curated catalog modelled on BluModel Basics (two cabinet lines with their finishes, sinks,
//     a range, a hood, a fridge, a dishwasher, pendants, stools), with generated thumbnails and no
//     store or "where to buy" links; fill the gaps (BluModel Basics) and bathrooms on
//   - with `people: true` (dev, QA, the demo server; never the admin command): an owner, a staff
//     member and a visitor on the showroom, two sample designs and three leads
//
// Idempotent: products are matched by SKU, people by email, designs by name. Used by
// server/seed/tenants.mjs and `node server/scripts/seed-demo-tenant.mjs`.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from '../lib/synth.mjs';
import { hashPassword, verifyPassword } from '../auth/passwords.mjs';
import { fileURLToPath } from 'node:url';
import { utcDate } from '../billing/showroom.mjs';
import { cleanTarget, lineKey, withImage } from './images.mjs';

export const DEMO_SLUG = 'demo';
export const DEMO_TENANT_ID = 't_demo';
export const DEMO_NAME = 'Northline Kitchen & Bath (Demo)';
export const DEMO_PEOPLE = Object.freeze([
  { key: 'owner', email: 'demo-owner@blumodel.test', name: 'Nora Lindqvist', role: 'owner' },
  { key: 'staff', email: 'demo-staff@blumodel.test', name: 'Theo Marchetti', role: 'staff' },
  { key: 'visitor', email: 'demo-visitor@blumodel.test', name: 'Riley Okafor', role: null },
]);

const SHAKER = [
  { id: 'chalk', name: 'Chalk White', hex: '#efede6', material: 'paint' },
  { id: 'sage', name: 'Northline Sage', hex: '#9aa892', material: 'paint' },
  { id: 'harbour', name: 'Harbour Navy', hex: '#2e3d55', material: 'paint' },
  { id: 'oak', name: 'Natural White Oak', hex: '#c8a77a', material: 'wood' },
];
const SLAB = [
  { id: 'rift-oak', name: 'Rift White Oak', hex: '#c9a979', material: 'wood' },
  { id: 'walnut', name: 'Smoked Walnut', hex: '#5f4330', material: 'wood' },
  { id: 'matte-black', name: 'Matte Black', hex: '#2a2a2b', material: 'paint' },
];
const STEEL = { id: 'steel', name: 'Brushed Stainless', hex: '#c3c6ca', material: 'metal' };

const BASE_W = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
const WALL_W = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
/** A vanity's finishes are its basin's; its cabinet takes the bathroom's cabinet finish. */
const VANITY_BASINS = [{ id: 'porcelain', name: 'White Porcelain Basin', hex: '#f4f2ee', material: 'ceramic' }, { id: 'stone-basin', name: 'Matte Stone Basin', hex: '#a9a49b', material: 'ceramic' }];
const BATH = [
  { id: 'driftwood', name: 'Driftwood Oak', hex: '#b39472', material: 'wood' },
  { id: 'mist', name: 'Coastal Mist', hex: '#c9d1cf', material: 'paint' },
  { id: 'chalk', name: 'Chalk White', hex: '#efede6', material: 'paint' },
];

/**
 * The curated range: fictional lines with realistic sizes, finishes and prices, made to fill the
 * app's layouts (every width the layout builder asks for), with no store or "where to buy" links.
 * `color` is the thumbnail's main colour. Seeding matches products by SKU and brings an existing
 * one up to date when anything here changed (`seedDemoTenant`).
 */
export const DEMO_PRODUCTS = Object.freeze([
  // Lakeshore Shaker: painted and oak five-piece doors, soft-close, dovetailed drawers.
  { sku: 'NL-LS-B{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'base', variant: 'door-drawer', category: 'cabinets', name: 'Lakeshore Base Cabinet', widthIn: 24, depthIn: 24, heightIn: 34.5, widthOptions: BASE_W, price: 540, finishes: SHAKER, color: [239, 237, 230], shape: 'base', blurb: 'Drawer over doors, soft-close, dovetailed maple drawer box.' },
  { sku: 'NL-LS-DB{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'base', variant: 'drawers', category: 'cabinets', name: 'Lakeshore Three-Drawer Base', widthIn: 30, depthIn: 24, heightIn: 34.5, widthOptions: [12, 15, 18, 24, 30, 36], price: 720, finishes: SHAKER, color: [154, 168, 146], shape: 'base', blurb: 'Three deep drawers for pots, pans and plates.' },
  { sku: 'NL-LS-TB{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'base', variant: 'trash', category: 'cabinets', name: 'Lakeshore Pull-Out Recycling Base', widthIn: 18, depthIn: 24, heightIn: 34.5, widthOptions: [15, 18], price: 610, finishes: SHAKER, color: [239, 237, 230], shape: 'base', blurb: 'Twin bins on full-extension slides.' },
  { sku: 'NL-LS-CB36', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'corner', category: 'cabinets', name: 'Lakeshore Blind Corner Base', widthIn: 36, depthIn: 36, heightIn: 34.5, price: 760, finishes: SHAKER, color: [239, 237, 230], shape: 'base', blurb: 'Swing-out shelves reach the back of the corner.' },
  { sku: 'NL-LS-W{w}30', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'door', category: 'cabinets', name: 'Lakeshore Wall Cabinet 30″', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: WALL_W, price: 410, finishes: SHAKER, color: [239, 237, 230], shape: 'wall', blurb: 'Hung 18″ above the counter, adjustable shelves.' },
  { sku: 'NL-LS-WG{w}30', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'glass', category: 'cabinets', name: 'Lakeshore Glass Wall Cabinet', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30, 36], price: 520, finishes: SHAKER, color: [46, 61, 85], shape: 'wall', blurb: 'Seeded glass doors and a lit interior.' },
  { sku: 'NL-LS-WB{w}15', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'wall', variant: 'bridge', category: 'cabinets', name: 'Lakeshore Bridge Cabinet', widthIn: 36, depthIn: 24, heightIn: 15, elevationIn: 72, widthOptions: [30, 33, 36], price: 380, finishes: SHAKER, color: [239, 237, 230], shape: 'wall', blurb: 'Over the fridge, flush with its front.' },
  { sku: 'NL-LS-P{w}84', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'tall', variant: 'pantry', category: 'cabinets', name: 'Lakeshore Tall Pantry', widthIn: 24, depthIn: 24, heightIn: 84, widthOptions: [18, 24, 30, 36], price: 1420, finishes: SHAKER, color: [46, 61, 85], shape: 'tall', blurb: 'Floor-to-crown storage with roll-out shelves.' },
  { sku: 'NL-LS-I{w}', line: 'Lakeshore Shaker', doorStyle: 'shaker', kind: 'island', category: 'cabinets', name: 'Lakeshore Island', widthIn: 84, depthIn: 42, heightIn: 36, widthOptions: [60, 72, 84, 96, 108], price: 3650, finishes: SHAKER, color: [154, 168, 146], shape: 'island', blurb: 'Storage on the work side, seating overhang on the other.' },
  // Harbourfront Slab: flat rift-oak veneer and lacquer doors, handleless.
  { sku: 'NL-HS-B{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'base', variant: 'door-drawer', category: 'cabinets', name: 'Harbourfront Base Cabinet', widthIn: 24, depthIn: 24, heightIn: 34.5, widthOptions: BASE_W, price: 495, finishes: SLAB, color: [201, 169, 121], shape: 'base', blurb: 'Rift-cut oak veneer slab doors, integrated pulls.' },
  { sku: 'NL-HS-DB{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'base', variant: 'drawers', category: 'cabinets', name: 'Harbourfront Drawer Base', widthIn: 30, depthIn: 24, heightIn: 34.5, widthOptions: [12, 15, 18, 24, 30, 36], price: 690, finishes: SLAB, color: [201, 169, 121], shape: 'base', blurb: 'Three wide drawers with a hidden cutlery tray.' },
  { sku: 'NL-HS-TB{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'base', variant: 'trash', category: 'cabinets', name: 'Harbourfront Recycling Base', widthIn: 18, depthIn: 24, heightIn: 34.5, widthOptions: [15, 18], price: 590, finishes: SLAB, color: [201, 169, 121], shape: 'base', blurb: 'Push to open, twin bins.' },
  { sku: 'NL-HS-CB36', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'corner', category: 'cabinets', name: 'Harbourfront Corner Base', widthIn: 36, depthIn: 36, heightIn: 34.5, price: 720, finishes: SLAB, color: [201, 169, 121], shape: 'base', blurb: 'A swing-out corner unit, nothing lost in the back.' },
  { sku: 'NL-HS-W{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'wall', variant: 'door', category: 'cabinets', name: 'Harbourfront Wall Cabinet', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: WALL_W, price: 380, finishes: SLAB, color: [201, 169, 121], shape: 'wall', blurb: 'Handleless, push-to-open.' },
  { sku: 'NL-HS-WG{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'wall', variant: 'glass', category: 'cabinets', name: 'Harbourfront Reeded Glass Cabinet', widthIn: 30, depthIn: 12, heightIn: 30, elevationIn: 54, widthOptions: [15, 18, 24, 30, 36], price: 495, finishes: SLAB, color: [95, 67, 48], shape: 'wall', blurb: 'Reeded glass in a slim oak frame.' },
  { sku: 'NL-HS-WB{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'wall', variant: 'bridge', category: 'cabinets', name: 'Harbourfront Bridge Cabinet', widthIn: 36, depthIn: 24, heightIn: 15, elevationIn: 72, widthOptions: [30, 33, 36], price: 360, finishes: SLAB, color: [201, 169, 121], shape: 'wall', blurb: 'A deep cabinet over the fridge.' },
  { sku: 'NL-HS-P{w}84', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'tall', variant: 'pantry', category: 'cabinets', name: 'Harbourfront Tall Pantry', widthIn: 24, depthIn: 24, heightIn: 84, widthOptions: [18, 24, 30, 36], price: 1380, finishes: SLAB, color: [95, 67, 48], shape: 'tall', blurb: 'Full-height doors with internal drawers.' },
  { sku: 'NL-HS-I{w}', line: 'Harbourfront Slab', doorStyle: 'slab', kind: 'island', category: 'cabinets', name: 'Harbourfront Island', widthIn: 96, depthIn: 42, heightIn: 36, widthOptions: [72, 84, 96, 108], price: 3480, finishes: SLAB, color: [95, 67, 48], shape: 'island', blurb: 'Drawers on the work side, seating on the other.' },
  // Sinks.
  { sku: 'NL-SK-FS{w}', line: 'Northline Sinks', kind: 'sink', variant: 'farmhouse', category: 'sinks', name: 'Fireclay Apron-Front Sink Base', widthIn: 36, depthIn: 24, heightIn: 34.5, widthOptions: [30, 33, 36], price: 1890, finishes: [{ id: 'fireclay', name: 'White Fireclay', hex: '#f5f3ef', material: 'ceramic' }, { id: 'stone', name: 'Grey Stone', hex: '#8f9192', material: 'ceramic' }], color: [245, 243, 239], shape: 'base', blurb: 'A deep fireclay apron sink in a matching base.' },
  { sku: 'NL-SK-UM{w}', line: 'Northline Sinks', kind: 'sink', variant: 'undermount', category: 'sinks', name: 'Undermount Steel Sink Base', widthIn: 33, depthIn: 24, heightIn: 34.5, widthOptions: [30, 33, 36], price: 1150, finishes: [{ id: 'steel', name: 'Brushed Steel', hex: '#b9bcc0', material: 'metal' }, { id: 'graphite', name: 'Graphite', hex: '#3c3f43', material: 'metal' }], color: [185, 188, 192], shape: 'base', blurb: '16-gauge single bowl with a sound-deadened base.' },
  { sku: 'NL-SK-DB{w}', line: 'Northline Sinks', kind: 'sink', variant: 'double', category: 'sinks', name: 'Double-Bowl Composite Sink Base', widthIn: 36, depthIn: 24, heightIn: 34.5, widthOptions: [33, 36], price: 1290, finishes: [{ id: 'onyx', name: 'Onyx Composite', hex: '#2f3032', material: 'stone' }, { id: 'sand', name: 'Sand Composite', hex: '#cdbfa8', material: 'stone' }], color: [47, 48, 50], shape: 'base', blurb: 'Two equal bowls in quartz composite.' },
  // Appliances: the suite Northline sells and installs.
  { sku: 'NL-AP-R36', line: 'Chef’s Appliance Suite', kind: 'range', variant: 'gas-6', category: 'appliances', name: 'Dual-Fuel Range 36″', widthIn: 36, depthIn: 28, heightIn: 36, price: 6290, finishes: [STEEL, { id: 'black', name: 'Black Stainless', hex: '#3a3b3d', material: 'metal' }], flags: { backguard: true }, color: [195, 198, 202], shape: 'range', blurb: 'Six sealed burners and a convection oven.' },
  { sku: 'NL-AP-R30', line: 'Chef’s Appliance Suite', kind: 'range', variant: 'induction', category: 'appliances', name: 'Induction Range 30″', widthIn: 30, depthIn: 28, heightIn: 36, price: 3490, finishes: [STEEL, { id: 'black', name: 'Black Stainless', hex: '#3a3b3d', material: 'metal' }], color: [195, 198, 202], shape: 'range', blurb: 'Four zones with a bridge element and an air-fry oven.' },
  { sku: 'NL-AP-H{w}', line: 'Chef’s Appliance Suite', kind: 'hood', variant: 'chimney', category: 'appliances', name: 'Chimney Hood', widthIn: 36, depthIn: 20, heightIn: 18, elevationIn: 66, widthOptions: [30, 36, 48], price: 1190, finishes: [STEEL], color: [190, 193, 197], shape: 'hood', blurb: '600 CFM, quiet, with a duct cover to the ceiling.' },
  { sku: 'NL-AP-F36', line: 'Chef’s Appliance Suite', kind: 'fridge', variant: 'french', category: 'appliances', name: 'French-Door Refrigerator 36″', widthIn: 36, depthIn: 30, heightIn: 70, price: 3890, finishes: [STEEL, { id: 'panel', name: 'Panel-Ready', hex: '#cfc8bb', material: 'panel' }], color: [196, 199, 203], shape: 'tall', blurb: 'Counter-depth with a bottom freezer drawer.' },
  { sku: 'NL-AP-DW24', line: 'Chef’s Appliance Suite', kind: 'dishwasher', category: 'appliances', name: 'Dishwasher 24″', widthIn: 24, depthIn: 24, heightIn: 34.5, price: 1090, finishes: [STEEL, { id: 'panel', name: 'Panel-Ready', hex: '#cfc8bb', material: 'panel' }], color: [200, 203, 207], shape: 'base', blurb: '42 dB, third rack, hidden controls.' },
  { sku: 'NL-AP-WC24', line: 'Chef’s Appliance Suite', kind: 'wine', variant: 'wine', category: 'appliances', name: 'Undercounter Wine Fridge 24″', widthIn: 24, depthIn: 24, heightIn: 34.5, price: 1690, finishes: [STEEL], color: [60, 62, 66], shape: 'base', blurb: '46 bottles in two temperature zones.' },
  // Lighting.
  { sku: 'NL-LT-D14', line: 'Bay Lighting', kind: 'pendant', variant: 'dome', category: 'lighting', name: 'Bay Dome Pendant', widthIn: 14, depthIn: 14, heightIn: 10, elevationIn: 68, price: 310, finishes: [{ id: 'brass', name: 'Aged Brass', hex: '#b08d57', material: 'metal' }, { id: 'black', name: 'Matte Black', hex: '#222222', material: 'metal' }], color: [176, 141, 87], shape: 'pendant', blurb: 'A spun-metal dome for islands.' },
  { sku: 'NL-LT-G12', line: 'Bay Lighting', kind: 'pendant', variant: 'globe', category: 'lighting', name: 'Opal Globe Pendant', widthIn: 12, depthIn: 12, heightIn: 12, elevationIn: 66, price: 365, finishes: [{ id: 'opal', name: 'Opal + Brass', hex: '#f4efe6', material: 'glass' }], color: [236, 230, 218], shape: 'pendant', blurb: 'Hand-blown opal glass on a brass stem.' },
  { sku: 'NL-LT-L48', line: 'Bay Lighting', kind: 'pendant', variant: 'linear', category: 'lighting', name: 'Linear Island Light 48″', widthIn: 48, depthIn: 6, heightIn: 5, elevationIn: 70, price: 890, finishes: [{ id: 'black', name: 'Matte Black', hex: '#222222', material: 'metal' }, { id: 'brass', name: 'Aged Brass', hex: '#b08d57', material: 'metal' }], color: [40, 40, 40], shape: 'pendant', blurb: 'One slim bar of warm, dimmable light.' },
  // Seating.
  { sku: 'NL-ST-26', line: 'Counter Seating', kind: 'stool', variant: 'counter', category: 'seating', name: 'Oak Counter Stool', widthIn: 17, depthIn: 17, heightIn: 26, price: 345, finishes: [{ id: 'oak', name: 'Natural Oak', hex: '#c49a6c', material: 'wood' }, { id: 'black', name: 'Black Oak', hex: '#2c2a28', material: 'wood' }], color: [196, 154, 108], shape: 'stool', blurb: 'Solid oak, 26″ seat for a 36″ counter.' },
  { sku: 'NL-ST-26B', line: 'Counter Seating', kind: 'stool', variant: 'backed', category: 'seating', name: 'Upholstered Counter Stool', widthIn: 19, depthIn: 20, heightIn: 38, price: 469, finishes: [{ id: 'cognac', name: 'Cognac Leather', hex: '#8a5630', material: 'leather' }, { id: 'oat', name: 'Oat Linen', hex: '#d9cfbd', material: 'fabric' }], color: [138, 86, 48], shape: 'stool', blurb: 'A low back and a stitched leather seat.' },
  // Bayview Bath: vanities (a basin in its base, 21″ deep at vanity height) and a linen tower.
  { sku: 'NL-BV-V{w}', line: 'Bayview Bath', doorStyle: 'shaker', kind: 'sink', variant: 'undermount', category: 'sinks', name: 'Bayview Vanity', widthIn: 36, depthIn: 21, heightIn: 32.5, widthOptions: [24, 30, 36], price: 1680, finishes: VANITY_BASINS, color: [179, 148, 114], shape: 'base', blurb: 'An undermount porcelain basin in a quartz top, two drawers below.' },
  { sku: 'NL-BV-DV{w}', line: 'Bayview Bath', doorStyle: 'shaker', kind: 'sink', variant: 'double', category: 'sinks', name: 'Bayview Double Vanity', widthIn: 60, depthIn: 21, heightIn: 32.5, widthOptions: [48, 60, 72], price: 2980, finishes: VANITY_BASINS, color: [179, 148, 114], shape: 'base', blurb: 'Two basins, a shared quartz top and a bank of drawers.' },
  { sku: 'NL-BV-LT{w}', line: 'Bayview Bath', doorStyle: 'shaker', kind: 'tall', variant: 'pantry', category: 'cabinets', name: 'Bayview Linen Tower', widthIn: 18, depthIn: 15, heightIn: 84, widthOptions: [18, 24], price: 1240, finishes: BATH, color: [201, 209, 207], shape: 'tall', blurb: 'Adjustable shelves and a hamper drawer.' },
]);

/** A 96 px product picture: a soft background and the product's front, to scale. */
export function thumb({ widthIn, heightIn, color, shape }) {
  const S = 96;
  const w = Math.max(widthIn, 6);
  const h = Math.max(heightIn, 6);
  const scale = (S * 0.76) / Math.max(w, h);
  const pw = Math.max(8, Math.round(w * scale));
  const ph = Math.max(8, Math.round(h * scale));
  const x0 = Math.round((S - pw) / 2);
  const y0 = shape === 'pendant' || shape === 'wall' || shape === 'hood' ? Math.round(S * 0.16) : S - 10 - ph;
  const accent = color.map((c) => Math.round(c * 0.55));
  return makePng({
    w: S,
    h: S,
    rgba: (x, y) => {
      const inside = x >= x0 && x < x0 + pw && y >= y0 && y < y0 + ph;
      if (shape === 'pendant' && x === Math.round(S / 2) && y < y0) return [70, 70, 70, 255];
      if (!inside) {
        const g = 245 - Math.round((y / S) * 14);
        return y > S - 10 ? [222, 216, 206, 255] : [g, g - 2, g - 5, 255];
      }
      const ex = Math.min(x - x0, x0 + pw - 1 - x);
      const ey = Math.min(y - y0, y0 + ph - 1 - y);
      if (ex < 1 || ey < 1) return [...accent, 255];
      if (['base', 'tall', 'wall', 'island'].includes(shape) && (x === x0 + Math.round(pw / 2) || (shape === 'base' && y === y0 + Math.round(ph * 0.22)))) return [...accent, 220];
      if (shape === 'range' && y < y0 + 5) return [...accent, 255];
      const shade = 1 - (ey / ph) * 0.12;
      return [Math.round(color[0] * shade), Math.round(color[1] * shade), Math.round(color[2] * shade), 255];
    },
  });
}

function logoPng() {
  // A navy roundel with a white "N"-ish chevron: recognisable at 32 px, fictional.
  return makePng({
    w: 128,
    h: 128,
    rgba: (x, y) => {
      const d = (x - 64) ** 2 + (y - 64) ** 2;
      if (d > 3900) return [255, 255, 255, 0];
      const inN = (x > 40 && x < 50 && y > 38 && y < 90) || (x > 78 && x < 88 && y > 38 && y < 90) || (Math.abs(y - 38 - (x - 45) * 1.2) < 7 && x > 44 && x < 84);
      return inN ? [250, 248, 243, 255] : [46, 61, 85, 255];
    },
  });
}

const BRANDING = {
  primaryColor: '#2e3d55',
  accentColor: '#9aa892',
  welcomeTitle: 'Design your new kitchen with Northline',
  welcomeText:
    'Plan your kitchen or bathroom in 3D with the cabinets, sinks and fixtures we actually sell and install. Save your design and send it to us: our designers will follow up with a quote.',
  featuredLines: ['Lakeshore Shaker', 'Harbourfront Slab', 'Northline Sinks', 'Chef’s Appliance Suite', 'Bay Lighting', 'Bayview Bath'],
};
const CONTACT = {
  phone: '(519) 555-0142',
  email: 'hello@northline-demo.test',
  website: 'https://northline-demo.test/',
  address: '120 Quarry Road, Guelph, ON (a fictional demo address)',
  serviceArea: 'Guelph, Kitchener-Waterloo and Wellington County',
  hours: 'Tue-Fri 10-6, Sat 10-4',
};

/** The seed password (SEED_PASSWORD) or a generated one kept in seed-credentials.txt (never printed). */
function passwordFor(config, email) {
  if (config.SEED_PASSWORD) return { password: config.SEED_PASSWORD, source: 'env' };
  const password = crypto.randomBytes(12).toString('base64url');
  if (config.DB_PATH && config.DB_PATH !== ':memory:') {
    try {
      fs.appendFileSync(path.join(path.dirname(config.DB_PATH), 'seed-credentials.txt'), `${email} ${password}\n`, { mode: 0o600 });
    } catch {
      /* the account exists; reset its password from Admin > Users if needed */
    }
  }
  return { password, source: 'generated' };
}

/** Depth (inches) of a demo product by its id: what the back-wall run sits at. */
const depthOfId = (ids, productId) => DEMO_PRODUCTS.find((p) => ids[p.sku] === productId)?.depthIn ?? 24;

/**
 * A design along the back wall: a run of `ids` (product, width) and an island. Each piece of the
 * run sits with its back on the wall (y = half its depth: a 30″-deep fridge at 15, not 12, or it
 * pokes through the wall and fails the design checks).
 */
function designDoc(name, run, extras = [], ids = {}) {
  let x = 4;
  const items = [];
  for (const [productId, widthIn, finishIndex = 0] of run) {
    items.push({ id: `it-${items.length + 1}`, productId, x: x + widthIn / 2, y: depthOfId(ids, productId) / 2, rotation: 0, finishIndex, widthIn });
    x += widthIn;
  }
  for (const e of extras) items.push({ id: `it-${items.length + 1}`, rotation: 0, finishIndex: 0, ...e });
  return {
    name,
    room: { widthIn: 216, lengthIn: 168, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
    items,
  };
}

/** The pictures and sample kitchens made by scripts/make-showroom-images.mjs, committed with the code. */
export const DEMO_IMAGES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-images');

/** The committed manifest ({ images, designs }), or null when there is none. */
export function demoManifest(dir = DEMO_IMAGES_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** A product's spec as the seed makes it (the thumbnail apart). */
export function specOf(p) {
  return {
    kind: p.kind,
    ...(p.variant ? { variant: p.variant } : {}),
    category: p.category,
    name: p.name,
    blurb: p.blurb,
    sku: p.sku,
    line: p.line,
    ...(p.doorStyle ? { doorStyle: p.doorStyle } : {}),
    widthIn: p.widthIn,
    depthIn: p.depthIn,
    heightIn: p.heightIn,
    elevationIn: p.elevationIn ?? 0,
    ...(p.widthOptions ? { widthOptions: [...p.widthOptions] } : {}),
    price: p.price,
    finishes: p.finishes.map((f) => ({ ...f })),
    ...(p.flags ? { flags: { ...p.flags } } : {}),
  };
}

/** True when the stored spec already says everything `want` says. */
function sameSpec(stored, want) {
  for (const [k, v] of Object.entries(want)) {
    const s = stored?.[k];
    if (k === 'finishes') {
      if (!Array.isArray(s) || s.length !== v.length || v.some((f, i) => ['id', 'name', 'hex', 'material'].some((x) => s[i]?.[x] !== f[x]))) return false;
    } else if (JSON.stringify(s) !== JSON.stringify(v)) return false;
  }
  return true;
}

/** A manifest design (`sku:<SKU>` product ids) with this database's product ids; unknown SKUs are left out. */
function docFromManifest(doc, ids) {
  const items = [];
  for (const it of doc.items ?? []) {
    if (typeof it.productId === 'string' && it.productId.startsWith('sku:')) {
      const id = ids[it.productId.slice(4)];
      if (id) items.push({ ...it, productId: id });
    } else items.push({ ...it });
  }
  return { ...doc, items };
}

/**
 * Makes (or brings up to date) the demo showroom. `people` adds the demo accounts, designs and
 * leads. Returns { tenantId, created, products, people: { owner, staff, visitor } | null }.
 *
 * Always (the live server included): the products (new ones made, changed ones updated by SKU),
 * the branding, the showroom pictures and the gallery's sample kitchens from demo-images/ (each
 * with a view-only link, owned by a "Northline design team" account nobody can sign in to).
 * @param {{ db: import('node:sqlite').DatabaseSync, services: any, config: any, now?: () => number }} ctx
 */
export async function seedDemoTenant({ db, services, config, now = Date.now }, { people = false, imagesDir = DEMO_IMAGES_DIR } = {}) {
  const { tenants, showroomBilling, credits, products, files, leads } = services;
  let t = tenants.bySlug(DEMO_SLUG);
  let created = false;
  if (!t) {
    t = tenants.create({ id: DEMO_TENANT_ID, name: DEMO_NAME, slug: DEMO_SLUG, isDemo: true, contact: CONTACT, settings: { fillGaps: true, bathrooms: true, visitorRenders: false, dailyRenderCap: 0 } });
    created = true;
  }
  const tenantId = t.id;

  // Branding and its logo (the logo made once; the words and featured lines kept up to date).
  if (!t.branding.logoFileId) {
    const logo = files.saveBuffer(logoPng(), { kind: 'image', visibility: 'public', tenantId, originalName: 'northline-logo.png' });
    tenants.update(tenantId, { branding: { ...BRANDING, logoFileId: logo.id }, contact: CONTACT });
  } else if (Object.entries(BRANDING).some(([k, v]) => JSON.stringify(t.branding[k]) !== JSON.stringify(v))) {
    tenants.update(tenantId, { branding: BRANDING });
  }

  // Products, by SKU: new ones made, changed ones updated (and published again).
  const ids = {};
  let made = 0;
  let updated = 0;
  for (const p of DEMO_PRODUCTS) {
    const want = specOf(p);
    const found = db.prepare("SELECT id FROM products WHERE tenant_id = ? AND json_extract(spec, '$.sku') = ?").get(tenantId, p.sku);
    if (found) {
      ids[p.sku] = found.id;
      const row = products.get(found.id);
      if (!sameSpec(row.spec, want) || row.status !== 'published') {
        const img = files.saveBuffer(thumb(p), { kind: 'image', visibility: 'public', tenantId, originalName: `${p.sku.replace(/[^A-Za-z0-9-]/g, '')}.png` });
        products.update(found.id, { ...want, imageFileIds: [img.id] }, { force: true });
        products.publish(found.id);
        updated++;
      }
      continue;
    }
    const img = files.saveBuffer(thumb(p), { kind: 'image', visibility: 'public', tenantId, originalName: `${p.sku.replace(/[^A-Za-z0-9-]/g, '')}.png` });
    const row = products.create({ source: 'tenant', tenantId, visibility: 'public', spec: { ...want, imageFileIds: [img.id] } });
    products.publish(row.id);
    ids[p.sku] = row.id;
    made++;
  }

  // Live: a complimentary license (renewed once it has ended) and monthly plan; credits once.
  if (!showroomBilling.currentLicense(tenantId)) showroomBilling.recordLicense(tenantId, { paidHow: 'comp', amountCents: 0, startsOn: utcDate(now()), note: 'The demo showroom' });
  if (!showroomBilling.monthlyPaid(tenantId)) showroomBilling.setComplimentary(tenantId, true, { note: 'The demo showroom' });
  if (!db.prepare('SELECT 1 FROM tenant_credit_entries WHERE tenant_id = ? LIMIT 1').get(tenantId)) credits.adjust(tenantId, 2500, { note: 'Demo render credits' });
  if (tenants.get(tenantId).status === 'setup') tenants.setStatus(tenantId, 'live');
  else tenants.refresh(tenantId);

  // The gallery's sample kitchens and the showroom pictures, from the committed manifest.
  const manifest = demoManifest(imagesDir);
  const t0 = now();
  /** Finds or makes a design by name for `userId`, keeping its plan up to date. Returns its id. */
  const design = (userId, name, doc) => {
    const json = JSON.stringify({ ...doc, name });
    const pr = db.prepare('SELECT id, doc FROM projects WHERE user_id = ? AND tenant_id = ? AND name = ?').get(userId, tenantId, name);
    if (pr) {
      if (pr.doc !== json) db.prepare('UPDATE projects SET doc = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(json, t0, pr.id);
      return pr.id;
    }
    const pid = crypto.randomUUID();
    db.prepare('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)').run(pid, userId, name, '', json, t0, t0, tenantId);
    return pid;
  };
  /** A live view-only link to a design (made once per label). */
  const shareOf = (projectId, userId, label) => {
    const s = db.prepare('SELECT token FROM share_links WHERE project_id = ? AND label = ? AND revoked_at IS NULL AND expires_at IS NULL').get(projectId, label);
    if (s) return s.token;
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(
      `INSERT INTO share_links (id, project_id, token, created_by, label, show_prices, expires_at, revoked_at, view_count, last_viewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, 0, NULL, ?)`,
    ).run(`sh_${crypto.randomBytes(12).toString('base64url')}`, projectId, token, userId, label, t0);
    return token;
  };
  const manifestDocs = new Map((manifest?.designs ?? []).map((d) => [d.key, docFromManifest(d.doc, ids)]));
  let pictures = 0;
  if (manifest) {
    // The gallery kitchens belong to an account made for them: no password anyone knows, on no team.
    let gallery = db.prepare('SELECT id FROM users WHERE email = ? AND tenant_id = ?').get(GALLERY_ACCOUNT.email, tenantId);
    if (!gallery) {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, GALLERY_ACCOUNT.email, GALLERY_ACCOUNT.name, await hashPassword(crypto.randomBytes(32).toString('base64url')), now(), tenantId);
      gallery = { id };
    }
    const tokens = {};
    for (const d of manifest.designs ?? []) tokens[d.key] = shareOf(design(gallery.id, d.title, manifestDocs.get(d.key)), gallery.id, 'Showroom gallery');

    let images = tenants.get(tenantId).branding.images ?? {};
    const before = JSON.stringify(images);
    for (const im of manifest.images ?? []) {
      const buf = fs.readFileSync(path.join(imagesDir, im.file));
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const target = cleanTarget(im);
      const cur = currentRender(images, target);
      const curFile = cur?.fileId ? files.get(cur.fileId) : null;
      let fileId = curFile?.sha256 === sha ? curFile.id : null;
      if (!fileId) {
        fileId = files.saveBuffer(buf, { kind: 'image', visibility: 'public', tenantId, originalName: im.file }).id;
        pictures++;
      }
      const token = im.design ? tokens[im.design] : undefined;
      if (curFile?.sha256 === sha && (cur.shareToken ?? undefined) === token) continue;
      images = withImage(images, target, { fileId, w: im.w, h: im.h, at: manifest.madeAt ?? t0, ...(token ? { shareToken: token } : {}) });
    }
    if (JSON.stringify(images) !== before) tenants.setImages(tenantId, images);
  }

  let accounts = null;
  if (people) {
    accounts = {};
    for (const p of DEMO_PEOPLE) {
      let row = db.prepare('SELECT id, password_hash FROM users WHERE email = ? AND tenant_id = ?').get(p.email, tenantId);
      const { password, source } = passwordFor(config, p.email);
      if (!row) {
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, p.email, p.name, await hashPassword(password), now(), tenantId);
        row = { id };
      } else if (source === 'env' && !(await verifyPassword(password, row.password_hash))) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), row.id);
      }
      if (p.role) tenants.addMember(tenantId, row.id, p.role);
      accounts[p.key] = row.id;
    }

    // The visitor's two designs and three leads, each with its design. The plans are the gallery's
    // kitchens (made by the app's own layout builder and checked by its design checks), or, without
    // the manifest, simple runs along the back wall.
    const P = (sku) => ids[sku];
    const pick = (key, fallback) => manifestDocs.get(key) ?? fallback();
    const projectIds = [
      design(accounts.visitor, 'Riley’s sage shaker kitchen', pick('hero', () => designDoc('', [[P('NL-LS-P{w}84'), 24, 1], [P('NL-AP-F36'), 36], [P('NL-LS-DB{w}'), 30, 1], [P('NL-AP-R36'), 36], [P('NL-LS-B{w}'), 24, 1], [P('NL-SK-FS{w}'), 36], [P('NL-AP-DW24'), 24]], [], ids))),
      design(accounts.visitor, 'Harbourfront condo kitchen', pick('gallery-1', () => designDoc('', [[P('NL-HS-P{w}84'), 24], [P('NL-HS-B{w}'), 30], [P('NL-SK-UM{w}'), 33], [P('NL-AP-DW24'), 24], [P('NL-HS-B{w}'), 24]], [], ids))),
    ];
    if (!db.prepare('SELECT 1 FROM showroom_leads WHERE tenant_id = ? LIMIT 1').get(tenantId)) {
      const tenant = tenants.get(tenantId);
      const first = leads.create(
        tenant,
        { name: 'Riley Okafor', email: 'demo-visitor@blumodel.test', phone: '(519) 555-0188', postalCode: 'N1H 3A1', budget: '$40,000 - $60,000', timeline: 'Next spring', notes: 'We love the sage colour. Can the island have seating for four?', consent: true, projectId: projectIds[0] },
        { userId: accounts.visitor },
      );
      leads.update(tenantId, first.id, { status: 'contacted', staffNotes: 'Called back; site measure booked.' });
      // The other two came with designs too (made with them in the showroom by the staff and sent
      // from a view-only link), so the demo inbox shows the plan attached on each.
      const sent = (name, doc) => shareOf(design(accounts.staff, name, doc), accounts.staff, 'Sent to Northline');
      const morgan = sent('Morgan’s condo kitchen', pick('gallery-1', () => designDoc('', [[P('NL-HS-P{w}84'), 24], [P('NL-AP-F36'), 36], [P('NL-HS-B{w}'), 30], [P('NL-SK-UM{w}'), 33], [P('NL-AP-DW24'), 24], [P('NL-HS-B{w}'), 24]], [], ids)));
      leads.create(tenant, { name: 'Morgan Lee', email: 'morgan.lee@example.test', phone: '(226) 555-0107', postalCode: 'N2L 3G1', budget: '$25,000 - $40,000', timeline: '3-6 months', notes: 'Condo kitchen, flat-front doors, lots of storage.', consent: true, shareToken: morgan });
      const sam = sent('Patel family kitchen', pick('gallery-2', () => designDoc('', [[P('NL-LS-P{w}84'), 24], [P('NL-LS-B{w}'), 24], [P('NL-AP-R36'), 36], [P('NL-LS-DB{w}'), 30], [P('NL-SK-FS{w}'), 36], [P('NL-AP-DW24'), 24], [P('NL-AP-F36'), 36]], [], ids)));
      const third = leads.create(tenant, { name: 'Sam Patel', email: 'sam.patel@example.test', postalCode: 'N1E 6K2', budget: 'Not sure yet', timeline: 'Just looking', notes: '', consent: true, shareToken: sam });
      leads.update(tenantId, third.id, { status: 'quoted', staffNotes: 'Quote #1042 sent.' });
    }
  }
  return { tenantId, created, products: { total: DEMO_PRODUCTS.length, made, updated }, pictures, people: accounts, ids: { ...ids } };
}

/** The account the gallery's sample kitchens belong to (it can't sign in: nobody knows its password). */
export const GALLERY_ACCOUNT = Object.freeze({ email: 'demo-gallery@blumodel.test', name: 'Northline design team' });

/** The render now stored where `target` points, or null. */
function currentRender(images, target) {
  const r = images?.render ?? {};
  if (target.slot === 'hero' || target.slot === 'heroTall') return r[target.slot] ?? null;
  if (target.slot === 'line') return r.lines?.[lineKey(target.line)] ?? null;
  if (target.slot === 'gallery') return r.gallery?.[target.index - 1] ?? null;
  return null;
}
