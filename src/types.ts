// Types and settings for Codex CLI provider

/**
 * Logger interface for custom logging.
 * Allows consumers to provide their own logging implementation
 * or disable logging entirely.
 *
 * @example
 * ```typescript
 * const customLogger: Logger = {
 *   debug: (message) => myLoggingService.debug(message),
 *   info: (message) => myLoggingService.info(message),
 *   warn: (message) => myLoggingService.warn(message),
 *   error: (message) => myLoggingService.error(message),
 * };
 * ```
 */
export interface Logger {
  /**
   * Log a debug message. Only logged when verbose mode is enabled.
   * Used for detailed execution tracing and troubleshooting.
   */
  debug: (message: string) => void;

  /**
   * Log an informational message. Only logged when verbose mode is enabled.
   * Used for general execution flow information.
   */
  info: (message: string) => void;

  /**
   * Log a warning message.
   */
  warn: (message: string) => void;

  /**
   * Log an error message.
   */
  error: (message: string) => void;
}

export type ApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

// 'none' is the newer "no extra reasoning" level for GPT‑5.1+.
// 'minimal' is retained as a backwards‑compatible alias for older GPT‑5 slugs.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
/**
 * Reasoning summary detail level.
 * Note: The API error messages claim 'concise' and 'none' are valid, but they are
 * actually rejected with 400 errors. Only 'auto' and 'detailed' work in practice.
 */
export type ReasoningSummary = 'auto' | 'detailed';
export type ReasoningSummaryFormat = 'none' | 'experimental';
export type ModelVerbosity = 'low' | 'medium' | 'high';

export interface McpServerBase {
  /**
   * Enable/disable this MCP server without removing its definition.
   * Maps to: `mcp_servers.<name>.enabled`
   */
  enabled?: boolean;

  /**
   * Time allowed for the MCP server to start (in seconds).
   * Maps to: `mcp_servers.<name>.startup_timeout_sec`
   */
  startupTimeoutSec?: number;

  /**
   * Max time a single MCP tool call may run (in seconds).
   * Maps to: `mcp_servers.<name>.tool_timeout_sec`
   */
  toolTimeoutSec?: number;

  /**
   * Explicit allow/deny lists for tools exposed by the server.
   * Maps to: `mcp_servers.<name>.enabled_tools` / `disabled_tools`
   */
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface McpServerStdio extends McpServerBase {
  /** Execute an MCP server over stdio */
  transport: 'stdio';

  /** Command to start the MCP server (e.g., `node`, `python`, or a binary path). */
  command: string;

  /** Arguments passed to the command. */
  args?: string[];

  /** Environment variables passed to the MCP process. */
  env?: Record<string, string>;

  /** Optional working directory for the MCP server process. */
  cwd?: string;
}

export interface McpServerHttp extends McpServerBase {
  /** Use an HTTP-based MCP server (RMCP). */
  transport: 'http';

  /** Base URL for the MCP server. */
  url: string;

  /** Bearer token supplied inline (use env var variant to avoid embedding secrets). */
  bearerToken?: string;

  /** Name of env var that holds the bearer token. */
  bearerTokenEnvVar?: string;

  /** Static HTTP headers to send with each MCP request. */
  httpHeaders?: Record<string, string>;

  /** Names of env vars whose values should be sent as HTTP headers. */
  envHttpHeaders?: Record<string, string>;
}

export type McpServerConfig = McpServerStdio | McpServerHttp;

export interface CodexCliSettings {
  // Path to the codex CLI JS entry (bin/codex.js) or executable. If omitted, the provider tries to resolve @openai/codex.
  codexPath?: string;

  // Set working directory for the Codex process
  cwd?: string;

  // Additional directories Codex should be allowed to read/write (maps to repeated --add-dir)
  addDirs?: string[];

  // Approval policy for command execution
  approvalMode?: ApprovalMode;

  // Sandbox mode for command execution
  sandboxMode?: SandboxMode;

  // Convenience: fully auto (equivalent to --full-auto)
  fullAuto?: boolean;

  // Danger mode which bypasses approvals and sandbox (equivalent to --dangerously-bypass-approvals-and-sandbox)
  dangerouslyBypassApprovalsAndSandbox?: boolean;

  // Skip Git repo safety check (recommended for CI/non-repo usage)
  skipGitRepoCheck?: boolean;

  // Force color handling in Codex CLI output; defaults to auto
  color?: 'always' | 'never' | 'auto';

  // Allow falling back to `npx @openai/codex` if the binary cannot be resolved
  allowNpx?: boolean;

  // Optional: write last agent message to this file (Codex CLI flag)
  outputLastMessageFile?: string;

  // Extra environment variables for the spawned process (e.g., OPENAI_API_KEY)
  env?: Record<string, string>;

  // Enable verbose provider logging
  verbose?: boolean;

  // Custom logger; set to false to disable logging
  logger?: Logger | false;

  // ===== Reasoning & Verbosity =====

  /**
   * Controls reasoning effort for reasoning-capable models (o3, o4-mini, the GPT-5.1 family,
   * and legacy GPT-5 slugs). Higher effort produces more thorough reasoning at the cost of latency.
   *
   * Codex CLI model presets currently expose `low`/`medium`/`high` for `gpt-5.1` and `gpt-5.1-codex`.
   * Per OpenAI API docs, GPT‑5.1+ models support a `none` level (no extra reasoning); older GPT‑5 slugs used `minimal` instead.
   * `gpt-5.1-codex-max` additionally supports `xhigh`. `gpt-5.1-codex-mini` only offers `medium`/`high`.
   *
   * Maps to: `-c model_reasoning_effort=<value>`
   * @see https://platform.openai.com/docs/guides/reasoning
   */
  reasoningEffort?: ReasoningEffort;

  /**
   * Controls reasoning summary detail level.
   *
   * Valid values: 'auto' | 'detailed'
   * Note: Despite API error messages claiming 'concise' and 'none' are valid,
   * they are rejected with 400 errors in practice.
   *
   * Maps to: `-c model_reasoning_summary=<value>`
   * @see https://platform.openai.com/docs/guides/reasoning#reasoning-summaries
   */
  reasoningSummary?: ReasoningSummary;

  /**
   * Controls reasoning summary format (experimental).
   *
   * Maps to: `-c model_reasoning_summary_format=<value>`
   */
  reasoningSummaryFormat?: ReasoningSummaryFormat;

  /**
   * Controls output length/detail for GPT-5.1 (non-Codex) and legacy GPT-5 models.
   * Codex-specific slugs ignore this flag because the CLI disables verbosity for them.
   * Only applies to models using the Responses API.
   *
   * Maps to: `-c model_verbosity=<value>`
   */
  modelVerbosity?: ModelVerbosity;

  // ===== MCP configuration =====

  /**
   * Configure MCP servers (stdio or HTTP/RMCP). Keys are server names.
   * Each entry maps to the Codex CLI `mcp_servers.<name>` table.
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Enable the RMCP client so HTTP-based MCP servers can be contacted.
   * Maps to: `-c features.rmcp_client=true`
   */
  rmcpClient?: boolean;

  // ===== Advanced Codex Features =====

  /**
   * Configuration profile from config.toml to specify default options.
   *
   * Maps to: `--profile <name>`
   */
  profile?: string;

  /**
   * Use OSS provider (experimental).
   *
   * Maps to: `--oss`
   */
  oss?: boolean;

  /**
   * Enable web search tool for the model.
   *
   * Maps to: `-c tools.web_search=true`
   */
  webSearch?: boolean;

  // ===== Generic config overrides (maps to -c key=value) =====

  /**
   * Generic Codex CLI config overrides. Allows setting any config value
   * without updating the provider.
   *
   * Each entry maps to: `-c <key>=<value>`
   *
   * Examples:
   * - `{ experimental_resume: '/tmp/session.jsonl' }`
   * - `{ 'model_providers.custom.base_url': 'http://localhost:8000' }`
   * - `{ 'sandbox_workspace_write': { network_access: true } }`
   *
   * Values are serialized:
   * - string → raw string
   * - number/boolean → String(value)
   * - plain objects → flattened recursively to dotted keys
   * - arrays → JSON.stringify(value)
   * - other objects (Date, RegExp, Map, etc.) → JSON.stringify(value)
   */
  configOverrides?: Record<string, string | number | boolean | object>;
}

export interface CodexCliProviderSettings {
  // Default settings applied to language models created by this provider
  defaultSettings?: CodexCliSettings;
}

/**
 * Per-call overrides supplied through AI SDK providerOptions.
 * These values take precedence over constructor-level CodexCliSettings.
 */
export interface CodexCliProviderOptions {
  /**
   * Per-call override for reasoning depth.
   * Maps to `model_reasoning_effort`.
   */
  reasoningEffort?: ReasoningEffort;

  /**
   * Per-call override for reasoning summary detail level.
   * Maps to `model_reasoning_summary`.
   */
  reasoningSummary?: ReasoningSummary;

  /**
   * Per-call override for reasoning summary format.
   * Maps to `model_reasoning_summary_format`.
   */
  reasoningSummaryFormat?: ReasoningSummaryFormat;

  /**
   * AI SDK naming for per-call verbosity overrides.
   * Maps to Codex `model_verbosity`.
   */
  textVerbosity?: ModelVerbosity;

  /**
   * Per-call override for extra directories Codex can access.
   * Maps to repeated `--add-dir` flags.
   */
  addDirs?: string[];

  /**
   * Per-call Codex CLI config overrides. These are merged with
   * constructor-level overrides with per-call values taking precedence.
   */
  configOverrides?: Record<string, string | number | boolean | object>;

  /**
   * Per-call MCP server definitions. Merged with constructor definitions
   * (per-call servers and fields take precedence).
   */
  mcpServers?: Record<string, McpServerConfig>;

  /**
   * Per-call override for RMCP client enablement.
   */
  rmcpClient?: boolean;
}
