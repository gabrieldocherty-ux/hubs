// Invalid email addresses cannot sign up: shape, typos of the big providers, throwaway inboxes, and domains that cannot receive mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailDomainProblem, emailProblem, emailSyntaxOk, setResolverForTests } from '../lib/emailCheck.mjs';
import { startTestServer } from './helpers.mjs';

test('syntax: real addresses pass, junk fails', () => {
  for (const ok of ['jane@example.com', 'jane.doe+kitchen@sub.example.co.uk', "o'brien@shop.ca", 'a_b-c@my-company.ca']) assert.equal(emailSyntaxOk(ok), true, ok);
  for (const bad of ['a@b.c', 'a@b', 'a b@c.com', 'a..b@c.com', '.a@c.com', 'a.@c.com', 'a@c..com', 'a@@c.com', 'a@c.123', 'a@-c.com', '@c.com', 'a@c.com,b@d.com', '', 'plainaddress'])
    assert.equal(emailSyntaxOk(bad), false, bad);
});

test('typos of the big providers get a "did you mean"', () => {
  assert.equal(emailProblem('sam@gmial.com'), 'Did you mean sam@gmail.com?');
  assert.equal(emailProblem('sam@hotmail.con'), 'Did you mean sam@hotmail.com?');
  assert.equal(emailProblem('sam@gmail.com'), null);
});

test('throwaway inbox services are refused', () => {
  assert.match(emailProblem('x1@mailinator.com'), /real email/);
  assert.match(emailProblem('x1@mail.yopmail.com'), /real email/);
});

test('domain check: no MX and no address record is refused; a timeout lets it through', async () => {
  const prev = process.env.BLUMODEL_EMAIL_DNS_CHECK;
  process.env.BLUMODEL_EMAIL_DNS_CHECK = 'on';
  const nx = Object.assign(new Error('x'), { code: 'ENOTFOUND' });
  try {
    setResolverForTests({ resolveMx: async (d) => (d === 'real.ca' ? [{ exchange: 'mx.real.ca', priority: 10 }] : Promise.reject(nx)), resolve4: async (d) => (d === 'aonly.ca' ? ['1.2.3.4'] : Promise.reject(nx)), resolve6: async () => Promise.reject(nx) });
    assert.equal(await emailDomainProblem('a@real.ca'), null);
    assert.equal(await emailDomainProblem('a@aonly.ca'), null);
    assert.match(await emailDomainProblem('a@nosuchdomain.ca'), /can’t find a mail server/);
    setResolverForTests({ resolveMx: async () => Promise.reject(Object.assign(new Error('t'), { code: 'ETIMEOUT' })), resolve4: async () => [], resolve6: async () => [] });
    assert.equal(await emailDomainProblem('a@anything.ca'), null, 'an outage never blocks a customer');
    setResolverForTests({ resolveMx: async () => [{ exchange: '', priority: 0 }], resolve4: async () => Promise.reject(nx), resolve6: async () => Promise.reject(nx) });
    assert.match(await emailDomainProblem('a@nullmx.ca'), /mail server/);
  } finally {
    setResolverForTests(null);
    process.env.BLUMODEL_EMAIL_DNS_CHECK = prev ?? 'off';
  }
});

test('sign-up refuses a bad address with a message for the email field', async () => {
  const t = await startTestServer();
  try {
    const a = t.agent();
    for (const email of ['not-an-email', 'a@b.c', 'sam@gmial.com', 'x@mailinator.com']) {
      const r = await a.post('/api/auth/signup', { name: 'Sam', email, password: 'longenough1' });
      assert.equal(r.status, 400, email);
    }
    const ok = await t.agent().post('/api/auth/signup', { name: 'Sam', email: 'sam@example.com', password: 'longenough1' });
    assert.equal(ok.status < 300, true);
  } finally {
    await t.close();
  }
});
