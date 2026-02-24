import type {
  CodexConfigOverrideValue,
  CodexSharedProviderOptions,
  CodexSharedSettings,
  ReasoningEffort,
} from './types-shared.js';

export type AppServerPersonality = 'none' | 'friendly' | 'pragmatic';
export type AppServerReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none';

export type AppServerApprovalPolicy =
  | 'untrusted'
  | 'on-failure'
  | 'on-request'
  | 'never'
  | {
      reject: {
        sandbox_approval: boolean;
        rules: boolean;
        mcp_elicitations: boolean;
      };
    };

export type AppServerSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; access?: unknown }
  | { type: 'externalSandbox'; networkAccess?: 'restricted' | 'enabled' }
  | {
      type: 'workspaceWrite';
      writableRoots?: string[];
      readOnlyAccess?: unknown;
      networkAccess?: boolean;
      excludeTmpdirEnvVar?: boolean;
      excludeSlashTmp?: boolean;
    };

export type ServerRequestHandler = (request: {
  method: string;
  id: number | string;
  params: Record<string, unknown>;
}) => Promise<unknown>;

export interface CodexAppServerSettings extends CodexSharedSettings {
  codexPath?: string;
  personality?: AppServerPersonality;
  effort?: ReasoningEffort;
  summary?: AppServerReasoningSummary;
  approvalPolicy?: AppServerApprovalPolicy;
  sandboxPolicy?: AppServerSandboxPolicy;
  autoApprove?: boolean;
  persistExtendedHistory?: boolean;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  configOverrides?: Record<string, CodexConfigOverrideValue>;
  onServerRequest?: ServerRequestHandler;
  minCodexVersion?: string;
}

export interface CodexAppServerProviderSettings {
  defaultSettings?: CodexAppServerSettings;
}

export interface CodexAppServerProviderOptions extends CodexSharedProviderOptions {
  threadId?: string;
  personality?: AppServerPersonality;
  effort?: ReasoningEffort;
  summary?: AppServerReasoningSummary;
  approvalPolicy?: AppServerApprovalPolicy;
  sandboxPolicy?: AppServerSandboxPolicy;
  autoApprove?: boolean;
  persistExtendedHistory?: boolean;
  onServerRequest?: ServerRequestHandler;
}
