export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  id: JsonRpcId;
  result: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  id: JsonRpcId | null;
  error: JsonRpcError;
}

export interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification;

export interface ClientInfo {
  name: string;
  title?: string;
  version: string;
}

export interface InitializeCapabilities {
  experimentalApi: boolean;
  optOutNotificationMethods?: string[] | null;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities: InitializeCapabilities | null;
}

export interface InitializeResponse {
  userAgent: string;
  capabilities?: Record<string, unknown> | null;
}

export interface ModelListParams {
  modelProviders?: string[] | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface ModelInfo {
  id: string;
  name?: string | null;
  modelProvider?: string | null;
  description?: string | null;
  isDefault?: boolean | null;
  [k: string]: unknown;
}

export interface ModelListResponse {
  data: ModelInfo[];
  nextCursor: string | null;
}

export interface Thread {
  id: string;
  preview?: string;
  modelProvider?: string;
  createdAt?: number;
  [k: string]: unknown;
}

export interface ThreadStartParams {
  model?: string | null;
  modelProvider?: string | null;
  cwd?: string | null;
  approvalPolicy?: unknown;
  sandbox?: unknown;
  config?: Record<string, unknown> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: 'none' | 'friendly' | 'pragmatic' | null;
  ephemeral?: boolean | null;
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
}

export interface ThreadStartResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  cwd: string;
  approvalPolicy: unknown;
  sandbox: unknown;
  reasoningEffort: string | null;
}

export interface ThreadResumeParams {
  threadId: string;
  history?: unknown[] | null;
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  cwd?: string | null;
  approvalPolicy?: unknown;
  sandbox?: unknown;
  config?: Record<string, unknown> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: 'none' | 'friendly' | 'pragmatic' | null;
  persistExtendedHistory: boolean;
}

export type ThreadResumeResponse = ThreadStartResponse;

export type UserInput =
  | { type: 'text'; text: string; text_elements: unknown[] }
  | { type: 'image'; url?: string; imageUrl?: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string };

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  cwd?: string | null;
  approvalPolicy?: unknown;
  sandboxPolicy?: unknown;
  model?: string | null;
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;
  summary?: 'auto' | 'concise' | 'detailed' | 'none' | null;
  personality?: 'none' | 'friendly' | 'pragmatic' | null;
  outputSchema?: unknown;
  collaborationMode?: unknown;
}

export type CodexErrorInfo =
  | 'contextWindowExceeded'
  | 'usageLimitExceeded'
  | 'serverOverloaded'
  | 'internalServerError'
  | 'unauthorized'
  | 'badRequest'
  | 'threadRollbackFailed'
  | 'sandboxError'
  | 'other'
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } };

export interface TurnError {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export type UserMessageItem = {
  type: 'userMessage';
  id: string;
  content: UserInput[];
};

export type AgentMessageItem = {
  type: 'agentMessage';
  id: string;
  text: string;
  phase: string | null;
};

export type PlanItem = {
  type: 'plan';
  id: string;
  text: string;
};

export type ReasoningItem = {
  type: 'reasoning';
  id: string;
  summary: string[];
  content: string[];
};

export type CommandExecutionItem = {
  type: 'commandExecution';
  id: string;
  command: string;
  cwd: string;
  processId: string | null;
  status: string;
  commandActions: unknown[];
  aggregatedOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
};

export type FileChangeItem = {
  type: 'fileChange';
  id: string;
  changes: unknown[];
  status: string;
};

export type McpToolCallItem = {
  type: 'mcpToolCall';
  id: string;
  server: string;
  tool: string;
  status: string;
  arguments: unknown;
  result: unknown | null;
  error: unknown | null;
  durationMs: number | null;
};

export type CollabAgentToolCallItem = {
  type: 'collabAgentToolCall';
  id: string;
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  agentsStates: Record<string, unknown>;
};

export type WebSearchItem = {
  type: 'webSearch';
  id: string;
  query: string;
  action: unknown | null;
};

export type ImageViewItem = {
  type: 'imageView';
  id: string;
  path: string;
};

export type EnteredReviewModeItem = {
  type: 'enteredReviewMode';
  id: string;
  review: string;
};

export type ExitedReviewModeItem = {
  type: 'exitedReviewMode';
  id: string;
  review: string;
};

export type ContextCompactionItem = {
  type: 'contextCompaction';
  id: string;
};

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | PlanItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | CollabAgentToolCallItem
  | WebSearchItem
  | ImageViewItem
  | EnteredReviewModeItem
  | ExitedReviewModeItem
  | ContextCompactionItem;

export interface Turn {
  id: string;
  items: ThreadItem[];
  status: TurnStatus;
  error: TurnError | null;
}

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type TurnInterruptResponse = Record<string, never>;

export interface ThreadStartedNotification {
  thread: Thread;
}

export interface TurnStartedNotification {
  threadId: string;
  turn: Turn;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: Turn;
}

export interface ItemStartedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
}

export interface ItemCompletedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
}

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ReasoningTextDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ReasoningSummaryTextDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface CommandExecutionOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface FileChangeOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ErrorNotification {
  error: TurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
  [k: string]: unknown;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface ThreadTokenUsageUpdatedNotification {
  threadId: string;
  turnId: string;
  tokenUsage: ThreadTokenUsage;
}

export interface CommandExecutionRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  networkApprovalContext?: unknown | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[] | null;
  proposedExecpolicyAmendment?: unknown | null;
}

export interface CommandExecutionRequestApprovalResponse {
  decision:
    | 'accept'
    | 'acceptForSession'
    | 'decline'
    | 'cancel'
    | { acceptWithExecpolicyAmendment: { execpolicy_amendment: unknown } };
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface FileChangeRequestApprovalResponse {
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
}

export interface SkillRequestApprovalParams {
  itemId: string;
  skillName: string;
}

export interface SkillRequestApprovalResponse {
  decision: 'approve' | 'decline';
}

export interface ToolRequestUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: unknown[];
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, unknown>;
}

export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
}

export interface DynamicToolCallResponse {
  contentItems: unknown[];
  success: boolean;
}

export interface ChatgptAuthTokensRefreshParams {
  reason: string;
  previousAccountId?: string | null;
}

export interface ChatgptAuthTokensRefreshResponse {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
}
