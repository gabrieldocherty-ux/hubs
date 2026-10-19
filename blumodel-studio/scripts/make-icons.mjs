// Makes the app icons in public/icons/ from the brand mark (src/components/Icons.tsx → Logo):
// the SVG favicon, 192 and 512 px icons, a 512 px maskable icon (the mark inside the 80% safe zone
// on a full-bleed background) and a 180 px apple-touch-icon (full bleed, no transparency: iOS
// rounds the corners itself). The PNGs are rasterised by the installed Edge, headless, through the
// QA runner's CDP driver (scripts/qa-shot.mjs), so there is no image dependency to install.
//
//   node scripts/make-icons.mjs            write public/icons/*
//   node scripts/make-icons.mjs --check    exit 1 if a file is missing or not the size it should be
//
// The PNGs are committed; run this again only when the mark changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './qa-shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');

const INK = '#211e1a';
const ACCENT = '#c2542d';
const PANEL = '#fbf9f4';
const PAPER = '#f3eee5';

/** The mark (Logo's 32-unit drawing), placed at `x, y` and scaled to `s` px. */
function mark(x, y, s) {
  const k = s / 32;
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <rect x="2.5" y="2.5" width="27" height="27" rx="2" fill="${PANEL}" stroke="${INK}" stroke-width="2.4"/>
    <path d="M9 23V9" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M9 9a14 14 0 0 1 14 14" fill="none" stroke="${ACCENT}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 4.2"/>
    <circle cx="23" cy="23" r="2.2" fill="${ACCENT}"/>
  </g>`;
}

/**
 * `any`: a paper tile with rounded corners and the mark filling most of it.
 * `maskable` / `apple`: full-bleed paper, the mark within the centre 60% (the maskable safe zone is
 * the centre 80% circle; 60% leaves room for every launcher's mask).
 */
function iconSvg(size, kind) {
  if (kind === 'any') {
    const r = size * 0.18;
    const m = size * 0.68;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${PAPER}"/>
  ${mark((size - m) / 2, (size - m) / 2, m)}
</svg>`;
  }
  const m = size * (kind === 'apple' ? 0.62 : 0.56);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${PAPER}"/>
  ${mark((size - m) / 2, (size - m) / 2, m)}
</svg>`;
}

/** The browser-tab icon: the mark alone, transparent around it, crisp at 16 px. */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(0, 0, 32).replace(/\s+/g, ' ')}</svg>\n`;

const PNGS = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'apple' },
];

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function check() {
  const bad = [];
  if (!fs.existsSync(path.join(OUT, 'icon.svg'))) bad.push('icon.svg is missing');
  for (const p of PNGS) {
    const f = path.join(OUT, p.file);
    if (!fs.existsSync(f)) {
      bad.push(`${p.file} is missing`);
      continue;
    }
    const s = pngSize(fs.readFileSync(f));
    if (!s || s.w !== p.size || s.h !== p.size) bad.push(`${p.file} is ${s ? `${s.w}×${s.h}` : 'not a PNG'}, expected ${p.size}×${p.size}`);
  }
  return bad;
}

async function make() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.svg'), FAVICON);
  const browser = await launchBrowser();
  try {
    for (const p of PNGS) {
      const page = await openPage(browser.cdp, { viewport: { w: p.size, h: p.size, dpr: 1, mobile: false } });
      try {
        // Transparent page, so the rounded `any` tile keeps clear corners.
        await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
        const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${iconSvg(p.size, p.kind)}</body></html>`;
        await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
        const png = await page.screenshot();
        const s = pngSize(png);
        if (!s || s.w !== p.size || s.h !== p.size) throw new Error(`${p.file}: the browser drew ${s ? `${s.w}×${s.h}` : 'no PNG'}`);
        fs.writeFileSync(path.join(OUT, p.file), png);
        console.log(`  ${p.file}  ${p.size}×${p.size}  ${png.length.toLocaleString('en-US')} bytes`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  const bad = check();
  for (const b of bad) console.error(`  ${b}`);
  process.exit(bad.length ? 1 : 0);
}
await make();
const bad = check();
if (bad.length) {
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`Icons written to ${path.relative(ROOT, OUT)}.`);
