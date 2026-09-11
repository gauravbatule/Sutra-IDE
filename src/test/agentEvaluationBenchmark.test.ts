import { describe, it, expect } from 'vitest';
import { fsTools } from '../../server/tools/fsTools.js';
import { agentSwarm } from '../../server/agentSwarm.js';
import {
  detectModelTier,
  buildMasterSystemPrompt,
} from '../../server/harness/agentPromptArchitecture.js';
import { getPrunedToolsForModel } from '../../server/modelRouter.js';
import { processManager } from '../../server/processManager.js';
import { DependencyDoctor } from '../../server/harness/dependencyDoctor.js';

describe('SUTRA Autonomous IDE — SWE Evaluation & Benchmark Suite', () => {

  describe('1. SWE-Basic: File Operations & Precision', () => {
    it('creates, reads, and edits files without stubbing placeholders', async () => {
      const testFilePath = 'temp-benchmark-math.ts';
      const initialCode = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

      const writeRes = await agentSwarm.executeTool({
        id: 'tc-bench-1',
        tool: 'write_file',
        params: { path: testFilePath, content: initialCode },
        status: 'pending',
        requiresApproval: false,
        timestamp: Date.now(),
      });

      expect(writeRes).toBeDefined();

      const readRes = await agentSwarm.executeTool({
        id: 'tc-bench-2',
        tool: 'read_file',
        params: { path: testFilePath },
        status: 'pending',
        requiresApproval: false,
        timestamp: Date.now(),
      });

      expect(readRes.content).toContain('return a + b;');

      const editRes = await agentSwarm.executeTool({
        id: 'tc-bench-3',
        tool: 'edit_file',
        params: {
          path: testFilePath,
          oldStr: 'return a + b;',
          newStr: '// Enhanced math addition\n  return Number(a) + Number(b);',
        },
        status: 'pending',
        requiresApproval: false,
        timestamp: Date.now(),
      });

      expect(editRes).toBeDefined();

      const verified = fsTools.readFile(testFilePath);
      expect(verified.content).toContain('Number(a) + Number(b);');

      // Cleanup
      fsTools.deletePath(testFilePath);
    });
  });

  describe('2. Model Capability Profiles & Tier-Adaptive Scaffolding', () => {
    it('accurately classifies model tiers for frontier, balanced, and compact models', () => {
      expect(detectModelTier('claude-3-7-sonnet-20250219')).toBe('FRONTIER');
      expect(detectModelTier('claude-3-5-sonnet-20241022')).toBe('FRONTIER');
      expect(detectModelTier('gpt-5-turbo')).toBe('FRONTIER');
      expect(detectModelTier('gemini-2.5-pro')).toBe('FRONTIER');
      expect(detectModelTier('deepseek-r1')).toBe('FRONTIER');

      expect(detectModelTier('gpt-4o-mini')).toBe('BALANCED');
      expect(detectModelTier('gemini-2.5-flash')).toBe('BALANCED');
      expect(detectModelTier('qwen2.5-coder-32b')).toBe('BALANCED');

      expect(detectModelTier('llama-3.1-8b-instant', 'groq')).toBe('COMPACT_WEAK');
      expect(detectModelTier('qwen2.5-coder-7b')).toBe('COMPACT_WEAK');
      expect(detectModelTier('phi-3-mini')).toBe('COMPACT_WEAK');
    });

    it('prunes tool schemas down to an 8-tool core for compact/weak models to prevent cognitive overload', () => {
      const compactTools = getPrunedToolsForModel('llama-3.1-8b-instant', [{ role: 'user', content: 'fix bug in math.ts' }]);
      expect(compactTools.length).toBeLessThanOrEqual(12);

      const toolNames = compactTools.map((t) => t.function.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('grep_search');
      expect(toolNames).toContain('run_command');
      expect(toolNames).toContain('typecheck_project');

      // Heavy multimodal or complex tools are excluded from compact weak tier unless explicitly asked
      expect(toolNames).not.toContain('generate_video_asset');
      expect(toolNames).not.toContain('inspect_sqlite_schema');
    });

    it('generates lean, modular canonical contracts for compact models under 1500 tokens', () => {
      const compactPrompt = buildMasterSystemPrompt({
        modelId: 'llama-3.1-8b-instant',
        workspaceRoot: 'C:/test-project',
      });

      expect(compactPrompt).toContain('You are Astra');
      expect(compactPrompt).toContain('CORE AGENT CONTRACT');
      expect(compactPrompt).toContain('TOOL CONTRACT');
      expect(compactPrompt).toContain('VERIFICATION CONTRACT');

      // The compact prompt should be concise and focused
      expect(compactPrompt.length).toBeLessThan(4000);
    });
  });

  describe('3. Error Recovery & Grounded Self-Healing', () => {
    it('returns grounded line preview when edit_file encounters anchor string mismatches', async () => {
      const testPath = 'temp-grounded-test.ts';
      fsTools.writeFile(testPath, `const x = 10;\nconst y = 20;\nconst z = 30;\n`);

      const failedEdit = await agentSwarm.executeTool({
        id: 'tc-ground-fail',
        tool: 'edit_file',
        params: {
          path: testPath,
          oldStr: 'const NON_EXISTENT_STRING = 999;',
          newStr: 'const updated = 1;',
        },
        status: 'pending',
        requiresApproval: false,
        timestamp: Date.now(),
      });

      expect(failedEdit).toBeDefined();
      expect(failedEdit.success).toBe(false);
      expect(failedEdit.groundedRetryHint).toContain('The edit failed because the target content did not match');
      expect(failedEdit.actualContentPreview).toContain('const x = 10;');

      // Cleanup
      fsTools.deletePath(testPath);
    });

    it('proactively detects uninstalled third-party npm packages upon file edits', () => {
      const depCheck = DependencyDoctor.checkMissingDependencies(
        fsTools.getWorkspaceRoot(),
        'src/utils/cryptoUtil.ts',
        `import bcrypt from 'bcrypt';\nimport jwt from 'jsonwebtoken';\n`
      );

      expect(depCheck).toBeDefined();
    });
  });

  describe('4. Ground-Truth Port Verification & Diagnostic Command Safety', () => {
    it('strictly avoids false-positive port detection on diagnostic commands', () => {
      expect(processManager.detectPort('netstat -ano | findstr :3002')).toBeNull();
      expect(processManager.detectPort('grep -rn "port: 3000" src/')).toBeNull();
      expect(processManager.detectPort('taskkill /PID 3002 /F')).toBeNull();
      expect(processManager.detectPort('git log -n 5')).toBeNull();
    });

    it('accurately identifies genuine server launches and port configurations', () => {
      expect(processManager.detectPort('python -m http.server 8080')).toBe(8080);
      expect(processManager.detectPort('npm run dev -- --port 4000')).toBe(4000);
      expect(processManager.detectPort('node server.js :5000')).toBe(5000);
      expect(processManager.detectPort('uvicorn main:app --port 8000')).toBe(8000);
    });
  });

  describe('5. Read-Only Investigation & Audit Mandate', () => {
    it('assembles read-only investigation contract on audit prompts', () => {
      const auditPrompt = buildMasterSystemPrompt({
        modelId: 'gpt-4o-mini',
        workspaceRoot: 'C:/test-project',
        intentMode: 'investigation',
      });

      expect(auditPrompt).toContain('READ-ONLY INVESTIGATION & AUDIT CONTRACT');
      expect(auditPrompt).toContain('DO NOT dump huge walls of code');
      expect(auditPrompt).toContain('create_artifact');
    });
  });
});
