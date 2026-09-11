/**
 * Final light-mode sweep: replace the last hardcoded zinc palette utilities
 * with theme-aware obsidian tokens. `text-zinc-300`/`400` are unreadable on
 * the light paper background, and `bg-zinc-800` stays dark in both themes.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'src');
const EXTS = new Set(['.ts', '.tsx']);

const RULES = [
  [/\bbg-zinc-800\/90\b/g, 'bg-obsidian-surface3'],
  [/\bbg-zinc-800\b/g, 'bg-obsidian-surface3'],
  [/\btext-zinc-100\b/g, 'text-obsidian-inkPrimary'],
  [/\btext-zinc-300\b/g, 'text-obsidian-inkSecondary'],
  [/\btext-zinc-400\b/g, 'text-obsidian-inkMuted'],
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let edits = 0;
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [pattern, replacement] of RULES) {
    after = after.replace(pattern, () => {
      edits++;
      return replacement;
    });
  }
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changedFiles++;
    console.log(`EDITED  ${path.relative(ROOT, file)}`);
  }
}
console.log(`\nfiles changed: ${changedFiles}   replacements: ${edits}`);
