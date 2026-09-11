import fs from 'fs';
import path from 'path';

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises',
  'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises',
  'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'timers', 'timers/promises', 'tls', 'trace_events',
  'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib'
]);

export interface DependencyCheckResult {
  hasMissing: boolean;
  missingDependencies: string[];
  warning?: string;
}

export class DependencyDoctor {
  /**
   * Extracts imported package names from source code (ESM imports, dynamic imports, CJS require)
   */
  public static extractImportedPackages(content: string): string[] {
    if (!content || typeof content !== 'string') return [];

    const packages = new Set<string>();

    // 1. Static ESM imports and exports: import ... from 'pkg' / export ... from 'pkg'
    const esmMatches = content.matchAll(/(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g);
    for (const match of esmMatches) {
      const specifier = match[1];
      const pkg = this.normalizePackageName(specifier);
      if (pkg) packages.add(pkg);
    }

    // 2. Dynamic imports and CJS require: import('pkg') / require('pkg')
    const dynamicMatches = content.matchAll(/(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of dynamicMatches) {
      const specifier = match[1];
      const pkg = this.normalizePackageName(specifier);
      if (pkg) packages.add(pkg);
    }

    return Array.from(packages);
  }

  /**
   * Normalizes an import specifier into its root npm package name (handling scopes like @scope/pkg)
   */
  public static normalizePackageName(specifier: string): string | null {
    if (!specifier || typeof specifier !== 'string') return null;
    const trimmed = specifier.trim();

    // Ignore relative or absolute local paths
    if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
      return null;
    }

    // Ignore path aliases commonly configured in tsconfig/vite
    if (trimmed.startsWith('@/') || trimmed.startsWith('~/') || trimmed.startsWith('#') || trimmed.startsWith('src/')) {
      return null;
    }

    // Strip "node:" prefix
    const cleanSpecifier = trimmed.startsWith('node:') ? trimmed.slice(5) : trimmed;

    // Check if it is a standard Node.js builtin
    if (NODE_BUILTINS.has(cleanSpecifier) || cleanSpecifier.startsWith('node:')) {
      return null;
    }

    // Handle scoped packages: @scope/package/subpath -> @scope/package
    if (cleanSpecifier.startsWith('@')) {
      const parts = cleanSpecifier.split('/');
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
      return cleanSpecifier;
    }

    // Handle non-scoped packages: package/subpath -> package
    const rootName = cleanSpecifier.split('/')[0];
    return rootName || null;
  }

  /**
   * Proactively verifies that all imported third-party packages are declared in package.json
   */
  public static checkMissingDependencies(workspaceRoot: string, filePath: string, content: string): DependencyCheckResult {
    // Only check JS/TS/web component files
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i.test(filePath)) {
      return { hasMissing: false, missingDependencies: [] };
    }

    const importedPackages = this.extractImportedPackages(content);
    if (importedPackages.length === 0) {
      return { hasMissing: false, missingDependencies: [] };
    }

    const pkgJsonPath = path.join(workspaceRoot, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      return { hasMissing: false, missingDependencies: [] };
    }

    let declaredDeps: Set<string>;
    try {
      const raw = fs.readFileSync(pkgJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      declaredDeps = new Set([
        ...Object.keys(parsed.dependencies || {}),
        ...Object.keys(parsed.devDependencies || {}),
        ...Object.keys(parsed.peerDependencies || {}),
        ...Object.keys(parsed.optionalDependencies || {}),
      ]);
    } catch {
      return { hasMissing: false, missingDependencies: [] };
    }

    const missing: string[] = [];
    for (const pkg of importedPackages) {
      if (!declaredDeps.has(pkg)) {
        missing.push(pkg);
      }
    }

    if (missing.length > 0) {
      return {
        hasMissing: true,
        missingDependencies: missing,
        warning: `Phantom dependency alert: ${filePath} imports uninstalled package(s): "${missing.join('", "')}". Proactively run "npm install ${missing.join(' ')}" or use standard built-ins before concluding.`,
      };
    }

    return { hasMissing: false, missingDependencies: [] };
  }
}
