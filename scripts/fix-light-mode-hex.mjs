/**
 * Light-mode hex migration.
 *
 * Replaces hardcoded dark hex backgrounds left in Tailwind classNames
 * (`bg-[#0b0c10]` etc.) with theme-aware `obsidian-*` tokens. These were a
 * direct cause of "light mode still renders dark surfaces" — a literal hex
 * ignores `[data-theme]` entirely.
 *
 * Mapping is by luminance: near-black hexes become the canvas token, the
 * slightly-lighter panel hexes become surface-1.
 *
 * Deliberately NOT touched: hexes inside `stroke=`/`fill=` SVG attributes and
 * inline `style={{}}` objects — those are handled separately, and many are
 * brand/illustration colors that are intentionally theme-independent.
 *
 * Usage: node scripts/fix-light-mode-hex.mjs [--dry]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'src');
const DRY = process.argv.includes('--dry');
const EXTS = new Set(['.ts', '.tsx']);

/** Canvas-level (near black) vs panel-level (dark grey) classification. */
const CANVAS_HEXES = ['#080b14', '#0b0c10', '#0c0d10'];
const SURFACE1_HEXES = [
  '#0e1015',
  '#0f1117',
  '#101114',
  '#111216',
  '#141419',
  '#14151a',
  '#141720',
  '#16171d',
];

// Longest-prefix rules first so `bg-[#080b14]/70` is handled before the
// bare `bg-[#080b14]` rule can clobber it.
const RULES = [
  // Hero card: a translucent blurred panel is exactly what .glass-panel is.
  [
    /\bbg-\[#080b14\]\/70\s+backdrop-blur-md\b/g,
    () => 'glass-panel',
  ],
  // Gradient scrim — drops the /80 (Tailwind v3 can't apply opacity to a
  // CSS-var color) but it fades to transparent anyway.
  // NOTE: no trailing \b on these — `]` is a non-word char, so \b would never
  // match before the following space and the rule would silently no-op.
  [/\bvia-\[#080b14\]\/80/g, () => 'via-obsidian-canvas'],
  [/\bfrom-\[#080b14\]/g, () => 'from-obsidian-canvas'],
  [/\bbg-\[#080b14\]/g, () => 'bg-obsidian-canvas'],

  ...CANVAS_HEXES.slice(1).flatMap((hex) => [
    [new RegExp(`\\bbg-\\[${hex}\\]`, 'g'), () => 'bg-obsidian-canvas'],
    [new RegExp(`\\bfrom-\\[${hex}\\]`, 'g'), () => 'from-obsidian-canvas'],
  ]),

  ...SURFACE1_HEXES.flatMap((hex) => [
    [new RegExp(`\\bbg-\\[${hex}\\]`, 'g'), () => 'bg-obsidian-surface1'],
  ]),
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

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  for (const [pattern, replacer] of RULES) {
    after = after.replace(pattern, (...args) => {
      const next = replacer(...args);
      if (next !== args[0]) totalEdits++;
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
