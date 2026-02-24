/**
 * Logger interface for custom logging.
 */
export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export type ApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

// 'none' is the newer "no extra reasoning" level for GPT-5.1+.
// 'minimal' is retained as a backwards-compatible alias for older GPT-5 slugs.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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
