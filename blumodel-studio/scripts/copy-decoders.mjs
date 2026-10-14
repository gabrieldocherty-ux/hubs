// Copies three's Draco decoders into public/draco/ so GLB products decode with no CDN request
// (drei's default Draco path is gstatic.com, which the offline rule forbids). Vite serves
// public/ at the site root in dev and copies it into dist/ on build, so the decoder URL is
// always /draco/. The copies are committed; run this again after upgrading three.
//
//   node scripts/copy-decoders.mjs           copy (or refresh) the files
//   node scripts/copy-decoders.mjs --check   exit 1 if public/draco/ is missing or stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const to = path.join(root, 'public', 'draco');
const FILES = ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js'];
const check = process.argv.includes('--check');

let stale = 0;
for (const f of FILES) {
  const src = path.join(from, f);
  const dst = path.join(to, f);
  if (!fs.existsSync(src)) {
    console.error(`Missing ${path.relative(root, src)}. Run npm ci first.`);
    process.exit(1);
  }
  const same = fs.existsSync(dst) && fs.readFileSync(src).equals(fs.readFileSync(dst));
  if (same) continue;
  stale++;
  if (check) {
    console.error(`public/draco/${f} is missing or differs from three's copy.`);
    continue;
  }
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`Copied ${f} (${(fs.statSync(dst).size / 1024).toFixed(0)} KB)`);
}
if (check && stale) process.exit(1);
if (!stale) console.log('public/draco/ is up to date.');
