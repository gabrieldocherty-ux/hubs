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
  return { d, html, plain: html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&quot;|&amp;/g, ' ') };
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
  for (const id of DOCS) assert.doesNotMatch(text(id, QA_LEGAL, 'stripe').plain, /demo/i, id);
  assert.match(text('terms', QA_LEGAL, 'demo').plain, /DEMO/);
  assert.ok(text('refunds', QA_LEGAL, 'demo').d.sections.some((s) => s.id === 'demo'));
  assert.match(text('terms', QA_LEGAL, 'none').plain, /Payments aren’t open yet/);
  assert.doesNotMatch(text('refunds', QA_LEGAL, 'none').plain, /demo/i);
});

test('the pages cover what the product does: paid exports, cancelling at period end, models, leads, uploads, cookies, backups, export/delete', () => {
  const terms = text('terms', NO_LEGAL, 'stripe').plain;
  const privacy = text('privacy', NO_LEGAL, 'stripe').plain;
  const refunds = text('refunds', NO_LEGAL, 'stripe').plain;
  assert.match(terms, /Exports are paid/);
  assert.match(terms, /end of the period you have already paid for/);
  assert.match(terms, /revisions/i);
  assert.match(terms, /Leads/);
  assert.match(privacy, /blumodel_session/);
  assert.match(privacy, /no advertising or analytics cookies/i);
  assert.match(privacy, /backup made every day/);
  assert.match(privacy, /Download my data/);
  assert.match(privacy, /Delete my account/);
  assert.match(privacy, /go to the one contractor you sent them to/);
  assert.match(refunds, /Custom 3D models/);
  // Section numbers stay in order whichever optional sections are shown.
  for (const id of DOCS)
    for (const payments of ['stripe', 'demo', 'none'] as const) {
      const nums = legalDoc(id, NO_LEGAL, payments).sections.map((s) => Number(/^(\d+)\./.exec(s.heading)?.[1]));
      assert.deepEqual(nums, nums.map((_, i) => i + 1), `${id} ${payments}`);
    }
});
