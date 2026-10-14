// The home server's private settings file: Stripe keys, PUBLIC_URL, ADMIN_EMAILS and the like,
// kept out of the repo and out of the generated supervisor script.
//
//   BLUMODEL_ENV_FILE=C:\Users\<you>\Projects\BluModelStudio\blumodel.env
//   (MISE_ENV_FILE is the deprecated name from before the rename, still read.)
//
// Format: one KEY=VALUE per line; blank lines and lines starting with # are skipped; an optional
// leading `export ` is allowed; a value may be wrapped in "double" or 'single' quotes (needed for
// a value with a space or a #). A value already in the environment wins over the file, so the
// supervisor's PORT, HOST and DB_PATH can't be moved by it.
//
// Values are secret. Nothing here logs, returns or puts in an error message a value, or the text
// of a line: only the file's path, line numbers and how many keys were set.

import fs from 'node:fs';

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Which variable names the settings file, and its path (null when neither is set). */
export function envFilePath(env = process.env) {
  const raw = String(env.BLUMODEL_ENV_FILE || env.MISE_ENV_FILE || '').trim();
  return raw ? raw.replace(/^"(.*)"$/, '$1') : null;
}

/**
 * Parses the text of a settings file into `{ KEY: value }`. Throws on a line that isn't KEY=VALUE,
 * naming only its line number.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const body = line.replace(/^export\s+/, '');
    const eq = body.indexOf('=');
    const key = eq > 0 ? body.slice(0, eq).trim() : '';
    if (!KEY.test(key)) throw new Error(`Settings file line ${i + 1} isn't KEY=VALUE.`);
    let value = body.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    else if (q === '"' || q === "'") throw new Error(`Settings file line ${i + 1} opens a quote it doesn't close.`);
    else value = value.replace(/\s+#.*$/, '');
    out[key] = value;
  });
  return out;
}

/**
 * Loads the settings file named by BLUMODEL_ENV_FILE (or MISE_ENV_FILE) into `env`, without
 * replacing a variable that is already set. Returns `{ path, set, total }`, or null when no file
 * is named. A named file that is missing or unreadable is an error: starting without it would
 * start the public server without its payment keys.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadEnvFile(env = process.env) {
  const file = envFilePath(env);
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Can't read the settings file ${file} (${err.code || 'error'}). Fix BLUMODEL_ENV_FILE or create the file.`);
  }
  const values = parseEnvFile(text);
  let set = 0;
  for (const [k, v] of Object.entries(values)) {
    if (env[k] === undefined || env[k] === '') {
      env[k] = v;
      set++;
    }
  }
  return { path: file, set, total: Object.keys(values).length };
}
