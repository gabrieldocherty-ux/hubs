import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EstimateLine } from '../../../lib/estimate';
import { contactLine, madeOnLine, printColour, productListHtml } from '../downloads';
import { contrast } from '../palette';
import { normalizeTenant } from '../site';

const tenant = normalizeTenant({
  id: 't1',
  slug: 'demo',
  name: 'Northline <Kitchen> & Bath (Demo)',
  url: 'https://demo.blumodel.studio',
  branding: { primaryColor: '#fff3a0', logoUrl: '/files/logo.png' },
  contact: { phone: '(519) 555-0142', email: 'hello@northline.test', website: 'https://northline.test/', address: '12 King St' },
})!;

const line = (o: Partial<EstimateLine>): EstimateLine => ({ key: 'k', group: 'Cabinets', label: 'Base 30', sub: 'Shaker · Sage', qty: 2, unit: 'ea', unitPrice: 450, total: 900, productId: 'p1', ...o }) as EstimateLine;

test('the contact line and where it was made', () => {
  assert.equal(contactLine(tenant), '(519) 555-0142  ·  hello@northline.test  ·  northline.test');
  assert.match(madeOnLine('demo.localhost:8910', new Date(2026, 9, 17)), /^Designed on demo\.localhost:8910 {2}· {2}.*2026/);
});

test('a printed page in the company colour keeps white text readable, even for a pale colour', () => {
  assert.ok(contrast(printColour(tenant), '#ffffff') >= 4.5);
});

test('the product list escapes everything, shows prices only when asked, and embeds only a captured plan', () => {
  const html = productListHtml({
    tenant,
    designName: 'Riley’s <script>alert(1)</script> kitchen',
    roomText: '12′ × 14′ · 168 sq ft',
    lines: [line({}), line({ key: 'b', label: 'Sink "Farmhouse"', sku: 'SK-<1>', total: 300, unitPrice: 300, qty: 1 })],
    showPrices: false,
    total: 1200,
    logoUrl: 'https://demo.blumodel.studio/files/logo.png',
    planImage: 'javascript:alert(1)',
    host: 'demo.blumodel.studio',
    at: new Date(2026, 9, 17),
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Northline &lt;Kitchen&gt; &amp; Bath/);
  assert.match(html, /SK-&lt;1&gt;/);
  assert.doesNotMatch(html, /\$900|Unit price|Estimated total/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<img class="logo" src="https:\/\/demo\.blumodel\.studio\/files\/logo\.png"/);
  assert.match(html, /tel:\(519\)|tel:5195550142/);
  // No store, no BluModel price, no upsell.
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ''), /\bbuy\b|\bstores?\b|upgrade|\bplans?\b/i);

  const priced = productListHtml({
    tenant,
    designName: 'K',
    roomText: 'r',
    lines: [line({})],
    showPrices: true,
    total: 900,
    logoUrl: 'javascript:alert(1)',
    planImage: 'data:image/png;base64,AAAA',
    host: 'h',
    at: new Date(),
  });
  assert.match(priced, /\$450/);
  assert.match(priced, /Estimated total/);
  assert.match(priced, /<img class="plan" src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(priced, /javascript:/);
  assert.match(priced, /class="logo initial">N</);
});
