// Makes public/marketing/og.png, the 1200x630 picture link previews show for blumodel.studio
// (index.html's og:image and twitter:image). Drawn as HTML with the site's own fonts and the 3D
// render in public/marketing/hero.webp, inlined as data: URLs, and photographed by the installed
// Edge (or Chrome with --chrome) through scripts/qa-shot.mjs. No dependencies, nothing leaves the
// machine: the page's every request is blocked except data: URLs.
//
//   node scripts/make-og-image.mjs            writes public/marketing/og.png
//   node scripts/make-og-image.mjs --out x.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openPage } from './qa-shot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? path.resolve(args[outArg + 1]) : path.join(PUBLIC, 'marketing', 'og.png');

const data = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(PUBLIC, file)).toString('base64')}`;
const font = (family, file, weight = '400 700') =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url('${data(`fonts/${file}`, 'font/woff2')}') format('woff2');}`;

// The page's colours are the light theme's tokens (src/styles.css) and the demo company's art.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Fraunces', 'fraunces-normal-latin.woff2')}
${font('Instrument Sans', 'instrument-sans-normal-latin.woff2')}
:root{--paper:#f3eee5;--paper-2:#ebe4d8;--card:#fff;--ink:#211e1a;--ink-2:#5f584d;--line:#e4dccd;--accent:#c2542d;--co:#2e3d55;--co-on:#f6f3ec}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{background:var(--paper);color:var(--ink);font-family:'Instrument Sans',system-ui,sans-serif;display:grid;grid-template-columns:560px 1fr;gap:44px;padding:58px 0 0 64px;position:relative}
.copy{display:flex;flex-direction:column;gap:22px}
.brand{display:flex;align-items:center;gap:12px;font-family:'Fraunces',serif;font-weight:600;font-size:28px;letter-spacing:-0.01em}
.eyebrow{font-size:17px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
h1{font-family:'Fraunces',serif;font-weight:600;font-size:56px;line-height:1.04;letter-spacing:-0.025em}
p{font-size:23px;line-height:1.45;color:var(--ink-2)}
.url{align-self:flex-start;display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:12px;background:var(--card);border:1px solid var(--line);font-size:21px;color:var(--ink-2)}
.url b{color:var(--ink)}
.art{position:relative;margin-top:22px}
.win{width:640px;border-radius:18px;overflow:hidden;background:var(--card);border:1px solid var(--line);box-shadow:0 40px 70px -30px rgba(33,30,26,.45)}
.bar{height:44px;display:flex;align-items:center;gap:8px;padding:0 16px;background:var(--paper-2);border-bottom:1px solid var(--line)}
.bar i{width:12px;height:12px;border-radius:50%;background:#d3c8b6}
.nav{height:50px;display:flex;align-items:center;gap:12px;padding:0 18px;background:var(--co);color:var(--co-on);font-family:'Fraunces',serif;font-weight:600;font-size:18px}
.nav span{width:28px;height:28px;border-radius:7px;background:#9aa892;color:var(--co);display:grid;place-items:center;font:800 11px 'Instrument Sans',sans-serif}
.stage{height:420px;background:#e6ddcf url('${data('marketing/hero.webp', 'image/webp')}') center/cover}
</style></head><body>
<div class="copy">
  <div class="brand"><svg width="34" height="34" viewBox="0 0 32 32"><rect x="2.5" y="2.5" width="27" height="27" rx="2" fill="none" stroke="#211e1a" stroke-width="2.4"/><path d="M9 23V9" stroke="#211e1a" stroke-width="2.4" stroke-linecap="round"/><path d="M9 9a14 14 0 0 1 14 14" fill="none" stroke="#c2542d" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 4.2"/><circle cx="23" cy="23" r="2.2" fill="#c2542d"/></svg>BluModel Studio</div>
  <div class="eyebrow">For kitchen &amp; bath companies</div>
  <h1>Your own virtual showroom, with your products, under your name.</h1>
  <p>We build it, host it and run it. Every customer design arrives as a lead.</p>
  <div class="url"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5f584d" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span><b>yourcompany</b>.blumodel.studio</span></div>
</div>
<div class="art"><div class="win"><div class="bar"><i></i><i></i><i></i></div><div class="nav"><span>YC</span>Your Company Kitchen &amp; Bath</div><div class="stage"></div></div></div>
</body></html>`;

const browser = await launchBrowser({});
try {
  const page = await openPage(browser.cdp, { viewport: { w: 1200, h: 630, dpr: 1 } });
  await page.goto('about:blank');
  const { frameTree } = await page.send('Page.getFrameTree');
  await page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const ok = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length);
  if (ok < 2) throw new Error(`only ${ok} fonts loaded`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, await page.screenshot());
  console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
  await page.close();
} finally {
  await browser.close();
}
