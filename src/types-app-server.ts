import type { JsonRpcId } from './app-server-protocol-types.js';
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
} from './app-server-protocol-types.js';
import type {
  CodexConfigOverrideValue,
  Logger,
  McpServerConfig,
  ReasoningEffort,
} from './types-shared.js';
import type { SdkMcpServer } from './tools/sdk-mcp-server.js';

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

export interface CodexAppServerSession {
  readonly threadId: string;
  readonly turnId: string | null;
  injectMessage(content: string | AppServerUserInput[]): Promise<void>;
  interrupt(): Promise<void>;
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

export interface CodexAppServerProviderSettings {
  defaultSettings?: CodexAppServerSettings;
}

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
