// The anti-copying clauses (docs/handoff/protect.md), the privacy page's retention facts
// (docs/handoff/data-lifecycle.md), and the © line in every site's footer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { legalDoc } from '../content';
import { copyrightLines, LegalLinks } from '../LegalLinks';
import { NO_LEGAL, QA_LEGAL } from '../../../lib/config';

const plainOf = (id: 'terms' | 'privacy', legal = NO_LEGAL) => {
  const d = legalDoc(id, legal, 'stripe');
  return renderToStaticMarkup(
    <>
      <p>{d.lede}</p>
      {d.sections.map((s) => (
        <section key={s.id}>
          <h2>{s.heading}</h2>
          {s.body}
        </section>
      ))}
    </>,
  )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&quot;|&amp;/g, ' ')
    .replace(/\s+/g, ' ');
};

test('the service agreement: who owns what, a licence not a sale, no copying, reverse engineering, scraping, competing products or AI training, trademarks, confidentiality', () => {
  const terms = plainOf('terms');
  for (const want of [
    /Yours: your company name, logo and brand, your product information/,
    /Ours: the BluModel Studio software and its code, its designs and layouts, the showroom template/,
    /the 3D models, textures and renderings we make/,
    /A licence, not a sale\./,
    /limited, non-exclusive, non-transferable right to use the service/,
    /every right we don’t expressly give you stays with us/,
    /reverse engineer, decompile, disassemble/,
    /scrape the service or reach it with bots, crawlers or other automated tools/,
    /build or help build a competing product/,
    /train, test or improve an AI or machine-learning model/,
    /18\. Confidentiality/,
    /keeps the other’s non-public information confidential/,
    /19\. Trademarks and copyright/,
    /“BluModel Studio”, its logo and our product names are our trademarks/,
    /20\. Contact/,
  ])
    assert.match(terms, want);
  // With no legal name set the © names BluModel Studio, with one it names the operator.
  assert.match(terms, new RegExp(`© ${new Date().getFullYear()} BluModel Studio`));
  assert.match(plainOf('terms', QA_LEGAL), new RegExp(`© ${new Date().getFullYear()} Sample Kitchen Co\\. \\(QA\\)`));
});

test('visitors (anyone using a showroom or blumodel.studio) are bound by the same no-copying rules', () => {
  const d = legalDoc('terms', NO_LEGAL, 'stripe');
  const visitors = renderToStaticMarkup(<>{d.sections.find((s) => s.id === 'visitors')!.body}</>).replace(/<[^>]+>/g, ' ');
  for (const want of [/Using this site\./, /scrape the site or reach it with bots/, /reverse engineer or decompile/, /competing product/, /train or improve an AI/, /are our trademarks/]) assert.match(visitors, want);
});

test('the privacy page states the retention the server enforces (docs/handoff/data-lifecycle.md)', () => {
  const p = plainOf('privacy');
  for (const want of [
    /deleted 24 months after their last visit, or sooner if the company chooses 6, 12 or 18 months/,
    /The visitor cookie lasts 180 days/,
    /It lasts 180 days, belongs to that one showroom/,
    /Book a call requests are deleted 24 months after they were last updated/,
    /starts a separate lead/,
    /have all of its data exported/,
    /6 years in Canada/,
    /replaced with a pseudonym/,
    /recovery codes, stored only as hashes/,
    /Deleted data leaves every backup within 35 days/,
  ])
    assert.match(p, want);
  assert.doesNotMatch(p, /400 days/);
});

test('every site’s footer carries the © line: ours on the sales site, the company’s and ours (the software) on a showroom', () => {
  const year = new Date().getFullYear();
  assert.deepEqual(copyrightLines(null, null, 2026), { owner: '© 2026 BluModel Studio', software: null });
  assert.deepEqual(copyrightLines(null, 'Sample Kitchen Co.', 2026), { owner: '© 2026 Sample Kitchen Co.', software: null });
  assert.deepEqual(copyrightLines('Acme Kitchens (Demo)', null, 2026), { owner: '© 2026 Acme Kitchens', software: 'Showroom software © 2026 BluModel Studio' });
  assert.deepEqual(copyrightLines('Acme Kitchens', 'Sample Kitchen Co.', 2026).software, 'Showroom software © 2026 Sample Kitchen Co.');
  // The footer component itself (the sales site, as rendered without a config yet).
  const sales = renderToStaticMarkup(<LegalLinks />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(sales, new RegExp(`© ${year} BluModel Studio`));
});
