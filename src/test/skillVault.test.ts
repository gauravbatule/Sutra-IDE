import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SkillVault } from '../../server/harness/skillVault.js';

describe('skillVault', () => {
  let tempDir: string;
  let vault: SkillVault;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sutra-skills-test-'));
    vault = new SkillVault(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort test directory cleanup
    }
  });

  it('adds and retrieves a skill', () => {
    vault.addSkill('anti-slop-design', '# Anti-Slop Design\n\nBan generic AI card grids and purple glows.');

    const skill = vault.getSkill('anti-slop-design');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('anti-slop-design');
    expect(skill?.content).toContain('urple glows');
  });

  it('finds relevant skills based on user intent', () => {
    vault.addSkill('responsive-fluid-layouts', '# Responsive Fluid Layouts\n\nBuild container queries and zero CLS layouts.');
    vault.addSkill('database-schema-modeling', '# Database Schema Modeling\n\nDesign normalized SQL tables and foreign keys.');

    const matches = vault.findRelevantSkills('I need a responsive fluid grid for mobile');
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('responsive-fluid-layouts');
  });
});
