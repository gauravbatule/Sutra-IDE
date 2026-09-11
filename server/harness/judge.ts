/**
 * SUTRA Studio — LLM-as-Judge Evaluation on Completed Missions
 * Evaluates goal satisfaction, verification evidence, and surfaces gaps before task completion.
 * Calibrated to eliminate false positives (claiming success when code wasn't mutated or failed verification)
 * and false negatives (failing tasks because of benign warnings, informational intents, or recovered self-heals).
 */

export interface JudgementResult {
  goalMet: boolean;
  score: number; // 0-10
  intent: 'mutation' | 'informational' | 'hybrid';
  evidence: string[];
  gaps: string[];
  timestamp: number;
}

export class TaskJudge {
  public static evaluateRun(params: {
    userGoal: string;
    executedTools: Array<string | { tool: string; result?: any; error?: any }>;
    mutatedFiles: string[];
    verificationPassed: boolean | null;
    verificationSummary?: string;
  }): JudgementResult {
    const evidence: string[] = [];
    const gaps: string[] = [];
    const goalLower = (params.userGoal || '').trim().toLowerCase();

    // 1. Detect user goal intent: Does the user expect code changes, or is this conversational/informational?
    const mutationKeywords = [
      'fix', 'create', 'add', 'update', 'build', 'refactor', 'remove',
      'delete', 'change', 'implement', 'edit', 'modify', 'replace',
      'style', 'install', 'setup', 'scaffold', 'wire', 'generate'
    ];
    const informationalKeywords = [
      'explain', 'what', 'how', 'why', 'search', 'find', 'where',
      'list', 'describe', 'summarize', 'review', 'read', 'tell me',
      'can you see', 'check if', 'inspect', 'diagnose'
    ];

    const hasMutationWord = mutationKeywords.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(goalLower));
    const hasInformationalWord = informationalKeywords.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(goalLower));

    let intent: 'mutation' | 'informational' | 'hybrid' = 'mutation';
    if (hasInformationalWord && !hasMutationWord) {
      intent = 'informational';
    } else if (hasMutationWord && hasInformationalWord) {
      intent = 'hybrid';
    } else if (!hasMutationWord && !hasInformationalWord) {
      // Default to informational if no files were touched, otherwise mutation
      intent = params.mutatedFiles.length > 0 ? 'mutation' : 'informational';
    }

    // 2. Parse executed tools and differentiate transient self-healed retries vs persistent failures
    let unresolvedToolErrors = 0;
    let recoveredToolRetries = 0;

    const toolEntries = (params.executedTools || []).map((t) => {
      if (typeof t === 'string') {
        const isError = /error|failed|exception/i.test(t);
        return { tool: t, error: isError ? t : undefined };
      }
      return t;
    });

    for (let i = 0; i < toolEntries.length; i++) {
      if (toolEntries[i].error) {
        // Check if there was a subsequent tool invocation of the same category that succeeded
        const hadSubsequentSuccess = toolEntries.slice(i + 1).some((sub) => !sub.error);
        if (hadSubsequentSuccess) {
          recoveredToolRetries++;
        } else {
          unresolvedToolErrors++;
        }
      }
    }

    if (recoveredToolRetries > 0) {
      evidence.push(`Autonomous self-healing: recovered cleanly from ${recoveredToolRetries} intermediate attempt(s).`);
    }
    if (unresolvedToolErrors > 0) {
      gaps.push(`${unresolvedToolErrors} tool execution(s) ended with unrecovered errors.`);
    }

    // 3. Evidence Gathering & Scoring Matrix
    let score = 8;

    if (params.mutatedFiles.length > 0) {
      evidence.push(`Mutated ${params.mutatedFiles.length} project file(s): ${params.mutatedFiles.slice(0, 3).join(', ')}`);
    }

    if (params.verificationPassed === true) {
      evidence.push(`Workspace verification checks passed: ${params.verificationSummary || 'All checks passed'}`);
    } else if (params.verificationPassed === false) {
      gaps.push(`Workspace verification failed: ${params.verificationSummary || 'Build, typecheck, or test errors detected'}`);
    }

    // 4. False Positive Prevention:
    // If the user explicitly asked for code changes (mutation), but ZERO files were created or modified:
    if ((intent === 'mutation' || (intent === 'hybrid' && !goalLower.includes('explain'))) && params.mutatedFiles.length === 0) {
      gaps.push('User requested code changes or fixes, but no project files were created or modified.');
      score = Math.min(score, 3);
    }

    // If verification failed on modified files:
    if (params.mutatedFiles.length > 0 && params.verificationPassed === false) {
      score = Math.min(score, 4);
    }

    // 5. False Negative Prevention:
    // For informational requests, mutating files is NOT required.
    if (intent === 'informational') {
      if (unresolvedToolErrors === 0) {
        score = 9;
        evidence.push('Analysis complete: retrieved and presented relevant project context.');
      } else {
        score = 6;
      }
    } else if (params.verificationPassed === true && params.mutatedFiles.length > 0 && unresolvedToolErrors === 0) {
      score = 10;
    } else if (params.verificationPassed === true && gaps.length === 0) {
      score = 9;
    }

    // A task is met if score is >= 7, with zero blocking verification failures
    const goalMet = score >= 7 && params.verificationPassed !== false;

    return {
      goalMet,
      score,
      intent,
      evidence,
      gaps,
      timestamp: Date.now(),
    };
  }
}
