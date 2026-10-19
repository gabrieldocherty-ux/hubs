import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLAN_DARK, PLAN_LIGHT } from '../../components/plan/planStyle';
import { THEME_CHROME, resolveTheme } from '../theme';

// The colour tokens in src/styles.css: every light token has a dark value, the two dark blocks
// (data-theme="dark", and System before the script runs) are identical, and the pairs the app
// draws text and controls with meet WCAG AA in dark (and, in light, are no worse than before).

const css = fs.readFileSync(path.join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\r\n/g, '\n');

function block(startsWith: string): Map<string, string> {
  const i = css.indexOf(startsWith);
  assert.ok(i >= 0, `styles.css has no "${startsWith}" block`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const out = new Map<string, string>();
  for (const m of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const light = block(':root,\n.theme-paper');
const dark = block("  :root[data-theme='dark']");
const system = block('  :root:not([data-theme])');

const hex = (v: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  assert.ok(m, `${v} is not a #rrggbb colour`);
  return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
};
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (v: string) => {
  const [r, g, b] = hex(v);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const val = (t: Map<string, string>, v: string) => (v.startsWith('--') ? t.get(v)! : v);

test('every light token has a dark value, and both dark blocks match', () => {
  assert.ok(light.size >= 40, `only ${light.size} light tokens found`);
  const missing = [...light.keys()].filter((k) => !dark.has(k));
  assert.deepEqual(missing, [], `tokens with no dark value: ${missing.join(', ')}`);
  assert.deepEqual([...system.entries()], [...dark.entries()], 'the System (prefers-color-scheme) block differs from data-theme="dark"');
});

test('the light values are the ones the app had before dark mode', () => {
  const before: Record<string, string> = {
    '--paper': '#f3eee5',
    '--paper-2': '#ebe4d8',
    '--panel': '#fbf9f4',
    '--card': '#ffffff',
    '--ink': '#211e1a',
    '--ink-2': '#5f584d',
    '--ink-3': '#8c8477',
    '--line': '#e4dccd',
    '--line-2': '#d3c8b6',
    '--accent': '#c2542d',
    '--accent-2': '#a5431f',
    '--accent-soft': '#f7e6dd',
    '--ok': '#3f7d52',
    '--ok-soft': '#e4efe5',
    '--warn': '#b7791f',
    '--warn-soft': '#f8edd9',
    '--bad': '#c0392b',
    '--bad-soft': '#f8e1dd',
  };
  for (const [k, v] of Object.entries(before)) assert.equal(light.get(k), v, k);
  assert.equal(THEME_CHROME.light, light.get('--paper'));
  assert.equal(THEME_CHROME.dark, dark.get('--paper'));
});

/** [text, background, what] pairs the app uses for text and controls. */
const TEXT: [string, string, string][] = [
  ['--ink', '--paper', 'body text'],
  ['--ink', '--card', 'body text on cards'],
  ['--ink-2', '--paper', 'secondary text'],
  ['--ink-2', '--paper-2', 'secondary text on the second paper'],
  ['--ink-2', '--card', 'secondary text on cards'],
  ['--ink-3', '--paper', 'muted text'],
  ['--ink-3', '--paper-2', 'muted text on the second paper'],
  ['--ink-3', '--panel', 'muted text in panels'],
  ['--ink-3', '--card', 'muted text on cards'],
  ['--accent-text', '--paper', 'accent text'],
  ['--accent-text', '--card', 'accent text on cards'],
  ['--accent-2', '--card', 'links'],
  ['--accent-2', '--accent-soft', 'accent chips'],
  ['--ok', '--card', 'green text'],
  ['--ok', '--ok-soft', 'green on its soft fill'],
  ['--ok-ink', '--ok-soft', 'green notes'],
  ['--warn-ink', '--warn-soft', 'amber notes'],
  ['--warn', '--warn-soft', 'amber on its soft fill'],
  ['--bad', '--card', 'error text'],
  ['--bad', '--bad-soft', 'red on its soft fill'],
  ['--bad-ink', '--bad-soft', 'red notes'],
  ['--info-ink', '--info-soft', 'blue pills'],
  ['--panel', '--ink', 'primary (ink) buttons'],
  ['--card', '--ink', 'ink chips'],
  ['--on-inverse', '--inverse', 'toasts, summary card, banners'],
  ['--on-inverse-2', '--inverse', 'muted text on those'],
  ['#ffffff', '--accent', 'accent buttons'],
  ['#ffffff', '--accent-strong', 'accent buttons, hovered'],
  ['#ffffff', '--ok-solid', 'green fills'],
  ['#ffffff', '--bad-solid', 'danger buttons'],
];

/** Non-text: focus rings and input borders on focus (3:1). */
const RING: [string, string, string][] = [
  ['--accent', '--paper', 'focus ring on the page'],
  ['--accent', '--card', 'focus ring on cards'],
  ['--accent', '--panel', 'focus ring in panels'],
];

/** Light pairs already under AA before dark mode (light is unchanged; docs/handoff/dark.md). */
const LIGHT_BEFORE = new Set(['muted text', 'muted text on the second paper', 'muted text in panels', 'muted text on cards', 'accent text', 'accent text on cards', 'green on its soft fill', 'amber on its soft fill', 'red on its soft fill']);

test('dark: text and controls meet WCAG AA, focus rings 3:1', () => {
  for (const [fg, bg, what] of TEXT) {
    const r = contrast(val(dark, fg), val(dark, bg));
    assert.ok(r >= 4.5, `dark ${what}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
  }
  for (const [fg, bg, what] of RING) {
    const r = contrast(val(dark, fg), val(dark, bg));
    assert.ok(r >= 3, `dark ${what}: ${r.toFixed(2)}:1`);
  }
});

test('light: AA everywhere except the pairs that were already under it before dark mode', () => {
  const under: string[] = [];
  for (const [fg, bg, what] of TEXT) {
    const r = contrast(val(light, fg), val(light, bg));
    if (r < 4.5) under.push(what);
  }
  assert.deepEqual(under.filter((w) => !LIGHT_BEFORE.has(w)), [], 'new light pairs under AA');
  for (const [fg, bg, what] of RING) assert.ok(contrast(val(light, fg), val(light, bg)) >= 3, `light ${what}`);
});

test('the dark plan: line work and dimensions read on its sheet and surround', () => {
  assert.ok(contrast(PLAN_DARK.ink, PLAN_DARK.sheet) >= 7, 'drafting ink on the dark sheet');
  assert.ok(contrast(PLAN_DARK.ink, PLAN_DARK.paper) >= 7, 'compass and wall dimensions on the dark surround');
  assert.ok(contrast(PLAN_DARK.muted, PLAN_DARK.paper) >= 4.5, 'wall-run dimensions on the dark surround');
  assert.ok(contrast(PLAN_DARK.accent, PLAN_DARK.paper) >= 4.5, 'selection dimensions on the dark surround');
  assert.ok(contrast(PLAN_DARK.wall, PLAN_DARK.paper) >= 3, 'rendered walls against the dark surround');
  // Light is the plan as it was.
  assert.deepEqual(
    { ink: PLAN_LIGHT.ink, paper: PLAN_LIGHT.paper, sheet: PLAN_LIGHT.sheet, wall: PLAN_LIGHT.wall },
    { ink: '#29251f', paper: '#f3eee5', sheet: '#ffffff', wall: '#2f2a25' }
  );
});

test('System follows the device; an explicit choice wins', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});
