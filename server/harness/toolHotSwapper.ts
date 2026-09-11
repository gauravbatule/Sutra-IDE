export type ToolDomain = 'web-frontend' | 'node-backend' | 'systems-cli' | 'graphics-3d' | 'general';

export interface ToolPack {
  domain: ToolDomain;
  tools: string[];
  description: string;
}

export class ToolHotSwapper {
  private activeDomains: Set<ToolDomain> = new Set(['general']);
  private packs: Map<ToolDomain, ToolPack> = new Map([
    [
      'general',
      {
        domain: 'general',
        tools: ['read_file', 'write_file', 'run_command', 'verify_http_server'],
        description: 'Core filesystem and terminal runtime tools',
      },
    ],
    [
      'web-frontend',
      {
        domain: 'web-frontend',
        tools: ['inspect_web_page', 'audit_web_vitals', 'bench_http_endpoint'],
        description: 'Headless DOM inspector, Web Vitals, and asset integrity tools',
      },
    ],
    [
      'node-backend',
      {
        domain: 'node-backend',
        tools: ['verify_http_server', 'bench_http_endpoint', 'run_command'],
        description: 'Backend API probing, ConPTY shell, and route benchmark tools',
      },
    ],
    [
      'graphics-3d',
      {
        domain: 'graphics-3d',
        tools: ['inspect_web_page', 'verify_http_server'],
        description: 'WebGL, Three.js canvas detection and frame-rate inspection tools',
      },
    ],
    [
      'systems-cli',
      {
        domain: 'systems-cli',
        tools: ['run_command', 'verify_http_server'],
        description: 'Low-level system execution and sandbox tools',
      },
    ],
  ]);

  public activateDomain(domain: ToolDomain): void {
    this.activeDomains.add(domain);
  }

  public deactivateDomain(domain: ToolDomain): void {
    if (domain !== 'general') {
      this.activeDomains.delete(domain);
    }
  }

  public getActiveTools(): string[] {
    const active = new Set<string>();
    for (const domain of this.activeDomains) {
      const pack = this.packs.get(domain);
      if (pack) {
        for (const tool of pack.tools) {
          active.add(tool);
        }
      }
    }
    return Array.from(active);
  }

  public detectDomainFromFiles(files: string[]): ToolDomain[] {
    const detected = new Set<ToolDomain>(['general']);
    for (const f of files) {
      const lower = f.toLowerCase();
      if (lower.endsWith('.html') || lower.endsWith('.tsx') || lower.endsWith('.css')) {
        detected.add('web-frontend');
      }
      if (lower.endsWith('.ts') || lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.json')) {
        detected.add('node-backend');
      }
      if (lower.includes('three') || lower.includes('canvas') || lower.includes('voxel')) {
        detected.add('graphics-3d');
      }
    }
    return Array.from(detected);
  }
}

export const toolHotSwapper = new ToolHotSwapper();
