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
