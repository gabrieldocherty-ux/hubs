// A showroom's document head (docs/SHOWROOM_PIVOT.md §5-6): link previewers don't run the app, so
// the HTML a showroom serves must already say the company, never our sales pitch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.mjs';

const INDEX = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html'), 'utf8');
const SALES = [/Virtual showrooms for kitchen and bath companies/, /We build, host and run/, /marketing\/og\.png/, /https:\/\/blumodel\.studio\//];

test("a showroom's HTML carries the company's title, description and preview tags, escaped; the sales site keeps ours", async () => {
  const t = await startTestServer();
  try {
    fs.mkdirSync(t.config.DIST_DIR, { recursive: true });
    fs.writeFileSync(path.join(t.config.DIST_DIR, 'index.html'), INDEX);
    const A = t.tenant({ name: 'Acme <Kitchens> & "Bath" (Demo)', slug: 'acme', settings: { bathrooms: true }, contact: { serviceArea: 'London, ON' } });
    const r = await t.agent({ host: A.host }).get('/');
    assert.equal(r.status, 200);
    const html = r.text;
    for (const re of SALES) assert.doesNotMatch(html, re);
    assert.match(html, /<title>Acme &lt;Kitchens&gt; &amp; &quot;Bath&quot; · Design your kitchen or bathroom in 3D<\/title>/);
    assert.match(html, /<meta property="og:title" content="Acme &lt;Kitchens&gt; &amp; &quot;Bath&quot; · Design your kitchen or bathroom in 3D" \/>/);
    assert.match(html, /<meta name="description" content="[^"]*then send it to Acme &lt;Kitchens&gt;[^"]*Serving London, ON\." \/>/);
    assert.match(html, new RegExp(`<meta property="og:url" content="http://acme\.localhost:${t.port}/" />`));
    assert.match(html, new RegExp(`<link rel="canonical" href="http://acme\.localhost:${t.port}/" />`));
    assert.doesNotMatch(html, /og:image/);
    // Deep links are the same document.
    assert.match((await t.agent({ host: A.host }).get('/some/route')).text, /<title>Acme/);
    // The sales site is untouched.
    const sales = await t.agent().get('/');
    assert.match(sales.text, /<title>BluModel Studio · Virtual showrooms for kitchen and bath companies<\/title>/);
  } finally {
    await t.close();
  }
});
