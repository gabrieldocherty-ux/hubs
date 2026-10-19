/**
 * Browser storage written before the product was renamed from Mise to BluModel Studio.
 *
 * Every localStorage / sessionStorage key the app owns now starts with `blumodel.` or `blumodel-`
 * where it used to start with `mise.` or `mise-` (the device-only kitchen `blumodel-local-draft`,
 * the editor's `blumodel-kitchen-v1`, the photo draft, studio preferences…). On startup each old
 * key is moved to its new name once: its value is copied unless the new key already has one, and
 * then the old key is removed, so a later clear of the new key can't bring a stale value back.
 * A copy that fails (storage full or blocked) keeps the old key for the next start.
 *
 * `src/boot.ts` runs this before any module reads storage.
 */

const LEGACY = /^mise([.-])/;

/** The current name for a key written before the rename, or null if it isn't one. */
export function renamedKey(key: string): string | null {
  return LEGACY.test(key) ? key.replace(LEGACY, 'blumodel$1') : null;
}

/** Moves every legacy key in `storage` to its new name. Returns how many moved. Never throws. */
export function migrateLegacyKeys(storage: Storage | null | undefined): number {
  if (!storage) return 0;
  let keys: string[];
  try {
    keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && renamedKey(k)) keys.push(k);
    }
  } catch {
    return 0;
  }
  let moved = 0;
  for (const old of keys) {
    const next = renamedKey(old)!;
    try {
      const value = storage.getItem(old);
      if (value === null) continue;
      if (storage.getItem(next) === null) storage.setItem(next, value);
      storage.removeItem(old);
      moved++;
    } catch {
      // Full or blocked: the old key stays and is tried again next time.
    }
  }
  return moved;
}

/** Both storages of this page (either can be missing or throw on access, e.g. blocked cookies). */
export function migrateBrowserStorage(): number {
  let moved = 0;
  for (const get of [() => globalThis.localStorage, () => globalThis.sessionStorage]) {
    let storage: Storage | undefined;
    try {
      storage = get();
    } catch {
      storage = undefined;
    }
    moved += migrateLegacyKeys(storage);
  }
  return moved;
}
