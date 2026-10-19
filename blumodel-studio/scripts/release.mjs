// Publishes this commit to the Wyse: `npm run release` (docs/HOSTING.md, "Publishing a version").
//
//   npm run release                 check, build, show what goes live, ask, publish
//   npm run release -- --yes        no question (for a script; still refuses everything below)
//   npm run release -- --qa         also run the full QA suite on the build first (slow; --qa-port 8828)
//   npm run release -- --dry-run    everything except the push: prints the release commit it made
//   options: --branch blumodel-studio  --remote origin
//
// What the Wyse runs is the blumodel-studio branch, and it never builds anything (4-8 GB of RAM, and
// "zero headaches"): each commit on that branch is a PREBUILT release. This makes one:
//   1. refuses when the checkout has uncommitted changes to tracked files (a release is a commit)
//   2. a CLEAN temporary worktree of HEAD (git worktree add --detach), with node_modules linked in
//      (a junction on Windows, a symlink elsewhere), so nothing half-edited or untracked can slip in
//   3. there: tsc --noEmit, npm test, the production build (build-kit + vite into dist/), and with
//      --qa the full QA suite against that build
//   4. the release tree, made with git plumbing in a throwaway index (the checkout and its branch are
//      never touched): HEAD's blumodel-studio/ folder, plus its build output - dist/ and
//      server/generated/, which are gitignored on every work branch and committed ONLY here - plus
//      blumodel-studio/RELEASE.json (the source commit, when and with which Node it was built), plus
//      WYSE_SETUP.md and CLAUDE.md at the top (from blumodel-studio/release/), so a Claude session
//      started in the Wyse's checkout reads the setup guide. Nothing else from the repo's top level
//      (the trading bot) goes into a release.
//   5. the release commit's parent is the branch's current tip on GitHub, so pushing it is a
//      fast-forward by construction; and a release must contain the one before it (HEAD descends
//      from the previous release's source commit), so it never quietly drops published work
//   6. prints what goes live (the commits since the last release, the size of the build) and asks
//   7. git push <remote> <release>:refs/heads/<branch>, never forced: if someone published in the
//      meantime git refuses, and you run it again
// The Wyse picks it up at its next daily check (04:00), or at once with Admin > System > Update now.
// Exit codes: 0 published (or nothing new); 1 refused or a check failed; 2 bad usage.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'blumodel-studio';
export const DEFAULT_BRANCH = 'blumodel-studio';
/** What the release adds on top of HEAD's blumodel-studio/ (relative to it): the build output. */
export const BUILD_PATHS = Object.freeze(['dist', 'server/generated', 'RELEASE.json']);
/** Files copied to the top of the release tree from blumodel-studio/release/. */
export const TOP_FILES = Object.freeze(['WYSE_SETUP.md', 'CLAUDE.md']);

/** git in `cwd`: { status, stdout, stderr } (stdout trimmed). `env` adds variables. */
export function git(cwd, args, { env, input } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...(env || {}) }, input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? '').trim(), stderr: String(r.stderr ?? '').trim() };
}
const must = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed: ${r.stderr || r.stdout || `exit ${r.status}`}`);
  return r.stdout;
};

/**
 * The release tree for the worktree `wt` (a checkout of the source commit whose build output is on
 * disk), made in a throwaway index. Returns the tree id. Pure git plumbing: the worktree's own
 * index, HEAD and branch are untouched.
 * @param {{ wt: string, source: string, topFiles?: Record<string, string>, index: string }} o
 *   topFiles: top-level name -> file on disk
 */
export function releaseTree({ wt, source, topFiles = {}, index }) {
  const env = { GIT_INDEX_FILE: index };
  fs.rmSync(index, { force: true });
  must(git(wt, ['read-tree', '--empty'], { env }), 'git read-tree --empty');
  must(git(wt, ['read-tree', `--prefix=${APP}/`, `${source}:${APP}`], { env }), `git read-tree of ${APP}/`);
  const build = BUILD_PATHS.map((p) => `${APP}/${p}`).filter((p) => fs.existsSync(path.join(wt, p)));
  // -f: dist/ and server/generated/ are gitignored on the work branches; here they are the point.
  must(git(wt, ['add', '-f', '--', ...build], { env }), 'git add of the build');
  for (const [name, file] of Object.entries(topFiles)) {
    const blob = must(git(wt, ['hash-object', '-w', '--', file]), `git hash-object ${file}`);
    must(git(wt, ['update-index', '--add', '--cacheinfo', `100644,${blob},${name}`], { env }), `git update-index ${name}`);
  }
  return must(git(wt, ['write-tree'], { env }), 'git write-tree');
}

/** The source commit a release was built from: its RELEASE.json, else (a branch from before releases) the commit itself. */
export function releaseSource(repo, tip) {
  const r = git(repo, ['show', `${tip}:${APP}/RELEASE.json`]);
  if (r.status === 0) {
    try {
      const s = JSON.parse(r.stdout).source;
      if (/^[0-9a-f]{40}$/.test(s)) return s;
    } catch {
      /* not JSON */
    }
  }
  return tip;
}

/**
 * Whether `head` may be released on top of `tip` (null when the branch doesn't exist yet): it must
 * contain the previous release's source, and not be that same source.
 * @returns {{ ok: boolean, reason?: string, previousSource: string | null, same?: boolean }}
 */
export function checkSuccession(repo, { head, tip }) {
  if (!tip) return { ok: true, previousSource: null };
  const prev = releaseSource(repo, tip);
  if (git(repo, ['cat-file', '-e', `${prev}^{commit}`]).status !== 0) return { ok: false, previousSource: prev, reason: `the previous release was built from ${prev.slice(0, 10)}, which this clone doesn't have: git fetch the branch it came from, then run this again` };
  if (prev === head) return { ok: true, previousSource: prev, same: true };
  if (git(repo, ['merge-base', '--is-ancestor', prev, head]).status !== 0) return { ok: false, previousSource: prev, reason: `HEAD (${head.slice(0, 10)}) does not contain the previous release's source (${prev.slice(0, 10)}): publishing it would drop work that is live. Merge or rebase onto it first` };
  return { ok: true, previousSource: prev };
}

/** The release commit's message. */
export const releaseMessage = ({ source, subject, branch }) => `release: ${APP} ${source.slice(0, 10)} - ${subject}\n\nPrebuilt release of ${source} for the ${branch} branch (scripts/release.mjs):\n${APP}/ as at that commit, plus its build (dist/, server/generated/) and RELEASE.json,\nand WYSE_SETUP.md / CLAUDE.md at the top.\n`;

function linkModules(wt) {
  const target = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(target)) throw new Error(`No node_modules in ${ROOT}: run npm ci here first.`);
  const link = path.join(wt, APP, 'node_modules');
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  return link;
}
/** Removes the link itself, never what it points at. True when it is gone. */
function unlinkModules(link) {
  try {
    fs.unlinkSync(link);
  } catch {
    try {
      fs.rmdirSync(link); // a junction: rmdir removes the link, not the folder it points at
    } catch {
      /* already gone, or the check below says so */
    }
  }
  try {
    fs.lstatSync(link);
    return false;
  } catch {
    return true;
  }
}

const NPM_CLI = path.join(path.dirname(process.execPath), process.platform === 'win32' ? '' : '..', process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'npm', 'bin', 'npm-cli.js');

function step(cwd, title, cmd, args, env = {}) {
  console.log(`\n==> ${title}\n+ ${[cmd === process.execPath ? 'node' : cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true, shell: false });
  if (r.status !== 0) throw new Error(`${title} failed (exit ${r.status ?? r.signal}). Nothing was published.`);
}

async function ask(q) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((resolve) => rl.question(q, resolve));
  rl.close();
  return /^y(es)?$/i.test(String(a).trim());
}

const dirSize = (d) => {
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size;
  return n;
};

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const valued = ['--branch', '--remote', '--qa-port'];
  const flags = ['--yes', '--qa', '--dry-run'];
  const bad = argv.filter((a, i) => a.startsWith('-') && ![...flags, ...valued].includes(a) && !valued.includes(argv[i - 1]));
  const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
  if (bad.length || valued.some((f) => argv.includes(f) && !opt(f))) {
    console.error('Usage: npm run release -- [--yes] [--qa [--qa-port 8828]] [--dry-run] [--branch blumodel-studio] [--remote origin]');
    process.exit(2);
  }
  const branch = opt('--branch', DEFAULT_BRANCH);
  const remote = opt('--remote', 'origin');
  const dryRun = argv.includes('--dry-run');
  if (!/^[\w./-]+$/.test(branch) || !/^[\w./:@-]+$/.test(remote)) {
    console.error('Not a branch or remote name.');
    process.exit(2);
  }
  const repo = must(git(ROOT, ['rev-parse', '--show-toplevel']), 'git rev-parse --show-toplevel');
  let wt = null;
  let link = null;
  const index = path.join(os.tmpdir(), `blumodel-release-index-${process.pid}`);
  let code = 0;
  try {
    // 1. a commit, not a working tree
    const dirty = must(git(repo, ['status', '--porcelain', '--untracked-files=no']), 'git status');
    if (dirty) throw new Error(`Uncommitted changes to tracked files:\n${dirty.replace(/^/gm, '    ')}\nCommit them (a release is a commit), or stash them, then run this again. Nothing was built or published.`);
    const head = must(git(repo, ['rev-parse', 'HEAD']), 'git rev-parse HEAD');
    const subject = must(git(repo, ['log', '-1', '--format=%s', head]), 'git log').slice(0, 100);
    console.log(`Release of ${head.slice(0, 10)} (${subject}) to ${remote}/${branch}${dryRun ? ' (dry run: no push)' : ''}`);

    // Where the branch is now, on GitHub.
    const fetched = git(repo, ['fetch', '--quiet', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
    let tip = null;
    if (fetched.status === 0) tip = must(git(repo, ['rev-parse', `refs/remotes/${remote}/${branch}`]), 'git rev-parse');
    else if (/couldn't find remote ref|not found/i.test(fetched.stderr)) console.log(`${remote}/${branch} does not exist yet: this is the first release.`);
    else throw new Error(`git fetch ${remote} ${branch} failed: ${fetched.stderr}`);
    const succ = checkSuccession(repo, { head, tip });
    if (!succ.ok) throw new Error(`Refused: ${succ.reason}. Nothing was published.`);
    if (succ.same) console.log(`${head.slice(0, 10)} is already the live release's source; building it again to compare.`);

    // 2. a clean worktree of HEAD
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-release-'));
    fs.rmSync(wt, { recursive: true, force: true });
    must(git(repo, ['worktree', 'add', '--detach', '--quiet', wt, head]), 'git worktree add');
    link = linkModules(wt);
    const app = path.join(wt, APP);

    // 3. the checks and the build, in that clean copy
    const node = process.execPath;
    step(app, 'Type check (tsc --noEmit)', node, [path.join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.json']);
    step(app, 'Tests (npm test)', node, [NPM_CLI, 'test']);
    step(app, 'The export kit (build-kit)', node, [path.join('scripts', 'build-kit.mjs')]);
    step(app, 'The production build (vite into dist/)', node, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', 'dist', '--emptyOutDir']);
    if (argv.includes('--qa')) step(app, 'The full QA suite on that build', node, [path.join('scripts', 'qa.mjs'), '--pkg', 'all', '--port', opt('--qa-port', '8828'), '--dist', 'dist']);
    fs.writeFileSync(path.join(app, 'RELEASE.json'), `${JSON.stringify({ source: head, subject, builtAt: new Date().toISOString(), node: process.version, branch }, null, 2)}\n`);

    // 4. the release tree
    const topFiles = Object.fromEntries(TOP_FILES.map((n) => [n, path.join(app, 'release', n)]));
    for (const f of Object.values(topFiles)) if (!fs.existsSync(f)) throw new Error(`${f} is missing: the release needs it at the top of the branch.`);
    const tree = releaseTree({ wt, source: head, topFiles, index });
    if (tip && must(git(repo, ['rev-parse', `${tip}^{tree}`]), 'git rev-parse tree') === tree) {
      console.log(`\nNothing new: ${remote}/${branch} already has exactly this release. Nothing was published.`);
      process.exitCode = 0;
    } else {
      // 5. the commit, on top of the branch's tip
      const msg = releaseMessage({ source: head, subject, branch });
      const commit = must(git(repo, ['commit-tree', tree, ...(tip ? ['-p', tip] : []), '-F', '-'], { input: msg }), 'git commit-tree');
      if (tip && git(repo, ['merge-base', '--is-ancestor', tip, commit]).status !== 0) throw new Error('The release is not a fast-forward of the branch. Nothing was published.');

      // 6. what goes live
      console.log(`\n==> What goes live on ${remote}/${branch}`);
      console.log(`  release commit ${commit.slice(0, 10)} (parent ${tip ? tip.slice(0, 10) : 'none: a new branch'})`);
      console.log(`  built from      ${head.slice(0, 10)} ${subject}`);
      console.log(`  the build       ${(dirSize(path.join(app, 'dist')) / 1048576).toFixed(1)} MB in dist/, ${fs.readdirSync(path.join(app, 'server', 'generated')).length} file(s) in server/generated/`);
      const since = succ.previousSource && !succ.same ? git(repo, ['log', '--oneline', '--no-decorate', '-n', '30', `${succ.previousSource}..${head}`, '--', APP]).stdout : '';
      if (since) console.log(`  changes since the live release (${succ.previousSource.slice(0, 10)}):\n${since.split('\n').map((l) => `    ${l.slice(0, 110)}`).join('\n')}`);
      else if (!succ.previousSource) console.log('  (the first release on this branch)');
      if (dryRun) {
        console.log(`\nDry run: nothing was pushed. To publish this exact release: git push ${remote} ${commit}:refs/heads/${branch}`);
      } else if (argv.includes('--yes') || (await ask(`\nPublish it to ${remote}/${branch}? The Wyse deploys it at its next daily check, or at once with Admin > System > Update now. [y/N] `))) {
        // 7. a fast-forward push, never forced
        const push = spawnSync('git', ['push', remote, `${commit}:refs/heads/${branch}`], { cwd: repo, stdio: 'inherit', windowsHide: true });
        if (push.status !== 0) throw new Error(`git push was refused (exit ${push.status}). If the branch moved on GitHub since the fetch, run npm run release again. Nothing was forced.`);
        console.log(`\nPublished ${commit.slice(0, 10)} to ${remote}/${branch}. Wyse: Admin > System > Update now, or wait for 04:00.`);
      } else {
        console.log('\nNot published.');
        code = 1;
      }
    }
  } catch (err) {
    console.error(`\n${err?.message ?? err}`);
    code = 1;
  } finally {
    // The temp worktree goes only once its node_modules link is gone, so removing it can never
    // reach the real node_modules through the link.
    const unlinked = link ? unlinkModules(link) : true;
    if (wt && !unlinked) console.error(`Could not remove the node_modules link ${link}; remove the link (not its contents), then: git worktree remove --force ${wt}`);
    else if (wt) {
      git(repo, ['worktree', 'remove', '--force', wt]);
      fs.rmSync(wt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      git(repo, ['worktree', 'prune']);
    }
    fs.rmSync(index, { force: true });
  }
  process.exit(code);
}
