import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Gabe's decision (PLANS_AND_CONTRACTORS, 2026-10-15): the $5 one-kitchen unlock is offered only in
// the export dialog a free user meets when they export. No other screen advertises it, names its
// price or hints at paying per kitchen. Account settings > Plan & billing said "Exports are paid per
// kitchen or with a plan", and Billing said "One kitchen only? Open it and choose Export".

const src = path.join(process.cwd(), 'src');
/** The export dialog itself, comments and receipts of unlocks already bought are fine. */
const ALLOWED = new Set(['features/billing/UnlockDialog.tsx', 'features/legal/content.tsx']);
const AD = /per[- ]kitchen|one kitchen only|choose Export to see|\$5\b|5 CAD|paid per/i;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...files(p));
    } else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The file's text with comments removed, so only what people can read is checked. */
const visible = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no screen but the export dialog advertises the per-kitchen unlock', () => {
  const hits: string[] = [];
  for (const f of files(src)) {
    const rel = path.relative(src, f).replace(/\\/g, '/');
    if (ALLOWED.has(rel)) continue;
    visible(fs.readFileSync(f, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (AD.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('Account settings: a free plan points at the plans and Pricing, not at paying per kitchen', () => {
  const s = fs.readFileSync(path.join(src, 'components/AccountSettings.tsx'), 'utf8');
  assert.match(s, /'Design, save and share for free\. Unlimited and Contractor plans add more\.'/);
  assert.match(s, /href="#\/pricing"/);
});
