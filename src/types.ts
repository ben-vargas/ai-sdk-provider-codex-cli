// Types and settings for Codex CLI provider

export interface Logger {
  warn: (message: string) => void;
  error: (message: string) => void;
}

export type ApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
/**
 * Reasoning summary detail level.
 * Note: The API error messages claim 'concise' and 'none' are valid, but they are
 * actually rejected with 400 errors. Only 'auto' and 'detailed' work in practice.
 */
export type ReasoningSummary = 'auto' | 'detailed';
export type ReasoningSummaryFormat = 'none' | 'experimental';
export type ModelVerbosity = 'low' | 'medium' | 'high';

export interface CodexCliSettings {
  // Path to the codex CLI JS entry (bin/codex.js) or executable. If omitted, the provider tries to resolve @openai/codex.
  codexPath?: string;

  // Set working directory for the Codex process
  cwd?: string;

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
   * Controls reasoning effort for reasoning-capable models (o3, o4-mini, gpt-5, gpt-5-codex).
   * Higher effort produces more thorough reasoning at the cost of latency.
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
   * Controls output length/detail for GPT-5 family models.
   * Only applies to models using the Responses API.
   *
   * Maps to: `-c model_verbosity=<value>`
   */
  modelVerbosity?: ModelVerbosity;

  // ===== Advanced Codex Features =====

  /**
   * Include experimental plan tool that the model can use to update its current plan.
   *
   * Maps to: `--include-plan-tool`
   */
  includePlanTool?: boolean;

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
