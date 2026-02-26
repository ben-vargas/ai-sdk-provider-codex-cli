import { z } from 'zod';

export const jsonRpcIdSchema = z.union([z.number(), z.string()]);

export const jsonRpcRequestSchema = z
  .object({
    id: jsonRpcIdSchema,
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const jsonRpcResponseSchema = z
  .object({
    id: jsonRpcIdSchema,
    result: z.unknown(),
  })
  .refine((value) => Object.prototype.hasOwnProperty.call(value, 'result'), {
    message: 'result field is required',
  })
  .passthrough();

export const jsonRpcErrorResponseSchema = z
  .object({
    id: z.union([jsonRpcIdSchema, z.null()]),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const jsonRpcNotificationSchema = z
  .object({
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const userInputTextSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    text_elements: z.array(z.unknown()),
  })
  .passthrough();

const userInputImageSchema = z
  .object({
    type: z.literal('image'),
    url: z.string().optional(),
    imageUrl: z.string().optional(),
  })
  .refine((value) => typeof value.url === 'string' || typeof value.imageUrl === 'string', {
    message: 'image input must provide url or imageUrl',
  })
  .passthrough();

const userInputLocalImageSchema = z
  .object({
    type: z.literal('localImage'),
    path: z.string(),
  })
  .passthrough();

const userInputSkillSchema = z
  .object({
    type: z.literal('skill'),
    name: z.string(),
    path: z.string(),
  })
  .passthrough();

const userInputMentionSchema = z
  .object({
    type: z.literal('mention'),
    name: z.string(),
    path: z.string(),
  })
  .passthrough();

export const userInputSchema = z.discriminatedUnion('type', [
  userInputTextSchema,
  userInputImageSchema,
  userInputLocalImageSchema,
  userInputSkillSchema,
  userInputMentionSchema,
]);

const userMessageItemSchema = z
  .object({
    type: z.literal('userMessage'),
    id: z.string(),
    content: z.array(userInputSchema),
  })
  .passthrough();

const agentMessageItemSchema = z
  .object({
    type: z.literal('agentMessage'),
    id: z.string(),
    text: z.string(),
    phase: z.string().nullable(),
  })
  .passthrough();

const planItemSchema = z
  .object({
    type: z.literal('plan'),
    id: z.string(),
    text: z.string(),
  })
  .passthrough();

const reasoningItemSchema = z
  .object({
    type: z.literal('reasoning'),
    id: z.string(),
    summary: z.array(z.string()),
    content: z.array(z.string()),
  })
  .passthrough();

const commandExecutionItemSchema = z
  .object({
    type: z.literal('commandExecution'),
    id: z.string(),
    command: z.string(),
    cwd: z.string(),
    processId: z.string().nullable(),
    status: z.string(),
    commandActions: z.array(z.unknown()),
    aggregatedOutput: z.string().nullable(),
    exitCode: z.number().nullable(),
    durationMs: z.number().nullable(),
  })
  .passthrough();

const fileChangeItemSchema = z
  .object({
    type: z.literal('fileChange'),
    id: z.string(),
    changes: z.array(z.unknown()),
    status: z.string(),
  })
  .passthrough();

const mcpToolCallItemSchema = z
  .object({
    type: z.literal('mcpToolCall'),
    id: z.string(),
    server: z.string(),
    tool: z.string(),
    status: z.string(),
    arguments: z.unknown(),
    result: z.unknown().nullable(),
    error: z.unknown().nullable(),
    durationMs: z.number().nullable(),
  })
  .passthrough();

const collabAgentToolCallItemSchema = z
  .object({
    type: z.literal('collabAgentToolCall'),
    id: z.string(),
    tool: z.string(),
    status: z.string(),
    senderThreadId: z.string(),
    receiverThreadIds: z.array(z.string()),
    prompt: z.string().nullable(),
    agentsStates: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const webSearchItemSchema = z
  .object({
    type: z.literal('webSearch'),
    id: z.string(),
    query: z.string(),
    action: z.unknown().nullable(),
  })
  .passthrough();

const imageViewItemSchema = z
  .object({
    type: z.literal('imageView'),
    id: z.string(),
    path: z.string(),
  })
  .passthrough();

const enteredReviewModeItemSchema = z
  .object({
    type: z.literal('enteredReviewMode'),
    id: z.string(),
    review: z.string(),
  })
  .passthrough();

const exitedReviewModeItemSchema = z
  .object({
    type: z.literal('exitedReviewMode'),
    id: z.string(),
    review: z.string(),
  })
  .passthrough();

const contextCompactionItemSchema = z
  .object({
    type: z.literal('contextCompaction'),
    id: z.string(),
  })
  .passthrough();

export const threadItemSchema = z.discriminatedUnion('type', [
  userMessageItemSchema,
  agentMessageItemSchema,
  planItemSchema,
  reasoningItemSchema,
  commandExecutionItemSchema,
  fileChangeItemSchema,
  mcpToolCallItemSchema,
  collabAgentToolCallItemSchema,
  webSearchItemSchema,
  imageViewItemSchema,
  enteredReviewModeItemSchema,
  exitedReviewModeItemSchema,
  contextCompactionItemSchema,
]);

const codexHttpStatusCodeSchema = z
  .object({
    httpStatusCode: z.number().nullable(),
  })
  .passthrough();

const codexErrorInfoSchema = z.union([
  z.enum([
    'contextWindowExceeded',
    'usageLimitExceeded',
    'serverOverloaded',
    'internalServerError',
    'unauthorized',
    'badRequest',
    'threadRollbackFailed',
    'sandboxError',
    'other',
  ]),
  z.object({ httpConnectionFailed: codexHttpStatusCodeSchema }).passthrough(),
  z.object({ responseStreamConnectionFailed: codexHttpStatusCodeSchema }).passthrough(),
  z.object({ responseStreamDisconnected: codexHttpStatusCodeSchema }).passthrough(),
  z.object({ responseTooManyFailedAttempts: codexHttpStatusCodeSchema }).passthrough(),
]);

export const turnSchema = z
  .object({
    id: z.string(),
    items: z.array(threadItemSchema),
    status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
    error: z
      .object({
        message: z.string(),
        codexErrorInfo: codexErrorInfoSchema.nullable(),
        additionalDetails: z.string().nullable(),
      })
      .nullable(),
  })
  .passthrough();

export const threadStartedNotificationSchema = z
  .object({
    thread: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

export const turnStartedNotificationSchema = z
  .object({
    threadId: z.string(),
    turn: turnSchema,
  })
  .passthrough();

export const turnCompletedNotificationSchema = z
  .object({
    threadId: z.string(),
    turn: turnSchema,
  })
  .passthrough();

export const itemStartedNotificationSchema = z
  .object({
    item: threadItemSchema,
    threadId: z.string(),
    turnId: z.string(),
  })
  .passthrough();

export const itemCompletedNotificationSchema = z
  .object({
    item: threadItemSchema,
    threadId: z.string(),
    turnId: z.string(),
  })
  .passthrough();

export const agentMessageDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

export const reasoningTextDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

export const reasoningSummaryTextDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

export const commandExecutionOutputDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

export const fileChangeOutputDeltaNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

export const tokenUsageBreakdownSchema = z
  .object({
    totalTokens: z.number(),
    inputTokens: z.number(),
    cachedInputTokens: z.number(),
    outputTokens: z.number(),
    reasoningOutputTokens: z.number(),
  })
  .passthrough();

export const threadTokenUsageUpdatedNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    tokenUsage: z
      .object({
        total: tokenUsageBreakdownSchema,
        last: tokenUsageBreakdownSchema,
        modelContextWindow: z.number().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export const errorNotificationSchema = z
  .object({
    error: z
      .object({
        message: z.string(),
        codexErrorInfo: codexErrorInfoSchema.nullable(),
        additionalDetails: z.string().nullable(),
      })
      .passthrough(),
    willRetry: z.boolean(),
    threadId: z.string(),
    turnId: z.string(),
  })
  .passthrough();

const commandExecutionRequestApprovalParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    approvalId: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    networkApprovalContext: z.unknown().nullable().optional(),
    command: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    commandActions: z.array(z.unknown()).nullable().optional(),
    proposedExecpolicyAmendment: z.unknown().nullable().optional(),
  })
  .passthrough();

const fileChangeRequestApprovalParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    reason: z.string().nullable().optional(),
    grantRoot: z.string().nullable().optional(),
  })
  .passthrough();

const toolRequestUserInputParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    itemId: z.string(),
    questions: z.array(z.unknown()),
  })
  .passthrough();

const skillRequestApprovalParamsSchema = z
  .object({
    itemId: z.string(),
    skillName: z.string(),
  })
  .passthrough();

const dynamicToolCallParamsSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string(),
    callId: z.string(),
    tool: z.string(),
    arguments: z.unknown(),
  })
  .passthrough();

const chatgptAuthTokensRefreshParamsSchema = z
  .object({
    reason: z.string(),
    previousAccountId: z.string().nullable().optional(),
  })
  .passthrough();

export const serverRequestParamSchemas = {
  'item/commandExecution/requestApproval': commandExecutionRequestApprovalParamsSchema,
  'item/fileChange/requestApproval': fileChangeRequestApprovalParamsSchema,
  'item/tool/requestUserInput': toolRequestUserInputParamsSchema,
  'skill/requestApproval': skillRequestApprovalParamsSchema,
  'item/tool/call': dynamicToolCallParamsSchema,
  'account/chatgptAuthTokens/refresh': chatgptAuthTokensRefreshParamsSchema,
} as const;

export const serverRequestMethodSchema = z.enum(
  Object.keys(serverRequestParamSchemas) as [
    keyof typeof serverRequestParamSchemas,
    ...(keyof typeof serverRequestParamSchemas)[],
  ],
);

export const serverRequestSchema = z.discriminatedUnion('method', [
  z
    .object({
      id: jsonRpcIdSchema,
      method: z.literal('item/commandExecution/requestApproval'),
      params: commandExecutionRequestApprovalParamsSchema,
    })
    .passthrough(),
  z
    .object({
      id: jsonRpcIdSchema,
      method: z.literal('item/fileChange/requestApproval'),
      params: fileChangeRequestApprovalParamsSchema,
    })
    .passthrough(),
  z
    .object({
      id: jsonRpcIdSchema,
      method: z.literal('item/tool/requestUserInput'),
      params: toolRequestUserInputParamsSchema,
    })
    .passthrough(),
  z
    .object({
      id: jsonRpcIdSchema,
      method: z.literal('skill/requestApproval'),
      params: skillRequestApprovalParamsSchema,
    })
    .passthrough(),
  z
    .object({
      id: jsonRpcIdSchema,
      method: z.literal('item/tool/call'),
      params: dynamicToolCallParamsSchema,
    })
    .passthrough(),
  z
    .object({
      id: jsonRpcIdSchema,
      method: z.literal('account/chatgptAuthTokens/refresh'),
      params: chatgptAuthTokensRefreshParamsSchema,
    })
    .passthrough(),
]);

export const incomingNotificationSchemas: Record<string, z.ZodTypeAny> = {
  'thread/started': threadStartedNotificationSchema,
  'turn/started': turnStartedNotificationSchema,
  'turn/completed': turnCompletedNotificationSchema,
  'item/started': itemStartedNotificationSchema,
  'item/completed': itemCompletedNotificationSchema,
  'item/agentMessage/delta': agentMessageDeltaNotificationSchema,
  reasoningTextDelta: reasoningTextDeltaNotificationSchema,
  reasoningSummaryTextDelta: reasoningSummaryTextDeltaNotificationSchema,
  'item/reasoning/textDelta': reasoningTextDeltaNotificationSchema,
  'item/reasoning/summaryTextDelta': reasoningSummaryTextDeltaNotificationSchema,
  'item/commandExecution/outputDelta': commandExecutionOutputDeltaNotificationSchema,
  'item/fileChange/outputDelta': fileChangeOutputDeltaNotificationSchema,
  'thread/tokenUsage/updated': threadTokenUsageUpdatedNotificationSchema,
  error: errorNotificationSchema,
};
