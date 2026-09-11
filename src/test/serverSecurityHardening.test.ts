import { describe, it, expect } from 'vitest';
import { SecurityGuardrails } from '../../server/security/guardrails';
import { isLoopbackOrigin } from '../../server/index';
import path from 'path';

describe('Server Security Hardening & Guardrails', () => {
  const dummyWorkspace = path.resolve('C:/workspace/project');

  describe('Destructive Command Blacklist Evasion', () => {
    it('should block rmdir with reordered flags', () => {
      const check1 = SecurityGuardrails.validateCommandSafety('rmdir /s /q C:\\', dummyWorkspace);
      expect(check1.safe).toBe(false);

      const check2 = SecurityGuardrails.validateCommandSafety('rmdir /q /s C:\\', dummyWorkspace);
      expect(check2.safe).toBe(false);

      const check3 = SecurityGuardrails.validateCommandSafety('rd /s /q C:\\', dummyWorkspace);
      expect(check3.safe).toBe(false);
    });

    it('should block del/erase with reordered flags', () => {
      const check1 = SecurityGuardrails.validateCommandSafety('del /f /s /q C:\\', dummyWorkspace);
      expect(check1.safe).toBe(false);

      const check2 = SecurityGuardrails.validateCommandSafety('del /q /f /s C:\\', dummyWorkspace);
      expect(check2.safe).toBe(false);

      const check3 = SecurityGuardrails.validateCommandSafety('erase /q /s /f C:\\', dummyWorkspace);
      expect(check3.safe).toBe(false);
    });

    it('should block PowerShell recursive drive wipe commands', () => {
      const check1 = SecurityGuardrails.validateCommandSafety('Remove-Item -Recurse -Force C:\\', dummyWorkspace);
      expect(check1.safe).toBe(false);

      const check2 = SecurityGuardrails.validateCommandSafety('Remove-Item -Force -Recurse C:\\', dummyWorkspace);
      expect(check2.safe).toBe(false);

      const check3 = SecurityGuardrails.validateCommandSafety('ri -Recurse -Force C:\\', dummyWorkspace);
      expect(check3.safe).toBe(false);
    });

    it('should block critical OS process termination attempts', () => {
      const check1 = SecurityGuardrails.validateCommandSafety('taskkill /f /im explorer.exe', dummyWorkspace);
      expect(check1.safe).toBe(false);

      const check2 = SecurityGuardrails.validateCommandSafety('taskkill /im explorer.exe /f', dummyWorkspace);
      expect(check2.safe).toBe(false);

      const check3 = SecurityGuardrails.validateCommandSafety('Stop-Process -Name explorer -Force', dummyWorkspace);
      expect(check3.safe).toBe(false);

      const check4 = SecurityGuardrails.validateCommandSafety('kill -Name lsass', dummyWorkspace);
      expect(check4.safe).toBe(false);
    });

    it('should allow legitimate development commands', () => {
      expect(SecurityGuardrails.validateCommandSafety('npm test', dummyWorkspace).safe).toBe(true);
      expect(SecurityGuardrails.validateCommandSafety('git status', dummyWorkspace).safe).toBe(true);
      expect(SecurityGuardrails.validateCommandSafety('npx tsc --noEmit', dummyWorkspace).safe).toBe(true);
      expect(SecurityGuardrails.validateCommandSafety('npm run dev', dummyWorkspace).safe).toBe(true);
    });
  });

  describe('Path Traversal and Confinement Verification', () => {
    it('should strictly confine paths within workspace root', () => {
      const valid = SecurityGuardrails.validateSafePath('src/App.tsx', dummyWorkspace);
      expect(valid.toLowerCase()).toContain('project');

      expect(() => {
        SecurityGuardrails.validateSafePath('../../../Windows/System32', dummyWorkspace);
      }).toThrow(/Security Violation/);
    });

    it('should reject NUL byte path traversal attempts', () => {
      expect(() => {
        SecurityGuardrails.validateSafePath('src/App.tsx\0/../../etc/passwd', dummyWorkspace);
      }).toThrow(/NUL byte/);
    });

    it('should reject sibling directories that share a prefix', () => {
      const parentDir = path.dirname(dummyWorkspace);
      const siblingDir = path.join(parentDir, 'project-secret', 'keys.json');

      expect(() => {
        SecurityGuardrails.validateSafePath(siblingDir, dummyWorkspace);
      }).toThrow(/Security Violation/);
    });
  });

  describe('Anti-CSRF Origin Gate', () => {
    it('should identify loopback origins as safe', () => {
      expect(isLoopbackOrigin('http://localhost:3000')).toBe(true);
      expect(isLoopbackOrigin('http://127.0.0.1:3000')).toBe(true);
      expect(isLoopbackOrigin('http://[::1]:3000')).toBe(true);
      expect(isLoopbackOrigin(undefined)).toBe(true);
    });

    it('should reject external and malicious origins', () => {
      expect(isLoopbackOrigin('http://attacker.com')).toBe(false);
      expect(isLoopbackOrigin('http://localhost.attacker.com')).toBe(false);
      expect(isLoopbackOrigin('http://evil-site.org:3000')).toBe(false);
      expect(isLoopbackOrigin('not-a-valid-url')).toBe(false);
    });
  });
});
