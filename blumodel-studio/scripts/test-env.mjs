// Preloaded by scripts/test.mjs: the minimum browser surface src/ modules touch when
// imported under Node. Deliberately no DOM: code that needs one belongs in a headless
// browser check, not a unit test.
class MemoryStorage {
  #m = new Map();
  get length() { return this.#m.size; }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(String(k), String(v)); }
  removeItem(k) { this.#m.delete(k); }
  clear() { this.#m.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
  globalThis.location = { search: '', hash: '', href: 'http://localhost/' };
}
