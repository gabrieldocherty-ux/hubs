import{aE as $,c_ as N,d3 as R}from"./index-m6HNHCyL.js";const U=N.ink,j="#5f584d",E="#e4dccd",b="'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",u="'Fraunces', 'Iowan Old Style', Georgia, serif";function z(t){var a;return((a=R(t.branding.primaryColor,t.branding.accentColor))==null?void 0:a.light["--brand"])??U}function C(t){const a=t.contact,r=a.website?a.website.replace(/^https?:\/\//i,"").replace(/\/$/,""):"";return[a.phone,a.email,r].filter(Boolean).join("  ·  ")}function D(t,a){const r=a.toLocaleDateString("en-CA",{day:"numeric",month:"short",year:"numeric"});return`Designed on ${t}  ·  ${r}`}const o=t=>t.replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),S=t=>`$${t.toLocaleString("en-CA",{minimumFractionDigits:0,maximumFractionDigits:2})}`;function B(t){const a=t.tenant,r=z(a),i=$(a),w=t.lines.map(l=>`<tr><td>${o(l.group)}</td><td><b>${o(l.label)}</b>${l.sub?`<br><span>${o(l.sub)}</span>`:""}</td><td>${o(l.sku??"")}</td><td class="n">${l.qty} ${o(l.unit)}</td>${t.showPrices?`<td class="n">${S(l.unitPrice)}</td><td class="n">${S(l.total)}</td>`:""}</tr>`).join(`
`),f=`<th>Group</th><th>Item</th><th>SKU</th><th class="n">Qty</th>${t.showPrices?'<th class="n">Unit price</th><th class="n">Total</th>':""}`,s=t.logoUrl&&/^(https:\/\/|data:image\/|\/)/.test(t.logoUrl)?`<img class="logo" src="${o(t.logoUrl)}" alt="">`:`<span class="logo initial">${o(i.charAt(0).toUpperCase())}</span>`,n=a.contact,d=[n.phone&&`<a href="tel:${o(n.phone.replace(/[^\d+]/g,""))}">${o(n.phone)}</a>`,n.email&&`<a href="mailto:${o(n.email)}">${o(n.email)}</a>`,n.website&&/^https?:\/\//i.test(n.website)&&`<a href="${o(n.website)}">${o(n.website.replace(/^https?:\/\//i,"").replace(/\/$/,""))}</a>`,n.address&&o(n.address)].filter(Boolean).join(" · ");return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o(t.designName)} · Product list · ${o(i)}</title>
<style>
:root{--brand:${r};--ink:${U};--muted:${j};--rule:${E}}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px;font:14px/1.5 ${b};color:var(--ink);background:#fff}
main{max-width:860px;margin:0 auto}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:12px;background:var(--brand);color:#fff}
.logo{width:48px;height:48px;border-radius:10px;object-fit:contain;background:#fff;flex:none}
.initial{display:grid;place-items:center;color:var(--brand);font:600 24px ${u}}
header b{font:600 20px ${u}}
header span{display:block;font-size:13px;opacity:.92}
h1{margin:24px 0 2px;font:600 26px ${u}}
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
<header>${s}<div><b>${o(i)}</b><span>${o(C(a))}</span></div></header>
<h1>${o(t.designName)}</h1>
<p class="room">${o(t.roomText)} · ${t.lines.length} item${t.lines.length===1?"":"s"}</p>
${t.planImage&&/^data:image\/(png|jpeg);base64,/.test(t.planImage)?`<img class="plan" src="${t.planImage}" alt="Floor plan of ${o(t.designName)}">`:""}
<table>
<thead><tr>${f}</tr></thead>
<tbody>
${w||`<tr><td colspan="${t.showPrices?6:4}">No products placed yet.</td></tr>`}
${t.showPrices&&t.lines.length?`<tr class="total"><td colspan="5">Estimated total</td><td class="n">${S(t.total)}</td></tr>`:""}
</tbody>
</table>
<footer>
<div>${d}</div>
<div class="fine">${o(D(t.host,t.at))}. A planning draft for a conversation with ${o(i)}: sizes, prices and availability are confirmed by ${o(i)} before anything is ordered.</div>
</footer>
</main>
</body>
</html>
`}function L(t,a){return new Promise(r=>{const i=new Image;a&&(i.crossOrigin="anonymous"),i.onload=()=>r(i),i.onerror=()=>r(null),i.src=t})}function m(t,a,r){if(t.measureText(a).width<=r)return a;let i=a;for(;i.length>1&&t.measureText(`${i}…`).width>r;)i=i.slice(0,-1);return`${i}…`}async function F(t,a,r,i,w=new Date){const f=await L(t,!1);if(!f)return t;const s=f.naturalWidth,n=Math.max(1,s/1600),d=Math.round(96*n),l=Math.round(64*n),p=document.createElement("canvas");p.width=s,p.height=f.naturalHeight+d+l;const e=p.getContext("2d");if(!e)return t;const y=z(a),h=Math.round(32*n);e.fillStyle="#ffffff",e.fillRect(0,0,p.width,p.height),e.fillStyle=y,e.fillRect(0,0,s,d);const c=Math.round(60*n),v=Math.round((d-c)/2);e.fillStyle="#ffffff",e.beginPath(),e.roundRect(h,v,c,c,Math.round(12*n)),e.fill();const x=a.branding.logoUrl,g=x?await L(x,/^https:/i.test(x)&&new URL(x).origin!==location.origin):null;if(g){const k=Math.min((c-8*n)/g.naturalWidth,(c-8*n)/g.naturalHeight),A=g.naturalWidth*k,P=g.naturalHeight*k;e.drawImage(g,h+(c-A)/2,v+(c-P)/2,A,P)}else e.fillStyle=y,e.font=`600 ${Math.round(32*n)}px ${u}`,e.textAlign="center",e.textBaseline="middle",e.fillText($(a).charAt(0).toUpperCase(),h+c/2,v+c/2+n);const M=h+c+Math.round(18*n);e.textAlign="left",e.textBaseline="alphabetic",e.fillStyle="#ffffff",e.font=`600 ${Math.round(30*n)}px ${u}`;const T=s/2-M;e.fillText(m(e,$(a),T),M,d/2+Math.round(2*n)),e.font=`${Math.round(17*n)}px ${b}`,e.fillText(m(e,C(a),T),M,d/2+Math.round(26*n)),e.textAlign="right",e.font=`600 ${Math.round(22*n)}px ${b}`,e.fillText(m(e,r,s/2-h*2),s-h,d/2+Math.round(8*n)),e.drawImage(f,0,d);const I=d+f.naturalHeight;e.fillStyle=y,e.fillRect(0,I,s,Math.max(2,Math.round(3*n))),e.fillStyle=j,e.textAlign="left",e.textBaseline="middle",e.font=`${Math.round(16*n)}px ${b}`,e.fillText(m(e,D(i,w),s*.55),h,I+l/2),e.textAlign="right",e.fillText(m(e,`A planning draft: ${$(a)} confirms sizes before ordering.`,s*.4),s-h,I+l/2);try{return p.toDataURL("image/png")}catch{return t}}export{F as brandedPng,C as contactLine,D as madeOnLine,z as printColour,B as productListHtml};
