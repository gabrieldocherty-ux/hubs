import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandSubOf, groupByLine, leadMailto, listingStatus, niceMax, portalRedirect, priceLabel, slugify, SLUG_RE, telHref } from '../logic';

test('the old portal routes redirect into the Contractor workspace (BRAND_PAGE §2)', () => {
  assert.equal(portalRedirect(''), 'brand');
  assert.equal(portalRedirect('analytics'), 'brand');
  assert.equal(portalRedirect('products'), 'brand/products');
  assert.equal(portalRedirect('products/new'), 'brand/products');
  assert.equal(portalRedirect('products/p_abc'), 'brand/products');
  assert.equal(portalRedirect('join'), 'brand/settings');
  assert.equal(portalRedirect('profile'), 'brand/settings');
  assert.equal(portalRedirect('members'), 'brand/settings');
  assert.equal(portalRedirect('leads'), 'brand/leads');
  assert.equal(portalRedirect('anything-else/x'), 'brand');
});

test('the Brand page tab sub-pages', () => {
  assert.equal(brandSubOf('brand'), 'overview');
  assert.equal(brandSubOf('brand/leads'), 'leads');
  assert.equal(brandSubOf('brand/settings'), 'settings');
  assert.equal(brandSubOf('brand/products'), 'products');
  assert.equal(brandSubOf('brand/nope'), 'overview');
});

test('price labels follow the page’s price display and never invent a price', () => {
  assert.equal(priceLabel({ price: 520, priceDisplay: 'from' }), 'From $520');
  assert.equal(priceLabel({ price: 0, priceDisplay: 'from' }), 'Price on request');
  assert.equal(priceLabel({ price: 520, priceDisplay: 'on_request' }), 'Price on request');
  assert.equal(priceLabel({ price: 520, priceDisplay: 'show' }), '$520');
  assert.equal(priceLabel({ price: 520, priceByWidth: { '12': 380, '36': 690 }, priceDisplay: 'show' }), '$380–$690');
  assert.equal(priceLabel({ price: 99 }), '$99');
});

test('grouping by line keeps first-seen order and puts unlined products last', () => {
  const g = groupByLine([{ line: 'B' }, { line: '' }, { line: 'A' }, { line: 'B' }, {}]);
  assert.deepEqual(
    g.map((x) => [x.label, x.items.length]),
    [
      ['B', 2],
      ['A', 1],
      ['Other products', 2],
    ],
  );
});

test('listing status words', () => {
  assert.deepEqual(listingStatus(null, 'live'), { label: 'Not on your page', tone: '', on: false });
  assert.equal(listingStatus({ status: 'archived', hasLive: true, live: false }, 'live').on, false);
  assert.equal(listingStatus({ status: 'submitted', hasLive: false, live: false }, 'live').label, 'In review');
  assert.equal(listingStatus({ status: 'submitted', hasLive: true, live: true }, 'live').label, 'Live · edit in review');
  assert.equal(listingStatus({ status: 'published', hasLive: true, live: true }, 'live').label, 'Live');
  assert.match(listingStatus({ status: 'published', hasLive: true, live: false }, 'hidden').label, /lapsed/);
  assert.deepEqual(listingStatus({ status: 'rejected', hasLive: false, live: false }, 'live'), { label: 'Changes requested', tone: 'bad', on: false });
  assert.equal(listingStatus({ status: 'rejected', hasLive: true, live: true }, 'live').on, true);
});

test('lead links: mailto with a subject naming the product; tel keeps only digits and +', () => {
  const href = leadMailto({ email: 'dana@example.test', productName: 'Shaker Base', name: 'Dana Homeowner' }, 'Hollis Cabinet Co');
  assert.ok(href.startsWith('mailto:dana@example.test?subject='));
  const subject = decodeURIComponent(href.split('subject=')[1].split('&')[0]);
  assert.equal(subject, 'Hollis Cabinet Co: your request about Shaker Base');
  assert.match(decodeURIComponent(href), /Hi Dana,/);
  assert.equal(telHref('+1 (555) 010-0199'), 'tel:+15550100199');
});

test('chart axis and slugs', () => {
  assert.equal(niceMax(0), 4);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(230), 250);
  assert.equal(slugify('Alder & Pine Cabinetry (Demo)'), 'alder-and-pine-cabinetry-demo');
  assert.ok(SLUG_RE.test('hollis-cabinet-co'));
  assert.ok(!SLUG_RE.test('-bad'));
  assert.ok(!SLUG_RE.test('a'));
  assert.ok(!SLUG_RE.test('Upper'));
});
