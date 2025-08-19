// Types and settings for Codex CLI provider

export interface Logger {
  warn: (message: string) => void;
  error: (message: string) => void;
}

export type ApprovalMode = 'untrusted' | 'on-failure' | 'on-request' | 'never';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

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
}

export interface CodexCliProviderSettings {
  // Default settings applied to language models created by this provider
  defaultSettings?: CodexCliSettings;
}
