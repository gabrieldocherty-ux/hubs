// npm run release (scripts/release.mjs): the release tree made with git plumbing (HEAD's
// blumodel-studio/ plus its build, RELEASE.json and the two top-level files, nothing else from the
// repo), the rule that a release contains the one before it, and the fast-forward parent. All in temp
// git repos; nothing is pushed anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUILD_PATHS, TOP_FILES, checkSuccession, git, releaseMessage, releaseSource, releaseTree } from '../../scripts/release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test', GIT_CONFIG_NOSYSTEM: '1' };
const g = (cwd, ...args) => {
  const r = git(cwd, args, { env: ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

/** A repo shaped like this one: other things at the top, the app in blumodel-studio/ with its build ignored. */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-rel-'));
  g(dir, 'init', '-q', '-b', 'work');
  g(dir, 'config', 'core.autocrlf', 'false');
  write(dir, 'CLAUDE.md', 'the trading bot\n');
  write(dir, 'main.py', 'print("bot")\n');
  write(dir, 'blumodel-studio/.gitignore', 'dist/\nserver/generated/\nnode_modules/\n');
  write(dir, 'blumodel-studio/server/index.mjs', 'export {};\n');
  write(dir, 'blumodel-studio/scripts/host/install-linux.sh', '#!/usr/bin/env bash\n');
  write(dir, 'blumodel-studio/release/WYSE_SETUP.md', '# Setting up the Wyse\n');
  write(dir, 'blumodel-studio/release/CLAUDE.md', '# Read WYSE_SETUP.md\n');
  g(dir, 'add', '.');
  g(dir, 'commit', '-q', '-m', 'one');
  return dir;
}
/** The build output, on disk only (as release.mjs leaves it in its temp worktree). */
function build(dir, source) {
  write(dir, 'blumodel-studio/dist/index.html', '<!doctype html>');
  write(dir, 'blumodel-studio/dist/assets/app.js', 'x');
  write(dir, 'blumodel-studio/server/generated/export-kit.mjs', 'export {};');
  write(dir, 'blumodel-studio/RELEASE.json', JSON.stringify({ source }));
}
const topFiles = (dir) => Object.fromEntries(TOP_FILES.map((n) => [n, path.join(dir, 'blumodel-studio', 'release', n)]));

test('the release tree: HEAD’s blumodel-studio/ plus dist/, server/generated/ and RELEASE.json, WYSE_SETUP.md and CLAUDE.md at the top, nothing else from the repo; the checkout is untouched', { skip: !HAS_GIT && 'no git' }, () => {
  const dir = makeRepo();
  try {
    const head = g(dir, 'rev-parse', 'HEAD');
    build(dir, head);
    const index = path.join(dir, '..', `rel-index-${process.pid}`);
    const tree = releaseTree({ wt: dir, source: head, topFiles: topFiles(dir), index });
    const files = g(dir, 'ls-tree', '-r', '--name-only', tree).split('\n').sort();
    assert.deepEqual(files, [
      'CLAUDE.md',
      'WYSE_SETUP.md',
      'blumodel-studio/.gitignore',
      'blumodel-studio/RELEASE.json',
      'blumodel-studio/dist/assets/app.js',
      'blumodel-studio/dist/index.html',
      'blumodel-studio/release/CLAUDE.md',
      'blumodel-studio/release/WYSE_SETUP.md',
      'blumodel-studio/scripts/host/install-linux.sh',
      'blumodel-studio/server/generated/export-kit.mjs',
      'blumodel-studio/server/index.mjs',
    ]);
    assert.equal(g(dir, 'show', `${tree}:CLAUDE.md`), '# Read WYSE_SETUP.md', 'the release’s CLAUDE.md, not the trading bot’s');
    assert.deepEqual([...BUILD_PATHS], ['dist', 'server/generated', 'RELEASE.json']);
    // The work branch and its index know nothing of it.
    assert.equal(g(dir, 'rev-parse', 'HEAD'), head);
    assert.equal(g(dir, 'status', '--porcelain', '--untracked-files=no'), '');
    assert.doesNotMatch(g(dir, 'ls-files'), /dist\/|generated\//);
    fs.rmSync(index, { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('succession: the first release; a release that contains the last one; refused when HEAD is older or has diverged; a release commit on top of the tip is a fast-forward', { skip: !HAS_GIT && 'no git' }, () => {
  const dir = makeRepo();
  try {
    const one = g(dir, 'rev-parse', 'HEAD');
    assert.deepEqual(checkSuccession(dir, { head: one, tip: null }), { ok: true, previousSource: null });
    // A branch from before releases: its tip is a plain source commit.
    assert.equal(releaseSource(dir, one), one);
    write(dir, 'blumodel-studio/server/index.mjs', 'export const two = 2;\n');
    g(dir, 'commit', '-q', '-am', 'two');
    const two = g(dir, 'rev-parse', 'HEAD');
    assert.equal(checkSuccession(dir, { head: two, tip: one }).ok, true);

    // Publish `two` as a release on top of `one`.
    build(dir, two);
    const index = path.join(dir, '..', `rel-index2-${process.pid}`);
    const tree = releaseTree({ wt: dir, source: two, topFiles: topFiles(dir), index });
    const rel = git(dir, ['commit-tree', tree, '-p', one, '-F', '-'], { env: ENV, input: releaseMessage({ source: two, subject: 'two', branch: 'blumodel-studio' }) }).stdout;
    assert.equal(git(dir, ['merge-base', '--is-ancestor', one, rel]).status, 0, 'a fast-forward of the old tip');
    assert.equal(releaseSource(dir, rel), two, 'RELEASE.json names the source');
    assert.match(g(dir, 'log', '-1', '--format=%B', rel), /^release: blumodel-studio [0-9a-f]{10} - two/);

    assert.equal(checkSuccession(dir, { head: two, tip: rel }).same, true);
    const older = checkSuccession(dir, { head: one, tip: rel });
    assert.equal(older.ok, false);
    assert.match(older.reason, /does not contain the previous release's source/);
    g(dir, 'checkout', '-q', '-b', 'side', one);
    write(dir, 'blumodel-studio/server/side.mjs', 'export const side = 1;\n');
    g(dir, 'add', '.');
    g(dir, 'commit', '-q', '-m', 'side');
    const side = g(dir, 'rev-parse', 'HEAD');
    assert.equal(checkSuccession(dir, { head: side, tip: rel }).ok, false, 'diverged: would drop `two`');
    g(dir, 'merge', '-q', '--no-edit', two);
    assert.equal(checkSuccession(dir, { head: g(dir, 'rev-parse', 'HEAD'), tip: rel }).ok, true, 'merged: fine');
    fs.rmSync(index, { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release.mjs: bad options are a usage error; the release files it puts at the top exist; npm run release is wired', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release.mjs'), '--force'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--yes\] \[--qa/);
  for (const f of TOP_FILES) assert.ok(fs.existsSync(path.join(ROOT, 'release', f)), f);
  const setup = fs.readFileSync(path.join(ROOT, 'release', 'WYSE_SETUP.md'), 'utf8');
  assert.match(setup.split('\n').slice(0, 4).join('\n'), /\*\*Run this\*\*/, 'leads with Run this');
  for (const re of [/never open, read, print/i, /never force-push/i, /data\//, /Ask Gabe before the cutover/, /split-brain/i, /--rollback/, /blumodel-update\.timer/]) assert.match(setup, re);
  assert.match(fs.readFileSync(path.join(ROOT, 'release', 'CLAUDE.md'), 'utf8'), /WYSE_SETUP\.md/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.release, 'node scripts/release.mjs');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'release.mjs'), 'utf8');
  const pushes = src.split('\n').filter((l) => /\['push',/.test(l));
  assert.equal(pushes.length, 1);
  assert.doesNotMatch(pushes[0], /--force|'-f'|\+/, 'never a forced push');
});
