// Browser storage from before the rename (Mise -> BluModel Studio) moves to the new keys once,
// so a device-only kitchen and the other drafts survive the rename.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateBrowserStorage, migrateLegacyKeys, renamedKey } from '../legacyStorage';

class Mem implements Storage {
  m = new Map<string, string>();
  failSet = false;
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  [name: string]: unknown;
}

test('renamedKey maps mise. and mise- to blumodel. and blumodel-, and nothing else', () => {
  assert.equal(renamedKey('mise-local-draft'), 'blumodel-local-draft');
  assert.equal(renamedKey('mise-kitchen-v1'), 'blumodel-kitchen-v1');
  assert.equal(renamedKey('mise.exportIntent'), 'blumodel.exportIntent');
  assert.equal(renamedKey('mise.quoteImages.p-1'), 'blumodel.quoteImages.p-1');
  assert.equal(renamedKey('mise-viewed:abc'), 'blumodel-viewed:abc');
  for (const k of ['blumodel-local-draft', 'mise', 'mise_session', 'misery', 'premise-x', 'Mise-local-draft', 'other']) assert.equal(renamedKey(k), null, k);
});

test('every old key moves to its new name, values intact, old keys removed', () => {
  const s = new Mem();
  const draft = JSON.stringify({ name: 'Gabe’s kitchen', items: [{ id: 'a', productId: 'base', x: 1, y: 2 }] });
  s.setItem('mise-local-draft', draft);
  s.setItem('mise-kitchen-v1', '{"state":{"ui":{"viewMode":"3d"}},"version":1}');
  s.setItem('mise.studio.prefs', '{"size":"1440"}');
  s.setItem('mise-generate-draft', '{"step":"space"}');
  s.setItem('unrelated', 'keep');
  assert.equal(migrateLegacyKeys(s), 4);
  assert.equal(s.getItem('blumodel-local-draft'), draft);
  assert.equal(s.getItem('blumodel-kitchen-v1'), '{"state":{"ui":{"viewMode":"3d"}},"version":1}');
  assert.equal(s.getItem('blumodel.studio.prefs'), '{"size":"1440"}');
  assert.equal(s.getItem('blumodel-generate-draft'), '{"step":"space"}');
  assert.equal(s.getItem('unrelated'), 'keep');
  assert.deepEqual([...s.m.keys()].filter((k) => k.startsWith('mise')), []);
  assert.equal(migrateLegacyKeys(s), 0, 'a second start has nothing to move');
});

test('a value already under the new key wins, and the stale old key is still removed', () => {
  const s = new Mem();
  s.setItem('blumodel-local-draft', 'new');
  s.setItem('mise-local-draft', 'old');
  assert.equal(migrateLegacyKeys(s), 1);
  assert.equal(s.getItem('blumodel-local-draft'), 'new');
  assert.equal(s.getItem('mise-local-draft'), null);
  // The new key is cleared later (the draft was saved into an account): the old one can't return.
  s.removeItem('blumodel-local-draft');
  migrateLegacyKeys(s);
  assert.equal(s.getItem('blumodel-local-draft'), null);
});

test('a copy that fails keeps the old key for the next start', () => {
  const s = new Mem();
  s.setItem('mise-local-draft', 'precious');
  s.failSet = true;
  assert.equal(migrateLegacyKeys(s), 0);
  assert.equal(s.getItem('mise-local-draft'), 'precious');
  s.failSet = false;
  assert.equal(migrateLegacyKeys(s), 1);
  assert.equal(s.getItem('blumodel-local-draft'), 'precious');
});

test('missing or throwing storage is a no-op, never an error', () => {
  assert.equal(migrateLegacyKeys(null), 0);
  assert.equal(migrateLegacyKeys(undefined), 0);
  const broken = new Mem();
  Object.defineProperty(broken, 'length', { get: () => { throw new Error('SecurityError'); } });
  assert.equal(migrateLegacyKeys(broken), 0);
});

test('on startup both storages move, and the editor reads the device kitchen from before the rename', async () => {
  const session = new Mem();
  session.setItem('mise.exportIntent', '{"projectId":"p1","kind":"csv"}');
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true, writable: true });
  localStorage.clear();
  const doc = { name: 'Device kitchen from Mise', room: { widthIn: 150, lengthIn: 130, ceilingIn: 96 }, items: [], version: 2 };
  localStorage.setItem('mise-local-draft', JSON.stringify(doc));
  localStorage.setItem('mise-kitchen-v1', JSON.stringify({ state: { ui: { viewMode: 'walls' } }, version: 1 }));

  assert.equal(migrateBrowserStorage(), 3);
  assert.equal(session.getItem('blumodel.exportIntent'), '{"projectId":"p1","kind":"csv"}');

  // Imported only now, as main.tsx imports it after boot.ts: the store reads the moved keys.
  const { loadLocalDraft, useDesignStore } = await import('../../store/useDesignStore');
  assert.equal(loadLocalDraft()?.name, 'Device kitchen from Mise');
  assert.equal(useDesignStore.getState().ui.viewMode, 'walls', 'the persisted editor state was read from blumodel-kitchen-v1');
  assert.equal(localStorage.getItem('mise-local-draft'), null);
});
