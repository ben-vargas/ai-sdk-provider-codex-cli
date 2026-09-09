import type {
  CodexConfigOverrideValue,
  CodexSharedProviderOptions,
  CodexSharedSettings,
} from './types-shared.js';

export interface CodexExecSettings extends CodexSharedSettings {
  codexPath?: string;
  addDirs?: string[];
  /**
   * @deprecated Codex CLI 0.147 removed `codex exec --full-auto`. The flag now
   * defaults the emitted sandbox to `workspace-write` and the approval policy
   * to `never` (what `--full-auto` pinned, even with
   * `approvals_reviewer = "auto_review"` configured). Explicit `sandboxMode` /
   * `approvalMode` settings (including provider `defaultSettings`) win over
   * those defaults, and a later `configOverrides.approval_policy` can replace
   * the emitted policy. `fullAuto` still suppresses
   * `dangerouslyBypassApprovalsAndSandbox`. To migrate, set both
   * `sandboxMode: 'workspace-write'` and `approvalMode: 'never'`, and drop
   * `dangerouslyBypassApprovalsAndSandbox` if it was configured alongside.
   */
  fullAuto?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  skipGitRepoCheck?: boolean;
  color?: 'always' | 'never' | 'auto';
  allowNpx?: boolean;
  outputLastMessageFile?: string;
  profile?: string;
  oss?: boolean;
  webSearch?: boolean;
  configOverrides?: Record<string, CodexConfigOverrideValue>;
}

export interface CodexExecProviderSettings {
  defaultSettings?: CodexExecSettings;
}

/**
 * Per-call overrides supplied through AI SDK providerOptions.
 */
export interface CodexExecProviderOptions extends CodexSharedProviderOptions {
  addDirs?: string[];
}

// Backward-compat aliases
export type CodexCliSettings = CodexExecSettings;
export type CodexCliProviderSettings = CodexExecProviderSettings;
export type CodexCliProviderOptions = CodexExecProviderOptions;
