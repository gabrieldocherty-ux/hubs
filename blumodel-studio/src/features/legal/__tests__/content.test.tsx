import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { legalDoc, type LegalDocId } from '../content';
import { NO_LEGAL, QA_LEGAL } from '../../../lib/config';
import type { LegalConfig } from '../../../types/platform';
import type { PaymentsMode } from '../../../lib/config';

const DOCS: LegalDocId[] = ['terms', 'privacy', 'refunds'];

/** The page's text, as a visitor reads it. */
function text(id: LegalDocId, legal: LegalConfig, payments: PaymentsMode | null) {
  const d = legalDoc(id, legal, payments);
  const html = renderToStaticMarkup(
    <>
      <h1>{d.title}</h1>
      <p>{d.lede}</p>
      {d.sections.map((s) => (
        <section key={s.id}>
          <h2>{s.heading}</h2>
          {s.body}
        </section>
      ))}
    </>,
  );
  return { d, html, plain: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&quot;|&amp;/g, ' ').replace(/\s+/g, ' ') };
}

test('with no legal details set, every page uses neutral wording and never a placeholder', () => {
  for (const id of DOCS) {
    const { plain, html } = text(id, NO_LEGAL, 'stripe');
    assert.match(plain, /the operator of this site/i, id);
    for (const bad of [/\bnull\b/, /\bundefined\b/, /\[[^\]]*\]/, /TODO|TBD|lorem ipsum/i, /YOUR [A-Z]/, /example\.(test|com)/i, /mailto:/]) assert.doesNotMatch(plain + html, bad, `${id}: ${bad}`);
  }
});

test('with the operator’s details, the pages name them and link the support address', () => {
  for (const id of DOCS) {
    const { html } = text(id, QA_LEGAL, 'stripe');
    assert.ok(html.includes('mailto:help@example.test'), id);
  }
  assert.ok(text('terms', QA_LEGAL, 'stripe').plain.includes('Sample Kitchen Co. (QA)'));
  assert.ok(text('terms', QA_LEGAL, 'stripe').plain.includes('governed by the laws of Ontario, Canada'));
  assert.ok(text('terms', NO_LEGAL, 'stripe').plain.includes('the place where the operator of this site is established'));
});

test('real payments: no demo wording on any page; the labelled demo explains itself', () => {
  for (const id of DOCS) assert.doesNotMatch(text(id, QA_LEGAL, 'stripe').plain, /bdemob/i, id);
  assert.match(text('terms', QA_LEGAL, 'demo').plain, /DEMO/);
  assert.ok(text('refunds', QA_LEGAL, 'demo').d.sections.some((s) => s.id === 'demo'));
  assert.match(text('terms', QA_LEGAL, 'none').plain, /Payments aren’t open yet/);
  assert.doesNotMatch(text('refunds', QA_LEGAL, 'none').plain, /bdemob/i);
});

test('the pages cover the showroom service: a B2B agreement, the company as controller and us as processor, the monthly plan refunds', () => {
  const terms = text('terms', NO_LEGAL, 'stripe').plain;
  const privacy = text('privacy', NO_LEGAL, 'stripe').plain;
  const refunds = text('refunds', NO_LEGAL, 'stripe').plain;
  assert.equal(legalDoc('terms', NO_LEGAL, 'stripe').title, 'Service agreement');
  assert.match(terms, /kitchen and bath companies/);
  // The setup and license fee is quoted per company: the agreement names no amount and no product count.
  assert.match(terms, /the setup and license fee set out in your order or invoice/);
  assert.doesNotMatch(terms, /1,995|1995|up to 50|\d+ products/);
  assert.match(terms, /\$50 CAD a month/);
  assert.match(terms, /\$25 CAD for hosting and running your showroom, including its web address/);
  assert.match(terms, /\$25 CAD of AI rendering credits/);
  assert.match(terms, /roll over for 3 months/);
  assert.match(terms, /14 days/);
  assert.match(terms, /Leads are yours/);
  assert.match(terms, /you are the controller and we are your processor/);
  assert.match(terms, /Cancel any time/);
  assert.match(privacy, /processor/);
  assert.match(privacy, /the company is in charge of their data/);
  assert.match(privacy, /blumodel_session/);
  assert.match(privacy, /no advertising or analytics cookies/i);
  assert.match(privacy, /backup made every day/);
  assert.match(privacy, /Download my data/);
  assert.match(privacy, /Delete my account/);
  assert.match(privacy, /A lead goes to the one company/);
  assert.match(refunds, /The monthly plan/);
  assert.match(refunds, /Rendering credits/);
  assert.match(refunds, /yearly license/);
  // Section numbers stay in order whichever optional sections are shown.
  for (const id of DOCS)
    for (const payments of ['stripe', 'demo', 'none'] as const) {
      const nums = legalDoc(id, NO_LEGAL, payments).sections.map((s) => Number(/^(\d+)\./.exec(s.heading)?.[1]));
      assert.deepEqual(nums, nums.map((_, i) => i + 1), `${id} ${payments}`);
    }
});

test('the removed homeowner and contractor products appear only in the earlier-purchases sections', () => {
  for (const id of DOCS) {
    const d = legalDoc(id, QA_LEGAL, 'stripe');
    for (const s of d.sections) {
      if (s.id === 'earlier') continue;
      const plain = renderToStaticMarkup(<>{s.body}</>).replace(/<[^>]+>/g, ' ');
      assert.doesNotMatch(plain, /\bUnlimited\b|kitchen unlock|Contractor plan|Start from a photo|watermark|Exports are paid/i, `${id}/${s.id}`);
    }
    if (id !== 'privacy') assert.ok(d.sections.some((s) => s.id === 'earlier'), `${id} has no earlier-purchases section`);
  }
});
