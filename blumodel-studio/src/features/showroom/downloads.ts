import type { EstimateLine } from '../../lib/estimate';
import { brandTokens, LIGHT_PAGE } from './palette';
import { shortName, type PublicTenant } from './site';

/**
 * Free, branded downloads on a showroom (docs/SHOWROOM_PIVOT.md §5): the plan and 3D PNGs carry
 * the company's logo, name and contact details, and the product list is a printable page in the
 * company's colours. Downloads are print media, so they are always drawn light; the colours come
 * from the company's own tokens (palette.ts), which keep white text on its colour at AA.
 * The text helpers are pure and tested; the canvas work runs in the browser only.
 */

const INK = LIGHT_PAGE.ink;
const MUTED = '#5f584d';
const RULE = '#e4dccd';
const FONT = "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
const DISPLAY = "'Fraunces', 'Iowan Old Style', Georgia, serif";

/** The company's colour for a printed page (white text on it reaches AA), our ink when it has none. */
export function printColour(t: PublicTenant): string {
  return brandTokens(t.branding.primaryColor, t.branding.accentColor)?.light['--brand'] ?? INK;
}

/** "(519) 555-0142 · hello@northline.test · northline.test": the company's ways to reach it, in one line. */
export function contactLine(t: PublicTenant): string {
  const c = t.contact;
  const site = c.website ? c.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '';
  return [c.phone, c.email, site].filter(Boolean).join('  ·  ');
}

/** "Designed on demo.blumodel.studio · 17 Oct 2026": where and when, at the foot of a download. */
export function madeOnLine(host: string, at: Date): string {
  const d = at.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  return `Designed on ${host}  ·  ${d}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export interface ProductListInput {
  tenant: PublicTenant;
  designName: string;
  /** "12′ × 14′ · 156 sq ft" */
  roomText: string;
  lines: EstimateLine[];
  /** The company's visitor prices, when the design shows them. */
  showPrices: boolean;
  total: number;
  /** An absolute https or same-origin logo address (or null). */
  logoUrl: string | null;
  /** The floor plan as a data: URL, when it could be captured. */
  planImage: string | null;
  host: string;
  at: Date;
}

/**
 * The product list as a standalone, printable HTML page: the company's mark and colour, the
 * design's name and room, the plan when captured, every product line (group, name, details, SKU,
 * quantity and, when shown, prices), the company's contact details and a planning disclaimer.
 * Every value is escaped; the page loads nothing but the company's logo.
 */
export function productListHtml(p: ProductListInput): string {
  const t = p.tenant;
  const brand = printColour(t);
  const name = shortName(t);
  const rows = p.lines
    .map(
      (l) => `<tr><td>${esc(l.group)}</td><td><b>${esc(l.label)}</b>${l.sub ? `<br><span>${esc(l.sub)}</span>` : ''}</td><td>${esc(l.sku ?? '')}</td><td class="n">${l.qty} ${esc(l.unit)}</td>${
        p.showPrices ? `<td class="n">${money(l.unitPrice)}</td><td class="n">${money(l.total)}</td>` : ''
      }</tr>`,
    )
    .join('\n');
  const head = `<th>Group</th><th>Item</th><th>SKU</th><th class="n">Qty</th>${p.showPrices ? '<th class="n">Unit price</th><th class="n">Total</th>' : ''}`;
  const logo = p.logoUrl && /^(https:\/\/|data:image\/|\/)/.test(p.logoUrl) ? `<img class="logo" src="${esc(p.logoUrl)}" alt="">` : `<span class="logo initial">${esc(name.charAt(0).toUpperCase())}</span>`;
  const c = t.contact;
  const contact = [
    c.phone && `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`,
    c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`,
    c.website && /^https?:\/\//i.test(c.website) && `<a href="${esc(c.website)}">${esc(c.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>`,
    c.address && esc(c.address),
  ]
    .filter(Boolean)
    .join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.designName)} · Product list · ${esc(name)}</title>
<style>
:root{--brand:${brand};--ink:${INK};--muted:${MUTED};--rule:${RULE}}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px;font:14px/1.5 ${FONT};color:var(--ink);background:#fff}
main{max-width:860px;margin:0 auto}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:12px;background:var(--brand);color:#fff}
.logo{width:48px;height:48px;border-radius:10px;object-fit:contain;background:#fff;flex:none}
.initial{display:grid;place-items:center;color:var(--brand);font:600 24px ${DISPLAY}}
header b{font:600 20px ${DISPLAY}}
header span{display:block;font-size:13px;opacity:.92}
h1{margin:24px 0 2px;font:600 26px ${DISPLAY}}
.room{margin:0 0 16px;color:var(--muted)}
.plan{display:block;width:100%;max-height:520px;object-fit:contain;border:1px solid var(--rule);border-radius:10px;margin:0 0 18px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 6px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
td span{color:var(--muted);font-size:13px}
.n{text-align:right;white-space:nowrap}
.total td{font-weight:700;border-bottom:0}
footer{margin-top:24px;padding-top:12px;border-top:2px solid var(--brand);font-size:13px;color:var(--muted)}
footer a{color:var(--ink)}
.fine{margin-top:8px;font-size:12px}
@media print{body{padding:0}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@media (max-width:560px){th:first-child,td:first-child{display:none}}
</style>
</head>
<body>
<main>
<header>${logo}<div><b>${esc(name)}</b><span>${esc(contactLine(t))}</span></div></header>
<h1>${esc(p.designName)}</h1>
<p class="room">${esc(p.roomText)} · ${p.lines.length} item${p.lines.length === 1 ? '' : 's'}</p>
${p.planImage && /^data:image\/(png|jpeg);base64,/.test(p.planImage) ? `<img class="plan" src="${p.planImage}" alt="Floor plan of ${esc(p.designName)}">` : ''}
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${rows || `<tr><td colspan="${p.showPrices ? 6 : 4}">No products placed yet.</td></tr>`}
${p.showPrices && p.lines.length ? `<tr class="total"><td colspan="5">Estimated total</td><td class="n">${money(p.total)}</td></tr>` : ''}
</tbody>
</table>
<footer>
<div>${contact}</div>
<div class="fine">${esc(madeOnLine(p.host, p.at))}. A planning draft for a conversation with ${esc(name)}: sizes, prices and availability are confirmed by ${esc(name)} before anything is ordered.</div>
</footer>
</main>
</body>
</html>
`;
}

// ── the PNGs (browser only) ─────────────────────────────────────────────────

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Fits `text` in `max` px, ending in an ellipsis when it doesn't. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/**
 * The plan or 3D PNG with the company's band on top (its logo and name, the design's name) and its
 * contact details at the foot. Falls back to the plain image if anything can't be drawn (and a
 * logo on another site without CORS is just left out, so the canvas stays exportable).
 */
export async function brandedPng(dataUrl: string, t: PublicTenant, designName: string, host: string, at = new Date()): Promise<string> {
  const img = await loadImage(dataUrl, false);
  if (!img) return dataUrl;
  const w = img.naturalWidth;
  const unit = Math.max(1, w / 1600);
  const band = Math.round(96 * unit);
  const foot = Math.round(64 * unit);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = img.naturalHeight + band + foot;
  const ctx = c.getContext('2d');
  if (!ctx) return dataUrl;
  const brand = printColour(t);
  const pad = Math.round(32 * unit);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = brand;
  ctx.fillRect(0, 0, w, band);
  // The logo on a white tile, or the company's initial.
  const tile = Math.round(60 * unit);
  const ty = Math.round((band - tile) / 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(pad, ty, tile, tile, Math.round(12 * unit));
  ctx.fill();
  const url = t.branding.logoUrl;
  const logo = url ? await loadImage(url, /^https:/i.test(url) && new URL(url).origin !== location.origin) : null;
  if (logo) {
    const k = Math.min((tile - 8 * unit) / logo.naturalWidth, (tile - 8 * unit) / logo.naturalHeight);
    const lw = logo.naturalWidth * k;
    const lh = logo.naturalHeight * k;
    ctx.drawImage(logo, pad + (tile - lw) / 2, ty + (tile - lh) / 2, lw, lh);
  } else {
    ctx.fillStyle = brand;
    ctx.font = `600 ${Math.round(32 * unit)}px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortName(t).charAt(0).toUpperCase(), pad + tile / 2, ty + tile / 2 + unit);
  }
  const textX = pad + tile + Math.round(18 * unit);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(30 * unit)}px ${DISPLAY}`;
  const nameW = w / 2 - textX;
  ctx.fillText(fit(ctx, shortName(t), nameW), textX, band / 2 + Math.round(2 * unit));
  ctx.font = `${Math.round(17 * unit)}px ${FONT}`;
  ctx.fillText(fit(ctx, contactLine(t), nameW), textX, band / 2 + Math.round(26 * unit));
  ctx.textAlign = 'right';
  ctx.font = `600 ${Math.round(22 * unit)}px ${FONT}`;
  ctx.fillText(fit(ctx, designName, w / 2 - pad * 2), w - pad, band / 2 + Math.round(8 * unit));
  ctx.drawImage(img, 0, band);
  // The foot: a rule in the company's colour, where it was made.
  const fy = band + img.naturalHeight;
  ctx.fillStyle = brand;
  ctx.fillRect(0, fy, w, Math.max(2, Math.round(3 * unit)));
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(16 * unit)}px ${FONT}`;
  ctx.fillText(fit(ctx, madeOnLine(host, at), w * 0.55), pad, fy + foot / 2);
  ctx.textAlign = 'right';
  ctx.fillText(fit(ctx, `A planning draft: ${shortName(t)} confirms sizes before ordering.`, w * 0.4), w - pad, fy + foot / 2);
  try {
    return c.toDataURL('image/png');
  } catch {
    // A logo that tainted the canvas after all: the plain image rather than nothing.
    return dataUrl;
  }
}
