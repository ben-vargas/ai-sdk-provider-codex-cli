/**
 * Logger interface for custom logging.
 */
export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Known Codex-capable model IDs with string fallback for forward compatibility.
 */
export type CodexModelId =
  | 'gpt-6-astra'
  | 'gpt-5.6-sol'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-luna'
  | 'gpt-5.5'
  | 'gpt-5.3-codex-spark'
  | 'gpt-5.3-codex'
  | 'gpt-5.2-codex'
  | 'gpt-5.2-codex-max'
  | 'gpt-5.2-codex-mini'
  | 'gpt-5.1'
  | 'gpt-5.2'
  | (string & {});

/**
 * Approval policy for exec mode (`-c approval_policy=...`).
 *
 * `'on-failure'` is deprecated: Codex CLI 0.143 retired it (the core config
 * keeps it only as an alias of `'on-request'`), so the provider translates it
 * to `'on-request'` and warns. Note that headless `codex exec` runs force
 * `never` internally unless an automatic approvals reviewer is configured.
 */
export type ApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

// 'none' is the newer "no extra reasoning" level for GPT-5.1+.
// 'minimal' is retained as a backwards-compatible alias for older GPT-5 slugs.
// 'max' and 'ultra' were added by Codex CLI 0.149 (gpt-6-astra / gpt-5.6 families).
// Which levels a model accepts is owned by Codex: inspect
// `supportedReasoningEfforts` from `listModels()` / `provider.listModels()`.
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

/**
 * Every reasoning effort level known to this provider, in ascending order.
 * Kept in compile-time sync with `ReasoningEffort`.
 */
export const CODEX_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const satisfies readonly ReasoningEffort[];

/**
 * Reasoning summary detail level for exec mode.
 */
export type ReasoningSummary = 'auto' | 'detailed';
export type ReasoningSummaryFormat = 'none' | 'experimental';
export type ModelVerbosity = 'low' | 'medium' | 'high';

export interface McpServerBase {
  enabled?: boolean;
  startupTimeoutSec?: number;
  toolTimeoutSec?: number;
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface McpServerStdio extends McpServerBase {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpServerHttp extends McpServerBase {
  transport: 'http';
  url: string;
  bearerToken?: string;
  bearerTokenEnvVar?: string;
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

export type CodexConfigOverrideValue = string | number | boolean | object;

export interface CodexSharedSettings {
  cwd?: string;
  approvalMode?: ApprovalMode;
  sandboxMode?: SandboxMode;
  env?: Record<string, string>;
  verbose?: boolean;
  logger?: Logger | false;
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  reasoningSummaryFormat?: ReasoningSummaryFormat;
  modelVerbosity?: ModelVerbosity;
  mcpServers?: Record<string, McpServerConfig>;
  rmcpClient?: boolean;
  configOverrides?: Record<string, CodexConfigOverrideValue>;
}

export interface CodexSharedProviderOptions {
  reasoningEffort?: ReasoningEffort;
  reasoningSummary?: ReasoningSummary;
  reasoningSummaryFormat?: ReasoningSummaryFormat;
  textVerbosity?: ModelVerbosity;
  mcpServers?: Record<string, McpServerConfig>;
  rmcpClient?: boolean;
  configOverrides?: Record<string, CodexConfigOverrideValue>;
}
