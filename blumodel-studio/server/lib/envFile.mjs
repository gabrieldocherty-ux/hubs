// The home server's private settings file: Stripe keys, PUBLIC_URL, ADMIN_EMAILS and the like,
// kept out of the repo and out of the generated supervisor script.
//
// Which file:
//   1. BLUMODEL_ENV_FILE=C:\Users\<you>\Projects\BluModelStudio\blumodel.env
//   2. MISE_ENV_FILE (the deprecated name from before the rename, still read)
//   3. otherwise, when the server runs from a deployed home (<home>\app\server\index.mjs),
//      <home>\blumodel.env if it exists, else <home>\mise.env (the old name) if that exists.
//      A checkout (the repo, the QA runner, the tests) has no default file.
//
// Format: one KEY=VALUE per line; blank lines and lines starting with # are skipped; an optional
// leading `export ` is allowed; a value may be wrapped in "double" or 'single' quotes (needed for
// a value with a space or a #); CRLF line ends and a UTF-8 BOM are fine. A line that isn't
// KEY=VALUE is skipped and reported by its line number. Only the keys in ENV_FILE_KEYS are used;
// any other key is ignored (reported by line number, never by name: a pasted secret can look like
// a key). A value already in the environment wins over the file, so the supervisor's PORT, HOST
// and DB_PATH can't be moved by it (they aren't settings-file keys anyway).
//
// Values are secret. Nothing here logs, returns or puts in an error message a value, a key that
// was ignored, or the text of a line: only the file's path, line numbers and counts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/ of this install (server/lib/..). */
export const DEFAULT_SERVER_DIR = path.resolve(HERE, '..');

/** The keys a settings file may set. Everything else in the file is ignored. */
export const ENV_FILE_KEYS = Object.freeze([
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ADMIN_EMAILS',
  'PUBLIC_URL',
  'DEMO_PAYMENTS',
  'TRUST_PROXY',
  'ANTHROPIC_API_KEY',
  'BLUMODEL_LLM_MODEL',
  'LEGAL_NAME',
  'SUPPORT_EMAIL',
  'LEGAL_JURISDICTION',
]);
const ALLOWED = new Set(ENV_FILE_KEYS);

/**
 * The deployed home this server runs from: the folder holding `app\` when the server is at
 * `<home>\app\server`. Null for a checkout.
 * @param {string} [serverDir]
 */
export function deployedHome(serverDir = DEFAULT_SERVER_DIR) {
  const appDir = path.resolve(serverDir, '..');
  return path.basename(appDir).toLowerCase() === 'app' ? path.dirname(appDir) : null;
}

/**
 * Which settings file applies, and how it was chosen: `{ file, source }` with source
 * 'BLUMODEL_ENV_FILE' | 'MISE_ENV_FILE' | 'default' | 'default-legacy', or null when there is none.
 * Only checks whether files exist; never opens one.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ serverDir?: string }} [opts]
 */
export function resolveEnvFile(env = process.env, { serverDir = DEFAULT_SERVER_DIR } = {}) {
  const clean = (v) => String(v ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (clean(env.BLUMODEL_ENV_FILE)) return { file: clean(env.BLUMODEL_ENV_FILE), source: 'BLUMODEL_ENV_FILE' };
  if (clean(env.MISE_ENV_FILE)) return { file: clean(env.MISE_ENV_FILE), source: 'MISE_ENV_FILE' };
  const home = deployedHome(serverDir);
  if (!home) return null;
  const current = path.join(home, 'blumodel.env');
  if (fs.existsSync(current)) return { file: current, source: 'default' };
  const legacy = path.join(home, 'mise.env');
  if (fs.existsSync(legacy)) return { file: legacy, source: 'default-legacy' };
  return null;
}

/** The settings file's path, or null (kept for callers that only need the name). */
export function envFilePath(env = process.env, opts) {
  return resolveEnvFile(env, opts)?.file ?? null;
}

/**
 * Parses the text of a settings file. Never throws on content: a line that isn't KEY=VALUE (or
 * opens a quote it doesn't close) is skipped and its number listed in `malformed`.
 * @param {string} text
 * @returns {{ values: Record<string, string>, malformed: number[] }}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {number[]} */
  const malformed = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const body = line.replace(/^export\s+/, '');
    const eq = body.indexOf('=');
    const key = eq > 0 ? body.slice(0, eq).trim() : '';
    if (!KEY.test(key)) {
      malformed.push(i + 1);
      return;
    }
    let value = body.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    else if (q === '"' || q === "'") {
      malformed.push(i + 1);
      return;
    } else value = value.replace(/\s+#.*$/, '');
    values[key] = value;
  });
  return { values, malformed };
}

/** Line numbers of the keys a settings file sets that aren't settings-file keys. */
function ignoredLines(text) {
  const out = [];
  String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim().replace(/^export\s+/, '');
      const eq = line.indexOf('=');
      const key = eq > 0 ? line.slice(0, eq).trim() : '';
      if (!line.startsWith('#') && KEY.test(key) && !ALLOWED.has(key)) out.push(i + 1);
    });
  return out;
}

/**
 * Loads the settings file (see the top of this file) into `env`, without replacing a variable
 * that is already set. Returns `{ path, source, set, total, malformed, ignored }` (line numbers,
 * never text), or null when there is no settings file. A file named by BLUMODEL_ENV_FILE or
 * MISE_ENV_FILE that is missing or unreadable is an error: starting without it would start the
 * public server without its payment keys.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ serverDir?: string, file?: string }} [opts]  `file` names the file outright (stripe-check --settings)
 */
export function loadEnvFile(env = process.env, { serverDir = DEFAULT_SERVER_DIR, file: named } = {}) {
  const chosen = named ? { file: named, source: 'argument' } : resolveEnvFile(env, { serverDir });
  if (!chosen) return null;
  let text;
  try {
    text = fs.readFileSync(chosen.file, 'utf8');
  } catch (err) {
    throw new Error(`Can't read the settings file ${chosen.file} (${err?.code || 'error'}). Fix BLUMODEL_ENV_FILE or create the file.`);
  }
  const { values, malformed } = parseEnvFile(text);
  const ignored = ignoredLines(text);
  let set = 0;
  let total = 0;
  for (const [k, v] of Object.entries(values)) {
    if (!ALLOWED.has(k)) continue;
    total++;
    if (env[k] === undefined || env[k] === '') {
      env[k] = v;
      set++;
    }
  }
  text = '';
  return { path: chosen.file, source: chosen.source, set, total, malformed, ignored };
}

/**
 * The log lines for a loaded settings file: what was read and anything to fix. Paths, counts
 * and line numbers only.
 * @param {ReturnType<typeof loadEnvFile>} info
 * @returns {{ info: string[], warn: string[] }}
 */
export function describeEnvFile(info) {
  if (!info) return { info: [], warn: [] };
  const lines = { info: [`Read ${info.total} settings from ${info.path} (${info.set} applied; the environment wins over the file).`], warn: [] };
  if (info.source === 'MISE_ENV_FILE') lines.warn.push('MISE_ENV_FILE is deprecated: name the settings file in BLUMODEL_ENV_FILE instead.');
  if (info.source === 'default-legacy') lines.warn.push(`Using ${info.path}, the settings file's name from before the rename. Rename it to blumodel.env.`);
  const where = (list) => `${list.length === 1 ? 'line' : 'lines'} ${list.join(', ')}`;
  if (info.malformed.length) lines.warn.push(`Settings file: skipped ${where(info.malformed)}: not KEY=VALUE (or a quote that isn't closed).`);
  if (info.ignored.length) lines.warn.push(`Settings file: ignored ${where(info.ignored)}: not a key the settings file can set (${ENV_FILE_KEYS.join(', ')}).`);
  return lines;
}
