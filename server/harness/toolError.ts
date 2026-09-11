/**
 * SUTRA Studio — Structured Tool Error Envelope
 * Categorizes tool execution failures for intelligent downstream recovery (auth, retry, compaction).
 */

export type ToolErrorCode =
  | 'rate_limit'
  | 'auth'
  | 'context_overflow'
  | 'not_found'
  | 'timeout'
  | 'validation'
  | 'unknown';

export class ToolError extends Error {
  public readonly code: ToolErrorCode;
  public readonly retryable: boolean;
  public readonly detail?: unknown;

  constructor(message: string, code: ToolErrorCode = 'unknown', retryable = false, detail?: unknown) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }

  public toJSON() {
    return {
      error: this.message,
      code: this.code,
      retryable: this.retryable,
      detail: this.detail,
    };
  }
}

export function classifyToolError(err: unknown): ToolError {
  if (err instanceof ToolError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err || 'Unknown tool error');
  const lower = message.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('tpm limit') || lower.includes('quota')) {
    return new ToolError(message, 'rate_limit', true, err);
  }

  if (lower.includes('auth') || lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('session expired') || lower.includes('cookie rejected')) {
    return new ToolError(message, 'auth', false, err);
  }

  if (lower.includes('context length') || lower.includes('maximum context') || lower.includes('token limit') || lower.includes('too many tokens') || lower.includes('prompt too long') || lower.includes('context_overflow')) {
    return new ToolError(message, 'context_overflow', true, err);
  }

  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('timed out')) {
    return new ToolError(message, 'timeout', true, err);
  }

  if (lower.includes('not found') || lower.includes('enoent') || lower.includes('no such file') || lower.includes('404')) {
    return new ToolError(message, 'not_found', false, err);
  }

  if (lower.includes('invalid') || lower.includes('missing required') || lower.includes('schema validation') || lower.includes('zod')) {
    return new ToolError(message, 'validation', false, err);
  }

  return new ToolError(message, 'unknown', false, err);
}
