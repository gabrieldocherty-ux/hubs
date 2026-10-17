// Team invites and addresses on a showroom (docs/SHOWROOM_PIVOT.md §4-5). There is no email
// verification, so holding an account with an address proves nothing about it:
//   - a visitor who signs up (or changes their email) with an address before it is invited must
//     not become staff or owner when the invite comes: the invite is held until its link is used;
//   - an address a sales-site team member signs in with can't be taken on that showroom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, startTestServer } from './helpers.mjs';

const tokenOf = (url) => new URL(url.replace('/#/', '/')).searchParams.get('reset');

test('a visitor who signed up with the address first does not become staff until the invite link is used', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const mallory = await t.showroomUser(A, { email: 'newhire@acme.test', password: 'mallory password 123' });
    assert.equal((await mallory.get('/api/workspace/leads')).status, 403);

    const r = await owner.post('/api/workspace/team', { email: 'newhire@acme.test', role: 'staff' });
    assert.equal(r.status, 200);
    assert.equal(r.body.pending, true);
    assert.equal(r.body.member.pending, true);
    assert.ok(r.body.invite?.url, 'the owner gets a link to pass on');
    // Nothing is granted yet: same cookie, still a visitor.
    assert.equal((await mallory.get('/api/workspace/leads')).status, 403);
    assert.equal((await mallory.get('/api/auth/me')).body.user.showroom.role, null);
    // The team lists the invite as pending.
    const team = (await owner.get('/api/workspace/team')).body.members;
    assert.equal(team.find((m) => m.email === 'newhire@acme.test')?.pending, true);

    // The real person uses the link: the password is theirs, mallory is signed out, they are staff.
    const hire = new Agent(t.url, { host: A.host });
    const reset = await hire.post('/api/auth/reset', { token: tokenOf(r.body.invite.url), password: 'the real new hire' });
    assert.equal(reset.status, 200, reset.text);
    assert.equal(reset.body.user.showroom.role, 'staff');
    assert.equal((await hire.get('/api/workspace/leads')).status, 200);
    assert.equal((await mallory.get('/api/auth/me')).body.user, null);
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/login', { email: 'newhire@acme.test', password: 'mallory password 123' })).status, 401);
    const after = (await owner.get('/api/workspace/team')).body.members.find((m) => m.email === 'newhire@acme.test');
    assert.equal(after.role, 'staff');
    assert.equal(after.pending, undefined);
  } finally {
    await t.close();
  }
});

test('an email change to the address before the invite gives nothing either; a pending invite can be withdrawn', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const mallory = await t.showroomUser(A, { email: 'mallory@evil.test', password: 'mallory password 123' });
    assert.equal((await mallory.post('/api/account/email', { email: 'hire2@acme.test', password: 'mallory password 123' })).status, 200);
    const r = await owner.post('/api/workspace/team', { email: 'hire2@acme.test', role: 'owner' });
    assert.equal(r.status, 200);
    assert.equal(r.body.pending, true);
    assert.equal(r.body.member.userId, mallory.id);
    assert.equal((await mallory.get('/api/workspace/team')).status, 403);
    // The owner can change the pending role, and withdraw it.
    assert.equal((await owner.patch(`/api/workspace/team/${mallory.id}`, { role: 'staff' })).body.member.role, 'staff');
    assert.equal((await owner.delete(`/api/workspace/team/${mallory.id}`)).status, 200);
    assert.equal((await owner.get('/api/workspace/team')).body.members.some((m) => m.userId === mallory.id), false);
    // The old link now leads nowhere useful: using it sets the password but makes no member.
    const hire = new Agent(t.url, { host: A.host });
    const reset = await hire.post('/api/auth/reset', { token: tokenOf(r.body.invite.url), password: 'the real new hire' });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.user.showroom.role, null);
  } finally {
    await t.close();
  }
});

test('the admin route holds the invite too, even for an owner of a company in setup', async () => {
  const t = await startTestServer();
  try {
    const C = t.tenant({ name: 'Charlie', slug: 'charlie', status: 'setup' });
    const admin = await t.user({ role: 'admin' });
    const eve = await t.showroomUser(C, { email: 'boss@charlie.test', password: 'eve password 1234' });
    const r = await admin.post(`/api/admin/tenants/${C.id}/members`, { email: 'boss@charlie.test', role: 'owner' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.pending, true);
    assert.ok(r.body.invite?.url);
    assert.equal((await eve.get('/api/workspace/team')).status, 403);
    // A brand-new address is added straight away, with its set-your-password link.
    const fresh = await admin.post(`/api/admin/tenants/${C.id}/members`, { email: 'staff@charlie.test', role: 'staff' });
    assert.equal(fresh.status, 201);
    assert.equal(fresh.body.pending, false);
    assert.equal(fresh.body.member.role, 'staff');
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
