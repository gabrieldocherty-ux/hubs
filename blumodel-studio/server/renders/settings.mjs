// The render service's address and key, set in Admin > System > Render service (so Gabe can paste
// them from a phone instead of editing blumodel.env on the server).
//
//   - blumodel.env wins: with ARCHITECT_AI_URL and ARCHITECT_AI_KEY both set there, the panel shows
//     that and can't change it. RENDER_PROVIDER=off or demo still means what it says.
//   - The key is stored encrypted (AES-256-GCM) in render_settings (renders-003). The 32-byte
//     encryption key is a file next to the database, render-settings.key, made on the first save:
//     a copy of the database alone (an export, a backup copied somewhere) doesn't give the key away.
//     Lose that file (a move to a new machine without it) and the saved key can't be read: the
//     panel says so and asks for it again. Nothing breaks.
//   - Only the last four characters ever leave the server. The key is never logged, audited or
//     put in an error.
//   - Renders pick a saved change up on the next render: no restart (current() is cheap, cached
//     on the row's updated_at).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MYARCHITECTAI_URL, createArchitectProvider, createDemoProvider } from './providers.mjs';

export const KEY_FILE = 'render-settings.key';
const KEY_MIN = 8;
const KEY_MAX = 512;
const URL_MAX = 500;

/** Where the encryption key lives for this database, or null (an in-memory database). */
export const keyFileFor = (dbPath) => (!dbPath || dbPath === ':memory:' ? null : path.join(path.dirname(path.resolve(dbPath)), KEY_FILE));

/** What's wrong with `url` as the render service's address, or null. Same rules as blumodel.env's. */
export function urlProblem(url, { prod }) {
  if (typeof url !== 'string' || !url.trim()) return 'Give the render service’s address.';
  const u = url.trim();
  if (u.length > URL_MAX || !/^https?:\/\/[^\s]+$/i.test(u)) return 'The address must start with https:// and have no spaces.';
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return 'That isn’t a web address.';
  }
  if (parsed.username || parsed.password) return 'Put the key in the key box, not in the address.';
  if (prod && parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase())) {
    return 'The address must start with https://, so the key never crosses the internet unencrypted.';
  }
  return null;
}

/** What's wrong with `key`, or null. It goes in a header, so no spaces or line breaks. */
export function keyProblem(key) {
  if (typeof key !== 'string' || !key.trim()) return 'Paste the key.';
  const k = key.trim();
  if (k.length < KEY_MIN || k.length > KEY_MAX) return `A key is ${KEY_MIN} to ${KEY_MAX} characters.`;
  if (!/^[\x21-\x7e]+$/.test(k)) return 'The key has a space, a line break or a character a key can’t have. Copy it again.';
  return null;
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, config: any, now: () => number, keyFile?: string | null,
 *   fetch: typeof fetch, log?: any }} deps
 */
export function createRenderSettings({ db, config, now, keyFile = keyFileFor(config.DB_PATH), fetch, log }) {
  // An in-memory database (tests) keeps its encryption key in memory too.
  let memKey = null;
  const envReady = !!(config.ARCHITECT_AI_URL && config.ARCHITECT_AI_KEY);

  function secret({ create }) {
    if (!keyFile) return (memKey ??= crypto.randomBytes(32));
    try {
      const b = fs.readFileSync(keyFile);
      if (b.length === 32) return b;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
    if (!create) return null;
    const b = crypto.randomBytes(32);
    // 'wx': never overwrite one that appeared meanwhile (that would orphan the saved key).
    try {
      fs.writeFileSync(keyFile, b, { flag: 'wx', mode: 0o600 });
      return b;
    } catch (err) {
      if (err?.code === 'EEXIST') return secret({ create: false });
      throw err;
    }
  }

  const seal = (plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', secret({ create: true }), iv);
    c.setAAD(Buffer.from('render_settings.key'));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${c.getAuthTag().toString('base64')}`;
  };
  /** The key, or null when it can't be read (no key file, or a different one). */
  const open = (sealed) => {
    const [v, iv, ct, tag] = String(sealed).split('.');
    const k = secret({ create: false });
    if (v !== 'v1' || !k) return null;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
      d.setAAD(Buffer.from('render_settings.key'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  };

  const row = () => db.prepare('SELECT url, key_sealed, key_last4, updated_at, updated_by FROM render_settings WHERE id = 1').get() ?? null;

  let cache = { at: -1, provider: null };
  let envP = null;
  let demoP = null;

  return {
    /** True when blumodel.env sets the service (the panel can't change it). */
    get fromEnv() {
      return envReady;
    },

    /** What the panel shows: never the key, only its last four characters. */
    view() {
      const r = row();
      const readable = !!(r && open(r.key_sealed) !== null);
      const p = this.current();
      return {
        source: envReady ? 'env' : r ? 'admin' : null,
        url: envReady ? config.ARCHITECT_AI_URL : r?.url ?? null,
        keyLast4: envReady ? config.ARCHITECT_AI_KEY.slice(-4) : r?.key_last4 ?? null,
        keyUnreadable: !envReady && !!r && !readable,
        updatedAt: envReady ? null : r?.updated_at ?? null,
        updatedBy: envReady ? null : r?.updated_by ?? null,
        defaultUrl: MYARCHITECTAI_URL,
        provider: p?.id ?? null,
        forced: config.RENDER_PROVIDER === 'off' || config.RENDER_PROVIDER === 'demo' ? config.RENDER_PROVIDER : null,
      };
    },

    /** Saves the address and key (the key may be left out to keep the saved one). Throws { field, message }. */
    save({ url: given, key, by }) {
      // Left empty: MyArchitectAI's own address.
      const url = typeof given === 'string' && given.trim() ? given : MYARCHITECTAI_URL;
      if (envReady) throw Object.assign(new Error('The render service is set in blumodel.env on the server. Change it there.'), { field: 'url' });
      const up = urlProblem(url, { prod: config.PROD });
      if (up) throw Object.assign(new Error(up), { field: 'url' });
      const r = row();
      const keepKey = (key === undefined || key === null || key === '') && r && open(r.key_sealed) !== null;
      if (!keepKey) {
        const kp = keyProblem(key);
        if (kp) throw Object.assign(new Error(kp), { field: 'key' });
      }
      const k = keepKey ? null : String(key).trim();
      const sealed = keepKey ? r.key_sealed : seal(k);
      const last4 = keepKey ? r.key_last4 : k.slice(-4);
      db.prepare(
        `INSERT INTO render_settings (id, url, key_sealed, key_last4, updated_at, updated_by) VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET url = excluded.url, key_sealed = excluded.key_sealed, key_last4 = excluded.key_last4,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).run(url.trim(), sealed, last4, now(), by ?? null);
      log?.info?.(`renders: the render service was ${r ? 'changed' : 'set'} in Admin > System by ${by ?? 'an admin'}`);
      return { keyChanged: !keepKey, urlChanged: !r || r.url !== url.trim() };
    },

    /** Forgets the saved address and key. */
    clear({ by }) {
      if (envReady) throw Object.assign(new Error('The render service is set in blumodel.env on the server. Change it there.'), { field: 'url' });
      const n = db.prepare('DELETE FROM render_settings WHERE id = 1').run().changes;
      if (n) log?.info?.(`renders: the render service was removed in Admin > System by ${by ?? 'an admin'}`);
      return n > 0;
    },

    /**
     * The provider renders use right now, or null when renders aren't set up:
     * RENDER_PROVIDER=off: none; blumodel.env's service; else the panel's (unless RENDER_PROVIDER=demo);
     * else what the config picked (the demo provider outside production, or none).
     */
    current() {
      if (config.RENDER_PROVIDER === 'off') return null;
      if (envReady || config.RENDER_PROVIDER === 'demo') return config.rendersProvider === 'architect' ? envProvider() : config.rendersProvider === 'demo' ? demo() : null;
      const r = row();
      const at = r ? r.updated_at : 0;
      if (cache.at === at) return cache.provider;
      const key = r ? open(r.key_sealed) : null;
      const provider =
        r && key !== null
          ? createArchitectProvider({ url: r.url, key, fetch, timeoutMs: config.RENDER_TIMEOUT_MS, log })
          : config.rendersProvider === 'demo'
            ? demo()
            : null;
      cache = { at, provider };
      return provider;
    },
  };

  function envProvider() {
    return (envP ??= createArchitectProvider({ url: config.ARCHITECT_AI_URL, key: config.ARCHITECT_AI_KEY, fetch, timeoutMs: config.RENDER_TIMEOUT_MS, log }));
  }
  function demo() {
    return (demoP ??= createDemoProvider());
  }
}
