// Unit tests for the TypeScript in src/, with no test framework to install:
// esbuild (already here via Vite) bundles every src/**/*.test.ts to .tmp-tests/,
// then Node's built-in runner executes them.
//
//   npm test                       all tests
//   npm test -- interaction        only files whose path contains "interaction"
//
// Tests use node:test + node:assert/strict. scripts/test-env.mjs is preloaded and
// provides the few browser globals the store touches at import time (localStorage,
// window.location), so store modules can be imported as-is.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.tmp-tests');
const filters = process.argv.slice(2);

function findTests(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findTests(p));
    else if (/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const entries = findTests(path.join(root, 'src')).filter((f) => !filters.length || filters.some((s) => f.replace(/\\/g, '/').includes(s)));
if (!entries.length) {
  console.error(filters.length ? `No tests match ${filters.join(', ')}` : 'No src/**/*.test.ts files found.');
  process.exit(1);
}

fs.rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: entries,
  outbase: path.join(root, 'src'),
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Dependencies (react, zustand…) load from node_modules as usual; only our TS is bundled.
  packages: 'external',
  jsx: 'automatic',
  sourcemap: 'inline',
  logLevel: 'warning',
});

const files = entries.map((f) => path.join(outdir, path.relative(path.join(root, 'src'), f)).replace(/\.tsx?$/, '.mjs'));
const res = spawnSync(process.execPath, ['--enable-source-maps', '--import', './scripts/test-env.mjs', '--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(res.status ?? 1);
