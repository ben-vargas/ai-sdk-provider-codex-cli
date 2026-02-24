import type {
  CodexConfigOverrideValue,
  CodexSharedProviderOptions,
  CodexSharedSettings,
} from './types-shared.js';

export interface CodexExecSettings extends CodexSharedSettings {
  codexPath?: string;
  addDirs?: string[];
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
