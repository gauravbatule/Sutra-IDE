import { describe, it, expect } from 'vitest';
import { ToolHotSwapper } from '../../server/harness/toolHotSwapper.js';

describe('toolHotSwapper', () => {
  it('activates and hot-swaps tool domains', () => {
    const swapper = new ToolHotSwapper();
    expect(swapper.getActiveTools()).toContain('read_file');

    swapper.activateDomain('web-frontend');
    expect(swapper.getActiveTools()).toContain('inspect_web_page');

    swapper.deactivateDomain('web-frontend');
    expect(swapper.getActiveTools()).not.toContain('inspect_web_page');
  });

  it('detects tool domains from files', () => {
    const swapper = new ToolHotSwapper();
    const domains = swapper.detectDomainFromFiles(['minecraft/index.html', 'server/index.ts', 'three-voxel.js']);
    expect(domains).toContain('web-frontend');
    expect(domains).toContain('node-backend');
    expect(domains).toContain('graphics-3d');
  });
});
