// Admin > System > Updates: what the automatic update (scripts/host/update.mjs --auto) last did, read
// from the files it writes in the home, and the Update now trigger the server leaves for it
// (docs/HOSTING.md, "Automatic updates").
//
//   <home>/auto-update.conf          AUTO_UPDATE=on|off, AUTO_UPDATE_TIME=HH:MM (register-tasks)
//   <home>/logs/update-status.json   last check, last result, deployed commit, branch head
//   <home>/logs/update-now.request   the trigger: written here, deleted by the update that runs
//
// The home is BLUMODEL_HOME, else the folder the deployed app sits in (<home>/app/server/...), else
// none (a development server: the card says updates are not set up here). Nothing here starts an
// update, a process or a git command: the server only leaves the trigger file, which systemd's
// blumodel-update.path (Linux) or the BluModelStudioUpdateNow task (Windows) acts on. fs only; no
// secret is read (the status file holds commits, times and outcomes; its error text is redacted).

import fs from 'node:fs';
import path from 'node:path';
import { SERVER_DIR } from '../config.mjs';
import { redact } from './redact.mjs';

/** The home this server runs from, or null. */
export function serverHome({ env = process.env, serverDir = SERVER_DIR } = {}) {
  if (env.BLUMODEL_HOME) return path.resolve(env.BLUMODEL_HOME);
  const app = path.resolve(serverDir, '..');
  if (path.basename(app) === 'app' && fs.existsSync(path.join(app, 'DEPLOYED.txt'))) return path.dirname(app);
  return null;
}

const files = (home) => ({
  conf: path.join(home, 'auto-update.conf'),
  status: path.join(home, 'logs', 'update-status.json'),
  trigger: path.join(home, 'logs', 'update-now.request'),
  logs: path.join(home, 'logs'),
});

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

function readConf(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(get('AUTO_UPDATE_TIME')) ? get('AUTO_UPDATE_TIME') : '04:00';
  return { enabled: get('AUTO_UPDATE').toLowerCase() !== 'off', time };
}

const COMMIT = /^[0-9a-f]{7,40}$/;
const commit = (v) => (typeof v === 'string' && COMMIT.test(v) ? v : null);
const ms = (v) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? t : null;
};
const OUTCOMES = new Set(['current', 'updated', 'skipped', 'refused', 'busy', 'rolled-back', 'failed', 'down', 'error']);
const result = (r) =>
  r && typeof r === 'object'
    ? {
        outcome: OUTCOMES.has(r.outcome) ? r.outcome : 'error',
        at: ms(r.at),
        from: commit(r.from),
        to: commit(r.to),
        durationMs: Number.isFinite(r.durationMs) ? r.durationMs : null,
        error: r.error ? redact(String(r.error), 400) : null,
        by: r.by === 'update-now' ? 'update-now' : 'schedule',
      }
    : null;

/**
 * The Updates card's data. `available` is false on a server that isn't a deployed home.
 * @param {{ home?: string | null }} [o]
 */
export function updateStatus({ home = serverHome() } = {}) {
  if (!home) return { available: false, reason: 'not_a_home' };
  const F = files(home);
  const conf = readConf(F.conf);
  const s = readJson(F.status) ?? {};
  const last = result(s.result);
  return {
    available: true,
    installed: !!conf,
    enabled: !!conf?.enabled,
    time: conf?.time ?? '04:00',
    branch: typeof s.branch === 'string' && /^[\w./-]{1,100}$/.test(s.branch) ? s.branch : null,
    deployed: commit(s.deployed),
    head: commit(s.head),
    source: commit(s.source),
    lastCheckAt: ms(s.checkedAt),
    last,
    lastUpdate: result(s.lastUpdate),
    failed: s.failed && commit(s.failed.commit) ? { commit: s.failed.commit, at: ms(s.failed.at) } : null,
    rolledBack: !!last && ['rolled-back', 'down', 'failed'].includes(last.outcome),
    pending: fs.existsSync(F.trigger),
  };
}

/**
 * Leaves the Update now trigger. Throws `{ code }` when the home has no automatic update installed
 * (or it is turned off: nothing would pick the file up). Returns whether one was already waiting.
 * @param {{ home?: string | null, now?: () => number, by?: string }} [o]
 */
export function requestUpdate({ home = serverHome(), now = Date.now, by = '' } = {}) {
  if (!home) throw Object.assign(new Error('This server is not a deployed home, so there is nothing to update here.'), { code: 'not_a_home' });
  const F = files(home);
  const conf = readConf(F.conf);
  if (!conf) throw Object.assign(new Error('Automatic updates are not installed on this machine (register-tasks writes auto-update.conf). Update by hand: docs/HOSTING.md, "Update from GitHub".'), { code: 'not_installed' });
  if (!conf.enabled) throw Object.assign(new Error('Automatic updates are turned off on this machine, so nothing would pick the request up. Turn them on with register-tasks (without --no-auto-update), or update by hand.'), { code: 'auto_update_off' });
  const already = fs.existsSync(F.trigger);
  fs.mkdirSync(F.logs, { recursive: true });
  // Only a time and who asked: the update deletes the file when it starts.
  fs.writeFileSync(F.trigger, `${JSON.stringify({ at: new Date(now()).toISOString(), by: String(by).slice(0, 254) })}\n`, { mode: 0o640 });
  return { already };
}
