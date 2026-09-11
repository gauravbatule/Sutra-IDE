/**
 * SUTRA Studio — Execution-Feedback Self-Healing Engine
 * Inspired by OpenCodeInterpreter, DeepSeek-Coder, and SWE-bench harness architectures.
 * Intercepts compiler errors, test failures, and runtime exceptions and formats
 * structured diagnostic feedback to enable immediate autonomous self-correction.
 */

export interface DiagnosticFeedback {
  category: 'typescript' | 'test' | 'runtime' | 'syntax' | 'general';
  summary: string;
  failedFile?: string;
  line?: number;
  column?: number;
  errorCode?: string;
  actionableGuidance: string;
}

export class SelfHealingEngine {
  public analyzeError(output: string, _commandContext?: string): DiagnosticFeedback {
    const text = output || '';

    // 1. TypeScript Compiler Errors
    const tsMatch = text.match(/([a-zA-Z0-9_/\\.-]+\.tsx?)\(([0-9]+),([0-9]+)\):\s*error\s*(TS\d+):\s*(.*)/i) ||
                    text.match(/([a-zA-Z0-9_/\\.-]+\.tsx?):([0-9]+):([0-9]+)\s*-\s*error\s*(TS\d+):\s*(.*)/i);
    if (tsMatch) {
      const [, failedFile, lineStr, colStr, errorCode, msg] = tsMatch;
      return {
        category: 'typescript',
        summary: `TypeScript Compilation Error ${errorCode}: ${msg}`,
        failedFile,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        errorCode,
        actionableGuidance: `Read ${failedFile} around line ${lineStr} with read_file, verify import statements or interface types, and apply surgical edits.`,
      };
    }

    // 2. Vitest / Jest Test Failures
    if (text.includes('FAIL') || text.includes('AssertionError') || text.includes('Expected:') || text.includes('Received:')) {
      const fileMatch = text.match(/(?:FAIL|✕)\s+([a-zA-Z0-9_/\\.-]+\.(?:test|spec)\.[tj]sx?)/i);
      const failedFile = fileMatch ? fileMatch[1] : undefined;
      return {
        category: 'test',
        summary: `Unit Test Assertion Failure in ${failedFile || 'test suite'}`,
        failedFile,
        actionableGuidance: `Inspect the test assertions in ${failedFile || 'the test file'}, locate the divergence between expected vs received values, and fix the implementation module.`,
      };
    }

    // 3. Syntax Errors
    if (text.includes('SyntaxError:')) {
      const lineMatch = text.match(/([a-zA-Z0-9_/\\.-]+):(\d+)/);
      return {
        category: 'syntax',
        summary: `JavaScript / TypeScript Syntax Error`,
        failedFile: lineMatch ? lineMatch[1] : undefined,
        line: lineMatch ? parseInt(lineMatch[2], 10) : undefined,
        actionableGuidance: `Check for unmatched parentheses, missing brackets, or improper JSX syntax at the indicated location.`,
      };
    }

    // 4. Node.js Runtime Exception / Missing Module
    const modMatch = text.match(/Cannot find module ['"]([^'"]+)['"]/);
    if (modMatch) {
      return {
        category: 'runtime',
        summary: `Missing Dependency Module: "${modMatch[1]}"`,
        actionableGuidance: `Run "npm install ${modMatch[1]}" via run_command or check if the relative import path in the source file is correct.`,
      };
    }

    return {
      category: 'general',
      summary: `Command Execution Error (exit code non-zero)`,
      actionableGuidance: `Review the error output above, verify file paths and environment configurations, and modify the target source files to resolve the issue.`,
    };
  }

  public formatSelfHealingPrompt(toolName: string, error: string, commandContext?: string): string {
    const diag = this.analyzeError(error, commandContext);
    return `\n[AUTONOMOUS SELF-HEALING DIAGNOSTIC]
- Detected Category: ${diag.category.toUpperCase()}
- Problem Summary: ${diag.summary}
${diag.failedFile ? `- Target File: ${diag.failedFile}${diag.line ? ` (Line ${diag.line})` : ''}` : ''}
${diag.errorCode ? `- Error Code: ${diag.errorCode}` : ''}
- Recommended Next Step: ${diag.actionableGuidance}

Raw Output:
\`\`\`
${error.slice(0, 1500)}
\`\`\`
Please inspect the root cause, apply surgical repairs using read_file/edit_file, and re-verify.`;
  }
}

export const selfHealingEngine = new SelfHealingEngine();
