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
  McpServerElicitationRequestParams,
  McpServerElicitationRequestResponse,
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

/**
 * Fine-grained approval controls (`AskForApproval::Granular` in the codex
 * app-server v2 protocol; requires the experimental API, which this client
 * always enables). When a flag is `true`, prompts of that category are shown
 * to the client (via server requests); when `false`, they are auto-rejected.
 */
export interface AppServerApprovalGranular {
  granular: {
    sandbox_approval: boolean;
    rules: boolean;
    mcp_elicitations: boolean;
    /** Defaults to `false` on the server when omitted. */
    skill_approval?: boolean;
    /** Defaults to `false` on the server when omitted. */
    request_permissions?: boolean;
  };
}

/**
 * @deprecated Legacy `reject` form from Codex CLI ~0.105 (removed since
 * 0.130). Flags are *inverted* relative to `granular` (`true` = auto-reject);
 * the provider translates it to the equivalent `granular` policy and warns.
 */
export interface AppServerApprovalReject {
  reject: {
    sandbox_approval: boolean;
    rules: boolean;
    mcp_elicitations: boolean;
  };
}

/**
 * Approval policy sent on `thread/start`, `thread/resume` and `turn/start`.
 *
 * `'on-failure'` is deprecated: Codex CLI 0.143 retired it and app-server
 * >= 0.144 rejects it (`-32600 unknown variant 'on-failure'`), so the
 * provider translates it to `'on-request'` and warns once per model.
 */
export type AppServerApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | AppServerApprovalGranular
  /** @deprecated Retired by Codex CLI 0.143; translated to `'on-request'`. */
  | 'on-failure'
  | AppServerApprovalReject;

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

export interface AppServerMcpElicitationRequest {
  id: JsonRpcId;
  method: 'mcpServer/elicitation/request';
  params: McpServerElicitationRequestParams;
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
  | AppServerMcpElicitationRequest
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
  /**
   * Handles `mcpServer/elicitation/request` (Codex >= 0.139), which includes
   * MCP tool call approvals (`params._meta.codex_approval_kind === 'mcp_tool_call'`).
   * Built-in default: accept tool call approvals when `autoApprove` is true,
   * decline all other elicitations.
   */
  onMcpElicitation?: (
    request: AppServerMcpElicitationRequest,
  ) => Promise<McpServerElicitationRequestResponse | undefined>;
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
