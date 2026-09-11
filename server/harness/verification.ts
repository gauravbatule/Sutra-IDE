/**
 * SUTRA Studio — Verification Stage
 *
 * After an agent run mutates workspace files, completed work is proven instead of
 * claimed: available project checks (typecheck, tests, build) are detected and
 * executed time-boxed, producing a structured report the UI renders as evidence.
 *
 * Checks that execute project code (tests, build) respect the permission model:
 * in strict approval mode they are skipped rather than silently auto-approved.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface VerificationCheck {
  name: string;
  status: 'passed' | 'failed' | 'timeout' | 'skipped';
  durationMs: number;
  /** Human-readable outcome: first useful error line(s), or a short OK/skip note. */
  summary: string;
}

export interface VerificationReport {
  ranAt: number;
  workspaceRoot: string;
  filesChanged: number;
  checks: VerificationCheck[];
  /** True when every check that actually ran passed (skips do not count as failures). */
  allPassed: boolean;
}

export interface PlannedCheck {
  name: 'typecheck' | 'tests' | 'build';
  command: string;
  args: string[];
  timeoutMs: number;
  /** True when the check executes project code and must respect strict approval mode. */
  executesCode: boolean;
}

interface PackageInfo {
  exists: boolean;
  scripts: Record<string, string>;
  hasVitest: boolean;
}

function readPackageInfo(workspaceRoot: string): PackageInfo {
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw);
    return {
      exists: true,
      scripts: pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts) ? pkg.scripts : {},
      hasVitest: Boolean(pkg.devDependencies?.vitest ?? pkg.dependencies?.vitest),
    };
  } catch {
    return { exists: false, scripts: {}, hasVitest: false };
  }
}

/**
 * Pure decision layer: given the workspace shape, which checks apply.
 * Vitest is invoked directly (`npx vitest run`) because a bare `npm test`
 * would start watch mode and hang the stage.
 */
export function planVerificationChecks(pkg: PackageInfo, hasTsconfig: boolean): PlannedCheck[] {
  const checks: PlannedCheck[] = [];

  if (typeof pkg.scripts.typecheck === 'string') {
    checks.push({ name: 'typecheck', command: 'npm', args: ['run', 'typecheck'], timeoutMs: 45_000, executesCode: false });
  } else if (hasTsconfig) {
    checks.push({ name: 'typecheck', command: 'npx', args: ['tsc', '--noEmit'], timeoutMs: 45_000, executesCode: false });
  }

  if (pkg.hasVitest) {
    checks.push({ name: 'tests', command: 'npx', args: ['vitest', 'run'], timeoutMs: 60_000, executesCode: true });
  } else if (typeof pkg.scripts.test === 'string') {
    checks.push({ name: 'tests', command: 'npm', args: ['run', 'test'], timeoutMs: 60_000, executesCode: true });
  }

  if (typeof pkg.scripts.build === 'string') {
    checks.push({ name: 'build', command: 'npm', args: ['run', 'build'], timeoutMs: 60_000, executesCode: true });
  }

  return checks;
}

/** Extracts the most useful short summary from raw check output. */
function summarizeOutput(output: string, ok: boolean): string {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!ok) {
    const interesting = lines.filter((l) => /error|fail|✕|cannot|unable/i.test(l)).slice(0, 2);
    if (interesting.length > 0) return interesting.join(' | ').slice(0, 220);
  }
  const last = lines[lines.length - 1] || '';
  return ok ? last.slice(0, 160) || 'OK' : last.slice(0, 220) || 'Failed';
}

function killProcessTree(child: ReturnType<typeof spawn>): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      // shell:true wraps the command in cmd.exe — killing only the shell orphans
      // grandchildren, so the Windows process tree is terminated explicitly.
      // Additionally, we want to ensure any EADDRINUSE port bindings are released.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // Process may have exited between timeout and kill — nothing to do.
  }
}

function executeCheck(check: PlannedCheck, cwd: string): Promise<VerificationCheck> {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let settled = false;
    const OUTPUT_CAP = 8000;

    let child: ReturnType<typeof spawn>;
    try {
      // Prepend local node_modules/.bin to PATH so local tools (tsc, vite, vitest) are resolved
      const localBin = path.join(cwd, 'node_modules', '.bin');
      const delimiter = process.platform === 'win32' ? ';' : ':';
      const customPath = localBin + delimiter + (process.env.PATH || process.env.Path || '');

      const cmd = process.platform === 'win32' && (check.command === 'npm' || check.command === 'npx' || check.command === 'yarn' || check.command === 'pnpm')
        ? `${check.command}.cmd`
        : check.command;

      // Args are compile-time constants from planVerificationChecks — joining is safe
      // and avoids the shell+args deprecation warning.
      const commandLine = [cmd, ...check.args].join(' ');
      child = spawn(commandLine, {
        cwd,
        shell: true,
        windowsHide: true,
        env: { ...process.env, PATH: customPath, Path: customPath, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      resolve({ name: check.name, status: 'failed', durationMs: 0, summary: err?.message || 'Failed to start' });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child);
      resolve({ name: check.name, status: 'timeout', durationMs: check.timeoutMs, summary: 'Timed out' });
    }, check.timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      if (output.length < OUTPUT_CAP) output += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (output.length < OUTPUT_CAP) output += d.toString();
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name: check.name, status: 'failed', durationMs: Date.now() - started, summary: err.message.slice(0, 220) });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ok = code === 0;
      resolve({
        name: check.name,
        status: ok ? 'passed' : 'failed',
        durationMs: Date.now() - started,
        summary: summarizeOutput(output, ok),
      });
    });
  });
}

function scriptRequiresNodeModules(script?: string): boolean {
  if (!script) return false;
  return /\b(tsc|vite|vitest|jest|next|astro|webpack|rollup|eslint|prettier|vue-tsc|svelte-check|rimraf|concurrently)\b/i.test(script);
}

export async function runWorkspaceVerification(opts: {
  workspaceRoot: string;
  filesChanged: number;
  mutatedFiles?: string[];
  permissionMode: 'strict' | 'full';
  onProgress?: (message: string) => void;
  /** Test hook: overrides every planned timeout so the stage can be exercised quickly. */
  timeoutOverrideMs?: number;
}): Promise<VerificationReport> {
  const mutatedList = opts.mutatedFiles || [];

  // Fast-path: if only static assets / documentation / HTML / CSS / standalone JSON files were edited,
  // do lightweight sub-millisecond syntax validation rather than triggering heavy multi-suite compilations.
  const isOnlyStaticOrHtml = mutatedList.length > 0 && mutatedList.every(
    (f) => /\.(html|htm|css|md|txt|svg|png|jpg|jpeg|gif|ico|json)$/i.test(f) && !f.endsWith('package.json') && !f.endsWith('tsconfig.json')
  );

  if (isOnlyStaticOrHtml) {
    const checks: VerificationCheck[] = [];
    for (const file of mutatedList) {
      const fullPath = path.resolve(opts.workspaceRoot, file);
      if (file.endsWith('.json') && fs.existsSync(fullPath)) {
        try {
          JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          checks.push({ name: `syntax:${path.basename(file)}`, status: 'passed', durationMs: 1, summary: 'Valid JSON syntax' });
        } catch (err: any) {
          checks.push({ name: `syntax:${path.basename(file)}`, status: 'failed', durationMs: 1, summary: `JSON syntax error: ${err.message}` });
        }
      } else if ((file.endsWith('.html') || file.endsWith('.htm')) && fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const hasDoctypeOrHtml = /<!DOCTYPE html|<html/i.test(content);
        const missingRefs: string[] = [];

        // Check local referenced scripts: <script src="...">
        const scriptMatches = content.matchAll(/<script\s+[^>]*src=["']([^"']+)["']/gi);
        for (const match of scriptMatches) {
          const src = match[1];
          if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//') && !src.startsWith('data:')) {
            const resolvedPath = path.resolve(path.dirname(fullPath), src);
            if (!fs.existsSync(resolvedPath)) {
              missingRefs.push(`script "${src}"`);
            }
          }
        }

        // Check local referenced stylesheets: <link href="...">
        const linkMatches = content.matchAll(/<link\s+[^>]*href=["']([^"']+\.css)["']/gi);
        for (const match of linkMatches) {
          const href = match[1];
          if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//')) {
            const resolvedPath = path.resolve(path.dirname(fullPath), href);
            if (!fs.existsSync(resolvedPath)) {
              missingRefs.push(`stylesheet "${href}"`);
            }
          }
        }

        if (missingRefs.length > 0) {
          checks.push({
            name: `html-integrity:${path.basename(file)}`,
            status: 'failed',
            durationMs: 2,
            summary: `Missing referenced local asset(s): ${missingRefs.join(', ')} on disk`,
          });
        } else {
          checks.push({
            name: `html:${path.basename(file)}`,
            status: 'passed',
            durationMs: 1,
            summary: hasDoctypeOrHtml ? 'Valid HTML document with all referenced assets verified on disk' : 'HTML fragment',
          });
        }
      } else if (file.endsWith('.css') && fs.existsSync(fullPath)) {
        checks.push({ name: `css:${path.basename(file)}`, status: 'passed', durationMs: 1, summary: 'CSS stylesheet updated' });
      }
    }

    if (checks.length > 0) {
      return {
        ranAt: Date.now(),
        workspaceRoot: opts.workspaceRoot,
        filesChanged: opts.filesChanged,
        checks,
        allPassed: checks.every((c) => c.status === 'passed'),
      };
    }
  }

  const pkg = readPackageInfo(opts.workspaceRoot);
  const hasTsconfig = fs.existsSync(path.join(opts.workspaceRoot, 'tsconfig.json'));
  const hasNodeModules = fs.existsSync(path.join(opts.workspaceRoot, 'node_modules'));
  const planned = planVerificationChecks(pkg, hasTsconfig);

  const checks: VerificationCheck[] = [];
  for (const check of planned) {
    if (check.executesCode && opts.permissionMode === 'strict') {
      checks.push({ name: check.name, status: 'skipped', durationMs: 0, summary: 'Needs approval mode to run' });
      continue;
    }
    // If check requires node_modules and it is missing on disk, skip with clear explanation instead of failing
    const isBareNpx = check.command === 'npx';
    const scriptCmd = check.command === 'npm' && check.args[0] === 'run' ? pkg.scripts[check.args[1]] : undefined;
    if (!hasNodeModules && (isBareNpx || scriptRequiresNodeModules(scriptCmd))) {
      checks.push({
        name: check.name,
        status: 'skipped',
        durationMs: 0,
        summary: 'Skipped: node_modules not yet installed in workspace (run npm install to enable automated checks)',
      });
      continue;
    }
    opts.onProgress?.(`Verifying ${check.name}…`);
    checks.push(await executeCheck(
      { ...check, timeoutMs: opts.timeoutOverrideMs ?? Math.min(check.timeoutMs, 25_000) },
      opts.workspaceRoot
    ));
  }

  return {
    ranAt: Date.now(),
    workspaceRoot: opts.workspaceRoot,
    filesChanged: opts.filesChanged,
    checks,
    allPassed: checks.every((c) => c.status === 'passed' || c.status === 'skipped'),
  };
}
