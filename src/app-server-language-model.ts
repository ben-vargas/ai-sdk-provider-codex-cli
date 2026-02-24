import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
  JSONObject,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId, parseProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { createVerboseLogger, getLogger } from './logger.js';
import type { ImageData } from './message-mapper.js';
import { mapMessagesToPrompt } from './message-mapper.js';
import { cleanupTempImages, extractImageData, writeImageToTempFile } from './image-utils.js';
import {
  createEmptyCodexUsage,
  mapUnsupportedSettingsWarnings,
  sanitizeJsonSchema,
  safeStringify,
} from './shared-utils.js';
import type { CodexAppServerProviderOptions, CodexAppServerSettings } from './types-app-server.js';
import type { Logger } from './types-shared.js';
import type {
  ThreadItem,
  ThreadTokenUsageUpdatedNotification,
  Turn,
  TurnStartParams,
  UserInput,
} from './app-server-protocol-types.js';
import { AppServerRpcClient } from './app-server-rpc-client.js';

const appServerProviderOptionsSchema = z
  .object({
    threadId: z.string().optional(),
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    reasoningSummary: z.enum(['auto', 'detailed']).optional(),
    reasoningSummaryFormat: z.enum(['none', 'experimental']).optional(),
    textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
    mcpServers: z.record(z.string(), z.object({}).passthrough()).optional(),
    rmcpClient: z.boolean().optional(),
    configOverrides: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.object({}).passthrough(),
          z.array(z.any()),
        ]),
      )
      .optional(),
    personality: z.enum(['none', 'friendly', 'pragmatic']).optional(),
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    summary: z.enum(['auto', 'concise', 'detailed', 'none']).optional(),
    approvalPolicy: z.any().optional(),
    sandboxPolicy: z.any().optional(),
    autoApprove: z.boolean().optional(),
    persistExtendedHistory: z.boolean().optional(),
  })
  .strict();

function mapTurnStatusToFinishReason(turn: Turn): LanguageModelV3FinishReason {
  switch (turn.status) {
    case 'completed':
      return { unified: 'stop', raw: 'completed' };
    case 'interrupted':
      return { unified: 'stop', raw: 'interrupted' };
    case 'failed': {
      const errorInfo = turn.error?.codexErrorInfo;
      if (errorInfo === 'contextWindowExceeded') {
        return { unified: 'length', raw: 'context_window_exceeded' };
      }
      if (errorInfo === 'usageLimitExceeded') {
        return { unified: 'length', raw: 'usage_limit_exceeded' };
      }
      return { unified: 'error', raw: turn.error?.message ?? 'failed' };
    }
    default:
      return { unified: 'other', raw: turn.status };
  }
}

function mapTokenUsageToAiSdkUsage(
  event: ThreadTokenUsageUpdatedNotification,
): LanguageModelV3Usage {
  const last = event.tokenUsage.last;

  return {
    inputTokens: {
      total: last.inputTokens,
      noCache: Math.max(0, last.inputTokens - last.cachedInputTokens),
      cacheRead: last.cachedInputTokens,
      cacheWrite: 0,
    },
    outputTokens: {
      total: last.outputTokens,
      text: undefined,
      reasoning: last.reasoningOutputTokens,
    },
    raw: last as unknown as JSONObject,
  };
}

function mapSandboxModeToThreadSandbox(
  mode?: CodexAppServerSettings['sandboxMode'],
): string | undefined {
  if (!mode) return undefined;
  if (mode === 'read-only') return 'readOnly';
  if (mode === 'workspace-write') return 'workspaceWrite';
  return 'dangerFullAccess';
}

function mapApprovalPolicy(
  settings: CodexAppServerSettings,
  overrides?: CodexAppServerProviderOptions,
): unknown {
  return overrides?.approvalPolicy ?? settings.approvalPolicy ?? settings.approvalMode;
}

function extractTextAndImagesFromLastUserMessage(prompt: unknown[]): {
  text: string;
  images: ImageData[];
  warning?: string;
} {
  const messages = Array.isArray(prompt) ? prompt : [];
  const userMessages = messages.filter((m) => {
    if (!m || typeof m !== 'object') return false;
    return (m as { role?: unknown }).role === 'user';
  }) as Array<{ content?: unknown }>;

  const warning =
    messages.length > 1
      ? 'Stateful mode ignores earlier prompt messages and only sends the last user message.'
      : undefined;

  const lastUser = userMessages[userMessages.length - 1];
  if (!lastUser) return { text: '', images: [], warning };

  if (typeof lastUser.content === 'string') {
    return { text: lastUser.content, images: [], warning };
  }

  const textParts: string[] = [];
  const images: ImageData[] = [];
  if (Array.isArray(lastUser.content)) {
    for (const part of lastUser.content) {
      if (part && typeof part === 'object') {
        const data = part as { type?: unknown; text?: unknown };
        if (data.type === 'text' && typeof data.text === 'string') {
          textParts.push(data.text);
        }
        if (data.type === 'image') {
          const image = extractImageData(part);
          if (image) images.push(image);
        }
      }
    }
  }

  return {
    text: textParts.join('\n').trim(),
    images,
    warning,
  };
}

function mapToolName(item: ThreadItem): string | undefined {
  switch (item.type) {
    case 'commandExecution':
      return 'exec';
    case 'fileChange':
      return 'patch';
    case 'mcpToolCall':
      return typeof item.tool === 'string' && item.tool.length > 0 ? item.tool : 'mcp_tool';
    case 'webSearch':
      return 'web_search';
    default:
      return undefined;
  }
}

const INTERRUPT_COMPLETION_TIMEOUT_MS = 5_000;

function waitForPromiseOrTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

function isThreadNotFoundError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return /thread.*not found/i.test(message);
}

function createStaleThreadError(threadId: string): Error {
  return new Error(
    `Thread '${threadId}' not found after server restart. Create a new thread by omitting threadId.`,
  );
}

function getErrorNotificationMessage(params: Record<string, unknown>): string | undefined {
  if (typeof params.message === 'string') return params.message;
  const nested = params.error;
  if (
    nested &&
    typeof nested === 'object' &&
    typeof (nested as { message?: unknown }).message === 'string'
  ) {
    return (nested as { message: string }).message;
  }
  return undefined;
}

export interface AppServerLanguageModelOptions {
  id: string;
  settings?: CodexAppServerSettings;
  client: AppServerRpcClient;
}

export class AppServerLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'codex-app-server';
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = true;

  readonly modelId: string;
  readonly settings: CodexAppServerSettings;

  private readonly client: AppServerRpcClient;
  private readonly logger: Logger;

  constructor(options: AppServerLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.client = options.client;
    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);

    if (!this.modelId || this.modelId.trim() === '') {
      throw new NoSuchModelError({ modelId: this.modelId, modelType: 'languageModel' });
    }
  }

  private mergeSettings(providerOptions?: CodexAppServerProviderOptions): CodexAppServerSettings {
    if (!providerOptions) return this.settings;
    return {
      ...this.settings,
      reasoningEffort: providerOptions.reasoningEffort ?? this.settings.reasoningEffort,
      reasoningSummary: providerOptions.reasoningSummary ?? this.settings.reasoningSummary,
      reasoningSummaryFormat:
        providerOptions.reasoningSummaryFormat ?? this.settings.reasoningSummaryFormat,
      modelVerbosity: providerOptions.textVerbosity ?? this.settings.modelVerbosity,
      configOverrides: {
        ...(this.settings.configOverrides ?? {}),
        ...(providerOptions.configOverrides ?? {}),
      },
      personality: providerOptions.personality ?? this.settings.personality,
      effort: providerOptions.effort ?? this.settings.effort,
      summary: providerOptions.summary ?? this.settings.summary,
      approvalPolicy: providerOptions.approvalPolicy ?? this.settings.approvalPolicy,
      sandboxPolicy: providerOptions.sandboxPolicy ?? this.settings.sandboxPolicy,
      autoApprove: providerOptions.autoApprove ?? this.settings.autoApprove,
      persistExtendedHistory:
        providerOptions.persistExtendedHistory ?? this.settings.persistExtendedHistory,
    };
  }

  private async buildUserInput(
    text: string,
    images: ImageData[],
  ): Promise<{ input: UserInput[]; tempImagePaths: string[] }> {
    const input: UserInput[] = [];
    const tempImagePaths: string[] = [];

    if (text.trim().length > 0) {
      input.push({ type: 'text', text, text_elements: [] });
    }

    for (const image of images) {
      try {
        const tempPath = writeImageToTempFile(image);
        tempImagePaths.push(tempPath);
        input.push({ type: 'localImage', path: tempPath });
      } catch (error) {
        this.logger.warn(`[codex-app-server] Failed to write image to temp file: ${String(error)}`);
      }
    }

    return { input, tempImagePaths };
  }

  async doGenerate(
    options: Parameters<LanguageModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const providerOptions = await parseProviderOptions<CodexAppServerProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: appServerProviderOptionsSchema as never,
    });

    const settings = this.mergeSettings(providerOptions);

    const warnings = [
      ...mapUnsupportedSettingsWarnings({
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        presencePenalty: options.presencePenalty,
        frequencyPenalty: options.frequencyPenalty,
        stopSequences: options.stopSequences,
        seed: (options as { seed?: unknown }).seed,
      }),
    ] as SharedV3Warning[];

    let mappedText = '';
    let mappedImages: ImageData[] = [];

    if (providerOptions?.threadId) {
      const stateful = extractTextAndImagesFromLastUserMessage(options.prompt as unknown[]);
      mappedText = stateful.text;
      mappedImages = stateful.images;
      if (stateful.warning) {
        warnings.push({ type: 'other', message: stateful.warning });
      }
    } else {
      const mapped = mapMessagesToPrompt(options.prompt);
      mappedText = mapped.promptText;
      mappedImages = mapped.images;
      for (const warning of mapped.warnings ?? []) {
        warnings.push({ type: 'other', message: warning });
      }
    }

    let threadId = providerOptions?.threadId;

    if (!threadId) {
      const thread = await this.client.threadStart({
        model: this.modelId,
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings, providerOptions),
        sandbox: mapSandboxModeToThreadSandbox(settings.sandboxMode),
        config: settings.configOverrides,
        personality: settings.personality,
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: settings.persistExtendedHistory ?? false,
      });
      threadId = thread.thread.id;
    } else {
      try {
        await this.client.threadResume({
          threadId,
          model: this.modelId,
          cwd: settings.cwd,
          approvalPolicy: mapApprovalPolicy(settings, providerOptions),
          personality: settings.personality,
          persistExtendedHistory: settings.persistExtendedHistory ?? false,
        });
      } catch (error) {
        if (isThreadNotFoundError(error)) {
          throw createStaleThreadError(threadId);
        }
        throw error;
      }
    }

    const { input, tempImagePaths } = await this.buildUserInput(mappedText, mappedImages);

    let usage: LanguageModelV3Usage = createEmptyCodexUsage();
    let text = '';
    let turnId: string | undefined;
    let aborted = false;
    let resolveAbort: (() => void) | undefined;
    const abortSignal = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    let completionListener: ((method: string, params: Record<string, unknown>) => void) | undefined;

    const removeCompletionListener = () => {
      if (completionListener) {
        this.client.off('notification', completionListener);
        completionListener = undefined;
      }
    };

    const completion = new Promise<Turn>((resolve, reject) => {
      completionListener = (method: string, params: Record<string, unknown>) => {
        const notificationThreadId =
          typeof params.threadId === 'string' ? params.threadId : undefined;
        if (notificationThreadId && notificationThreadId !== threadId) return;

        if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
          const notificationTurnId = typeof params.turnId === 'string' ? params.turnId : undefined;
          if (!turnId || !notificationTurnId || notificationTurnId === turnId) {
            text += params.delta;
          }
          return;
        }

        if (method === 'item/completed' && params.item && typeof params.item === 'object') {
          const item = params.item as ThreadItem;
          if (item.type === 'agentMessage' && typeof item.text === 'string') {
            text = item.text;
          }
          return;
        }

        if (method === 'thread/tokenUsage/updated') {
          const parsed = params as unknown as ThreadTokenUsageUpdatedNotification;
          usage = mapTokenUsageToAiSdkUsage(parsed);
          return;
        }

        if (method === 'turn/completed' && params.turn && typeof params.turn === 'object') {
          const turn = params.turn as Turn;
          if (!turnId || turn.id === turnId) {
            removeCompletionListener();
            resolve(turn);
          }
          return;
        }

        if (method === 'error') {
          const message = getErrorNotificationMessage(params);
          if (message) {
            removeCompletionListener();
            reject(new Error(message));
          }
        }
      };

      this.client.on('notification', completionListener);
    });

    let interruptWaitPromise: Promise<void> | undefined;
    const interruptAndAwaitCompletion = async (): Promise<void> => {
      if (!turnId) return;
      if (!interruptWaitPromise) {
        interruptWaitPromise = (async () => {
          await this.client.turnInterrupt({ threadId: threadId!, turnId }).catch(() => undefined);
          await waitForPromiseOrTimeout(
            completion.then(() => undefined),
            INTERRUPT_COMPLETION_TIMEOUT_MS,
          );
        })();
      }
      await interruptWaitPromise;
    };

    const abortError = () => options.abortSignal?.reason ?? new Error('Request aborted');

    const onAbort = () => {
      aborted = true;
      resolveAbort?.();
      if (turnId) {
        void interruptAndAwaitCompletion();
      }
    };

    if (options.abortSignal) {
      if (options.abortSignal.aborted) onAbort();
      options.abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const turnParams: TurnStartParams = {
        threadId,
        input,
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings, providerOptions),
        sandboxPolicy: settings.sandboxPolicy,
        model: this.modelId,
        effort: settings.effort,
        summary: settings.summary,
        personality: settings.personality,
        ...(options.responseFormat?.type === 'json' && options.responseFormat.schema
          ? { outputSchema: sanitizeJsonSchema(options.responseFormat.schema) }
          : {}),
      };

      const startTurn = async () => await this.client.turnStart(turnParams);
      let turnResponse: Awaited<ReturnType<typeof startTurn>>;
      try {
        turnResponse = providerOptions?.threadId
          ? await this.client.withThreadLock(threadId, startTurn)
          : await startTurn();
      } catch (error) {
        if (providerOptions?.threadId && isThreadNotFoundError(error)) {
          throw createStaleThreadError(threadId);
        }
        if (aborted) {
          throw abortError();
        }
        throw error;
      }

      turnId = turnResponse.turn.id;
      if (aborted) {
        await interruptAndAwaitCompletion();
      }

      const raceResult = await Promise.race([
        completion.then((turn) => ({ type: 'completed' as const, turn })),
        abortSignal.then(async () => {
          await interruptAndAwaitCompletion();
          return { type: 'aborted' as const };
        }),
      ]);

      if (aborted) {
        throw abortError();
      }
      if (raceResult.type === 'aborted') {
        throw abortError();
      }

      const completedTurn = raceResult.turn;
      const content: LanguageModelV3Content[] = [{ type: 'text', text }];
      return {
        content,
        usage,
        finishReason: mapTurnStatusToFinishReason(completedTurn),
        warnings,
        response: { id: generateId(), timestamp: new Date(), modelId: this.modelId },
        request: { body: mappedText },
        providerMetadata: { 'codex-app-server': { threadId } },
      };
    } finally {
      removeCompletionListener();
      if (options.abortSignal) {
        options.abortSignal.removeEventListener('abort', onAbort);
      }
      if (tempImagePaths.length > 0) {
        cleanupTempImages(tempImagePaths);
      }
    }
  }

  async doStream(
    options: Parameters<LanguageModelV3['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
    const providerOptions = await parseProviderOptions<CodexAppServerProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: appServerProviderOptionsSchema as never,
    });

    const settings = this.mergeSettings(providerOptions);

    const warnings = [
      ...mapUnsupportedSettingsWarnings({
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        presencePenalty: options.presencePenalty,
        frequencyPenalty: options.frequencyPenalty,
        stopSequences: options.stopSequences,
        seed: (options as { seed?: unknown }).seed,
      }),
    ] as SharedV3Warning[];

    let mappedText = '';
    let mappedImages: ImageData[] = [];

    if (providerOptions?.threadId) {
      const stateful = extractTextAndImagesFromLastUserMessage(options.prompt as unknown[]);
      mappedText = stateful.text;
      mappedImages = stateful.images;
      if (stateful.warning) {
        warnings.push({ type: 'other', message: stateful.warning });
      }
    } else {
      const mapped = mapMessagesToPrompt(options.prompt);
      mappedText = mapped.promptText;
      mappedImages = mapped.images;
      for (const warning of mapped.warnings ?? []) {
        warnings.push({ type: 'other', message: warning });
      }
    }

    let threadId = providerOptions?.threadId;
    if (!threadId) {
      const thread = await this.client.threadStart({
        model: this.modelId,
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings, providerOptions),
        sandbox: mapSandboxModeToThreadSandbox(settings.sandboxMode),
        config: settings.configOverrides,
        personality: settings.personality,
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: settings.persistExtendedHistory ?? false,
      });
      threadId = thread.thread.id;
    } else {
      try {
        await this.client.threadResume({
          threadId,
          model: this.modelId,
          cwd: settings.cwd,
          approvalPolicy: mapApprovalPolicy(settings, providerOptions),
          personality: settings.personality,
          persistExtendedHistory: settings.persistExtendedHistory ?? false,
        });
      } catch (error) {
        if (isThreadNotFoundError(error)) {
          throw createStaleThreadError(threadId);
        }
        throw error;
      }
    }

    const { input, tempImagePaths } = await this.buildUserInput(mappedText, mappedImages);

    let usage: LanguageModelV3Usage = createEmptyCodexUsage();

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        controller.enqueue({ type: 'stream-start', warnings });

        let turnId: string | undefined;
        let aborted = false;
        let settled = false;
        let cleanedUp = false;
        let markTurnCompleted: (() => void) | undefined;
        const turnCompletedSignal = new Promise<void>((resolve) => {
          markTurnCompleted = resolve;
        });
        const activeToolIds = new Set<string>();

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          this.client.off('notification', onNotification);
          cleanupTempImages(tempImagePaths);
          if (options.abortSignal) {
            options.abortSignal.removeEventListener('abort', onAbort);
          }
        };

        const emitToolCall = (item: ThreadItem) => {
          const toolCallId = typeof item.id === 'string' ? item.id : generateId();
          const toolName = mapToolName(item);
          if (!toolName || activeToolIds.has(toolCallId)) return;

          activeToolIds.add(toolCallId);
          const inputText = safeStringify(item);

          controller.enqueue({ type: 'tool-input-start', id: toolCallId, toolName });
          if (inputText)
            controller.enqueue({ type: 'tool-input-delta', id: toolCallId, delta: inputText });
          controller.enqueue({ type: 'tool-input-end', id: toolCallId });
          controller.enqueue({
            type: 'tool-call',
            toolCallId,
            toolName,
            input: inputText,
            providerExecuted: true,
          });
        };

        const emitToolResult = (item: ThreadItem) => {
          const toolCallId = typeof item.id === 'string' ? item.id : generateId();
          const toolName = mapToolName(item);
          if (!toolName) return;

          controller.enqueue({
            type: 'tool-result',
            toolCallId,
            toolName,
            result: item as unknown as NonNullable<import('@ai-sdk/provider').JSONValue>,
          });
        };

        const onNotification = (method: string, params: Record<string, unknown>) => {
          const notificationThreadId =
            typeof params.threadId === 'string' ? params.threadId : undefined;
          if (notificationThreadId && notificationThreadId !== threadId) return;

          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
            const notificationTurnId =
              typeof params.turnId === 'string' ? params.turnId : undefined;
            const notificationItemId =
              typeof params.itemId === 'string' ? params.itemId : generateId();
            if (!turnId || !notificationTurnId || notificationTurnId === turnId) {
              controller.enqueue({
                type: 'text-delta',
                id: notificationItemId,
                delta: params.delta,
              });
            }
            return;
          }

          if (
            (method === 'item/started' || method === 'item/completed') &&
            params.item &&
            typeof params.item === 'object'
          ) {
            const item = params.item as ThreadItem;
            if (method === 'item/started') emitToolCall(item);
            if (method === 'item/completed') emitToolResult(item);
            return;
          }

          if (method === 'thread/tokenUsage/updated') {
            usage = mapTokenUsageToAiSdkUsage(
              params as unknown as ThreadTokenUsageUpdatedNotification,
            );
            return;
          }

          if (method === 'turn/completed' && params.turn && typeof params.turn === 'object') {
            const turn = params.turn as Turn;
            if (!turnId || turn.id === turnId) {
              markTurnCompleted?.();
              if (aborted) {
                return;
              }
              if (settled) return;
              settled = true;
              controller.enqueue({
                type: 'finish',
                finishReason: mapTurnStatusToFinishReason(turn),
                usage,
                providerMetadata: { 'codex-app-server': { threadId } },
              });
              controller.close();
              cleanup();
            }
            return;
          }

          if (method === 'error') {
            const message = getErrorNotificationMessage(params);
            if (!message) return;
            if (settled) return;
            settled = true;
            controller.error(new Error(message));
            cleanup();
          }
        };

        let interruptWaitPromise: Promise<void> | undefined;
        const interruptAndAwaitCompletion = async (): Promise<void> => {
          if (!turnId) return;
          if (!interruptWaitPromise) {
            interruptWaitPromise = (async () => {
              await this.client
                .turnInterrupt({ threadId: threadId!, turnId })
                .catch(() => undefined);
              await waitForPromiseOrTimeout(turnCompletedSignal, INTERRUPT_COMPLETION_TIMEOUT_MS);
            })();
          }
          await interruptWaitPromise;
        };

        const abortError = () => options.abortSignal?.reason ?? new Error('Request aborted');

        const finishAbortedTurn = async () => {
          if (settled) return;
          settled = true;
          await interruptAndAwaitCompletion();
          controller.error(abortError());
          cleanup();
        };

        const onAbort = () => {
          aborted = true;
          if (turnId) {
            void finishAbortedTurn();
          }
        };

        this.client.on('notification', onNotification);
        if (options.abortSignal) {
          if (options.abortSignal.aborted) {
            onAbort();
            return;
          }
          options.abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        controller.enqueue({
          type: 'response-metadata',
          id: generateId(),
          timestamp: new Date(),
          modelId: this.modelId,
        });

        try {
          const turnParams: TurnStartParams = {
            threadId,
            input,
            cwd: settings.cwd,
            approvalPolicy: mapApprovalPolicy(settings, providerOptions),
            sandboxPolicy: settings.sandboxPolicy,
            model: this.modelId,
            effort: settings.effort,
            summary: settings.summary,
            personality: settings.personality,
            ...(options.responseFormat?.type === 'json' && options.responseFormat.schema
              ? { outputSchema: sanitizeJsonSchema(options.responseFormat.schema) }
              : {}),
          };

          const startTurn = async () => await this.client.turnStart(turnParams);
          let turnResponse: Awaited<ReturnType<typeof startTurn>>;
          try {
            turnResponse = providerOptions?.threadId
              ? await this.client.withThreadLock(threadId!, startTurn)
              : await startTurn();
          } catch (error) {
            if (aborted) {
              await finishAbortedTurn();
              return;
            }
            if (providerOptions?.threadId && isThreadNotFoundError(error)) {
              settled = true;
              controller.error(createStaleThreadError(threadId!));
              cleanup();
              return;
            }
            throw error;
          }

          turnId = turnResponse.turn.id;
          if (aborted) {
            await finishAbortedTurn();
          }
        } catch (error) {
          if (settled) return;
          settled = true;
          controller.error(error);
          cleanup();
        }
      },
    });

    return {
      stream,
      request: { body: mappedText },
    };
  }
}
