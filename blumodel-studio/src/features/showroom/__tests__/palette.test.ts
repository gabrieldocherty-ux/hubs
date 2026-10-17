import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandCss, brandTokens, cleanHex, contrast, DARK_PAGE, LIGHT_PAGE } from '../palette';
import { looksLikeShowroomHost, normalizeTenant, safeImageUrl, shortName, telHref } from '../site';

const PAGES_LIGHT = [LIGHT_PAGE.paper, LIGHT_PAGE.panel, LIGHT_PAGE.card];
const PAGES_DARK = [DARK_PAGE.paper, DARK_PAGE.panel, DARK_PAGE.card];

test('cleanHex accepts #rgb and #rrggbb only', () => {
  assert.equal(cleanHex('#2E3D55'), '#2e3d55');
  assert.equal(cleanHex('#abc'), '#aabbcc');
  for (const bad of ['2e3d55', 'red', '#12345', 'url(x)', '', null, 7]) assert.equal(cleanHex(bad), null);
});

test('every brand colour gives AA pairs in both themes', () => {
  // Navy, a pale yellow, pure white, black, a mid sage and a saturated red.
  for (const c of ['#2e3d55', '#fff3a0', '#ffffff', '#000000', '#9aa892', '#e5322d']) {
    const t = brandTokens(c, '#9aa892')!;
    assert.ok(t, c);
    for (const theme of [t.light, t.dark]) {
      assert.ok(contrast(theme['--accent'], '#ffffff') >= 4.5, `${c}: white on --accent`);
      assert.ok(contrast(theme['--brand'], theme['--brand-ink']) >= 4.5, `${c}: --brand-ink on --brand`);
      assert.ok(contrast(theme['--accent-strong'], '#ffffff') >= 4.5, `${c}: white on --accent-strong`);
    }
    for (const bg of PAGES_LIGHT) assert.ok(contrast(t.light['--accent-text'], bg) >= 4.5, `${c}: --accent-text on ${bg} (light)`);
    for (const bg of PAGES_DARK) assert.ok(contrast(t.dark['--accent-text'], bg) >= 4.5, `${c}: --accent-text on ${bg} (dark)`);
    assert.ok(contrast(LIGHT_PAGE.ink, t.light['--accent-soft']) >= 7, `${c}: ink on --accent-soft (light)`);
    assert.ok(contrast(DARK_PAGE.ink, t.dark['--accent-soft']) >= 7, `${c}: ink on --accent-soft (dark)`);
  }
});

test('no usable colour means no override', () => {
  assert.equal(brandTokens(null), null);
  assert.equal(brandTokens('javascript:alert(1)'), null);
});

test('the stylesheet layers light on :root and dark under the theme attribute and the media query', () => {
  const css = brandCss(brandTokens('#2e3d55')!);
  assert.match(css, /^:root,\.theme-paper,\.quote-sheet\{--accent:#/);
  assert.match(css, /:root\[data-theme='dark'\]\{/);
  assert.match(css, /@media screen and \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme\]\)\{/);
  assert.doesNotMatch(css, /[<>]/);
});

test('normalizeTenant keeps what is usable and drops what is not', () => {
  const t = normalizeTenant({
    id: 't_demo',
    slug: 'demo',
    name: 'Northline Kitchen & Bath (Demo)',
    status: 'live',
    isDemo: true,
    url: 'http://demo.localhost:8910/',
    branding: { logoUrl: 'javascript:alert(1)', primaryColor: '#2e3d55', accentColor: 'nope', welcomeTitle: '  Hi  ', welcomeText: 'Text', featuredLines: ['A', '', 3, 'B'] },
    contact: { phone: '(519) 555-0142', email: 'not an email', website: 'javascript:x', address: '1 Main', serviceArea: 'Guelph', hours: '' },
    features: { fillGaps: true, bathrooms: 'yes', visitorRenders: false },
  })!;
  assert.equal(t.url, 'http://demo.localhost:8910');
  assert.equal(t.branding.logoUrl, null);
  assert.equal(t.branding.primaryColor, '#2e3d55');
  assert.equal(t.branding.accentColor, null);
  assert.equal(t.branding.welcomeTitle, 'Hi');
  assert.deepEqual(t.branding.featuredLines, ['A', 'B']);
  assert.equal(t.contact.email, '');
  assert.equal(t.contact.website, '');
  assert.deepEqual(t.features, { fillGaps: true, bathrooms: false, visitorRenders: false });
  assert.equal(shortName(t), 'Northline Kitchen & Bath');
  assert.equal(normalizeTenant({ id: '', slug: 'x', name: 'y' }), null);
  assert.equal(normalizeTenant(null), null);
});

test('logo addresses: our own paths and https only', () => {
  assert.equal(safeImageUrl('/api/files/abc'), '/api/files/abc');
  assert.equal(safeImageUrl('https://cdn.example/logo.png'), 'https://cdn.example/logo.png');
  for (const bad of ['//evil.example/x.png', 'http://x/y.png', 'data:image/png;base64,AA', '/a"onerror=1', 'javascript:1']) assert.equal(safeImageUrl(bad), null, bad);
});

test('showroom-looking hosts', () => {
  assert.equal(looksLikeShowroomHost('demo.localhost'), true);
  assert.equal(looksLikeShowroomHost('acme.blumodel.studio'), true);
  assert.equal(looksLikeShowroomHost('showroom.acmekitchens.ca'), true);
  for (const h of ['localhost', '127.0.0.1', 'blumodel.studio', 'www.blumodel.studio', '[::1]']) assert.equal(looksLikeShowroomHost(h), false, h);
});

test('phone links', () => {
  assert.equal(telHref('(519) 555-0142'), 'tel:5195550142');
  assert.equal(telHref('+1 519 555 0142'), 'tel:+15195550142');
  assert.equal(telHref('call us'), null);
});
