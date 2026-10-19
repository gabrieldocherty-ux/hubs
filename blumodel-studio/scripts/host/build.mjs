// Builds the site for a deploy on this machine, with a memory guard for small machines (a 4 GB
// Dell Wyse): the export kit (scripts/build-kit.mjs), then vite into dist/ with
// NODE_OPTIONS=--max-old-space-size=<half the RAM, 1024-2048 MB>. Refuses, with the fix, when RAM
// plus swap is under 2 GB. No type check (npm run build has one; the branch is checked before it
// is published), which saves memory and minutes on a slow CPU.
//
//   node scripts/host/build.mjs                  # build into dist/
//   node scripts/host/build.mjs --out <dir>      # build somewhere else (deploy it with deploy-local --dist <dir>)
//   node scripts/host/build.mjs --dry-run        # print the memory plan and the commands
//
// Used by scripts/host/install-linux.sh, install-windows.ps1 and update.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMemoryPlan, machineMemory, showCommand } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The build's commands, run in `root`.
 * @param {{ root?: string, out?: string, heapMb: number, node?: string }} o
 * @returns {{ cmd: string, args: string[], env: Record<string, string> }[]}
 */
export function buildSteps({ root = ROOT, out = 'dist', heapMb, node = process.execPath }) {
  const env = { NODE_OPTIONS: `--max-old-space-size=${heapMb}` };
  return [
    { cmd: node, args: [path.join(root, 'scripts', 'build-kit.mjs')], env },
    { cmd: node, args: [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'], env },
  ];
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const bad = argv.filter((a, i) => a.startsWith('--') && !['--out', '--dry-run'].includes(a) && argv[i - 1] !== '--out');
  if (bad.length || (argv.includes('--out') && !argv[argv.indexOf('--out') + 1])) {
    console.error('Usage: node scripts/host/build.mjs [--out <dir>] [--dry-run]');
    process.exit(2);
  }
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'dist';
  const plan = buildMemoryPlan(machineMemory());
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(1);
  }
  console.log(plan.message);
  const steps = buildSteps({ out, heapMb: plan.heapMb });
  if (argv.includes('--dry-run')) {
    for (const s of steps) console.log(`+ NODE_OPTIONS=${s.env.NODE_OPTIONS} ${showCommand(s.cmd, s.args)}`);
    console.log('Dry run: nothing was built.');
    process.exit(0);
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))) {
    console.error('vite is not installed here: run npm ci first.');
    process.exit(1);
  }
  const started = Date.now();
  for (const s of steps) {
    console.log(`+ ${showCommand(s.cmd, s.args)}`);
    const r = spawnSync(s.cmd, s.args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...s.env } });
    if (r.status !== 0) {
      console.error(
        r.signal === 'SIGKILL' || r.status === 134 || r.status === 137
          ? `The build ran out of memory (${r.signal ?? `exit ${r.status}`}). Add swap (docs/HOSTING.md, "Disk and memory") or build on another computer.`
          : `The build failed (exit ${r.status ?? r.signal}).`,
      );
      process.exit(1);
    }
  }
  console.log(`Built into ${path.resolve(ROOT, out)} in ${Math.round((Date.now() - started) / 1000)} s.`);
}
