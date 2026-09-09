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
  title?: string | null;
  version: string;
}

export interface InitializeCapabilities {
  experimentalApi: boolean;
  /** Opt into `attestation/generate` requests (codex >= 0.142). */
  requestAttestation?: boolean;
  /** Allow MCP servers to request OpenAI extended form elicitations (codex >= 0.142). */
  mcpServerOpenaiFormElicitation?: boolean;
  optOutNotificationMethods?: string[] | null;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities: InitializeCapabilities | null;
}

export interface InitializeResponse {
  userAgent: string;
  /** Absolute path to the server's $CODEX_HOME directory (codex >= 0.142). */
  codexHome?: string;
  /** Platform family, e.g. 'unix' or 'windows' (codex >= 0.142). */
  platformFamily?: string;
  /** Operating system, e.g. 'macos', 'linux', 'windows' (codex >= 0.142). */
  platformOs?: string;
  /** External contract: only pre-0.142 servers return this; codex 0.142.5 omits it. */
  capabilities?: Record<string, unknown> | null;
}

export interface ModelListParams {
  /**
   * External contract: accepted by pre-0.142 servers only. Codex 0.142.5
   * removed this param and ignores it when sent (verified empirically).
   */
  modelProviders?: string[] | null;
  cursor?: string | null;
  limit?: number | null;
  /** Include models hidden from the default picker list (codex >= 0.142). */
  includeHidden?: boolean | null;
}

/**
 * Vendored subset of the codex 0.142.5 `Model` wire type (renamed upstream
 * from `ModelInfo`), plus fields only pre-0.142 servers return.
 */
export interface ModelInfo {
  id: string;
  /** Underlying model slug (codex >= 0.142). */
  model?: string;
  /** Display name; replaces the pre-0.142 `name` field (codex >= 0.142). */
  displayName?: string;
  description?: string | null;
  /** Whether the model is hidden from the default picker list (codex >= 0.142). */
  hidden?: boolean;
  isDefault?: boolean | null;
  /** External contract: only pre-0.142 servers return `name`. */
  name?: string | null;
  /** External contract: only pre-0.142 servers return `modelProvider`. */
  modelProvider?: string | null;
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
  experimentalRawEvents?: boolean;
  /**
   * External contract: consumed by pre-0.142 servers only. Codex 0.142.5
   * removed this param and ignores it when sent (verified empirically).
   */
  persistExtendedHistory?: boolean;
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
  /**
   * External contract: consumed by pre-0.142 servers only. Codex 0.142.5
   * removed this param and ignores it when sent.
   */
  persistExtendedHistory?: boolean;
}

export type ThreadResumeResponse = ThreadStartResponse;

export type UserInput =
  | { type: 'text'; text: string; text_elements: unknown[] }
  | {
      type: 'image';
      url: string;
      /** Optional rendering detail hint (codex >= 0.142). */
      detail?: 'auto' | 'low' | 'high' | 'original';
      /** External contract: pre-0.142 servers read `imageUrl`; codex 0.142.5 only reads `url`. */
      imageUrl?: string;
    }
  | {
      type: 'localImage';
      path: string;
      /** Optional rendering detail hint (codex >= 0.142). */
      detail?: 'auto' | 'low' | 'high' | 'original';
    }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string };

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  cwd?: string | null;
  approvalPolicy?: unknown;
  sandboxPolicy?: unknown;
  model?: string | null;
  /**
   * Reasoning effort. Open-ended string upstream (`ReasoningEffort = string`
   * in codex 0.153.4); known values include 'none', 'minimal', 'low',
   * 'medium', 'high', 'xhigh', 'max', and 'ultra' (the last two since
   * codex 0.149). Per-model availability comes from `model/list`.
   */
  effort?: string | null;
  summary?: 'auto' | 'concise' | 'detailed' | 'none' | null;
  personality?: 'none' | 'friendly' | 'pragmatic' | null;
  outputSchema?: unknown;
  collaborationMode?: unknown;
}

export type CodexErrorInfo =
  | 'contextWindowExceeded'
  | 'usageLimitExceeded'
  | 'serverOverloaded'
  | 'cyberPolicy'
  | 'internalServerError'
  | 'unauthorized'
  | 'badRequest'
  | 'threadRollbackFailed'
  | 'sandboxError'
  | 'other'
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: 'review' | 'compact' } };

export interface TurnError {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export type UserMessageItem = {
  type: 'userMessage';
  id: string;
  /** Client-supplied message id echoed back by the server (codex >= 0.142). */
  clientId?: string | null;
  content: UserInput[];
};

export type AgentMessageItem = {
  type: 'agentMessage';
  id: string;
  text: string;
  phase: string | null;
  /** Memory citation metadata (codex >= 0.142). */
  memoryCitation?: unknown | null;
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
  /** 'agent' | 'userShell' | 'unifiedExecStartup' | 'unifiedExecInteraction' (codex >= 0.142). */
  source?: string;
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
  /** MCP app context; replaces `mcpAppResourceUri` (codex >= 0.142). */
  appContext?: unknown | null;
  mcpAppResourceUri?: string;
  pluginId?: string | null;
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
  /** Model requested for the spawned agent, when applicable (codex >= 0.142). */
  model?: string | null;
  /** Reasoning effort requested for the spawned agent, when applicable (codex >= 0.142). */
  reasoningEffort?: string | null;
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

/** codex >= 0.142. */
export type HookPromptItem = {
  type: 'hookPrompt';
  id: string;
  fragments: unknown[];
};

/** SDK-registered dynamic tool call surfaced as a thread item (codex >= 0.142). */
export type DynamicToolCallItem = {
  type: 'dynamicToolCall';
  id: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
  status: string;
  contentItems: unknown[] | null;
  success: boolean | null;
  durationMs: number | null;
};

/** codex >= 0.142. */
export type SubAgentActivityItem = {
  type: 'subAgentActivity';
  id: string;
  kind: string;
  agentThreadId: string;
  agentPath: string;
};

/** codex >= 0.142. */
export type SleepItem = {
  type: 'sleep';
  id: string;
  durationMs: number;
};

/** codex >= 0.142. */
export type ImageGenerationItem = {
  type: 'imageGeneration';
  id: string;
  status: string;
  revisedPrompt: string | null;
  result: string;
  savedPath?: string;
};

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | PlanItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | DynamicToolCallItem
  | CollabAgentToolCallItem
  | HookPromptItem
  | SubAgentActivityItem
  | SleepItem
  | ImageGenerationItem
  | WebSearchItem
  | ImageViewItem
  | EnteredReviewModeItem
  | ExitedReviewModeItem
  | ContextCompactionItem;

export interface Turn {
  id: string;
  items: ThreadItem[];
  /** 'notLoaded' | 'summary' | 'full' (codex >= 0.142). */
  itemsView?: string;
  status: TurnStatus;
  error: TurnError | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
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
  /** Unix timestamp (ms) when this item lifecycle started (codex >= 0.142). */
  startedAtMs?: number;
}

export interface ItemCompletedNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
  /** Unix timestamp (ms) when this item lifecycle completed (codex >= 0.142). */
  completedAtMs?: number;
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
  /** Index into the reasoning item's `content` array (codex >= 0.142). */
  contentIndex?: number;
}

export interface ReasoningSummaryTextDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  /** Index into the reasoning item's `summary` array (codex >= 0.142). */
  summaryIndex?: number;
}

export interface CommandExecutionOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

/**
 * External contract: codex 0.142.5 marks this notification deprecated and no
 * longer emits it; only pre-0.142 servers do.
 */
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
  /** Unix timestamp (ms) when this approval request started (codex >= 0.142). */
  startedAtMs?: number;
  approvalId?: string | null;
  /** Environment in which the command will run (codex >= 0.142). */
  environmentId?: string | null;
  reason?: string | null;
  networkApprovalContext?: unknown | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[] | null;
  /** Additional permissions requested for this command (codex >= 0.142). */
  additionalPermissions?: unknown | null;
  proposedExecpolicyAmendment?: unknown | null;
  /** Proposed network policy amendments for future requests (codex >= 0.142). */
  proposedNetworkPolicyAmendments?: unknown[] | null;
  /** Ordered decisions the client may present for this prompt (codex >= 0.142). */
  availableDecisions?: unknown[] | null;
}

export interface CommandExecutionRequestApprovalResponse {
  decision:
    | 'accept'
    | 'acceptForSession'
    | 'decline'
    | 'cancel'
    | { acceptWithExecpolicyAmendment: { execpolicy_amendment: unknown } }
    | { applyNetworkPolicyAmendment: { network_policy_amendment: unknown } };
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  /** Unix timestamp (ms) when this approval request started (codex >= 0.142). */
  startedAtMs?: number;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface FileChangeRequestApprovalResponse {
  decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel';
}

/**
 * External contract: `skill/requestApproval` was removed from the codex
 * 0.142.5 server-request surface; only pre-0.142 servers send it.
 */
export interface SkillRequestApprovalParams {
  itemId: string;
  skillName: string;
}

/**
 * External contract: `skill/requestApproval` was removed from the codex
 * 0.142.5 server-request surface; only pre-0.142 servers send it.
 */
export interface SkillRequestApprovalResponse {
  decision: 'approve' | 'decline';
}

export interface ToolRequestUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: unknown[];
  /** Auto-resolution deadline in milliseconds, when set (codex >= 0.142). */
  autoResolutionMs?: number | null;
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, unknown>;
}

export type McpServerElicitationAction = 'accept' | 'decline' | 'cancel';

export interface McpServerElicitationRequestParams {
  threadId: string;
  /** Nullable: the elicitation may arrive outside of an active turn. */
  turnId?: string | null;
  serverName: string;
  /**
   * 'form' and 'openai/form' (codex >= 0.142) requests carry
   * message/requestedSchema; 'url' requests carry url/elicitationId.
   */
  mode?: string;
  message?: string;
  requestedSchema?: unknown;
  url?: string;
  elicitationId?: string;
  /**
   * For MCP tool approval elicitations, Codex sets
   * `codex_approval_kind: 'mcp_tool_call'` and may include `persist` hints.
   */
  _meta?: Record<string, unknown> | null;
}

export interface McpServerElicitationRequestResponse {
  action: McpServerElicitationAction;
  /** Structured user input for accepted elicitations; null for decline/cancel. */
  content?: Record<string, unknown> | null;
  /** Optional client metadata for form-mode action handling (codex >= 0.142). */
  _meta?: Record<string, unknown> | null;
}

export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  /** Dynamic tool namespace (codex >= 0.142). */
  namespace?: string | null;
  tool: string;
  arguments: unknown;
}

export interface DynamicToolCallResponse {
  contentItems: unknown[];
  success: boolean;
}

export interface ChatgptAuthTokensRefreshParams {
  /** Codex 0.142.5 only sends 'unauthorized'; kept open for forward compat. */
  reason: string;
  previousAccountId?: string | null;
}

export interface ChatgptAuthTokensRefreshResponse {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
}
