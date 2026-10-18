// The Windows home's tools (server/ops/winTools.mjs): blumodel.cmd, update-now.cmd ("Update
// BluModel" on the desktop), the face's .url shortcut and the .ico. The .cmd files run for real in
// a temp home with stub scripts; nothing here updates, deploys or touches a real home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { faceShortcut, icoFromPng, toolScripts } from '../ops/winTools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';

test('blumodel.cmd and update-now.cmd: CRLF, the checkout’s scripts with this node, the home passed safely; refused without quotes in the node path', () => {
  const t = toolScripts({ node: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.deepEqual(Object.keys(t), ['blumodel.cmd', 'update-now.cmd']);
  for (const text of Object.values(t)) {
    assert.ok(!/[^\r]\n/.test(text), 'CRLF');
    assert.ok(/^[\x00-\x7f]*$/.test(text), 'ASCII');
  }
  assert.match(t['blumodel.cmd'], /"C:\\Program Files\\nodejs\\node\.exe" --no-warnings "%S%" %\*/);
  assert.match(t['blumodel.cmd'], /set "S=%~dp0repo\\blumodel-studio\\scripts\\host\\blumodel\.mjs"/);
  assert.match(t['update-now.cmd'], /"%S%" --home "%~dp0\."/, 'the home without a trailing backslash before the quote');
  assert.match(t['update-now.cmd'], /\r\npause\r\n/, 'the window stays open with the result');
  assert.throws(() => toolScripts({ node: 'C:\\a"b\\node.exe' }), /no quotes/);
});

test('the face shortcut and the icon', () => {
  assert.equal(faceShortcut(), '[InternetShortcut]\r\nURL=http://127.0.0.1:8799/\r\n');
  assert.equal(faceShortcut({ port: 8936, icon: 'C:\\H\\blumodel.ico' }), '[InternetShortcut]\r\nURL=http://127.0.0.1:8936/\r\nIconFile=C:\\H\\blumodel.ico\r\nIconIndex=0\r\n');
  assert.throws(() => faceShortcut({ port: 'x' }), /Not a port/);
  const png = fs.readFileSync(path.join(ROOT, 'public', 'icons', 'icon-192.png'));
  const ico = icoFromPng(png);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.deepEqual([ico[6], ico[7]], [192, 192]);
  assert.equal(ico.readUInt32LE(14), png.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(png));
  const big = fs.readFileSync(path.join(ROOT, 'public', 'icons', 'icon-512.png'));
  assert.deepEqual([icoFromPng(big)[6], icoFromPng(big)[7]], [0, 0], '256 px and up is 0');
  assert.throws(() => icoFromPng(Buffer.from('not a png at all, no')), /needs a PNG/);
});

test('the .cmd files run: without a checkout they say so; with one they hand their arguments and the home to the scripts', { skip: !WIN && 'Windows .cmd' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-wintools-'));
  try {
    for (const [n, body] of Object.entries(toolScripts({ node: process.execPath }))) fs.writeFileSync(path.join(home, n), body);
    const run = (n, ...a) => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', path.join(home, n), ...a], { encoding: 'utf8', windowsHide: true, input: '\r\n', timeout: 30_000 });
    let r = run('blumodel.cmd', 'sites', 'status');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /needs the install's checkout/);
    r = run('update-now.cmd');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no install checkout/);
    const host = path.join(home, 'repo', 'blumodel-studio', 'scripts', 'host');
    fs.mkdirSync(host, { recursive: true });
    fs.writeFileSync(path.join(host, 'blumodel.mjs'), 'console.log("ARGS " + JSON.stringify(process.argv.slice(2))); process.exit(7);\n');
    fs.writeFileSync(path.join(host, 'update.mjs'), 'console.log("ARGS " + JSON.stringify(process.argv.slice(2)));\n');
    r = run('blumodel.cmd', 'sites', 'off', '--yes');
    assert.match(r.stdout, /ARGS \["sites","off","--yes"\]/);
    assert.equal(r.status, 7, 'the exit code comes back');
    r = run('update-now.cmd');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const args = JSON.parse(/ARGS (.*)/.exec(r.stdout)[1]);
    assert.equal(args[0], '--home');
    assert.equal(path.resolve(args[1]), path.resolve(home));
    assert.match(r.stdout, /Done: BluModel Studio is up to date and running\./);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the Update now check costs nothing without the trigger: update-check.cmd (and the VBS fallback) start node only when logs\\update-now.request exists', { skip: !WIN && 'Windows .cmd and .vbs' }, async () => {
  const { updateCheckCmd, updateLauncherVbs } = await import('../ops/home.mjs');
  assert.throws(() => updateCheckCmd({ node: 'C:\\a"b\\node.exe' }), /no quotes/);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-upcheck-'));
  try {
    fs.mkdirSync(path.join(home, 'logs'));
    const host = path.join(home, 'repo', 'blumodel-studio', 'scripts', 'host');
    fs.mkdirSync(host, { recursive: true });
    const marker = path.join(home, 'ran.txt');
    // A stub update.mjs: records that node ran, and with what.
    fs.writeFileSync(path.join(host, 'update.mjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)));\n`.replace("require('node:fs')", "(await import('node:fs')).default"));
    fs.writeFileSync(path.join(home, 'update-check.cmd'), updateCheckCmd({ node: process.execPath }));
    fs.writeFileSync(path.join(home, 'update-hidden.vbs'), updateLauncherVbs({ node: process.execPath }));
    const check = () => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', path.join(home, 'update-check.cmd')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    const vbs = () => spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cscript.exe'), ['//nologo', path.join(home, 'update-hidden.vbs'), '--auto', '--trigger-only'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    let r = check();
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'nothing printed');
    assert.ok(!fs.existsSync(marker), 'node never started');
    assert.equal(vbs().status, 0);
    assert.ok(!fs.existsSync(marker), 'the VBS quits before node too');
    fs.writeFileSync(path.join(home, 'logs', 'update-now.request'), '{}');
    r = check();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const args = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.deepEqual([args[0], path.resolve(args[1]), ...args.slice(2)], ['--home', path.resolve(home), '--auto', '--trigger-only']);
    fs.rmSync(marker);
    assert.equal(vbs().status, 0);
    assert.ok(fs.existsSync(marker), 'with the trigger the VBS runs node');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
