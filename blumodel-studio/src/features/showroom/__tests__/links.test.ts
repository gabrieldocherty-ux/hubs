import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_DRAFT_HREF, designHref } from '../links';

test('a visitor designs signed out: Design your kitchen goes straight to the wizard', () => {
  assert.equal(designHref('kitchen', false), '#/new');
  assert.equal(designHref('bathroom', false), '#/new?room=bathroom');
  assert.equal(designHref('kitchen', false, 'Lakeshore Shaker'), '#/new?line=Lakeshore+Shaker');
  assert.equal(designHref('kitchen', true), '#/new');
  // Sending a device design signs up, then #/local saves it to the new account.
  assert.equal(CLAIM_DRAFT_HREF, '#/signup?next=%23%2Flocal');
});
