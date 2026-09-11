/**
 * Light-mode token migration.
 *
 * Replaces hardcoded `bg-white/[0.0X]`, `border-white/NN`, `ring-white/NN`
 * and `text-white` with theme-aware `obsidian-*` tokens. These classes were
 * the reason light mode still rendered dark surfaces / invisible hovers:
 * `bg-white/[0.06]` is an invisible wash on paper, and `text-white` is
 * unreadable on paper.
 *
 * Deliberately NOT touched:
 *   - `bg-black/NN`  -> modal scrims. These SHOULD stay dark in both themes
 *                       so the modal keeps focus.
 *   - `bg-white/NN` where NN >= 70 (and bare `bg-white`) -> near-solid light
 *                       elements that are intentional in both themes.
 *
 * Usage: node scripts/fix-light-mode-tokens.mjs [--dry]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'src');
const DRY = process.argv.includes('--dry');
const EXTS = new Set(['.ts', '.tsx']);

/** bg-white opacity -> surface token (matching the tokens.css ramp). */
function bgToken(opacity) {
  if (opacity <= 0.05) return 'bg-obsidian-surface1';
  if (opacity <= 0.08) return 'bg-obsidian-surface2';
  if (opacity <= 0.14) return 'bg-obsidian-surface3';
  return 'bg-obsidian-surface4';
}

/** border-white opacity -> hairline token. */
function borderToken(opacity) {
  if (opacity <= 0.06) return 'border-obsidian-hairline';
  if (opacity <= 0.2) return 'border-obsidian-border';
  return 'border-obsidian-borderBright';
}

/** ring-white opacity -> hairline token. */
function ringToken(opacity) {
  if (opacity <= 0.2) return 'ring-obsidian-hairline';
  if (opacity <= 0.35) return 'ring-obsidian-border';
  return 'ring-obsidian-borderBright';
}

const RULES = [
  // text-white (with or without opacity) -> theme ink. Run before bg rules so
  // `text-white/80` never partially matches a bg rule.
  [/\btext-white(?:\/\d+)?\b/g, () => 'text-obsidian-inkPrimary'],

  // bg-white/[0.0X] arbitrary-opacity washes.
  [/\bbg-white\/\[0?\.(\d+)\]/g, (_m, d) => bgToken(Number(`0.${d}`))],
  // bg-white/<int> — leave near-solid (>=70) alone, it's an intentional
  // light surface that reads correctly on both themes.
  [/\bbg-white\/(\d+)\b/g, (m, n) => (Number(n) >= 70 ? m : bgToken(Number(n) / 100))],

  // border-white/[0.0X] and border-white/<int>
  [/\bborder-white\/\[0?\.(\d+)\]/g, (_m, d) => borderToken(Number(`0.${d}`))],
  [/\bborder-white\/(\d+)\b/g, (_m, n) => borderToken(Number(n) / 100)],

  // ring-white/<int>
  [/\bring-white\/(\d+)\b/g, (_m, n) => ringToken(Number(n) / 100)],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
let changedFiles = 0;
let totalEdits = 0;
const perRule = new Map();

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  for (const [pattern, replacer] of RULES) {
    after = after.replace(pattern, (...args) => {
      const next = replacer(...args);
      if (next !== args[0]) {
        const key = String(pattern);
        perRule.set(key, (perRule.get(key) || 0) + 1);
        totalEdits++;
      }
      return next;
    });
  }

  if (after !== before) {
    changedFiles++;
    if (DRY) {
      console.log(`WOULD EDIT  ${path.relative(ROOT, file)}`);
    } else {
      fs.writeFileSync(file, after, 'utf8');
      console.log(`EDITED      ${path.relative(ROOT, file)}`);
    }
  }
}

console.log('\n--- summary ---');
console.log(`files scanned : ${files.length}`);
console.log(`files changed : ${changedFiles}`);
console.log(`replacements  : ${totalEdits}`);
console.log(DRY ? '\n(dry run — no files written)' : '\n(files written)');
