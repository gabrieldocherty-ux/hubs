// Linux file systems are case-sensitive; Windows (and macOS by default) are not. An import written
// './Foo' for foo.ts, or an asset URL '/Icons/icon.svg' for public/icons/icon.svg, works on this PC
// and fails on the Wyse: a blank page, a server that won't start, a 404 for a font. Node's
// fs.existsSync can't catch it here (it answers true on Windows whatever the case), so this test
// walks every path one directory listing at a time and compares names exactly.
//
// What it checks, from the repo root (blumodel-studio/):
//   - every relative import / export / dynamic import / require / new URL(..., import.meta.url) in
//     src/, server/, scripts/ and the root config files, resolved the way Vite, tsc and Node do
//     (exact file, then .ts/.tsx/.mjs/.js/.json, then a folder's index; './x.js' may mean x.ts);
//   - CSS @import and url(...) (relative to the file; '/x' is public/x);
//   - index.html's src/href, the web manifest's icons, and every '/<public path>' string in the code
//     whose first segment is in public/ (fonts, icons, the hero image, /draco/, theme-boot.js);
//   - the Draco decoder names three-stdlib's loader asks for under /draco/;
//   - path.join / path.resolve calls whose last arguments are plain strings (e.g. 'src', 'data',
//     'retail.json'): if those name an existing path only in a different case, that's a mismatch.
// A relative import that resolves to nothing at all fails too (it would fail on any OS).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'public');
/** Folders that are generated, installed or local state, never source. */
const SKIP = new Set(['node_modules', 'dist', '.build', '.qa', '.git', '.tmp-tests', '.smoke', 'generated', 'data']);

/** Every file under `dir` whose name matches `re` (skipping SKIP folders). */
function walk(dir, re, out = []) {
  let list = [];
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // server/data is local state; src/data is source (the catalog) and must be scanned.
      if (SKIP.has(e.name) && !(e.name === 'data' && path.basename(dir) === 'src')) continue;
      walk(p, re, out);
    } else if (e.isFile() && re.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * A case-exact path checker rooted at `root`. `lookup(abs)` answers
 *   { status: 'exact', actual }   every segment exists with exactly this spelling
 *   { status: 'case', actual }    it exists, but only spelled differently (actual = the real names)
 *   { status: 'missing' }         nothing there in any case
 *   { status: 'outside' }         not under root
 */
export function caseChecker(root) {
  const cache = new Map();
  const names = (dir) => {
    if (!cache.has(dir)) {
      try {
        cache.set(dir, fs.readdirSync(dir));
      } catch {
        cache.set(dir, null);
      }
    }
    return cache.get(dir);
  };
  return function lookup(abs) {
    const rel = path.relative(root, abs);
    if (rel === '') return { status: 'exact', actual: root };
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { status: 'outside' };
    let actual = root;
    let exact = true;
    for (const seg of rel.split(path.sep)) {
      const list = names(actual);
      if (!list) return { status: 'missing' };
      if (list.includes(seg)) {
        actual = path.join(actual, seg);
        continue;
      }
      const other = list.find((n) => n.toLowerCase() === seg.toLowerCase());
      if (!other) return { status: 'missing' };
      exact = false;
      actual = path.join(actual, other);
    }
    return { status: exact ? 'exact' : 'case', actual };
  };
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The first candidate that exists: exact → ok; else the first that exists in another case → a
 * mismatch; else missing. `want` is 'file' or 'dir'.
 */
function resolveCandidates(lookup, candidates, want = 'file') {
  let caseHit = null;
  for (const c of candidates) {
    const r = lookup(c);
    if (r.status === 'outside') return { status: 'outside' };
    const kindOk = want === 'dir' ? isDir(r.actual ?? '') : isFile(r.actual ?? '');
    if (r.status === 'exact' && kindOk) return { status: 'exact', actual: r.actual };
    if (r.status === 'case' && kindOk && !caseHit) caseHit = { status: 'case', wanted: c, actual: r.actual };
  }
  return caseHit ?? { status: 'missing' };
}

/** How Vite / tsc (moduleResolution: bundler) / Node look a relative specifier up. */
function moduleCandidates(base) {
  const out = [base];
  if (/\.(m?js|jsx)$/.test(base)) {
    const stem = base.replace(/\.(m?js|jsx)$/, '');
    out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`);
  }
  for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.json', '.d.ts', '.css']) out.push(base + ext);
  for (const ext of ['.ts', '.tsx', '.mjs', '.js']) out.push(path.join(base, `index${ext}`));
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const stripQuery = (s) => s.replace(/[?#].*$/, '');

/** Relative module specifiers in JS/TS source: `{ spec, index }`. */
function jsSpecifiers(text) {
  const out = [];
  const res = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
    /\bnew\s+URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url/g,
  ];
  for (const re of res) for (const m of text.matchAll(re)) if (/^\.\.?\//.test(m[2])) out.push({ spec: m[2], index: m.index });
  return out;
}

/** CSS @import and url(...) targets that are local files: `{ spec, index }`. */
function cssSpecifiers(text) {
  const out = [];
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/g)) out.push({ spec: m[2], index: m.index });
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) out.push({ spec: m[2], index: m.index });
  return out.filter((s) => !/^(data:|https?:|#|about:)/i.test(s.spec) && !s.spec.startsWith('%'));
}

/** Top-level names in public/ (lower-cased), for spotting '/<public path>' strings in code. */
const publicTop = () => new Set(fs.readdirSync(PUBLIC).map((n) => n.toLowerCase()));

/** '/fonts/x.woff2'-style strings in code whose first segment is something in public/. */
function publicRefs(text, top) {
  const out = [];
  for (const m of text.matchAll(/(['"`(])(\/[A-Za-z0-9_][A-Za-z0-9_.\-/]*)(?=['"`)?#])/g)) {
    const ref = m[2];
    const first = ref.slice(1).split('/')[0].toLowerCase();
    if (!top.has(first)) continue;
    out.push({ spec: ref, index: m.index });
  }
  return out;
}

/** The string-literal tail of each path.join / path.resolve call: `{ segs, index }`. */
function pathJoinTails(text) {
  const out = [];
  const re = /\bpath\.(?:join|resolve)\(/g;
  for (const m of text.matchAll(re)) {
    // The call's argument list, up to its matching parenthesis.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    let quote = null;
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const args = [];
    let cur = '';
    let d = 0;
    quote = null;
    for (const ch of text.slice(start, i - 1)) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      if (ch === '(' || ch === '[' || ch === '{') d++;
      if (ch === ')' || ch === ']' || ch === '}') d--;
      if (ch === ',' && d === 0) {
        args.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    const tail = [];
    for (let k = args.length - 1; k >= 0; k--) {
      const lit = /^(['"])([^'"$\\]*)\1$/.exec(args[k]);
      if (!lit) break;
      tail.unshift(lit[2]);
    }
    const segs = tail.flatMap((s) => s.split('/')).filter((s) => s && s !== '.');
    if (segs.length && !segs.includes('..') && segs.some((s) => /[A-Za-z]/.test(s))) out.push({ segs, index: m.index });
  }
  return out;
}

/** Every case problem in the repo, as readable lines. Also returns what it checked, for the report. */
export function scanRepo() {
  const lookup = caseChecker(ROOT);
  const problems = [];
  const counted = { modules: 0, css: 0, html: 0, publicRefs: 0, pathJoins: 0 };
  const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
  const report = (file, text, index, wrote, r) => {
    const where = `${rel(file)}:${lineOf(text, index)}`;
    if (r.status === 'case') problems.push(`${where}: '${wrote}' is spelled ${rel(r.actual)} on disk`);
    else problems.push(`${where}: '${wrote}' does not exist`);
  };

  const self = fileURLToPath(import.meta.url); // its fixtures are wrong on purpose
  const code = [
    ...walk(path.join(ROOT, 'src'), /\.(tsx?|mjs|js)$/),
    ...walk(path.join(ROOT, 'server'), /\.(mjs|js)$/),
    ...walk(path.join(ROOT, 'scripts'), /\.(mjs|js)$/),
    ...fs
      .readdirSync(ROOT)
      .filter((n) => /\.(ts|mjs|js)$/.test(n))
      .map((n) => path.join(ROOT, n)),
  ].filter((f) => path.resolve(f) !== path.resolve(self));
  const top = publicTop();
  for (const file of code) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { spec, index } of jsSpecifiers(text)) {
      counted.modules++;
      const r = resolveCandidates(lookup, moduleCandidates(path.resolve(path.dirname(file), stripQuery(spec))));
      if (r.status !== 'exact' && r.status !== 'outside') report(file, text, index, spec, r);
    }
    // Public paths are served by the browser-facing code; the server and scripts name routes
    // ('/files/…', '/api/…') that aren't files, so only src/ is checked for these.
    if (rel(file).startsWith('src/')) {
      for (const { spec, index } of publicRefs(text, top)) {
        counted.publicRefs++;
        const p = path.join(PUBLIC, ...stripQuery(spec).split('/').filter(Boolean));
        const r = spec.endsWith('/') ? resolveCandidates(lookup, [p], 'dir') : resolveCandidates(lookup, [p]);
        if (r.status !== 'exact') report(file, text, index, spec, r);
      }
    }
    for (const { segs, index } of pathJoinTails(text)) {
      counted.pathJoins++;
      const bases = [path.dirname(file), ROOT, path.join(ROOT, 'server'), path.join(ROOT, 'src')];
      const hits = bases.map((b) => lookup(path.join(b, ...segs)));
      if (hits.some((h) => h.status === 'exact')) continue;
      const wrong = hits.find((h) => h.status === 'case');
      if (wrong) report(file, text, index, segs.join('/'), wrong);
    }
  }

  for (const file of walk(path.join(ROOT, 'src'), /\.css$/)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { spec, index } of cssSpecifiers(text)) {
      counted.css++;
      const clean = stripQuery(spec);
      const target = clean.startsWith('/') ? path.join(PUBLIC, ...clean.split('/').filter(Boolean)) : path.resolve(path.dirname(file), clean);
      const r = resolveCandidates(lookup, [target]);
      if (r.status !== 'exact') report(file, text, index, spec, r);
    }
  }

  const htmlFile = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/g)) {
    const spec = m[2];
    if (/^(https?:|mailto:|#|data:)/i.test(spec)) continue;
    counted.html++;
    const segs = stripQuery(spec).split('/').filter(Boolean);
    // Vite serves public/ at the root, and resolves other root paths (/src/main.tsx) from the project.
    const r = resolveCandidates(lookup, [path.join(PUBLIC, ...segs), path.join(ROOT, ...segs)]);
    if (r.status !== 'exact') report(htmlFile, html, m.index, spec, r);
  }

  const manifestFile = path.join(PUBLIC, 'manifest.webmanifest');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  for (const icon of JSON.parse(manifestText).icons ?? []) {
    counted.publicRefs++;
    const r = resolveCandidates(lookup, [path.join(PUBLIC, ...icon.src.split('/').filter(Boolean))]);
    if (r.status !== 'exact') report(manifestFile, manifestText, manifestText.indexOf(icon.src), icon.src, r);
  }

  // The decoders three-stdlib's DRACOLoader fetches from /draco/ (src/components/three/gltf.tsx).
  const loaderFile = path.join(ROOT, 'node_modules', 'three-stdlib', 'loaders', 'DRACOLoader.js');
  if (fs.existsSync(loaderFile)) {
    const loader = fs.readFileSync(loaderFile, 'utf8');
    for (const name of new Set(loader.match(/draco_[a-z_]+\.(?:js|wasm)/g) ?? [])) {
      counted.publicRefs++;
      const r = resolveCandidates(lookup, [path.join(PUBLIC, 'draco', name)]);
      if (r.status !== 'exact') problems.push(`three-stdlib's DRACOLoader asks for /draco/${name}: ${r.status === 'case' ? `spelled ${rel(r.actual)} on disk` : 'not in public/draco/'}`);
    }
  }
  return { problems, counted, files: code.length };
}

test('the case checker itself: a wrong-cased path is caught even on a case-insensitive disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-case-'));
  try {
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'lib', 'helper.mjs'), 'export const x = 1;\n');
    const lookup = caseChecker(dir);
    assert.equal(lookup(path.join(dir, 'lib', 'helper.mjs')).status, 'exact');
    const wrong = lookup(path.join(dir, 'Lib', 'Helper.mjs'));
    assert.equal(wrong.status, 'case');
    assert.equal(wrong.actual, path.join(dir, 'lib', 'helper.mjs'));
    assert.equal(lookup(path.join(dir, 'lib', 'nope.mjs')).status, 'missing');
    assert.equal(lookup(path.join(os.tmpdir(), 'elsewhere')).status, 'outside');
    // An import of './Helper' resolves (case-insensitively) only to a mismatch, never to 'exact'.
    const r = resolveCandidates(lookup, moduleCandidates(path.join(dir, 'lib', 'Helper')));
    assert.equal(r.status, 'case');
    // The real repo is checked by the same function: a deliberately wrong spelling is a mismatch.
    assert.equal(caseChecker(ROOT)(path.join(ROOT, 'Server', 'Config.mjs')).status, 'case');
    assert.equal(caseChecker(ROOT)(path.join(ROOT, 'server', 'config.mjs')).status, 'exact');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the specifier scanners find imports, CSS urls, public paths and path.join tails', () => {
  const js = `import a from './A';\nexport { b } from "../b.js";\nimport './side.css';\nconst c = await import('./lazy');\nconst u = new URL('./w.wasm', import.meta.url);\nimport x from 'react';\n`;
  assert.deepEqual(
    jsSpecifiers(js).map((s) => s.spec).sort(),
    ['../b.js', './A', './lazy', './side.css', './w.wasm'],
  );
  assert.deepEqual(cssSpecifiers(`@import './x.css';\n@font-face { src: url('/fonts/a.woff2') format('woff2'), url(data:font/woff2;base64,AA); }`).map((s) => s.spec), ['./x.css', '/fonts/a.woff2']);
  assert.deepEqual(publicRefs(`const a = '/icons/icon.svg'; const b = "/api/health"; const c = \`/draco/\`;`, new Set(['icons', 'draco'])).map((s) => s.spec), ['/icons/icon.svg', '/draco/']);
  assert.deepEqual(pathJoinTails(`path.join(ROOT, 'src', 'data', 'retail.json'); path.resolve(x, y); path.join(path.dirname(f), 'Seed', \`\${n}.mjs\`)`).map((t) => t.segs), [['src', 'data', 'retail.json']]);
});

// A clone on Linux gets the names in Git's index, not the names on this disk. A file renamed only in
// case on Windows (core.ignorecase=true) can keep its old spelling in the index: the imports above
// match this disk and still break on the Wyse. So the index must agree with the disk, and no two
// tracked paths may differ only in case (they'd collide on a Windows or macOS checkout).
let tracked = null;
try {
  tracked = execFileSync('git', ['ls-files', '-z', '--full-name', '.'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    .split('\0')
    .filter(Boolean);
} catch {
  tracked = null; // not a git checkout (an exported copy) or no git: nothing to compare
}

test("Git's index spells every tracked file the way this disk does, and no two differ only in case", { skip: tracked ? false : 'not a git checkout' }, () => {
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  const lookup = caseChecker(ROOT);
  const wrong = [];
  const seen = new Map();
  for (const full of tracked) {
    const rel = prefix && full.startsWith(prefix) ? full.slice(prefix.length) : full;
    const key = rel.toLowerCase();
    if (seen.has(key)) wrong.push(`${seen.get(key)} and ${rel} differ only in case`);
    seen.set(key, rel);
    const r = lookup(path.join(ROOT, ...rel.split('/')));
    if (r.status === 'case') wrong.push(`git tracks ${rel}, the disk has ${path.relative(ROOT, r.actual).split(path.sep).join('/')} (fix with git mv)`);
  }
  assert.ok(tracked.length > 300, `${tracked.length} tracked files`);
  assert.deepEqual(wrong, [], `\n${wrong.join('\n')}`);
});

test('every relative import, asset URL and literal path in the repo matches the on-disk name exactly (Linux is case-sensitive)', (t) => {
  const { problems, counted, files } = scanRepo();
  t.diagnostic(`scanned ${files} source files: ${JSON.stringify(counted)}`);
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
  // The scanners really found things (a regex that silently matched nothing would pass above).
  assert.ok(files > 200, `scanned ${files} source files`);
  assert.ok(counted.modules > 500, `checked ${counted.modules} relative imports`);
  assert.ok(counted.publicRefs >= 8, `checked ${counted.publicRefs} public asset paths`);
  assert.ok(counted.css >= 10, `checked ${counted.css} CSS urls`);
  assert.ok(counted.html >= 5, `checked ${counted.html} index.html references`);
  assert.ok(counted.pathJoins >= 20, `checked ${counted.pathJoins} path.join tails`);
});
