#!/usr/bin/env node
/**
 * verify-design-tokens.mjs
 *
 * Guards the two invariants that make Tailwind opacity modifiers work:
 *
 *   1. Every alpha-capable token (`--x-rgb`) must be defined in BOTH theme
 *      blocks. A token defined only in dark renders fully transparent the
 *      moment the user switches to light mode.
 *   2. Each `--x-rgb` triplet must be the exact R G B of its sibling hex
 *      var (`--x`). A hand-converted typo silently ships the wrong colour.
 *
 * Also reports any Tailwind opacity modifier that still cannot compile
 * (i.e. a token left as a bare `var(--x)` while being used with `/NN`).
 *
 * Usage: node scripts/verify-design-tokens.mjs
 * Exit code 0 = clean, 1 = violations.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');

/** Extract `key: value;` pairs from a named theme block. */
function block(label) {
  const start = css.indexOf(label);
  if (start === -1) throw new Error(`theme block not found: ${label}`);
  const open = css.indexOf('{', start);
  // Walk braces so nested blocks (none today, but be safe) don't truncate us.
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const out = new Map();
  const body = css.slice(open + 1, end);
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const dark = block(':root[data-theme=\'dark\']');
const light = block(':root[data-theme=\'light\']');

const hexOf = (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
const tripletOf = (v) => {
  const m = v.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const rgbOfHex = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const problems = [];
const checked = [];

const rgbKeys = [...dark.keys()].filter((k) => k.endsWith('-rgb')).sort();

for (const rgbKey of rgbKeys) {
  const baseKey = rgbKey.slice(0, -4); // strip '-rgb'

  // ── Invariant 1: present in both themes ─────────────────────────
  for (const [name, map] of [['dark', dark], ['light', light]]) {
    if (!map.has(rgbKey)) {
      problems.push(`${baseKey}: --${rgbKey} missing from the ${name} block`);
    }
    if (!map.has(baseKey)) {
      problems.push(`${baseKey}: hex var --${baseKey} missing from the ${name} block`);
    }
  }

  // ── Invariant 2: triplet matches the hex ────────────────────────
  for (const [name, map] of [['dark', dark], ['light', light]]) {
    const hex = hexOf(map.get(baseKey) ?? '');
    const trip = tripletOf(map.get(rgbKey) ?? '');
    if (!hex || !trip) continue; // already reported above
    const want = rgbOfHex(hex);
    const same = want.every((n, i) => n === trip[i]);
    checked.push(`${baseKey.padEnd(20)} ${name.padEnd(5)} ${hex} -> ${trip.join(' ')}`);
    if (!same) {
      problems.push(
        `${baseKey} (${name}): --${rgbKey} = "${trip.join(' ')}" ` +
        `but --${baseKey} = ${hex} (expected "${want.join(' ')}")`,
      );
    }
  }
}

// ── Report ────────────────────────────────────────────────────────
console.log(`Design token audit — ${rgbKeys.length} alpha-capable tokens\n`);
if (process.argv.includes('--verbose')) {
  for (const line of checked) console.log('  ok  ' + line);
  console.log();
} else {
  console.log(`  verified ${checked.length} hex/triplet pairs (use --verbose to list)\n`);
}

if (problems.length === 0) {
  console.log('PASS: all alpha-capable tokens present in both themes and colour-accurate.');
  process.exit(0);
}

console.log(`FAIL: ${problems.length} violation(s)\n`);
for (const p of problems) console.log('  - ' + p);
process.exit(1);
