import type { JsonRpcId } from './protocol/types.js';
import type {
  ChatgptAuthTokensRefreshParams,
  ChatgptAuthTokensRefreshResponse,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  SkillRequestApprovalParams,
  SkillRequestApprovalResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
} from './protocol/types.js';
import type {
  CodexConfigOverrideValue,
  Logger,
  McpServerConfig,
  ReasoningEffort,
} from '../types-shared.js';
import type { SdkMcpServer } from '../tools/sdk-mcp-server.js';

export type AppServerThreadMode = 'stateless' | 'persistent';

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
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'
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

export type AppServerUserInput =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string }
  | { type: 'localImage'; path: string };

/**
 * Live session handle for an active app-server thread.
 *
 * Session callbacks are most useful in streaming flows where you can inject
 * follow-up instructions while a turn is still running.
 */
export interface CodexAppServerSession {
  readonly threadId: string;
  readonly turnId: string | null;

  /**
   * Injects an additional user message into the current thread.
   */
  injectMessage(content: string | AppServerUserInput[]): Promise<void>;

  /**
   * Requests interruption of the currently running turn.
   */
  interrupt(): Promise<void>;

  /**
   * Returns whether this session currently has an active turn.
   */
  isActive(): boolean;
}

export interface AppServerCommandExecutionApprovalRequest {
  id: JsonRpcId;
  method: 'item/commandExecution/requestApproval';
  params: CommandExecutionRequestApprovalParams;
}

export interface AppServerFileChangeApprovalRequest {
  id: JsonRpcId;
  method: 'item/fileChange/requestApproval';
  params: FileChangeRequestApprovalParams;
}

export interface AppServerSkillApprovalRequest {
  id: JsonRpcId;
  method: 'skill/requestApproval';
  params: SkillRequestApprovalParams;
}

export interface AppServerToolRequestUserInputRequest {
  id: JsonRpcId;
  method: 'item/tool/requestUserInput';
  params: ToolRequestUserInputParams;
}

export interface AppServerDynamicToolCallRequest {
  id: JsonRpcId;
  method: 'item/tool/call';
  params: DynamicToolCallParams;
}

export interface AppServerAuthRefreshRequest {
  id: JsonRpcId;
  method: 'account/chatgptAuthTokens/refresh';
  params: ChatgptAuthTokensRefreshParams;
}

export type AppServerTypedRequest =
  | AppServerCommandExecutionApprovalRequest
  | AppServerFileChangeApprovalRequest
  | AppServerSkillApprovalRequest
  | AppServerToolRequestUserInputRequest
  | AppServerDynamicToolCallRequest
  | AppServerAuthRefreshRequest;

export interface AppServerUnhandledRequest {
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Typed handlers for server-initiated JSON-RPC requests.
 *
 * Handler precedence:
 * 1) per-call provider options
 * 2) provider default settings
 * 3) built-in defaults in the RPC client
 * 4) `onUnhandled` fallback
 */
export interface CodexAppServerRequestHandlers {
  onCommandExecutionApproval?: (
    request: AppServerCommandExecutionApprovalRequest,
  ) => Promise<CommandExecutionRequestApprovalResponse | undefined>;
  onFileChangeApproval?: (
    request: AppServerFileChangeApprovalRequest,
  ) => Promise<FileChangeRequestApprovalResponse | undefined>;
  onSkillApproval?: (
    request: AppServerSkillApprovalRequest,
  ) => Promise<SkillRequestApprovalResponse | undefined>;
  onToolRequestUserInput?: (
    request: AppServerToolRequestUserInputRequest,
  ) => Promise<ToolRequestUserInputResponse | undefined>;
  onDynamicToolCall?: (
    request: AppServerDynamicToolCallRequest,
  ) => Promise<DynamicToolCallResponse | undefined>;
  onAuthRefresh?: (
    request: AppServerAuthRefreshRequest,
  ) => Promise<ChatgptAuthTokensRefreshResponse | undefined>;
  onUnhandled?: (request: AppServerUnhandledRequest) => Promise<unknown>;
}

export type AppServerMcpServerConfig = McpServerConfig | SdkMcpServer;

/**
 * Provider-level and model-level settings for Codex app-server mode.
 */
export interface CodexAppServerSettings {
  codexPath?: string;
  cwd?: string;
  env?: Record<string, string>;
  verbose?: boolean;
  logger?: Logger | false;

  personality?: AppServerPersonality;
  effort?: ReasoningEffort;
  summary?: AppServerReasoningSummary;
  approvalPolicy?: AppServerApprovalPolicy;
  sandboxPolicy?: AppServerSandboxPolicy;
  baseInstructions?: string;
  developerInstructions?: string;

  mcpServers?: Record<string, AppServerMcpServerConfig>;
  rmcpClient?: boolean;
  configOverrides?: Record<string, CodexConfigOverrideValue>;

  autoApprove?: boolean;
  persistExtendedHistory?: boolean;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  minCodexVersion?: string;
  threadMode?: AppServerThreadMode;
  resume?: string;
  includeRawChunks?: boolean;

  serverRequests?: CodexAppServerRequestHandlers;
  onSessionCreated?: (session: CodexAppServerSession) => void | Promise<void>;
}

/**
 * Factory options passed to `createCodexAppServer`.
 */
export interface CodexAppServerProviderSettings {
  defaultSettings?: CodexAppServerSettings;
}

/**
 * Per-request overrides passed via `providerOptions['codex-app-server']`.
 */
export interface CodexAppServerProviderOptions {
  threadId?: string;
  resume?: string;
  threadMode?: AppServerThreadMode;

  includeRawChunks?: boolean;
  personality?: AppServerPersonality;
  effort?: ReasoningEffort;
  summary?: AppServerReasoningSummary;
  approvalPolicy?: AppServerApprovalPolicy;
  sandboxPolicy?: AppServerSandboxPolicy;
  baseInstructions?: string;
  developerInstructions?: string;

  mcpServers?: Record<string, AppServerMcpServerConfig>;
  rmcpClient?: boolean;
  configOverrides?: Record<string, CodexConfigOverrideValue>;

  autoApprove?: boolean;
  persistExtendedHistory?: boolean;

  serverRequests?: Partial<CodexAppServerRequestHandlers>;
  onSessionCreated?: (session: CodexAppServerSession) => void | Promise<void>;
}
