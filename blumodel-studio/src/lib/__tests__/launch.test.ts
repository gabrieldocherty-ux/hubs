import { test } from 'node:test';
import assert from 'node:assert/strict';

// payments.ts keeps the checkout marker in sessionStorage; the shared test env only has localStorage.
class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const session = new MemoryStorage();
Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true, writable: true });
const loc = globalThis.location as unknown as { search: string; hash: string };

const { ApiError } = await import('../api');
const { normalizeConfig, normalizeLegal, readQaOverride, applyQaOverride, NO_LEGAL, QA_LEGAL, PUBLIC_URL } = await import('../config');
const { isPaymentsUnavailable, paymentError, PAYMENTS_SOON, markCheckout, settleDemoCheckout, takeCheckoutReturn } = await import('../payments');
const { parseRoute, hrefFor, safeNext, pathToHashUrl } = await import('../router');
const { attachmentName } = await import('../attachment');
const { isLoopbackHost } = await import('../qa');

// ─── /api/config ─────────────────────────────────────────────────────────────

test('payments mode: stripe, the allowed demo, or none (including a refused demo and an old server)', () => {
  assert.equal(normalizeConfig({ payments: 'stripe', demoPayments: false } as never).payments, 'stripe');
  assert.equal(normalizeConfig({ payments: 'demo', demoPayments: true } as never).payments, 'demo');
  assert.equal(normalizeConfig({ payments: 'demo' } as never).payments, 'demo');
  assert.equal(normalizeConfig({ payments: 'demo', demoPayments: false } as never).payments, 'none');
  assert.equal(normalizeConfig({ payments: 'none' } as never).payments, 'none');
  assert.equal(normalizeConfig({ payments: 'bogus' } as never).payments, 'none');
  assert.equal(normalizeConfig(null).payments, 'none');
});

test('publicUrl defaults to blumodel.studio and drops a trailing slash; junk is ignored', () => {
  assert.equal(normalizeConfig({}).publicUrl, PUBLIC_URL);
  assert.equal(normalizeConfig({ publicUrl: 'https://blumodel.studio/' }).publicUrl, 'https://blumodel.studio');
  assert.equal(normalizeConfig({ publicUrl: 'javascript:alert(1)' }).publicUrl, PUBLIC_URL);
});

test('legal details: trimmed, checked, and only ready with a business name and a real email', () => {
  assert.deepEqual(normalizeLegal(undefined), NO_LEGAL);
  const ok = normalizeLegal({ ready: true, businessName: '  Sample   Co. ', supportEmail: 'help@example.test', jurisdiction: 'Ontario, Canada' });
  assert.deepEqual(ok, { ready: true, businessName: 'Sample Co.', supportEmail: 'help@example.test', jurisdiction: 'Ontario, Canada' });
  const badEmail = normalizeLegal({ ready: true, businessName: 'Sample Co.', supportEmail: 'not an email', jurisdiction: null });
  assert.equal(badEmail.supportEmail, null);
  assert.equal(badEmail.ready, false, 'a server saying ready without a usable email is not ready');
  assert.equal(normalizeLegal({ ready: false, businessName: 'Sample Co.', supportEmail: 'help@example.test' }).ready, false);
  assert.equal(normalizeLegal({ businessName: 'x'.repeat(500) }).businessName, null, 'absurdly long values are dropped, not shown');
});

test('the QA override only replaces payments and legal, and is remembered for the tab', () => {
  const o = readQaOverride('#/pricing?qa-payments=none&qa-legal=ready', null);
  assert.deepEqual(o, { payments: 'none', legal: 'ready' });
  const kept = readQaOverride('#/account/billing', JSON.stringify(o));
  assert.deepEqual(kept, o, 'a later route in the same tab keeps the override');
  assert.deepEqual(readQaOverride('#/?qa-payments=free-money', null), {}, 'unknown values are ignored');
  assert.deepEqual(readQaOverride('#/', '{not json'), {});
  const base = normalizeConfig({ payments: 'demo', demoPayments: true });
  const c = applyQaOverride(base, { payments: 'stripe', legal: 'ready' });
  assert.equal(c.payments, 'stripe');
  assert.deepEqual(c.legal, QA_LEGAL);
  assert.equal(applyQaOverride(base, { legal: 'unset' }).legal, NO_LEGAL);
  assert.equal(applyQaOverride(base, {}).payments, 'demo');
});

test('the QA override works only on this machine: never on blumodel.studio, whatever the link says', () => {
  for (const h of ['127.0.0.1', '127.0.0.2', 'localhost', 'LOCALHOST', '[::1]']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['blumodel.studio', 'www.blumodel.studio', '127.0.0.1.evil.test', 'localhost.evil.test', '192.168.1.5', '10.0.0.1', '']) assert.equal(isLoopbackHost(h), false, h);
});

test('a path the server answered with the app becomes the same hash route', () => {
  assert.equal(pathToHashUrl('/', '', ''), null);
  assert.equal(pathToHashUrl('/', '?qa=1', '#/pricing'), null);
  assert.equal(pathToHashUrl('/index.html', '', ''), null);
  assert.equal(pathToHashUrl('/terms', '', ''), '/#/terms');
  assert.equal(pathToHashUrl('/pricing/', '', ''), '/#/pricing');
  assert.equal(pathToHashUrl('/b/alder-and-pine', '?ref=x', ''), '/?ref=x#/b/alder-and-pine');
  assert.equal(pathToHashUrl('/old-page', '', '#/privacy'), '/#/privacy', 'a hash of its own wins');
  assert.equal(pathToHashUrl('/no/such/page', '', '#'), '/#/no/such/page');
  assert.deepEqual(parseRoute('#/no/such/page'), { name: 'notFound' });
  assert.deepEqual(parseRoute('#/terms'), { name: 'legal', doc: 'terms' });
});

// ─── payments ────────────────────────────────────────────────────────────────

test('the 503 payments_unavailable answer reads as "payments open soon"', () => {
  const off = new ApiError(503, 'Payments are not available yet.', { error: 'Payments are not available yet.', code: 'payments_unavailable' });
  assert.equal(isPaymentsUnavailable(off), true);
  assert.equal(paymentError(off), PAYMENTS_SOON);
  assert.equal(isPaymentsUnavailable(new ApiError(503, 'Down', {})), false);
  assert.equal(paymentError(new ApiError(409, 'Already unlocked.')), 'Already unlocked.');
  assert.equal(paymentError(new Error('x'), 'Fallback'), 'Fallback');
});

test('checkout return: a cancelled trip says cancelled once, on the page it returns to', () => {
  session.clear();
  loc.search = '';
  const t0 = Date.now();
  markCheckout('kitchen_unlock', '#/k/abc');
  assert.equal(takeCheckoutReturn('#/account/billing', t0 + 10), null, 'another page does not take it');
  assert.deepEqual(takeCheckoutReturn('#/k/abc', t0 + 10_000), { outcome: 'cancel', what: 'kitchen_unlock', sessionId: null });
  assert.deepEqual(takeCheckoutReturn('#/k/abc', t0 + 11_000), { outcome: 'cancel', what: 'kitchen_unlock', sessionId: null }, 'a second effect run (StrictMode) hears the same');
  assert.equal(takeCheckoutReturn('#/k/abc', t0 + 60_000), null, 'then it is gone');
});

test('checkout return: the DEMO page settles success; Stripe adds ?session_id=', () => {
  session.clear();
  loc.search = '';
  markCheckout('unlimited', '#/account/billing');
  settleDemoCheckout('success');
  assert.deepEqual(takeCheckoutReturn('#/account/billing?x=1', Date.now() + 1), { outcome: 'success', what: 'unlimited', sessionId: null });

  session.clear();
  loc.search = '?qa=1&session_id=cs_test_123';
  markCheckout('contractor', '#/pro');
  const r = takeCheckoutReturn('#/pro', Date.now() + 10_000);
  assert.deepEqual(r, { outcome: 'success', what: 'contractor', sessionId: 'cs_test_123' });
  loc.search = '';
});

test('checkout return: a stale marker (over two hours) is dropped', () => {
  session.clear();
  loc.search = '';
  markCheckout('order', '#/orders/o1');
  assert.equal(takeCheckoutReturn('#/orders/o1', Date.now() + 3 * 3600 * 1000), null);
  assert.equal(session.getItem('blumodel.checkout'), null);
});

// ─── routes ──────────────────────────────────────────────────────────────────

test('legal pages, account settings and the 404 route', () => {
  assert.deepEqual(parseRoute('#/terms'), { name: 'legal', doc: 'terms' });
  assert.deepEqual(parseRoute('#/privacy'), { name: 'legal', doc: 'privacy' });
  assert.deepEqual(parseRoute('#/refunds?qa-payments=stripe'), { name: 'legal', doc: 'refunds' });
  assert.deepEqual(parseRoute('#/account'), { name: 'account' });
  assert.deepEqual(parseRoute('#/account/billing'), { name: 'billing' });
  for (const h of ['#/nope', '#/terms/extra', '#/pricing/x', '#/k/not-a-uuid', '#/%E0%A4%A']) assert.deepEqual(parseRoute(h), { name: 'notFound' }, h);
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.equal(hrefFor({ name: 'legal', doc: 'refunds' }), '#/refunds');
  assert.equal(hrefFor({ name: 'account' }), '#/account');
  assert.equal(safeNext(new URLSearchParams('next=#/nope')), '#/', 'sign-in never sends someone on to a 404');
  assert.equal(safeNext(new URLSearchParams('next=#/privacy')), '#/privacy');
});

// ─── downloads ───────────────────────────────────────────────────────────────

test('the data download keeps the server’s filename, made safe to save', () => {
  assert.equal(attachmentName('attachment; filename="blumodel-account-2026-10-14.json"', 'f.json'), 'blumodel-account-2026-10-14.json');
  assert.equal(attachmentName("attachment; filename*=UTF-8''my%20data.json", 'f.json'), 'my data.json');
  assert.equal(attachmentName('attachment; filename="../../etc/passwd"', 'f.json'), 'etc-passwd');
  assert.equal(attachmentName('attachment; filename="100%.json"', 'f.json'), '100%.json');
  assert.equal(attachmentName(null, 'f.json'), 'f.json');
  assert.equal(attachmentName('inline', 'f.json'), 'f.json');
});
