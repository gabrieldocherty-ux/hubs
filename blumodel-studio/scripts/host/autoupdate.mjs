// Automatic updates (docs/HOSTING.md, "Automatic updates"): what `node scripts/host/update.mjs --auto`
// decides and records. It is run unattended, once a day at AUTO_UPDATE_TIME (04:00 by default) by
// blumodel-update.timer on Linux or the BluModelStudioUpdate task on Windows, and right away when
// Admin > System > Update now leaves the trigger file (blumodel-update.path on Linux; the
// BluModelStudioUpdateNow task's two-minute no-op check on Windows).
//
// One run:
//   1. --trigger-only (the Windows check): nothing at all unless logs/update-now.request exists
//   2. the lock (logs/update.lock, made with an exclusive create): another run holds it -> 'busy';
//      a lock older than LOCK_STALE_MS (its run died) is cleared and logged
//   3. a deploy in progress (<home>/deploying, written by deploy-local, younger than
//      LOCK_STALE_MS) -> 'busy'
//   4. the trigger file is consumed (deleted) now, so it can't fire twice
//   5. git fetch of the branch; the checkout must be clean; the deployed commit (app/DEPLOYED.txt),
//      the checkout's HEAD and origin/<branch> are compared:
//        deployed == origin/<branch>                     -> 'current' (one short log line)
//        origin/<branch> is the commit that failed last  -> 'skipped' (until the branch moves on,
//                                                           or Update now asks for it again)
//        HEAD is not an ancestor of origin/<branch>      -> 'refused' (force-pushed: never reset)
//        otherwise git merge --ff-only, then the update itself (update.mjs --no-pull, the NEW copy
//        of the script) -> 'updated', or 'rolled-back' / 'failed' / 'down' (the commit is
//        remembered as failed)
//   6. one JSON line in logs/update.log (rotated at LOG_MAX_BYTES, LOG_KEEP kept) and
//      logs/update-status.json for Admin > System; the lock is released
//
// Files, all in <home>/logs (the server may write there, so its trigger file can go there too):
//   update.log            {"at","from","to","outcome","durationMs","error","by"} one per line
//   update-status.json    { checkedAt, branch, deployed, head, source, result, failed, schedule }
//   update-state.json     { failedCommit, failedAt } the commit not to retry
//   update.lock           { pid, at } while a run is going
//   update-now.request    the trigger, written by the server (Admin > System > Update now)
// and <home>/auto-update.conf (AUTO_UPDATE=on|off, AUTO_UPDATE_TIME=HH:MM), written by
// register-tasks when it installs the schedule. Nothing here reads blumodel.env.
//
// Pure decisions (decide) plus file helpers that take the home's layout, so the tests can drive a
// whole run with a fake git and a temp home (server/test/autoupdate.test.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { pathFor } from '../../server/ops/home.mjs';

export const LOCK_STALE_MS = 2 * 3_600_000;
export const LOG_MAX_BYTES = 1024 * 1024;
export const LOG_KEEP = 3;
export const DEFAULT_TIME = '04:00';
export const OUTCOMES = Object.freeze(['current', 'updated', 'skipped', 'refused', 'busy', 'rolled-back', 'failed', 'down', 'error']);

/** Every file auto-update uses in a home, with `platform`'s separators. */
export function updateFiles(home, platform = process.platform) {
  const p = pathFor(platform);
  const h = p.resolve(home);
  const logs = p.join(h, 'logs');
  return {
    home: h,
    logs,
    log: p.join(logs, 'update.log'),
    status: p.join(logs, 'update-status.json'),
    state: p.join(logs, 'update-state.json'),
    lock: p.join(logs, 'update.lock'),
    trigger: p.join(logs, 'update-now.request'),
    conf: p.join(h, 'auto-update.conf'),
    deploying: p.join(h, 'deploying'),
    deployed: p.join(h, 'app', 'DEPLOYED.txt'),
  };
}

/** 'HH:MM' (24 hour) or null. */
export function parseTime(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** <home>/auto-update.conf's text. */
export const confText = ({ enabled = true, time = DEFAULT_TIME } = {}) =>
  `# Written by scripts/register-tasks.mjs (docs/HOSTING.md, "Automatic updates"). Not secret.\n# Change it by running register-tasks again (--auto-update-time HH:MM, --no-auto-update).\nAUTO_UPDATE=${enabled ? 'on' : 'off'}\nAUTO_UPDATE_TIME=${parseTime(time) ?? DEFAULT_TIME}\n`;

/** `{ enabled, time, installed }` from auto-update.conf; installed is false when there is none. */
export function readConf(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { enabled: false, time: DEFAULT_TIME, installed: false };
  }
  const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  return { enabled: get('AUTO_UPDATE').toLowerCase() !== 'off', time: parseTime(get('AUTO_UPDATE_TIME')) ?? DEFAULT_TIME, installed: true };
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
/** Written whole to a temp file and renamed over, so a reader never sees half of it. */
const writeJson = (file, value) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(tmp, file);
};

export const readStatus = (F) => readJson(F.status);
export const readState = (F) => readJson(F.state) ?? { failedCommit: null, failedAt: null };
export const writeState = (F, s) => writeJson(F.state, s);
export const writeStatus = (F, s) => writeJson(F.status, s);

/** Do two commit ids name the same commit (one may be the short form of the other)? */
export const sameCommit = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/**
 * The lock. `{ ok: true, token }` when this run holds it now; `{ ok: false, holder }` when another
 * live run does. A lock older than `staleMs` is cleared (`cleared: true`).
 */
export function acquireLock(F, { now = Date.now(), staleMs = LOCK_STALE_MS, pid = process.pid } = {}) {
  fs.mkdirSync(F.logs, { recursive: true });
  let cleared = false;
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(F.lock, 'wx', 0o644);
      fs.writeSync(fd, JSON.stringify({ pid, at: new Date(now).toISOString() }));
      fs.closeSync(fd);
      return { ok: true, token: `${pid}`, cleared };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
    }
    const holder = readJson(F.lock);
    let at = Date.parse(holder?.at ?? '');
    if (!Number.isFinite(at)) {
      try {
        at = fs.statSync(F.lock).mtimeMs;
      } catch {
        continue; // gone in between: try again
      }
    }
    if (now - at < staleMs) return { ok: false, holder, cleared };
    fs.rmSync(F.lock, { force: true });
    cleared = true;
  }
  return { ok: false, holder: readJson(F.lock), cleared };
}

export const releaseLock = (F) => fs.rmSync(F.lock, { force: true });

/** Is a deploy in progress (its marker, younger than `staleMs`)? */
export function deployInProgress(F, { now = Date.now(), staleMs = LOCK_STALE_MS } = {}) {
  try {
    return now - fs.statSync(F.deploying).mtimeMs < staleMs;
  } catch {
    return false;
  }
}

/** Appends one JSON line to update.log, first rotating it (update.log.1 .. .LOG_KEEP) when it is big. */
export function appendLog(F, entry, { maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP } = {}) {
  fs.mkdirSync(F.logs, { recursive: true });
  let size = 0;
  try {
    size = fs.statSync(F.log).size;
  } catch {
    size = 0;
  }
  if (size >= maxBytes) {
    fs.rmSync(`${F.log}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) if (fs.existsSync(`${F.log}.${i}`)) fs.renameSync(`${F.log}.${i}`, `${F.log}.${i + 1}`);
    fs.renameSync(F.log, `${F.log}.1`);
  }
  fs.appendFileSync(F.log, `${JSON.stringify(entry)}\n`, { mode: 0o644 });
}

/**
 * What to do, from what the run found. Pure.
 * @param {{ deployed: string | null, local: string | null, head: string | null, failedCommit?: string | null,
 *   requested?: boolean, fastForward: boolean }} s
 * @returns {{ action: 'none' | 'update', outcome: string, reason: string }}
 */
export function decide({ deployed, local, head, failedCommit = null, requested = false, fastForward }) {
  if (!head) return { action: 'none', outcome: 'error', reason: 'could not read the branch head' };
  if (sameCommit(deployed, head) && sameCommit(local, head)) return { action: 'none', outcome: 'current', reason: `commit ${head.slice(0, 7)} is deployed` };
  if (!fastForward) return { action: 'none', outcome: 'refused', reason: `the branch is not a fast-forward of the checkout (${(local ?? '?').slice(0, 7)} is not an ancestor of ${head.slice(0, 7)}): it was force-pushed or rewritten. Nothing was reset; push a commit on top of the old one, or fix the checkout by hand` };
  if (sameCommit(deployed, head)) return { action: 'update', outcome: 'updated', reason: 'the checkout is behind a commit that is already deployed: fast-forward only' };
  if (failedCommit && sameCommit(failedCommit, head) && !requested) return { action: 'none', outcome: 'skipped', reason: `commit ${head.slice(0, 7)} failed before and is not retried until the branch moves on (or Update now is pressed)` };
  return { action: 'update', outcome: 'updated', reason: `commit ${head.slice(0, 7)} is new (deployed: ${deployed ? deployed.slice(0, 7) : 'none'})` };
}

/** update.mjs's exit code -> the outcome recorded. */
export function outcomeOfExit(code) {
  if (code === 0) return 'updated';
  if (code === 4) return 'rolled-back';
  if (code === 3) return 'down';
  return 'failed';
}

/** The DEPLOYED.txt commit, or null. */
export function deployedCommit(F) {
  try {
    return /^commit (\S+)/m.exec(fs.readFileSync(F.deployed, 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The release's own record of what it was built from (RELEASE.json in the checkout), or null. */
export function releaseInfo(root) {
  return readJson(path.join(root, 'RELEASE.json'));
}

/**
 * One automatic run. Everything outside is injected:
 *   git(args) -> { status, stdout }      git -C <checkout> ..., as the checkout's owner
 *   update() -> exit code                 runs the update itself (update.mjs --no-pull, the new copy)
 *   out(line)                             journald / console
 * @param {{ home: string, root: string, branch: string, platform?: string, triggerOnly?: boolean,
 *   now?: () => number, git: (args: string[]) => { status: number, stdout: string }, update: () => number,
 *   out?: (s: string) => void, staleMs?: number }} o
 * @returns {{ outcome: string, code: number, entry?: any }}
 */
export function runAuto({ home, root, branch, platform = process.platform, triggerOnly = false, now = Date.now, git, update, out = console.log, staleMs = LOCK_STALE_MS }) {
  const F = updateFiles(home, platform);
  const requested = fs.existsSync(F.trigger);
  if (triggerOnly && !requested) return { outcome: 'idle', code: 0 };
  const started = now();
  const by = requested ? 'update-now' : 'schedule';
  const conf = readConf(F.conf);
  const finish = (entry, { status: extra = {} } = {}) => {
    const full = { at: new Date(started).toISOString(), from: null, to: null, error: null, ...entry, durationMs: Math.max(0, now() - started), by };
    try {
      appendLog(F, full);
    } catch (err) {
      out(`blumodel-update: could not write ${F.log}: ${err?.message ?? err}`);
    }
    const prev = readStatus(F) ?? {};
    const state = readState(F);
    const status = {
      checkedAt: full.at,
      branch,
      deployed: deployedCommit(F),
      head: extra.head ?? prev.head ?? null,
      source: releaseInfo(root)?.source ?? null,
      // A busy run (another one holds the lock) doesn't hide the result of the one that does.
      result: full.outcome === 'busy' && prev.result ? prev.result : full,
      lastUpdate: full.outcome === 'updated' ? full : (prev.lastUpdate ?? null),
      failed: state.failedCommit ? { commit: state.failedCommit, at: state.failedAt } : null,
      schedule: { enabled: conf.enabled, time: conf.time, installed: conf.installed },
    };
    try {
      writeStatus(F, status);
    } catch (err) {
      out(`blumodel-update: could not write ${F.status}: ${err?.message ?? err}`);
    }
    out(`blumodel-update: ${full.outcome}${full.to ? ` ${String(full.to).slice(0, 7)}` : ''}${full.error ? `: ${full.error}` : ''} (${Math.round(full.durationMs / 100) / 10} s, ${by})`);
    return full;
  };

  const lock = acquireLock(F, { now: started, staleMs });
  if (lock.cleared) out(`blumodel-update: cleared a stale lock (${F.lock}) left by a run that did not finish`);
  if (!lock.ok) {
    // The trigger stays for the next tick; nothing is recorded as a result beyond the log line.
    const entry = finish({ outcome: 'busy', error: `another update is running (pid ${lock.holder?.pid ?? '?'} since ${lock.holder?.at ?? '?'})` });
    return { outcome: 'busy', code: 0, entry };
  }
  try {
    if (deployInProgress(F, { now: started, staleMs })) {
      const entry = finish({ outcome: 'busy', error: 'a deploy is in progress (the deploying marker exists): not starting another' });
      return { outcome: 'busy', code: 0, entry };
    }
    if (requested) fs.rmSync(F.trigger, { force: true });

    const dirty = git(['status', '--porcelain', '--untracked-files=no']);
    if (dirty.status !== 0) return { outcome: 'error', code: 1, entry: finish({ outcome: 'error', error: `git status failed (exit ${dirty.status})` }) };
    if (String(dirty.stdout || '').trim()) return { outcome: 'refused', code: 1, entry: finish({ outcome: 'refused', error: 'the checkout has local changes to tracked files: undo them (git checkout -- .); nothing was changed' }) };

    const fetch = git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    if (fetch.status !== 0) return { outcome: 'error', code: 1, entry: finish({ outcome: 'error', error: `git fetch failed (exit ${fetch.status}): GitHub unreachable or the branch is gone; the site keeps running` }) };
    const rev = (ref) => {
      const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return r.status === 0 ? String(r.stdout || '').trim() || null : null;
    };
    const head = rev(`refs/remotes/origin/${branch}`);
    const local = rev('HEAD');
    const deployed = deployedCommit(F);
    const fastForward = !!local && !!head && (local === head || git(['merge-base', '--is-ancestor', local, head]).status === 0);
    const state = readState(F);
    const d = decide({ deployed, local, head, failedCommit: state.failedCommit, requested, fastForward });
    const base = { from: deployed, to: head };
    if (d.action === 'none') {
      return { outcome: d.outcome, code: d.outcome === 'refused' || d.outcome === 'error' ? 1 : 0, entry: finish({ ...base, outcome: d.outcome, error: d.outcome === 'current' ? null : d.reason }, { status: { head } }) };
    }
    out(`blumodel-update: ${d.reason}: updating`);
    if (local !== head) {
      const m = git(['merge', '--ff-only', '--quiet', head]);
      if (m.status !== 0) return { outcome: 'refused', code: 1, entry: finish({ ...base, outcome: 'refused', error: `git merge --ff-only failed (exit ${m.status}); nothing was changed` }, { status: { head } }) };
    }
    const code = update();
    const outcome = outcomeOfExit(code);
    const nowDeployed = deployedCommit(F);
    if (outcome === 'updated' && sameCommit(nowDeployed, head)) {
      if (state.failedCommit) writeState(F, { failedCommit: null, failedAt: null });
      return { outcome, code: 0, entry: finish({ ...base, outcome }, { status: { head } }) };
    }
    writeState(F, { failedCommit: head, failedAt: new Date(now()).toISOString() });
    const why = { 'rolled-back': 'the new version failed its health check and the previous one is running again', down: 'the new version failed its health check AND the rollback failed: the site may be down', failed: `the update stopped before the new version went in (exit ${code}); the site runs the version it had` }[outcome === 'updated' ? 'failed' : outcome];
    return { outcome: outcome === 'updated' ? 'failed' : outcome, code: outcome === 'down' ? 3 : 1, entry: finish({ ...base, outcome: outcome === 'updated' ? 'failed' : outcome, error: why }, { status: { head } }) };
  } catch (err) {
    return { outcome: 'error', code: 1, entry: finish({ outcome: 'error', error: String(err?.message ?? err).slice(0, 500) }) };
  } finally {
    releaseLock(F);
  }
}
