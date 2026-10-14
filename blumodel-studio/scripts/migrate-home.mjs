// Moves the home server's folder from before the rename (%USERPROFILE%\Projects\Mise) to
// %USERPROFILE%\Projects\BluModelStudio, or merges it into that folder if it already exists.
//
//   node scripts/migrate-home.mjs --dry-run      # say what it would do; change nothing
//   node scripts/migrate-home.mjs                # do it
//   options: --from <old home>  --to <new home>  --port 8790 (repeatable: every port a server of
//            either home may listen on)
//
// What it does, in order (each step is skipped when already done, so running it twice is safe):
//   1. Refuses, changing nothing, while a server listens on the port or any process runs from
//      either folder (a cloudflared tunnel running from the new folder is fine), or when both
//      folders hold a database (data\mise.db and data\blumodel.db) or both hold a settings file
//      (mise.env and blumodel.env): which one is real is a decision for a person.
//   2. Moves the folder (one rename on the same drive), or, when the new folder exists, moves each
//      file and folder that isn't there yet. Nothing in the new folder is ever overwritten; what
//      can't move (a file of the same name is already there, or the old app\ when the new folder
//      has one) stays in the old folder, which is then left in place and listed.
//   3. Renames data\mise.db (and its -wal and -shm, which may hold most of the data) to
//      data\blumodel.db.
//   4. Renames mise.env to blumodel.env with a file rename only: the file is never opened, read,
//      copied or printed. Then restricts it to the current Windows account (icacls, which changes
//      who may read it without reading it).
//   5. Renames supervisor scripts generated before the rename (they start the server on
//      data\mise.db, which would now create an empty database) to <name>.pre-migration.
//   6. Prints what is left to do: deploy the new code, and the Task Scheduler changes
//      (delete MiseKitchenServer; register BluModelStudioServer and BluModelTunnel).
// Backups (data\backups\), uploads (data\uploads\) and logs (logs\) move with the folder.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEGACY_TASK, SERVER_TASK, TUNNEL_TASK, defaultHome, homeProcesses, legacyHome, restrictToCurrentUser } from '../server/ops/home.mjs';

const SCRIPTS = ['run-server.cmd', 'start-server.cmd', 'stop-server.cmd', 'start-hidden.vbs'];
/** Generated top-level files the new folder keeps its own copy of. */
const KEEP_DESTINATION = new Set(['app', ...SCRIPTS, 'cloudflared.yml', 'run-tunnel.cmd', 'start-tunnel.vbs', 'start-tunnel.cmd', 'stop-tunnel.cmd']);

/** Is something accepting connections on 127.0.0.1:port? */
export const listening = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1500, () => done(false));
  });

const exists = (p) => fs.existsSync(p);
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const inside = (a, b) => {
  const rel = path.relative(a, b);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Plans the move or merge: `{ kind, moves: [{ from, to }], left: [path] }`.
 * kind: 'rename' (the new folder doesn't exist), 'merge', 'none' (nothing at the old place).
 */
export function planMove(from, to) {
  if (!exists(from)) return { kind: 'none', moves: [], left: [] };
  if (!exists(to)) return { kind: 'rename', moves: [{ from, to }], left: [] };
  const moves = [];
  const left = [];
  const walk = (src, dst, top) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (!exists(d)) moves.push({ from: s, to: d });
      else if (top && KEEP_DESTINATION.has(e.name.toLowerCase())) left.push(s);
      else if (e.isDirectory() && isDir(d)) walk(s, d, false);
      else left.push(s);
    }
  };
  walk(from, to, true);
  return { kind: 'merge', moves, left };
}

/**
 * Will `rel` exist under `to` once the planned moves are done?
 * @param {{ kind: string, moves: { from: string, to: string }[] }} plan
 */
function willExist(plan, from, to, rel) {
  const target = path.join(to, rel);
  if (exists(target)) return true;
  if (plan.kind === 'rename') return exists(path.join(from, rel));
  return plan.moves.some((m) => inside(m.to, target) && exists(path.join(m.from, path.relative(m.to, target))));
}

/** Where a file that will be at `to\rel` is now (before the moves). */
function currentPath(plan, from, to, rel) {
  const target = path.join(to, rel);
  if (exists(target)) return target;
  if (plan.kind === 'rename') return path.join(from, rel);
  const m = plan.moves.find((x) => inside(x.to, target));
  return m ? path.join(m.from, path.relative(m.to, target)) : target;
}

/** A script generated before the rename (it names Mise, or runs the server on data\mise.db). */
function isLegacyScript(file) {
  try {
    const t = fs.readFileSync(file, 'utf8');
    return /data\\mise\.db|kitchen-visualizer|\bMise\b/.test(t);
  } catch {
    return false;
  }
}

/**
 * @param {{ from: string, to: string, ports?: number[], dryRun?: boolean, out?: (s: string) => void,
 *   processes?: (home: string) => { servers: any[], supervisors: any[], tunnels: any[], others: any[] },
 *   restrict?: (file: string) => string }} o
 * @returns {Promise<{ ok: boolean, blocked: string[], did: string[], left: string[] }>}
 */
export async function migrateHome({ from, to, ports = [8790], dryRun = false, out = console.log, processes = homeProcesses, restrict = restrictToCurrentUser }) {
  from = path.resolve(from);
  to = path.resolve(to);
  const blocked = [];
  const did = [];
  /** @type {ReturnType<typeof planMove>} */
  let plan = { kind: 'none', moves: [], left: [] };
  const say = (s) => {
    did.push(s);
    out(`${dryRun ? 'Would: ' : ''}${s}`);
  };

  if (from.toLowerCase() === to.toLowerCase()) blocked.push('The old and new folders are the same.');
  else if (inside(from, to) || inside(to, from)) blocked.push('One folder is inside the other.');
  if (!exists(from) && !exists(to)) blocked.push(`Neither ${from} nor ${to} exists: nothing to migrate.`);
  if (blocked.length) return finish();

  // ── 1. refuse while anything runs, or when a person has to choose ──────
  for (const port of ports) {
    if (await listening(port)) blocked.push(`Something is listening on 127.0.0.1:${port}: stop the server first (stop-server.cmd in its folder, or end the ${LEGACY_TASK} / ${SERVER_TASK} task's server).`);
  }
  for (const [home, allowTunnel] of [[from, false], [to, true]]) {
    if (!exists(home)) continue;
    const p = processes(home);
    if (p.error) blocked.push(`Could not list the processes running from ${home} (PowerShell failed), so it isn't safe to move it.`);
    const running = [...p.servers, ...p.supervisors, ...p.others, ...(allowTunnel ? [] : p.tunnels)];
    if (running.length) blocked.push(`Processes are running from ${home}: ${running.map((x) => `${x.name} (pid ${x.pid})`).join(', ')}. Stop them first.`);
  }
  plan = planMove(from, to);
  const will = (rel) => willExist(plan, from, to, rel);
  if (plan.kind === 'merge') {
    const oldDb = exists(path.join(from, 'data', 'mise.db')) || exists(path.join(from, 'data', 'blumodel.db'));
    const newDb = exists(path.join(to, 'data', 'blumodel.db')) || exists(path.join(to, 'data', 'mise.db'));
    if (oldDb && newDb) blocked.push(`Both folders hold a database (${path.join(from, 'data')} and ${path.join(to, 'data')}). Decide which one is real and move the other out of the way, then run this again.`);
    const oldEnv = exists(path.join(from, 'mise.env')) || exists(path.join(from, 'blumodel.env'));
    const newEnv = exists(path.join(to, 'blumodel.env')) || exists(path.join(to, 'mise.env'));
    if (oldEnv && newEnv) blocked.push(`Both folders hold a private settings file (${from} and ${to}). Neither is opened by this script: decide which one is real (a deploy-made template has empty Stripe values), move the other out of the way, then run this again.`);
  }
  if (blocked.length) return finish();

  // ── 2. move or merge ───────────────────────────────────────────────────
  if (plan.kind === 'none') out(`${from} does not exist: nothing to move. Checking ${to}.`);
  else if (plan.kind === 'rename') {
    say(`move ${from} to ${to}`);
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
    }
  } else {
    say(`merge ${from} into ${to}: ${plan.moves.length} item(s) to move, ${plan.left.length} left in place because ${to} already has them`);
    if (!dryRun) for (const m of plan.moves) fs.renameSync(m.from, m.to);
  }

  // ── 3. the database ────────────────────────────────────────────────────
  const dbRel = path.join('data', 'blumodel.db');
  const oldDbRel = path.join('data', 'mise.db');
  if (will(oldDbRel)) {
    if (will(dbRel) || will(dbRel + '-wal') || will(dbRel + '-shm')) out(`Note: ${path.join(to, oldDbRel)} and a blumodel.db (or its -wal/-shm) are both there; the server uses blumodel.db and mise.db is left alone.`);
    else {
      const parts = ['', '-wal', '-shm'].filter((ext) => will(oldDbRel + ext));
      say(`rename data\\mise.db${parts.length > 1 ? ` (with ${parts.filter(Boolean).join(', ')})` : ''} to data\\blumodel.db`);
      if (!dryRun) for (const ext of parts) fs.renameSync(path.join(to, oldDbRel + ext), path.join(to, dbRel + ext));
    }
  }

  // ── 4. the private settings: a rename only, never opened ─────────────────
  if (will('mise.env')) {
    if (will('blumodel.env')) out(`Note: ${to} has both mise.env and blumodel.env; the server reads blumodel.env. Neither was opened.`);
    else {
      say('rename mise.env to blumodel.env (the file is not opened) and restrict it to the current Windows account');
      if (!dryRun) {
        fs.renameSync(path.join(to, 'mise.env'), path.join(to, 'blumodel.env'));
        try {
          out(`  blumodel.env is now readable only by ${restrict(path.join(to, 'blumodel.env'))}.`);
        } catch (err) {
          out(`  Could not restrict blumodel.env (${err?.message ?? err}); it keeps the folder's permissions.`);
        }
      }
    }
  }

  // ── 5. supervisor scripts from before the rename ─────────────────────────
  // They are a set: when run-server.cmd is one of them, all four go.
  const legacySet = will('run-server.cmd') && isLegacyScript(currentPath(plan, from, to, 'run-server.cmd'));
  for (const name of SCRIPTS) {
    if (!will(name) || !(legacySet || isLegacyScript(currentPath(plan, from, to, name)))) continue;
    let target = path.join(to, `${name}.pre-migration`);
    for (let i = 2; exists(target); i++) target = path.join(to, `${name}.pre-migration-${i}`);
    say(`rename ${name} (made before the rename; it runs the server on data\\mise.db) to ${path.basename(target)}`);
    if (!dryRun) fs.renameSync(path.join(to, name), target);
  }

  // Empty folders the merge left behind in the old home.
  if (!dryRun && plan.kind === 'merge') removeEmptyDirs(from);
  return finish();

  function finish() {
    const left = plan.left.filter((p) => exists(p));
    if (blocked.length) {
      out('');
      out(`REFUSED${dryRun ? ' (dry run)' : ''}: nothing was changed.`);
      for (const b of blocked) out(`  - ${b}`);
      return { ok: false, blocked, did, left };
    }
    if (!did.length) out(`Nothing to do: ${to} is already migrated.`);
    if (left.length) {
      out('');
      out(`Left in ${from} (the new folder already has a file of that name; nothing was overwritten):`);
      for (const p of left.slice(0, 15)) out(`  ${p}`);
      if (left.length > 15) out(`  ... and ${left.length - 15} more`);
      out(`Check them, then delete ${from} yourself.`);
    }
    out('');
    out(dryRun ? 'Dry run: nothing was changed. Next, after running it for real:' : 'Next:');
    out(`  1. Deploy the new code there: set BLUMODEL_HOME=${to}  then  npm run deploy:local`);
    out('     (or node scripts/deploy-local.mjs --dist <a build>). It writes new supervisor scripts and starts the server.');
    out(`  2. Task Scheduler: delete the old task and register the new ones (both start hidden at logon):`);
    out(`       schtasks /Delete /TN ${LEGACY_TASK} /F`);
    out(`       node scripts/register-tasks.mjs --home "${to}" --dry-run     (then again without --dry-run)`);
    out(`     That registers ${SERVER_TASK} (start-hidden.vbs) and ${TUNNEL_TASK} (start-tunnel.vbs).`);
    out(`  3. The tunnel: node scripts/tunnel/setup-tunnel.mjs --home "${to}" --validate  (docs/OPERATIONS.md).`);
    return { ok: true, blocked, did, left };
  }
}

/** Removes empty folders under (and including) `dir`, bottom-up. Never removes a file. */
function removeEmptyDirs(dir) {
  if (!isDir(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {
    /* in use or not empty */
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ports = argv.flatMap((a, i) => (argv[i - 1] === '--port' ? [Number(a)] : [])).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  if (process.platform !== 'win32') {
    console.error('migrate-home is written for the Windows home server.');
    process.exit(1);
  }
  const unknown = argv.filter((a, i) => a.startsWith('--') && !['--dry-run', '--from', '--to', '--port'].includes(a) && argv[i - 1] !== '--from' && argv[i - 1] !== '--to');
  if (unknown.length) {
    console.error(`Unknown option ${unknown.join(' ')}. Usage: node scripts/migrate-home.mjs [--dry-run] [--from <old>] [--to <new>] [--port 8790]`);
    process.exit(2);
  }
  const r = await migrateHome({
    from: opt('--from') || legacyHome(),
    to: opt('--to') || defaultHome(),
    ports: ports.length ? ports : [8790],
    dryRun: argv.includes('--dry-run'),
  });
  process.exit(r.ok ? 0 : 1);
}

export const SCRIPT_PATH = fileURLToPath(import.meta.url);
