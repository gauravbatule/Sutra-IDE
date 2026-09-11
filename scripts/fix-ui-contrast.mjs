/**
 * Fixes hardcoded colours that break light mode / render invisible content.
 *
 * Tailwind v3.4 silently DROPS opacity modifiers on CSS-var colours, so
 * `bg-obsidian-canvas/20 text-obsidian-canvas` renders as a solid block of
 * --bg-canvas filled with --bg-canvas text: invisible in BOTH themes.
 *
 * Idempotent — safe to re-run. Supports --dry.
 *
 * Usage: node scripts/fix-ui-contrast.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const DRY = process.argv.includes('--dry');

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|jsx?)$/.test(full) ? [full] : [];
  });

// Pass 1 — unconditional literal swaps.
const GLOBAL = [
  // CTA hover: hardcoded zinc never inverts.
  ['hover:bg-zinc-200', 'hover:bg-obsidian-accentHover'],
  // Black text on a light-theme cream surface is unreadable.
  ['text-black', 'text-obsidian-inkInverse'],
  // Dropped-alpha bug: canvas-on-canvas = invisible in both themes.
  ['bg-obsidian-canvas/20 text-obsidian-canvas', 'bg-[color:var(--overlay-muted)] text-obsidian-inkPrimary'],
  // Dropped-alpha bug: solid accent under primary ink = black-on-black / white-on-white.
  ['bg-obsidian-accent/15', 'bg-[color:var(--accent-soft)]'],
  // White waveform bars / status dots vanish on the light cream surface.
  ['bg-white/70', 'bg-obsidian-inkPrimary'],
  ['bg-white/90', 'bg-obsidian-inkPrimary'],
  // Underline decoration invisible on light surfaces.
  ['decoration-white/20', 'decoration-obsidian-inkFaint'],
  // File-tree icons that never invert with the theme.
  ['text-stone-400/80', 'text-obsidian-inkMuted'],
  ['text-stone-300/90', 'text-obsidian-inkMuted'],
  ['text-stone-400', 'text-obsidian-inkMuted'],
  ['text-slate-400', 'text-obsidian-inkMuted'],
  ['group-hover:text-stone-300', 'group-hover:text-obsidian-inkSecondary'],
  // Splash screen: near-black wordmark on pure black.
  ['bg-black text-obsidian-inkPrimary', 'bg-obsidian-canvas text-obsidian-inkPrimary'],
  // Same CTA pattern written with zinc instead of black.
  ['text-zinc-950', 'text-obsidian-inkInverse'],
  // Monaco zen mode: hardcoded black kills light mode, and z-50 covered the
  // title bar (z-30), status bar and activity bar (z-20).
  //
  // The trailing quote is load-bearing: without it this also matches the prefix
  // of modal scrims (`fixed inset-0 z-50 bg-black/80`), which must stay black
  // and stay above the chrome at z-50.
  ["fixed inset-0 z-50 bg-black'", "fixed inset-0 z-40 bg-obsidian-canvas'"],
];

// Pass 2 — swap `bg-white` only where it is a CTA fill, identified by the
// presence of the inverse (light) text colour set in pass 1. This avoids
// touching decorative white dots and badges, which are handled by their own
// opacity-modifier rules above.
const CTA_MARKER = 'text-obsidian-inkInverse';

// Pass 3 — dark translucent surfaces used as INPUT backgrounds. These are
// only fixed on lines that pair them with an ink token; modal scrims
// (`bg-black/80` etc. on `fixed inset-0`) are intentional and left alone.
const DARK_SURFACES = [
  ['bg-black/40', 'bg-obsidian-surface1'],
  ['bg-black/50', 'bg-obsidian-surface2'],
  ['bg-black/30', 'bg-obsidian-surface2'],
];
const SCRIM = /fixed inset-0|inset-0 z-50|backdrop-blur/;

const files = walk(SRC);
const report = [];

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const lines = original.split('\n');
  let changed = 0;

  const next = lines.map((line) => {
    let out = line;

    for (const [from, to] of GLOBAL) {
      if (out.includes(from)) {
        out = out.split(from).join(to);
        changed++;
      }
    }

    // CTA fill: bg-white paired with inverse text.
    if (out.includes(CTA_MARKER) && out.includes('bg-white ')) {
      out = out.replace(/\bbg-white\b/, 'bg-obsidian-accent');
      changed++;
    }
    if (out.includes(CTA_MARKER) && out.includes('border-white ')) {
      out = out.replace(/\bborder-white\b/, 'border-obsidian-accent');
      changed++;
    }

    // Dark input surfaces (never modal scrims).
    if (!SCRIM.test(out)) {
      for (const [from, to] of DARK_SURFACES) {
        if (out.includes(from) && /text-obsidian-ink|text-obsidian-surface/.test(out)) {
          out = out.split(from).join(to);
          changed++;
        }
      }
    }

    return out;
  });

  if (changed === 0) continue;

  const updated = next.join('\n');
  if (updated !== original) {
    report.push({ file: relative(ROOT, file), changed });
    if (!DRY) writeFileSync(file, updated, 'utf8');
  }
}

console.log(DRY ? '--- DRY RUN (no files written) ---\n' : '--- applied ---\n');
for (const r of report) console.log(`  ${String(r.changed).padStart(3)}  ${r.file}`);
console.log(`\n${report.length} file(s), ${report.reduce((a, b) => a + b.changed, 0)} replacement(s)`);
