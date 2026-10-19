// Updates this machine's BluModel Studio from GitHub in one command, and rolls back by itself
// when the new version doesn't come up (docs/HOSTING.md, "Update from GitHub"):
//
//   Linux:   sudo bash <home>/repo/blumodel-studio/scripts/host/update-linux.sh    (runs this)
//   Windows: node <home>\repo\blumodel-studio\scripts\host\update.mjs           (npm run host:update)
//   options: --dry-run (print the plan; run nothing)  --force (redeploy even if this commit is deployed)
//            --no-pull (use the checkout as it is)    --home <dir> (default: the home this checkout
//            is in, <home>/repo/blumodel-studio, else the platform's default)
//            --build (emergency only: npm ci and build here instead of deploying the prebuilt dist/)
//            --auto [--trigger-only] (the unattended run, see below)
//            --platform win32|linux with --dry-run only
//
// The blumodel-studio branch carries PREBUILT releases (npm run release on a developer's machine,
// scripts/release.mjs): dist/ and server/generated/ are committed there and nowhere else. So this
// machine never builds: no vite, no devDependencies, no npm ci (the server has no runtime
// dependencies). --build is the way out when a release can't be made elsewhere: it installs and
// builds into .build/local/ (never over the tracked dist/, which would make the checkout dirty).
//
// In order (it stops at the first step that fails; until step 5 the site keeps running untouched):
//   1. refuses when the checkout has local changes to tracked files
//   2. git pull --ff-only on the branch the checkout tracks; if this script itself changed, the
//      new one is run (with --no-pull) so the newest steps apply
//   3. stops when <home>/app/DEPLOYED.txt already has this commit (unless --force)
//   4. the prebuilt release must be there (dist/index.html, server/generated/export-kit.mjs);
//      with --build instead: npm ci, then scripts/host/build.mjs --out .build/local
//   5. the deploy (scripts/deploy-local.mjs --dist <dist> --commit <sha>): stops the server, copies
//      the database to data/backups/<time>/ FIRST, puts the new app in place keeping the old one as
//      app.previous, starts the server and checks http://127.0.0.1:<port>/api/health
//   6. if that health check fails: scripts/deploy-local.mjs --rollback (the previous app, started
//      and checked again). The database is not restored automatically: the rollback prints the
//      command if the new version migrated it.
// On Linux this runs as root (the deploy restarts blumodel-studio.service); git (and with --build,
// npm and the build) run as the account that owns the checkout ('blumodel') through runuser.
// Only one update runs at a time: logs/update.lock in the home (scripts/host/autoupdate.mjs).
//
// --auto is what the schedule runs (blumodel-update.timer and blumodel-update.path on Linux, the
// BluModelStudioUpdate tasks on Windows): it fetches, compares the deployed commit with
// origin/<branch>, and only when there is a new fast-forward commit (that has not failed before)
// runs the steps above with the new copy of this script. It never resets the checkout.
// scripts/host/autoupdate.mjs has the rules; every run is one JSON line in logs/update.log and the
// latest is in logs/update-status.json. --trigger-only (Windows' two-minute check) does nothing at
// all unless Admin > System > Update now left logs/update-now.request.
//
// Exit codes: 0 updated (or nothing to do); 1 refused or failed before the deploy; 4 the update
// failed and the previous version is back up; 3 the update failed AND the rollback did too.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEPLOY_BRANCH, SERVICE_USER, defaultHome, homeLayout, isRoot, pathFor } from '../../server/ops/home.mjs';
import { EXIT, asServiceUser, readDeployed, showCommand } from './lib.mjs';
import { acquireLock, releaseLock, runAuto, updateFiles } from './autoupdate.mjs';

/** The exit code when the new version failed and the previous one is running again. */
export const ROLLED_BACK = 4;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
/** PATH for what runs as the service account: the standard one (node, npm and git are in /usr/bin). */
const LINUX_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/**
 * The home this checkout belongs to when it sits at <home>/repo/blumodel-studio (what the install
 * scripts make), else the platform's default.
 */
export function inferHome(root, { platform = process.platform, exists = fs.existsSync } = {}) {
  const p = pathFor(platform);
  const repo = p.dirname(root);
  if (p.basename(repo) === 'repo') {
    const home = p.dirname(repo);
    if (exists(p.join(home, 'data')) || exists(p.join(home, 'app'))) return home;
  }
  return defaultHome(undefined, platform);
}

/** npm as [cmd, prefixArgs, shell]: npm-cli.js beside this node when it is there (no .cmd shim on Windows), else npm. */
export function npmCommand({ platform = process.platform, node = process.execPath, exists = fs.existsSync } = {}) {
  const p = pathFor(platform);
  const cli = platform === 'win32' ? p.join(p.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js') : p.join(p.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (exists(cli)) return { cmd: node, pre: [p.normalize(cli)], shell: false };
  return platform === 'win32' ? { cmd: 'npm.cmd', pre: [], shell: true } : { cmd: 'npm', pre: [], shell: false };
}

/**
 * Runs the update. `exec(cmd, args, { cwd, env, capture })` runs one command and returns
 * `{ status, stdout }` (stdout only when capture is set); tests pass a fake.
 * @param {{ root: string, home: string, platform?: string, serviceUser?: string | null, asRoot?: boolean,
 *   force?: boolean, pull?: boolean, build?: boolean, dryRun?: boolean, node?: string, exec: Function,
 *   out?: (s: string) => void, afterPull?: () => boolean, exists?: (file: string) => boolean }} o
 * @returns {{ code: number, reexec?: boolean, deployed?: string }}
 */
export function runUpdate({ root, home, platform = process.platform, serviceUser = null, asRoot = false, force = false, pull = true, build = false, dryRun = false, node = process.execPath, exec, out = console.log, afterPull = () => false, exists = fs.existsSync }) {
  const p = pathFor(platform);
  const L = homeLayout(home, platform);
  const npm = npmCommand({ platform, node });
  /** git, npm and the build: as the checkout's owner when root on Linux. */
  const svc = (cmd, args) => asServiceUser(cmd, args, { user: serviceUser, home, root: asRoot, envPath: LINUX_PATH });
  const step = (title) => out(`\n==> ${title}`);
  /** Runs (or, in a dry run, prints) a command. Returns its status (0 in a dry run). */
  const run = ([cmd, args], { cwd = root, env, capture = false, show = true, shell = false } = {}) => {
    if (show) out(`+ ${env ? `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')} ` : ''}${showCommand(cmd, args)}`);
    if (dryRun) return { status: 0, stdout: '' };
    return exec(cmd, args, { cwd, env, capture, shell });
  };
  const git = (...args) => svc('git', ['-C', root, ...args]);

  step('Checking the checkout');
  const dirty = run(git('status', '--porcelain', '--untracked-files=no'), { capture: true, show: dryRun });
  if (dirty.status !== 0) {
    out(`REFUSED: git status failed in ${root} (exit ${dirty.status}). Nothing was changed.`);
    return { code: EXIT.REFUSED };
  }
  if (String(dirty.stdout || '').trim()) {
    out(`REFUSED: the checkout has local changes, so it can't be fast-forwarded safely:\n${String(dirty.stdout).trimEnd().replace(/^/gm, '    ')}\nUndo them (git -C ${root} checkout -- .) or commit them elsewhere, then run this again. Nothing was changed.`);
    return { code: EXIT.REFUSED };
  }

  if (pull) {
    step('Pulling from GitHub (fast-forward only)');
    const r = run(git('pull', '--ff-only'));
    if (r.status !== 0) {
      out(`REFUSED: git pull --ff-only failed (exit ${r.status}): the branch can't be fast-forwarded, or GitHub can't be reached. The site still runs the version it had.`);
      return { code: EXIT.REFUSED };
    }
    if (!dryRun && afterPull()) {
      out('This update script changed with the pull: running the new one.');
      return { code: EXIT.OK, reexec: true };
    }
  }

  const head = dryRun ? { status: 0, stdout: '<commit>' } : run(git('rev-parse', '--short', 'HEAD'), { capture: true, show: false });
  const commit = String(head.stdout || '').trim();
  if (head.status !== 0 || !commit) {
    out('REFUSED: could not read the checkout’s commit. Nothing was changed.');
    return { code: EXIT.REFUSED };
  }
  const deployed = readDeployed(L.app)?.commit ?? null;
  out(`Checkout: ${commit}. Deployed in ${L.app}: ${deployed ?? '(none)'}.`);
  if (deployed === commit && !force) {
    out(`Already deployed: commit ${commit} is running. Nothing to do (--force redeploys it).`);
    return { code: EXIT.OK, deployed: commit };
  }

  let dist = p.join(root, 'dist');
  if (!build) {
    step('The prebuilt release (nothing is built on this machine)');
    const need = [p.join(root, 'dist', 'index.html'), p.join(root, 'server', 'generated', 'export-kit.mjs')];
    const missing = dryRun ? [] : need.filter((f) => !exists(f));
    if (missing.length) {
      out(`REFUSED: this checkout has no prebuilt release (missing ${missing.join(', ')}). Every version published to the blumodel-studio branch with npm run release has one; other branches don't. To build on this machine anyway (about 2 GB of RAM + swap, and the devDependencies): --build. The site still runs the version it had.`);
      return { code: EXIT.REFUSED };
    }
    out(`Deploying the build in ${dist} (made by npm run release).`);
  } else {
    step('Emergency build on this machine (--build): installing dependencies (npm ci)');
    if (run(svc(npm.cmd, [...npm.pre, 'ci', '--no-audit', '--no-fund']), { shell: npm.shell }).status !== 0) {
      out('FAILED: npm ci. The site still runs the version it had.');
      return { code: EXIT.REFUSED };
    }
    step('Building into .build/local (the tracked dist/ is left alone)');
    const outDir = p.join('.build', 'local');
    if (run(svc(node, [p.join(root, 'scripts', 'host', 'build.mjs'), '--out', outDir])).status !== 0) {
      out('FAILED: the build. The site still runs the version it had.');
      return { code: EXIT.REFUSED };
    }
    dist = p.join(root, outDir);
  }

  step('Deploying (backs up the database first, then restarts the server and checks its health)');
  const env = { BLUMODEL_HOME: home };
  const deploy = run([node, [p.join(root, 'scripts', 'deploy-local.mjs'), '--dist', dist, '--commit', commit]], { env });
  if (dryRun) {
    step('Only if that health check fails: rolling back to the previous app');
    run([node, [p.join(root, 'scripts', 'deploy-local.mjs'), '--rollback']], { env });
    return { code: EXIT.OK };
  }
  if (deploy.status === EXIT.OK) {
    out(`\nUpdated: commit ${commit} is running.`);
    return { code: EXIT.OK, deployed: commit };
  }
  if (deploy.status !== EXIT.UNHEALTHY) {
    out(`FAILED: the deploy refused or stopped (exit ${deploy.status}) before putting the new app in place. The site runs the version it had.`);
    return { code: EXIT.REFUSED };
  }

  step('The new version failed its health check: rolling back to the previous app');
  const back = run([node, [p.join(root, 'scripts', 'deploy-local.mjs'), '--rollback']], { env });
  if (back.status === EXIT.OK) {
    out(`\nROLLED BACK: commit ${deployed ?? '(the previous app)'} is running again; ${commit} did not start healthy. Its logs are in ${L.logs}${platform === 'linux' ? ' and journalctl -u blumodel-studio' : ''}. Fix forward, then update again.`);
    return { code: ROLLED_BACK };
  }
  out(`\nTHE ROLLBACK FAILED TOO (exit ${back.status}): the site may be down. See docs/HOSTING.md, "Rollback", and ${L.logs}.`);
  return { code: EXIT.UNHEALTHY };
}

/** The owner of `dir` when it isn't root (Linux): the account git and npm should run as. */
function ownerOf(dir) {
  try {
    const uid = fs.statSync(dir).uid;
    if (!uid) return null;
    return String(execFileSync('id', ['-nu', String(uid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim() || null;
  } catch {
    return null;
  }
}

const sha = (files) => {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    try {
      h.update(fs.readFileSync(f));
    } catch {
      h.update('missing');
    }
  }
  return h.digest('hex');
};

/** The branch the checkout is on (what it tracks), or the deploy branch. */
function currentBranch(git) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const b = String(r.stdout || '').trim();
  return r.status === 0 && b && b !== 'HEAD' ? b : DEPLOY_BRANCH;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  const valued = ['--home', '--platform'];
  const flags = ['--dry-run', '--force', '--no-pull', '--build', '--auto', '--trigger-only'];
  const bad = argv.filter((a, i) => a.startsWith('--') && ![...flags, ...valued].includes(a) && !valued.includes(argv[i - 1]));
  if (bad.length) {
    console.error(`Unknown option ${bad.join(' ')}. Usage: node scripts/host/update.mjs [--dry-run] [--force] [--no-pull] [--build] [--home <dir>] | --auto [--trigger-only] [--home <dir>]`);
    process.exit(EXIT.USAGE);
  }
  const dryRun = argv.includes('--dry-run');
  const auto = argv.includes('--auto');
  if (argv.includes('--trigger-only') && !auto) {
    console.error('--trigger-only goes with --auto.');
    process.exit(EXIT.USAGE);
  }
  if (auto && (dryRun || argv.includes('--force') || argv.includes('--no-pull') || argv.includes('--build'))) {
    console.error('--auto decides for itself: it takes only --home (and --trigger-only). For a plan, run without --auto and with --dry-run.');
    process.exit(EXIT.USAGE);
  }
  const platform = opt('--platform') || process.platform;
  if (platform !== process.platform && !dryRun) {
    console.error('--platform only works with --dry-run.');
    process.exit(EXIT.USAGE);
  }
  if (!['win32', 'linux'].includes(platform)) {
    console.error(`The update knows Windows and Linux homes (this is ${platform}).`);
    process.exit(EXIT.REFUSED);
  }
  const P = pathFor(platform);
  const root = platform === process.platform ? ROOT : platform === 'linux' ? '/srv/blumodel-studio/repo/blumodel-studio' : 'C:\\Users\\<you>\\Projects\\BluModelStudio\\repo\\blumodel-studio';
  const home = opt('--home') ? P.resolve(opt('--home')) : inferHome(root, { platform });
  const linux = platform === 'linux';
  if (linux && !dryRun && !isRoot()) {
    console.error('On Linux the update restarts blumodel-studio.service: run it with sudo (sudo bash scripts/host/update-linux.sh).');
    process.exit(EXIT.REFUSED);
  }
  const asRoot = linux && (dryRun ? platform !== process.platform || isRoot() : true);
  const serviceUser = linux ? (platform === process.platform ? ownerOf(root) : SERVICE_USER) : null;
  const node = platform === process.platform ? process.execPath : linux ? '/usr/bin/node' : 'node';
  const exec = (cmd, args, { cwd, env, capture, shell }) => {
    const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', shell: !!shell, windowsHide: true });
    return { status: r.status ?? 1, stdout: r.stdout ?? '' };
  };

  if (auto) {
    // Unattended: quiet unless something happens; journald (or the task's history) gets one line.
    const git = (args) => {
      const [cmd, a] = asServiceUser('git', ['-C', root, ...args], { user: serviceUser, home, root: asRoot, envPath: LINUX_PATH });
      const r = spawnSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      return { status: r.status ?? 1, stdout: r.stdout ?? '' };
    };
    // The update itself runs from the checkout as it is after the fast-forward, so a release that
    // changes this script is applied with its own new steps. It inherits the lock.
    const update = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'host', 'update.mjs'), '--no-pull', '--home', home], { stdio: 'inherit', windowsHide: true, env: { ...process.env, BLUMODEL_UPDATE_LOCK_HELD: '1' } }).status ?? 1;
    const r = runAuto({ home, root, branch: currentBranch(git), platform, triggerOnly: argv.includes('--trigger-only'), git, update });
    process.exit(r.code);
  }

  const watched = [fileURLToPath(import.meta.url), path.join(HERE, 'lib.mjs'), path.join(HERE, 'autoupdate.mjs')];
  const before = sha(watched);
  console.log(`BluModel Studio update: checkout ${root}, home ${home}${dryRun ? ' (dry run: nothing is run)' : ''}`);
  // One update at a time (an --auto run passes its lock on to the update it starts).
  const F = updateFiles(home, platform);
  const ownLock = !dryRun && !process.env.BLUMODEL_UPDATE_LOCK_HELD;
  if (ownLock) {
    const lock = acquireLock(F);
    if (!lock.ok) {
      console.error(`REFUSED: another update is running (pid ${lock.holder?.pid ?? '?'}, since ${lock.holder?.at ?? '?'}; ${F.lock}). Nothing was changed.`);
      process.exit(EXIT.REFUSED);
    }
  }
  let code = EXIT.REFUSED;
  try {
    const r = runUpdate({ root, home, platform, serviceUser, asRoot, node, dryRun, force: argv.includes('--force'), pull: !argv.includes('--no-pull'), build: argv.includes('--build'), exec, afterPull: () => sha(watched) !== before });
    code = r.code;
    if (r.reexec) {
      // The new copy of this script, under the lock this run holds.
      const again = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv.filter((a) => a !== '--no-pull'), '--no-pull'], { stdio: 'inherit', env: { ...process.env, BLUMODEL_UPDATE_LOCK_HELD: '1' } });
      code = again.status ?? 1;
    }
  } finally {
    if (ownLock) releaseLock(F);
  }
  if (dryRun) console.log('\nDry run: nothing was pulled, built, deployed or restarted.');
  process.exit(code);
}
