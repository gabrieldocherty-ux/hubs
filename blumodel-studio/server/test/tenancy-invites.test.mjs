// Team invites and addresses on a showroom (docs/SHOWROOM_PIVOT.md §4-5). There is no email
// verification, so holding an account with an address proves nothing about it:
//   - a visitor who signs up (or changes their email) with an address before it is invited must
//     not become staff or owner when the invite comes: the invite is held until its link is used;
//   - an address a sales-site team member signs in with can't be taken on that showroom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, startTestServer } from './helpers.mjs';

const tokenOf = (url) => new URL(url.replace('/#/', '/')).searchParams.get('reset');
const EMAIL_ENV = { RESEND_API_KEY: 're_FAKE_FOR_TESTS', EMAIL_FROM: 'BluModel Studio <hello@blumodel.test>' };
/** A fetch that records every email and answers like Resend. */
function mailbox() {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'em_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const joinToken = (to) => {
    const m = sent.filter((x) => x.body.to.includes(to)).map((x) => /[?&]join=([A-Za-z0-9_-]{43})/.exec(x.body.text)?.[1]).filter(Boolean);
    return m.at(-1) ?? null;
  };
  return { fetch, sent, joinToken };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test('an owner inviting an existing customer account gets no link into it, and its password never changes (audit: Team > Invite takeover)', async () => {
  const mail = mailbox();
  const t = await startTestServer({ env: EMAIL_ENV, fetch: mail.fetch });
  try {
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const victim = await t.showroomUser(A, { email: 'v2@ex.test', password: 'victim password 123' });

    const r = await owner.post('/api/workspace/team', { email: 'v2@ex.test', role: 'staff' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.pending, true);
    assert.equal(r.body.invite, undefined, 'no link of any kind comes back to the owner');
    assert.ok(!/reset=|join=/.test(r.text));
    // No password-reset token exists for the account at all.
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ?').get(victim.id).n, 0);
    // The victim is still signed in with their own password, and nothing is granted.
    assert.equal((await victim.get('/api/auth/me')).body.user.id, victim.id);
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/login', { email: 'v2@ex.test', password: 'victim password 123' })).status, 200);
    assert.equal((await victim.get('/api/workspace/leads')).status, 403);

    // The accept link went to the address only. It needs the account's own password; a wrong one is refused.
    await settle();
    const join = mail.joinToken('v2@ex.test');
    assert.ok(join, 'the address was emailed an accept link');
    assert.equal(mail.sent.filter((x) => x.body.to.includes(owner.user.email)).length, 0);
    const stranger = new Agent(t.url, { host: A.host });
    const check = await stranger.post('/api/auth/join/check', { token: join });
    assert.equal(check.body.valid, true);
    assert.equal(check.body.email.includes('v2@ex.test'), false, 'the address is masked');
    assert.equal((await stranger.post('/api/auth/join', { token: join, password: 'the owner guesses' })).status, 401);
    assert.equal((await stranger.get('/api/auth/me')).body.user, null);
    // The account holder accepts with their own password: they join, and the password is unchanged.
    const ok = await stranger.post('/api/auth/join', { token: join, password: 'victim password 123' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.user.showroom.role, 'staff');
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/login', { email: 'v2@ex.test', password: 'victim password 123' })).status, 200);
    // The link works once.
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/join', { token: join, password: 'victim password 123' })).status, 400);
    // On another showroom the token is nothing.
    const B = t.tenant({ name: 'Bravo', slug: 'bravo' });
    assert.equal((await new Agent(t.url, { host: B.host }).post('/api/auth/join/check', { token: join })).body.valid, false);
  } finally {
    await t.close();
  }
});

test('without an email provider an existing account cannot be invited at all (409 email_required); a new address still gets its set-your-password link', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const mallory = await t.showroomUser(A, { email: 'newhire@acme.test', password: 'mallory password 123' });
    const r = await owner.post('/api/workspace/team', { email: 'newhire@acme.test', role: 'staff' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'email_required');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_invites').get().n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ?').get(mallory.id).n, 0);
    assert.equal((await mallory.get('/api/workspace/leads')).status, 403);
    const fresh = await owner.post('/api/workspace/team', { email: 'brand-new@acme.test', role: 'staff' });
    assert.equal(fresh.status, 201);
    assert.ok(fresh.body.invite?.url, 'an account made just now, empty, gets its link');
  } finally {
    await t.close();
  }
});

test('a squatter who signed up (or changed their email) with the address first gets nothing; a pending invite can be changed and withdrawn', async () => {
  const mail = mailbox();
  const t = await startTestServer({ env: EMAIL_ENV, fetch: mail.fetch });
  try {
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const mallory = await t.showroomUser(A, { email: 'mallory@evil.test', password: 'mallory password 123' });
    assert.equal((await mallory.post('/api/account/email', { email: 'hire2@acme.test', password: 'mallory password 123' })).status, 200);
    const r = await owner.post('/api/workspace/team', { email: 'hire2@acme.test', role: 'owner' });
    assert.equal(r.status, 200);
    assert.equal(r.body.pending, true);
    assert.equal(r.body.member.userId, mallory.id);
    assert.equal(r.body.member.pending, true);
    assert.equal((await mallory.get('/api/workspace/team')).status, 403);
    // Mallory never sees the emailed link (it went to hire2@acme.test), and signing in is not accepting.
    assert.equal((await mallory.get('/api/auth/me')).body.user.showroom.role, null);
    assert.equal((await owner.patch(`/api/workspace/team/${mallory.id}`, { role: 'staff' })).body.member.role, 'staff');
    assert.equal((await owner.delete(`/api/workspace/team/${mallory.id}`)).status, 200);
    assert.equal((await owner.get('/api/workspace/team')).body.members.some((m) => m.userId === mallory.id), false);
    await settle();
    const join = mail.joinToken('hire2@acme.test');
    assert.ok(join);
    // Withdrawn: the link leads nowhere.
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/join', { token: join, password: 'mallory password 123' })).status, 400);
  } finally {
    await t.close();
  }
});

test('the admin route holds the invite too and gets no link into an existing account', async () => {
  const mail = mailbox();
  const t = await startTestServer({ env: EMAIL_ENV, fetch: mail.fetch });
  try {
    const C = t.tenant({ name: 'Charlie', slug: 'charlie' });
    const admin = await t.user({ role: 'admin' });
    const eve = await t.showroomUser(C, { email: 'boss@charlie.test', password: 'eve password 1234' });
    t.ctx.services.tenants.setStatus(C.id, 'setup');
    const r = await admin.post(`/api/admin/tenants/${C.id}/members`, { email: 'boss@charlie.test', role: 'owner' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.pending, true);
    assert.equal(r.body.invite, undefined);
    assert.equal((await eve.get('/api/workspace/team')).status, 403);
    await settle();
    assert.ok(mail.joinToken('boss@charlie.test'));
    // A brand-new address is added straight away, with its set-your-password link.
    const fresh = await admin.post(`/api/admin/tenants/${C.id}/members`, { email: 'staff@charlie.test', role: 'staff' });
    assert.equal(fresh.status, 201);
    assert.equal(fresh.body.pending, false);
    assert.equal(fresh.body.member.role, 'staff');
    assert.ok(tokenOf(fresh.body.invite.url));
  } finally {
    await t.close();
  }
});

test("a sales-site team member's address can't be taken on the showroom by signing up or changing email", async () => {
  const t = await startTestServer();
  try {
    const B = t.tenant({ name: 'Bravo Bath', slug: 'bravo' });
    const pro = await t.user({ email: 'pro@bravo.test', password: 'pro password 1234' });
    t.ctx.services.tenants.addMember(B.id, pro.id, 'owner');
    const login = () => new Agent(t.url, { host: B.host }).post('/api/auth/login', { email: 'pro@bravo.test', password: 'pro password 1234' });
    assert.equal((await login()).body.user.showroom.role, 'owner');

    const squat = await new Agent(t.url, { host: B.host }).post('/api/auth/signup', { name: 'Squatter', email: 'pro@bravo.test', password: 'squatter pass 123' });
    assert.equal(squat.status, 409);
    const v = await t.showroomUser(B, { email: 'v@x.test', password: 'visitor pass 123' });
    assert.equal((await v.post('/api/account/email', { email: 'pro@bravo.test', password: 'visitor pass 123' })).status, 409);
    const r = await login();
    assert.equal(r.status, 200);
    assert.equal(r.body.user.showroom.role, 'owner');

    // An account made before signup refused this doesn't lock the member out either.
    t.db.prepare("UPDATE users SET email = 'pro@bravo.test' WHERE id = ?").run(v.id);
    assert.equal((await login()).body.user.id, pro.id);
  } finally {
    await t.close();
  }
});

test("a sales-site team member can't delete their whole account from a showroom", async () => {
  const t = await startTestServer();
  try {
    const B = t.tenant({ name: 'Bravo Bath', slug: 'bravo' });
    const pro = await t.user({ email: 'pro2@bravo.test', password: 'pro password 1234' });
    t.ctx.services.tenants.addMember(B.id, pro.id, 'owner');
    const onShowroom = new Agent(t.url, { host: B.host });
    await onShowroom.post('/api/auth/login', { email: 'pro2@bravo.test', password: 'pro password 1234' });
    const del = await onShowroom.post('/api/account/delete', { password: 'pro password 1234' });
    assert.equal(del.status, 409);
    assert.equal(del.body.code, 'sales_account');
    assert.ok(t.db.prepare('SELECT 1 FROM users WHERE id = ?').get(pro.id));
    // A visitor's own showroom account still deletes there.
    const v = await t.showroomUser(B, { password: 'visitor pass 123' });
    assert.equal((await v.post('/api/account/delete', { password: 'visitor pass 123' })).status, 204);
  } finally {
    await t.close();
  }
});
