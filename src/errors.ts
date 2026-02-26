import { APICallError, LoadAPIKeyError, UnsupportedFunctionalityError } from '@ai-sdk/provider';

export interface CodexErrorMetadata {
  code?: string;
  exitCode?: number;
  stderr?: string;
  promptExcerpt?: string;
}

export class UnsupportedFeatureError extends UnsupportedFunctionalityError {
  readonly feature: string;
  readonly minCodexVersion?: string;
  readonly serverVersion?: string;

  constructor({
    feature,
    minCodexVersion,
    serverVersion,
    message,
  }: {
    feature: string;
    minCodexVersion?: string;
    serverVersion?: string;
    message?: string;
  }) {
    const resolvedMessage =
      message ??
      `Feature '${feature}' is not supported by this codex app-server` +
        (serverVersion ? ` (detected ${serverVersion})` : '') +
        (minCodexVersion ? `. Requires codex CLI >= ${minCodexVersion}.` : '.');
    super({ functionality: feature, message: resolvedMessage });
    this.name = 'UnsupportedFeatureError';
    this.feature = feature;
    this.minCodexVersion = minCodexVersion;
    this.serverVersion = serverVersion;
  }
}

export function createAPICallError({
  message,
  code,
  exitCode,
  stderr,
  promptExcerpt,
  provider = 'exec',
  isRetryable = false,
}: CodexErrorMetadata & {
  message: string;
  provider?: 'exec' | 'app-server';
  isRetryable?: boolean;
}): APICallError {
  const data: CodexErrorMetadata = { code, exitCode, stderr, promptExcerpt };
  const url = provider === 'app-server' ? 'codex-cli://app-server' : 'codex-cli://exec';
  return new APICallError({
    message,
    isRetryable,
    url,
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
    if (data?.code !== undefined) {
      const normalized = String(data.code).trim().toLowerCase();
      if (normalized === '401' || normalized === 'unauthorized' || normalized === 'auth') {
        return true;
      }
    }
  }
  return false;
}

export function isUnsupportedFeatureError(err: unknown): err is UnsupportedFeatureError {
  return err instanceof UnsupportedFeatureError;
}
