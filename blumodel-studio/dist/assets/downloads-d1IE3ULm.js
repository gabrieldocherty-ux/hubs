import{aE as w,dp as N,dx as R}from"./index-vcxCNgVh.js";const z=N.ink,L="#5f584d",E="#e4dccd",$="'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",f="'Fraunces', 'Iowan Old Style', Georgia, serif";function U(e){var a;return((a=R(e.branding.primaryColor,e.branding.accentColor))==null?void 0:a.light["--brand"])??z}function C(e){const a=e.contact,r=a.website?a.website.replace(/^https?:\/\//i,"").replace(/\/$/,""):"";return[a.phone,a.email,r].filter(Boolean).join("  ·  ")}function D(e,a){const r=a.toLocaleDateString("en-CA",{day:"numeric",month:"short",year:"numeric"});return`Designed on ${e}  ·  ${r}`}const o=e=>e.replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),S=e=>`$${e.toLocaleString("en-CA",{minimumFractionDigits:0,maximumFractionDigits:2})}`;function W(e){var m,c;const a=e.tenant,r=U(a),i=w(a),y=e.lines.map(t=>`<tr><td>${o(t.group)}</td><td><b>${o(t.label)}</b>${t.sub?`<br><span>${o(t.sub)}</span>`:""}</td><td>${o(t.sku??"")}</td><td class="n">${t.qty} ${o(t.unit)}</td>${e.showPrices?`<td class="n">${S(t.unitPrice)}</td><td class="n">${S(t.total)}</td>`:""}</tr>`).join(`
`),h=`<th>Group</th><th>Item</th><th>SKU</th><th class="n">Qty</th>${e.showPrices?'<th class="n">Unit price</th><th class="n">Total</th>':""}`,s=e.logoUrl&&/^(https:\/\/|data:image\/|\/)/.test(e.logoUrl)?`<img class="logo" src="${o(e.logoUrl)}" alt="">`:`<span class="logo initial">${o(i.charAt(0).toUpperCase())}</span>`,n=a.contact,l=[n.phone&&`<a href="tel:${o(n.phone.replace(/[^\d+]/g,""))}">${o(n.phone)}</a>`,n.email&&`<a href="mailto:${o(n.email)}">${o(n.email)}</a>`,n.website&&/^https?:\/\//i.test(n.website)&&`<a href="${o(n.website)}">${o(n.website.replace(/^https?:\/\//i,"").replace(/\/$/,""))}</a>`,n.address&&o(n.address)].filter(Boolean).join(" · ");return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o(e.designName)} · Product list · ${o(i)}</title>
<style>
:root{--brand:${r};--ink:${z};--muted:${L};--rule:${E}}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px;font:14px/1.5 ${$};color:var(--ink);background:#fff}
main{max-width:860px;margin:0 auto}
header{display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:12px;background:var(--brand);color:#fff}
.logo{width:48px;height:48px;border-radius:10px;object-fit:contain;background:#fff;flex:none}
.initial{display:grid;place-items:center;color:var(--brand);font:600 24px ${f}}
header b{font:600 20px ${f}}
header span{display:block;font-size:13px;opacity:.92}
h1{margin:24px 0 2px;font:600 26px ${f}}
.room{margin:0 0 16px;color:var(--muted)}
.plan{display:block;width:100%;max-height:520px;object-fit:contain;border:1px solid var(--rule);border-radius:10px;margin:0 0 18px}
.walls h2{margin:28px 0 8px;font:600 18px ${f}}
.walls figure{margin:0 0 18px;break-inside:avoid;page-break-inside:avoid;border:1px solid var(--rule);border-radius:10px;padding:8px}
.walls figcaption{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 4px}
.walls svg{display:block;width:100%;height:auto;max-height:420px}
.scope h2{margin:28px 0 4px;font:600 18px ${f}}
.scope p{margin:0 0 10px;color:var(--muted);font-size:13px}
.scope h3{margin:16px 0 4px;font:600 14px ${$};color:var(--brand)}
.scope ol{margin:0;padding-left:20px}
.scope li{padding:3px 0;break-inside:avoid}
.scope li i{float:right;font-style:normal;color:var(--muted);white-space:nowrap;margin-left:12px}
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
<h1>${o(e.designName)}</h1>
<p class="room">${o(e.roomText)} · ${e.lines.length} item${e.lines.length===1?"":"s"}</p>
${e.planImage&&/^data:image\/(png|jpeg);base64,/.test(e.planImage)?`<img class="plan" src="${e.planImage}" alt="Floor plan of ${o(e.designName)}">`:""}
<table>
<thead><tr>${h}</tr></thead>
<tbody>
${y||`<tr><td colspan="${e.showPrices?6:4}">No products placed yet.</td></tr>`}
${e.showPrices&&e.lines.length?`<tr class="total"><td colspan="5">Estimated total</td><td class="n">${S(e.total)}</td></tr>`:""}
</tbody>
</table>
${(m=e.elevations)!=null&&m.length?`<section class="walls"><h2>Wall elevations</h2>
${e.elevations.map(t=>`<figure><figcaption>${o(t.title)}</figcaption>${/^<svg[\s>]/.test(t.svg)?t.svg:""}</figure>`).join("")}</section>`:""}
${(c=e.scope)!=null&&c.length?`<section class="scope"><h2>Scope of work</h2><p>What each trade does to build this design, in the order it happens on site. Quantities come from the design; ${o(i)} confirms them on a site visit.</p>
${e.scope.map(t=>`<h3>${o(t.trade)}</h3><ol>${t.tasks.map(g=>`<li>${g.qty?`<i>${o(g.qty)}</i>`:""}${o(g.text)}</li>`).join("")}</ol>`).join(`
`)}</section>`:""}
<footer>
<div>${l}</div>
<div class="fine">${o(D(e.host,e.at))}. A planning draft for a conversation with ${o(i)}: sizes, prices and availability are confirmed by ${o(i)} before anything is ordered.</div>
</footer>
</main>
</body>
</html>
`}function P(e,a){return new Promise(r=>{const i=new Image;a&&(i.crossOrigin="anonymous"),i.onload=()=>r(i),i.onerror=()=>r(null),i.src=e})}function x(e,a,r){if(e.measureText(a).width<=r)return a;let i=a;for(;i.length>1&&e.measureText(`${i}…`).width>r;)i=i.slice(0,-1);return`${i}…`}async function B(e,a,r,i,y=new Date){const h=await P(e,!1);if(!h)return e;const s=h.naturalWidth,n=Math.max(1,s/1600),l=Math.round(96*n),m=Math.round(64*n),c=document.createElement("canvas");c.width=s,c.height=h.naturalHeight+l+m;const t=c.getContext("2d");if(!t)return e;const g=U(a),p=Math.round(32*n);t.fillStyle="#ffffff",t.fillRect(0,0,c.width,c.height),t.fillStyle=g,t.fillRect(0,0,s,l);const d=Math.round(60*n),v=Math.round((l-d)/2);t.fillStyle="#ffffff",t.beginPath(),t.roundRect(p,v,d,d,Math.round(12*n)),t.fill();const b=a.branding.logoUrl,u=b?await P(b,/^https:/i.test(b)&&new URL(b).origin!==location.origin):null;if(u){const T=Math.min((d-8*n)/u.naturalWidth,(d-8*n)/u.naturalHeight),A=u.naturalWidth*T,j=u.naturalHeight*T;t.drawImage(u,p+(d-A)/2,v+(d-j)/2,A,j)}else t.fillStyle=g,t.font=`600 ${Math.round(32*n)}px ${f}`,t.textAlign="center",t.textBaseline="middle",t.fillText(w(a).charAt(0).toUpperCase(),p+d/2,v+d/2+n);const M=p+d+Math.round(18*n);t.textAlign="left",t.textBaseline="alphabetic",t.fillStyle="#ffffff",t.font=`600 ${Math.round(30*n)}px ${f}`;const I=s/2-M;t.fillText(x(t,w(a),I),M,l/2+Math.round(2*n)),t.font=`${Math.round(17*n)}px ${$}`,t.fillText(x(t,C(a),I),M,l/2+Math.round(26*n)),t.textAlign="right",t.font=`600 ${Math.round(22*n)}px ${$}`,t.fillText(x(t,r,s/2-p*2),s-p,l/2+Math.round(8*n)),t.drawImage(h,0,l);const k=l+h.naturalHeight;t.fillStyle=g,t.fillRect(0,k,s,Math.max(2,Math.round(3*n))),t.fillStyle=L,t.textAlign="left",t.textBaseline="middle",t.font=`${Math.round(16*n)}px ${$}`,t.fillText(x(t,D(i,y),s*.55),p,k+m/2),t.textAlign="right",t.fillText(x(t,`A planning draft: ${w(a)} confirms sizes before ordering.`,s*.4),s-p,k+m/2);try{return c.toDataURL("image/png")}catch{return e}}export{B as brandedPng,C as contactLine,D as madeOnLine,U as printColour,W as productListHtml};
