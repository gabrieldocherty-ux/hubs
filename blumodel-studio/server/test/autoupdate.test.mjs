// Automatic updates (scripts/host/autoupdate.mjs, update.mjs --auto): the decision, the lock, the
// failed-commit memory, the trigger file, the deploy-in-progress guard, the log and status files,
// and a non-fast-forward branch in a real temp git repo. Nothing here deploys, fetches from GitHub
// or touches a real home: every home is a temp folder and `update` is a fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LOCK_STALE_MS,
  acquireLock,
  appendLog,
  confText,
  decide,
  outcomeOfExit,
  parseTime,
  readConf,
  readState,
  readStatus,
  runAuto,
  sameCommit,
  updateFiles,
} from '../../scripts/host/autoupdate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const tempDir = (p = 'blumodel-au-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);

/** A temp home whose app/DEPLOYED.txt says `deployed` (short, as the deploy writes it). */
function home(deployed = OLD.slice(0, 7)) {
  const h = tempDir();
  fs.mkdirSync(path.join(h, 'app'), { recursive: true });
  fs.mkdirSync(path.join(h, 'logs'), { recursive: true });
  if (deployed) fs.writeFileSync(path.join(h, 'app', 'DEPLOYED.txt'), `commit ${deployed}\ndeployed 2026-10-01T04:00:00.000Z\n`);
  return h;
}

/** A fake git: answers status, fetch, rev-parse, merge-base and merge from `s`, recording each call. */
function fakeGit(s = {}) {
  const st = { dirty: '', fetch: 0, head: NEW, local: OLD, ancestor: true, merge: 0, ...s };
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'status') return { status: 0, stdout: st.dirty };
    if (args[0] === 'fetch') return { status: st.fetch, stdout: '' };
    if (args[0] === 'rev-parse') return args.some((a) => a.startsWith('refs/remotes/')) ? { status: st.head ? 0 : 1, stdout: `${st.head ?? ''}\n` } : { status: 0, stdout: `${st.local}\n` };
    if (args[0] === 'merge-base') return { status: st.ancestor ? 0 : 1, stdout: '' };
    if (args[0] === 'merge') {
      if (st.merge === 0) st.local = st.head;
      return { status: st.merge, stdout: '' };
    }
    return { status: 0, stdout: '' };
  };
  return { git, calls, st };
}

/** A fake update: exit `code`; on 0 it writes DEPLOYED.txt with `commit` like the deploy would. */
function fakeUpdate(h, { code = 0, commit = NEW } = {}) {
  let runs = 0;
  const update = () => {
    runs++;
    if (code === 0) fs.writeFileSync(path.join(h, 'app', 'DEPLOYED.txt'), `commit ${commit.slice(0, 7)}\n`);
    return code;
  };
  return { update, runs: () => runs };
}

const auto = (h, git, update, extra = {}) => runAuto({ home: h, root: path.join(h, 'repo', 'blumodel-studio'), branch: 'blumodel-studio', git, update, out: () => {}, ...extra });
const logLines = (h) => fs.readFileSync(updateFiles(h).log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// ── the decision ─────────────────────────────────────────────────────────

test('decide: current, new commit, failed commit remembered (retried only on Update now), non-fast-forward refused, no head is an error', () => {
  assert.equal(decide({ deployed: OLD.slice(0, 7), local: OLD, head: OLD, fastForward: true }).outcome, 'current');
  assert.deepEqual(decide({ deployed: OLD.slice(0, 7), local: OLD, head: NEW, fastForward: true }).action, 'update');
  assert.equal(decide({ deployed: OLD.slice(0, 7), local: NEW, head: NEW, failedCommit: NEW, fastForward: true }).outcome, 'skipped');
  assert.equal(decide({ deployed: OLD.slice(0, 7), local: NEW, head: NEW, failedCommit: NEW, requested: true, fastForward: true }).action, 'update', 'Update now retries it');
  assert.equal(decide({ deployed: OLD.slice(0, 7), local: NEW, head: NEWER, failedCommit: NEW, fastForward: true }).action, 'update', 'a newer commit is tried');
  const nff = decide({ deployed: OLD.slice(0, 7), local: OLD, head: NEW, fastForward: false });
  assert.equal(nff.outcome, 'refused');
  assert.match(nff.reason, /force-pushed or rewritten\. Nothing was reset/);
  assert.equal(decide({ deployed: null, local: OLD, head: null, fastForward: false }).outcome, 'error');
  assert.equal(decide({ deployed: null, local: OLD, head: NEW, fastForward: true }).action, 'update', 'nothing deployed yet');
  assert.ok(sameCommit('abc1234', 'abc1234def') && sameCommit('abc1234def', 'abc1234') && !sameCommit('abc1234', 'abd1234') && !sameCommit(null, 'a'));
  assert.deepEqual([0, 1, 3, 4, 2].map(outcomeOfExit), ['updated', 'failed', 'down', 'rolled-back', 'failed']);
});

test('the schedule file: AUTO_UPDATE_TIME is HH:MM (24 h), 04:00 by default; AUTO_UPDATE=off turns it off; no file means not installed', () => {
  assert.deepEqual(['04:00', '4:00', '23:59', '24:00', '04:60', 'x', ''].map(parseTime), ['04:00', '04:00', '23:59', null, null, null, null]);
  const h = home();
  try {
    const F = updateFiles(h);
    assert.deepEqual(readConf(F.conf), { enabled: false, time: '04:00', installed: false });
    fs.writeFileSync(F.conf, confText({ time: '05:30' }));
    assert.deepEqual(readConf(F.conf), { enabled: true, time: '05:30', installed: true });
    fs.writeFileSync(F.conf, confText({ enabled: false, time: 'nonsense' }));
    assert.deepEqual(readConf(F.conf), { enabled: false, time: '04:00', installed: true });
  } finally {
    rm(h);
  }
});

// ── whole runs with a fake git ───────────────────────────────────────────

test('already deployed: one short log line, no merge, no update, status says current', () => {
  const h = home(NEW.slice(0, 7));
  try {
    const g = fakeGit({ local: NEW, head: NEW });
    const u = fakeUpdate(h);
    const r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'current');
    assert.equal(r.code, 0);
    assert.equal(u.runs(), 0);
    assert.ok(!g.calls.some((c) => c.startsWith('merge ')), 'no merge');
    const lines = logLines(h);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].outcome, 'current');
    assert.equal(lines[0].by, 'schedule');
    for (const k of ['at', 'from', 'to', 'outcome', 'durationMs', 'error']) assert.ok(k in lines[0], k);
    const s = readStatus(updateFiles(h));
    assert.equal(s.deployed, NEW.slice(0, 7));
    assert.equal(s.head, NEW);
    assert.equal(s.branch, 'blumodel-studio');
    assert.equal(s.result.outcome, 'current');
    assert.ok(!fs.existsSync(updateFiles(h).lock), 'the lock is released');
  } finally {
    rm(h);
  }
});

test('a new commit: fetch, fast-forward, the update, status updated; a failed one is remembered and not retried until the branch moves on', () => {
  const h = home();
  try {
    const F = updateFiles(h);
    let g = fakeGit();
    let u = fakeUpdate(h);
    let r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'updated');
    assert.equal(u.runs(), 1);
    assert.deepEqual(g.calls.map((c) => c.split(' ')[0]), ['status', 'fetch', 'rev-parse', 'rev-parse', 'merge-base', 'merge']);
    assert.match(g.calls[1], /^fetch --quiet origin \+refs\/heads\/blumodel-studio:refs\/remotes\/origin\/blumodel-studio$/);
    assert.equal(g.calls[5], `merge --ff-only --quiet ${NEW}`);
    assert.equal(readStatus(F).lastUpdate.outcome, 'updated');

    // NEWER fails its health check and is rolled back (update.mjs exit 4).
    g = fakeGit({ local: NEW, head: NEWER });
    u = fakeUpdate(h, { code: 4 });
    r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'rolled-back');
    assert.equal(r.code, 1);
    assert.equal(readState(F).failedCommit, NEWER);
    const st = readStatus(F);
    assert.equal(st.result.outcome, 'rolled-back');
    assert.equal(st.failed.commit, NEWER);
    assert.equal(st.lastUpdate.to, NEW, 'the last successful update is kept');

    // The next tick: still NEWER on the branch. Not retried.
    g = fakeGit({ local: NEWER, head: NEWER });
    u = fakeUpdate(h);
    r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'skipped');
    assert.equal(u.runs(), 0);

    // Update now asks for it again: retried, and on success the memory is cleared.
    fs.writeFileSync(F.trigger, '');
    g = fakeGit({ local: NEWER, head: NEWER });
    u = fakeUpdate(h, { commit: NEWER });
    r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'updated');
    assert.equal(r.entry.by, 'update-now');
    assert.ok(!fs.existsSync(F.trigger), 'the trigger is consumed');
    assert.equal(readState(F).failedCommit, null);
    assert.deepEqual(logLines(h).map((l) => l.outcome), ['updated', 'rolled-back', 'skipped', 'updated']);
  } finally {
    rm(h);
  }
});

test('a failed update that stops before the deploy (exit 1) and one whose rollback failed too (exit 3) are both remembered', () => {
  const h = home();
  try {
    const F = updateFiles(h);
    let r = auto(h, fakeGit().git, fakeUpdate(h, { code: 1 }).update);
    assert.equal(r.outcome, 'failed');
    assert.equal(readState(F).failedCommit, NEW);
    r = auto(h, fakeGit({ local: NEW, head: NEWER }).git, fakeUpdate(h, { code: 3 }).update);
    assert.equal(r.outcome, 'down');
    assert.equal(r.code, 3);
    assert.match(r.entry.error, /rollback failed: the site may be down/);
  } finally {
    rm(h);
  }
});

test('the lock: a second run while one holds it is busy and changes nothing; a stale lock is cleared; the result shown stays the last real one', () => {
  const h = home(NEW.slice(0, 7));
  try {
    const F = updateFiles(h);
    auto(h, fakeGit({ local: NEW, head: NEW }).git, fakeUpdate(h).update);
    const first = acquireLock(F, { now: Date.now() });
    assert.ok(first.ok);
    assert.equal(acquireLock(F).ok, false, 'held');
    const g = fakeGit();
    const u = fakeUpdate(h);
    const r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'busy');
    assert.equal(g.calls.length, 0, 'not even git status');
    assert.equal(u.runs(), 0);
    assert.ok(fs.existsSync(F.lock), 'the other run’s lock is left alone');
    assert.equal(readStatus(F).result.outcome, 'current', 'busy does not hide the last result');
    // A lock from a run that died hours ago.
    fs.writeFileSync(F.lock, JSON.stringify({ pid: 999999, at: new Date(Date.now() - LOCK_STALE_MS - 60_000).toISOString() }));
    const lines = [];
    const r2 = auto(h, fakeGit({ local: NEW, head: NEW }).git, fakeUpdate(h).update, { out: (s) => lines.push(s) });
    assert.equal(r2.outcome, 'current');
    assert.match(lines.join('\n'), /cleared a stale lock/);
  } finally {
    rm(h);
  }
});

test('a deploy in progress: busy, nothing done; a marker hours old is ignored', () => {
  const h = home();
  try {
    const F = updateFiles(h);
    fs.writeFileSync(F.deploying, new Date().toISOString());
    const g = fakeGit();
    assert.equal(auto(h, g.git, fakeUpdate(h).update).outcome, 'busy');
    assert.equal(g.calls.length, 0);
    const old = (Date.now() - LOCK_STALE_MS - 60_000) / 1000;
    fs.utimesSync(F.deploying, old, old);
    assert.equal(auto(h, fakeGit().git, fakeUpdate(h).update).outcome, 'updated');
  } finally {
    rm(h);
  }
});

test('refusals that never touch the checkout: local changes, a fetch that fails, a non-fast-forward (force-pushed) branch', () => {
  const h = home();
  try {
    let g = fakeGit({ dirty: ' M server/index.mjs\n' });
    let r = auto(h, g.git, fakeUpdate(h).update);
    assert.equal(r.outcome, 'refused');
    assert.deepEqual(g.calls.map((c) => c.split(' ')[0]), ['status']);
    g = fakeGit({ fetch: 128 });
    r = auto(h, g.git, fakeUpdate(h).update);
    assert.equal(r.outcome, 'error');
    assert.match(r.entry.error, /git fetch failed/);
    g = fakeGit({ ancestor: false });
    const u = fakeUpdate(h);
    r = auto(h, g.git, u.update);
    assert.equal(r.outcome, 'refused');
    assert.match(r.entry.error, /force-pushed/);
    assert.equal(u.runs(), 0);
    assert.ok(!g.calls.some((c) => /^(merge |reset|checkout)/.test(c)), 'never merged, reset or checked out');
  } finally {
    rm(h);
  }
});

test('--trigger-only does nothing at all without the trigger file (no git, no log line); with it, one run that consumes it', () => {
  const h = home(NEW.slice(0, 7));
  try {
    const F = updateFiles(h);
    const g = fakeGit({ local: NEW, head: NEW });
    assert.equal(auto(h, g.git, fakeUpdate(h).update, { triggerOnly: true }).outcome, 'idle');
    assert.equal(g.calls.length, 0);
    assert.ok(!fs.existsSync(F.log), 'no log line for an idle check');
    fs.writeFileSync(F.trigger, '');
    const r = auto(h, g.git, fakeUpdate(h).update, { triggerOnly: true });
    assert.equal(r.outcome, 'current');
    assert.equal(r.entry.by, 'update-now');
    assert.ok(!fs.existsSync(F.trigger));
  } finally {
    rm(h);
  }
});

test('update.log rotates at its size limit, keeping the newest files', () => {
  const h = home();
  try {
    const F = updateFiles(h);
    for (let i = 0; i < 12; i++) appendLog(F, { i, pad: 'x'.repeat(80) }, { maxBytes: 300, keep: 2 });
    const files = fs.readdirSync(F.logs).filter((f) => f.startsWith('update.log')).sort();
    assert.deepEqual(files, ['update.log', 'update.log.1', 'update.log.2']);
    assert.ok(fs.statSync(F.log).size < 300 + 200, 'at most the limit plus one line');
    const last = fs.readFileSync(F.log, 'utf8').trim().split('\n').at(-1);
    assert.equal(JSON.parse(last).i, 11);
  } finally {
    rm(h);
  }
});

// ── a real git repo: the fast-forward check ──────────────────────────────

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

test('with real git: a fast-forward is updated; a force-pushed branch is refused and the checkout is left exactly as it was', { skip: !HAS_GIT && 'no git' }, () => {
  const dir = tempDir('blumodel-au-git-');
  const h = home();
  try {
    const sh = (cwd, ...args) => {
      const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test', GIT_CONFIG_NOSYSTEM: '1' } });
      assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const origin = path.join(dir, 'origin.git');
    const work = path.join(dir, 'work');
    const checkout = path.join(dir, 'checkout');
    sh(dir, 'init', '--bare', '-b', 'blumodel-studio', origin);
    sh(dir, 'clone', origin, work);
    sh(work, 'checkout', '-b', 'blumodel-studio');
    fs.writeFileSync(path.join(work, 'a.txt'), '1');
    sh(work, 'add', '.');
    sh(work, 'commit', '-m', 'one');
    sh(work, 'push', 'origin', 'blumodel-studio');
    sh(dir, 'clone', '--branch', 'blumodel-studio', origin, checkout);
    const one = sh(checkout, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(h, 'app', 'DEPLOYED.txt'), `commit ${one.slice(0, 7)}\n`);
    const git = (args) => {
      const r = spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8' });
      return { status: r.status ?? 1, stdout: r.stdout ?? '' };
    };
    const run = (code = 0) => runAuto({ home: h, root: checkout, branch: 'blumodel-studio', git, update: () => {
      if (code === 0) fs.writeFileSync(path.join(h, 'app', 'DEPLOYED.txt'), `commit ${sh(checkout, 'rev-parse', '--short', 'HEAD')}\n`);
      return code;
    }, out: () => {} });

    assert.equal(run().outcome, 'current');
    fs.writeFileSync(path.join(work, 'a.txt'), '2');
    sh(work, 'commit', '-am', 'two');
    sh(work, 'push', 'origin', 'blumodel-studio');
    const two = sh(work, 'rev-parse', 'HEAD');
    assert.equal(run().outcome, 'updated');
    assert.equal(sh(checkout, 'rev-parse', 'HEAD'), two, 'fast-forwarded');

    // Rewrite history and force-push it.
    sh(work, 'reset', '--hard', one);
    fs.writeFileSync(path.join(work, 'a.txt'), 'other');
    sh(work, 'commit', '-am', 'rewritten');
    sh(work, 'push', '--force', 'origin', 'blumodel-studio');
    const r = run();
    assert.equal(r.outcome, 'refused');
    assert.match(r.entry.error, /not an ancestor/);
    assert.equal(sh(checkout, 'rev-parse', 'HEAD'), two, 'the checkout was not reset');
    assert.equal(sh(checkout, 'status', '--porcelain'), '');
  } finally {
    rm(dir);
    rm(h);
  }
});

// ── update.mjs itself ─────────────────────────────────────────────────────

test('update.mjs: --auto takes no plan options; --trigger-only needs --auto; the usage names --build and --auto', () => {
  const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'host', 'update.mjs'), ...a], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(cli('--auto', '--dry-run').status, 2);
  assert.equal(cli('--auto', '--force').status, 2);
  assert.equal(cli('--trigger-only').status, 2);
  const bad = cli('--nope');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--build/);
  assert.match(bad.stderr, /--auto \[--trigger-only\]/);
});
