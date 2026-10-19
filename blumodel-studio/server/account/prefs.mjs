// A person's preferences (Account settings > Preferences and Email notifications), one JSON
// object per user in user_prefs. Every key is listed here with its default and its check; a key
// that isn't listed is refused, never stored.
//
//   theme          'system' | 'light' | 'dark'   Appearance; the browser also keeps it locally
//                                                so it applies before the first paint
//   showEstimator  boolean, default false        the editor's cost estimator (Est. chip,
//                                                Estimate tab, totals); contractor quotes and the
//                                                price book work either way
//   signInAlerts   boolean, default true         email me when a new browser signs in (only sent
//                                                when an email provider is configured)

import { HttpError } from '../http/respond.mjs';

export const THEMES = Object.freeze(['system', 'light', 'dark']);

export const DEFAULT_PREFS = Object.freeze({ theme: 'system', showEstimator: false, signInAlerts: true });

const CHECKS = {
  theme: (v) => THEMES.includes(v),
  showEstimator: (v) => typeof v === 'boolean',
  signInAlerts: (v) => typeof v === 'boolean',
};

const MESSAGES = {
  theme: 'Appearance is System, Light or Dark.',
  showEstimator: 'The cost estimator is on or off.',
  signInAlerts: 'Sign-in alerts are on or off.',
};

/** Only known keys with valid values survive (a stored object from an older version is cleaned). */
function clean(obj) {
  const out = { ...DEFAULT_PREFS };
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const k of Object.keys(CHECKS)) if (k in obj && CHECKS[k](obj[k])) out[k] = obj[k];
  }
  return out;
}

/**
 * Validates a PATCH body: an object with at least one known key, every value valid. Throws a 400
 * naming the field otherwise.
 * @param {unknown} body
 */
export function readPrefsPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send the preferences to change.');
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(400, 'Send the preferences to change.');
  if (keys.length > Object.keys(CHECKS).length) throw new HttpError(400, 'Too many preferences.');
  const patch = {};
  for (const k of keys) {
    if (!Object.hasOwn(CHECKS, k)) throw new HttpError(400, 'That isn’t a preference.', { field: k.slice(0, 40) });
    if (!CHECKS[k](body[k])) throw new HttpError(400, MESSAGES[k], { field: k });
    patch[k] = body[k];
  }
  return patch;
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createPrefsStore(db, now = Date.now) {
  return {
    /** `{ prefs, saved }`: `saved` is false while the person has never changed one (all defaults). */
    get(userId) {
      const row = db.prepare('SELECT prefs FROM user_prefs WHERE user_id = ?').get(userId);
      if (!row) return { prefs: { ...DEFAULT_PREFS }, saved: false };
      let parsed = null;
      try {
        parsed = JSON.parse(row.prefs);
      } catch {
        parsed = null;
      }
      return { prefs: clean(parsed), saved: true };
    },
    /** Merges a validated patch and returns the full preferences. */
    update(userId, patch) {
      const next = clean({ ...this.get(userId).prefs, ...patch });
      db.prepare(
        `INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
      ).run(userId, JSON.stringify(next), now());
      return next;
    },
  };
}
