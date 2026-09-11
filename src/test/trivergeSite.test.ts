import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('TriVerge Technologies Website Suite', () => {
  it('generates a complete, anti-slop production webpage for trivergetech.com', () => {
    const filePath = path.join(process.cwd(), 'public', 'triverge', 'index.html');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('TriVerge Technologies');
    expect(content).toContain('Where Autonomous Intelligence Meets Enterprise Scale.');
    expect(content).toContain('Autonomous Agent Swarms');
    expect(content).toContain('Sub-10ms Edge Neural Mesh');
    expect(content).toContain('SOC-2 Enterprise Security');
    expect(content).toContain('Calculate Enterprise Efficiency Gains');
    expect(content).toContain('trivergetech.com');
  });

  it('contains interactive ROI calculator logic with dynamic DOM updates', () => {
    const filePath = path.join(process.cwd(), 'public', 'triverge', 'index.html');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('updateROI');
    expect(content).toContain('teamSize');
    expect(content).toContain('hourlyRate');
  });
});
