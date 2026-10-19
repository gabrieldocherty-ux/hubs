// The retail research library is not in the client bundle: loadRetail() asks the server for it
// (GET /api/catalog/retail) only for BluModel staff on the sales site, never on a showroom, and
// a staff member who signs in later gets it then.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import raw from '../data/retail.json';
import { loadRetail, retailAllowed, useRetail } from './retail';
import { useSession } from '../store/useSession';
import { useConfig } from '../lib/config';

const calls: string[] = [];
globalThis.fetch = (async (url: string) => {
  calls.push(String(url));
  return new Response(JSON.stringify(raw), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

const as = (role: string | null) => useSession.setState({ user: role ? ({ id: 'u_1', email: 'x@test', name: 'X', role } as never) : null });
const reset = () => {
  useRetail.setState({ status: 'idle', data: null, products: [], byId: new Map(), fixtures: [], stores: new Map() });
  calls.length = 0;
};

test('signed out, a customer, or anyone on a showroom: nothing is asked for and the library is absent', async () => {
  for (const role of [null, 'customer', 'contractor']) {
    reset();
    as(role);
    await loadRetail();
    assert.equal(useRetail.getState().status, 'unavailable', String(role));
    assert.deepEqual(calls, [], `${role}: no request`);
  }
  reset();
  as('admin');
  useConfig.setState({ config: { tenant: { slug: 'acme', name: 'Acme' } } as never });
  assert.equal(retailAllowed(), false, 'never on a showroom, even for an admin');
  await loadRetail();
  assert.equal(useRetail.getState().status, 'unavailable');
  assert.deepEqual(calls, []);
  useConfig.setState({ config: null });
});

test('BluModel staff on the sales site get it from the API, and someone who signs in later gets it then', async () => {
  reset();
  as('studio');
  await loadRetail();
  assert.deepEqual(calls, ['/api/catalog/retail']);
  assert.equal(useRetail.getState().status, 'ready');
  assert.ok(useRetail.getState().products.length > 100);

  reset();
  as(null);
  await loadRetail();
  assert.equal(useRetail.getState().status, 'unavailable');
  as('admin');
  await new Promise((r) => setTimeout(r, 0));
  await loadRetail();
  assert.equal(useRetail.getState().status, 'ready');
  assert.deepEqual(calls, ['/api/catalog/retail'], 'one request, after the sign-in');
});
