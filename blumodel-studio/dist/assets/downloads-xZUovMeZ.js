import{aE as $,di as N,dr as R}from"./index-BDHZCSzO.js";const U=N.ink,j="#5f584d",E="#e4dccd",b="'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",m="'Fraunces', 'Iowan Old Style', Georgia, serif";function z(t){var a;return((a=R(t.branding.primaryColor,t.branding.accentColor))==null?void 0:a.light["--brand"])??U}function C(t){const a=t.contact,l=a.website?a.website.replace(/^https?:\/\//i,"").replace(/\/$/,""):"";return[a.phone,a.email,l].filter(Boolean).join("  ·  ")}function D(t,a){const l=a.toLocaleDateString("en-CA",{day:"numeric",month:"short",year:"numeric"});return`Designed on ${t}  ·  ${l}`}const o=t=>t.replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),I=t=>`$${t.toLocaleString("en-CA",{minimumFractionDigits:0,maximumFractionDigits:2})}`;function B(t){var f;const a=t.tenant,l=z(a),r=$(a),w=t.lines.map(i=>`<tr><td>${o(i.group)}</td><td><b>${o(i.label)}</b>${i.sub?`<br><span>${o(i.sub)}</span>`:""}</td><td>${o(i.sku??"")}</td><td class="n">${i.qty} ${o(i.unit)}</td>${t.showPrices?`<td class="n">${I(i.unitPrice)}</td><td class="n">${I(i.total)}</td>`:""}</tr>`).join(`
`),p=`<th>Group</th><th>Item</th><th>SKU</th><th class="n">Qty</th>${t.showPrices?'<th class="n">Unit price</th><th class="n">Total</th>':""}`,s=t.logoUrl&&/^(https:\/\/|data:image\/|\/)/.test(t.logoUrl)?`<img class="logo" src="${o(t.logoUrl)}" alt="">`:`<span class="logo initial">${o(r.charAt(0).toUpperCase())}</span>`,n=a.contact,d=[n.phone&&`<a href="tel:${o(n.phone.replace(/[^\d+]/g,""))}">${o(n.phone)}</a>`,n.email&&`<a href="mailto:${o(n.email)}">${o(n.email)}</a>`,n.website&&/^https?:\/\//i.test(n.website)&&`<a href="${o(n.website)}">${o(n.website.replace(/^https?:\/\//i,"").replace(/\/$/,""))}</a>`,n.address&&o(n.address)].filter(Boolean).join(" · ");return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o(t.designName)} · Product list · ${o(r)}</title>
<style>
:root{--brand:${l};--ink:${U};--muted:${j};--rule:${E}}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px;font:14px/1.5 ${b};color:var(--ink);background:#fff}
main{max-width:860px;margin:0 auto}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:12px;background:var(--brand);color:#fff}
.logo{width:48px;height:48px;border-radius:10px;object-fit:contain;background:#fff;flex:none}
.initial{display:grid;place-items:center;color:var(--brand);font:600 24px ${m}}
header b{font:600 20px ${m}}
header span{display:block;font-size:13px;opacity:.92}
h1{margin:24px 0 2px;font:600 26px ${m}}
.room{margin:0 0 16px;color:var(--muted)}
.plan{display:block;width:100%;max-height:520px;object-fit:contain;border:1px solid var(--rule);border-radius:10px;margin:0 0 18px}
.walls h2{margin:28px 0 8px;font:600 18px ${m}}
.walls figure{margin:0 0 18px;break-inside:avoid;page-break-inside:avoid;border:1px solid var(--rule);border-radius:10px;padding:8px}
.walls figcaption{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 4px}
.walls svg{display:block;width:100%;height:auto;max-height:420px}
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
<header>${s}<div><b>${o(r)}</b><span>${o(C(a))}</span></div></header>
<h1>${o(t.designName)}</h1>
<p class="room">${o(t.roomText)} · ${t.lines.length} item${t.lines.length===1?"":"s"}</p>
${t.planImage&&/^data:image\/(png|jpeg);base64,/.test(t.planImage)?`<img class="plan" src="${t.planImage}" alt="Floor plan of ${o(t.designName)}">`:""}
<table>
<thead><tr>${p}</tr></thead>
<tbody>
${w||`<tr><td colspan="${t.showPrices?6:4}">No products placed yet.</td></tr>`}
${t.showPrices&&t.lines.length?`<tr class="total"><td colspan="5">Estimated total</td><td class="n">${I(t.total)}</td></tr>`:""}
</tbody>
</table>
${(f=t.elevations)!=null&&f.length?`<section class="walls"><h2>Wall elevations</h2>
${t.elevations.map(i=>`<figure><figcaption>${o(i.title)}</figcaption>${/^<svg[\s>]/.test(i.svg)?i.svg:""}</figure>`).join("")}</section>`:""}
<footer>
<div>${d}</div>
<div class="fine">${o(D(t.host,t.at))}. A planning draft for a conversation with ${o(r)}: sizes, prices and availability are confirmed by ${o(r)} before anything is ordered.</div>
</footer>
</main>
</body>
</html>
`}function L(t,a){return new Promise(l=>{const r=new Image;a&&(r.crossOrigin="anonymous"),r.onload=()=>l(r),r.onerror=()=>l(null),r.src=t})}function u(t,a,l){if(t.measureText(a).width<=l)return a;let r=a;for(;r.length>1&&t.measureText(`${r}…`).width>l;)r=r.slice(0,-1);return`${r}…`}async function F(t,a,l,r,w=new Date){const p=await L(t,!1);if(!p)return t;const s=p.naturalWidth,n=Math.max(1,s/1600),d=Math.round(96*n),f=Math.round(64*n),i=document.createElement("canvas");i.width=s,i.height=p.naturalHeight+d+f;const e=i.getContext("2d");if(!e)return t;const y=z(a),h=Math.round(32*n);e.fillStyle="#ffffff",e.fillRect(0,0,i.width,i.height),e.fillStyle=y,e.fillRect(0,0,s,d);const c=Math.round(60*n),v=Math.round((d-c)/2);e.fillStyle="#ffffff",e.beginPath(),e.roundRect(h,v,c,c,Math.round(12*n)),e.fill();const x=a.branding.logoUrl,g=x?await L(x,/^https:/i.test(x)&&new URL(x).origin!==location.origin):null;if(g){const T=Math.min((c-8*n)/g.naturalWidth,(c-8*n)/g.naturalHeight),A=g.naturalWidth*T,P=g.naturalHeight*T;e.drawImage(g,h+(c-A)/2,v+(c-P)/2,A,P)}else e.fillStyle=y,e.font=`600 ${Math.round(32*n)}px ${m}`,e.textAlign="center",e.textBaseline="middle",e.fillText($(a).charAt(0).toUpperCase(),h+c/2,v+c/2+n);const M=h+c+Math.round(18*n);e.textAlign="left",e.textBaseline="alphabetic",e.fillStyle="#ffffff",e.font=`600 ${Math.round(30*n)}px ${m}`;const S=s/2-M;e.fillText(u(e,$(a),S),M,d/2+Math.round(2*n)),e.font=`${Math.round(17*n)}px ${b}`,e.fillText(u(e,C(a),S),M,d/2+Math.round(26*n)),e.textAlign="right",e.font=`600 ${Math.round(22*n)}px ${b}`,e.fillText(u(e,l,s/2-h*2),s-h,d/2+Math.round(8*n)),e.drawImage(p,0,d);const k=d+p.naturalHeight;e.fillStyle=y,e.fillRect(0,k,s,Math.max(2,Math.round(3*n))),e.fillStyle=j,e.textAlign="left",e.textBaseline="middle",e.font=`${Math.round(16*n)}px ${b}`,e.fillText(u(e,D(r,w),s*.55),h,k+f/2),e.textAlign="right",e.fillText(u(e,`A planning draft: ${$(a)} confirms sizes before ordering.`,s*.4),s-h,k+f/2);try{return i.toDataURL("image/png")}catch{return t}}export{F as brandedPng,C as contactLine,D as madeOnLine,z as printColour,B as productListHtml};
