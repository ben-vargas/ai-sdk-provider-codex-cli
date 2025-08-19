import { APICallError, LoadAPIKeyError } from '@ai-sdk/provider';

export interface CodexErrorMetadata {
  code?: string;
  exitCode?: number;
  stderr?: string;
  promptExcerpt?: string;
}

export function createAPICallError({
  message,
  code,
  exitCode,
  stderr,
  promptExcerpt,
  isRetryable = false,
}: CodexErrorMetadata & { message: string; isRetryable?: boolean }): APICallError {
  const data: CodexErrorMetadata = { code, exitCode, stderr, promptExcerpt };
  return new APICallError({
    message,
    isRetryable,
    url: 'codex-cli://exec',
    requestBodyValues: promptExcerpt ? { prompt: promptExcerpt } : undefined,
    data,
  });
}

export function createAuthenticationError(message?: string): LoadAPIKeyError {
  return new LoadAPIKeyError({
    message: message || 'Authentication failed. Ensure Codex CLI is logged in (codex login).',
  });
}

export function isAuthenticationError(err: unknown): boolean {
  if (err instanceof LoadAPIKeyError) return true;
  if (err instanceof APICallError) {
    const data = err.data as CodexErrorMetadata | undefined;
    if (data?.exitCode === 401) return true;
  }
  return false;
}
