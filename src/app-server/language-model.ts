import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3File,
  LanguageModelV3FinishReason,
  LanguageModelV3Reasoning,
  LanguageModelV3Source,
  LanguageModelV3StreamPart,
  LanguageModelV3Text,
  LanguageModelV3ToolApprovalRequest,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolResult,
  LanguageModelV3Usage,
  LanguageModelV3ResponseMetadata,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId, parseProviderOptions } from '@ai-sdk/provider-utils';
import { createVerboseLogger, getLogger } from '../logger.js';
import { convertPromptToCodexInput, type PromptMessage } from '../converters/index.js';
import { cleanupTempImages, type ImageData, writeImageToTempFile } from '../image-utils.js';
import {
  createEmptyCodexUsage,
  mapUnsupportedSettingsWarnings,
  mcpServersToConfigOverrides,
  mergeSingleMcpServer,
  sanitizeJsonSchema,
} from '../shared-utils.js';
import type {
  AppServerMcpServerConfig,
  AppServerThreadMode,
  CodexAppServerProviderOptions,
  CodexAppServerRequestHandlers,
  CodexAppServerSettings,
} from './types.js';
import type { CodexModelId, Logger, McpServerConfig } from '../types-shared.js';
import type { Turn, TurnStartParams, UserInput } from './protocol/types.js';
import { AppServerRpcClient } from './rpc/client.js';
import { AppServerSession } from './session.js';
import { AppServerNotificationRouter } from './stream/router.js';
import { AppServerStreamEmitter } from './stream/emitter.js';
import { isSdkMcpServer, type SdkMcpServer } from '../tools/sdk-mcp-server.js';
import { appServerProviderOptionsSchema } from '../validation.js';

const INTERRUPT_COMPLETION_TIMEOUT_MS = 5_000;

type PromptImage =
  | {
      type: 'local';
      data: ImageData;
    }
  | {
      type: 'remote';
      url: string;
    };

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

function mapSandboxToThreadSandboxMode(settings: CodexAppServerSettings): unknown {
  const policy = settings.sandboxPolicy;
  if (!policy) return undefined;
  if (typeof policy === 'string') return policy;

  if (policy.type === 'readOnly') return 'read-only';
  if (policy.type === 'workspaceWrite') return 'workspace-write';
  if (policy.type === 'dangerFullAccess') return 'danger-full-access';

  // Thread start/resume accepts SandboxMode, not full SandboxPolicy.
  // For non-mode variants (for example externalSandbox), skip thread-level override.
  return undefined;
}

function mapSandboxToTurnSandboxPolicy(settings: CodexAppServerSettings): unknown {
  const policy = settings.sandboxPolicy;
  if (!policy) return undefined;
  if (typeof policy !== 'string') return policy;

  if (policy === 'read-only') return { type: 'readOnly' };
  if (policy === 'workspace-write') return { type: 'workspaceWrite' };
  if (policy === 'danger-full-access') return { type: 'dangerFullAccess' };

  return undefined;
}

function mapApprovalPolicy(settings: CodexAppServerSettings): unknown {
  return settings.approvalPolicy;
}

function mergeServerRequests(
  base?: CodexAppServerRequestHandlers,
  override?: Partial<CodexAppServerRequestHandlers>,
): CodexAppServerRequestHandlers | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

function mergeAppServerMcpServers(
  base?: Record<string, AppServerMcpServerConfig>,
  override?: Record<string, AppServerMcpServerConfig>,
): Record<string, AppServerMcpServerConfig> | undefined {
  if (!base) return override ? { ...override } : undefined;
  if (!override) return { ...base };

  const merged: Record<string, AppServerMcpServerConfig> = { ...base };
  for (const [name, incoming] of Object.entries(override)) {
    const existing = merged[name];

    if (!existing || isSdkMcpServer(existing) || isSdkMcpServer(incoming)) {
      merged[name] = incoming;
      continue;
    }

    if (existing.transport === incoming.transport) {
      merged[name] = mergeSingleMcpServer(existing, incoming);
    } else {
      merged[name] = incoming;
    }
  }

  return merged;
}

interface ResolvedConfig {
  configOverrides: Record<string, unknown> | undefined;
}

export interface AppServerLanguageModelOptions {
  id: CodexModelId;
  settings?: CodexAppServerSettings;
  client: AppServerRpcClient;
  onSdkMcpServerUsed?: (server: SdkMcpServer) => void;
}

export class AppServerLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'codex-app-server';
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = true;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = true;

  readonly modelId: string;
  readonly settings: CodexAppServerSettings;

  private readonly client: AppServerRpcClient;
  private readonly logger: Logger;
  private readonly onSdkMcpServerUsed?: (server: SdkMcpServer) => void;

  private persistentThreadId?: string;
  private persistentSession?: AppServerSession;

  constructor(options: AppServerLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.client = options.client;
    this.onSdkMcpServerUsed = options.onSdkMcpServerUsed;
    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);

    if (!this.modelId || this.modelId.trim() === '') {
      throw new NoSuchModelError({ modelId: this.modelId, modelType: 'languageModel' });
    }
  }

  private mergeSettings(providerOptions?: CodexAppServerProviderOptions): CodexAppServerSettings {
    if (!providerOptions) return this.settings;

    const merged: CodexAppServerSettings = {
      ...this.settings,
      personality: providerOptions.personality ?? this.settings.personality,
      effort: providerOptions.effort ?? this.settings.effort,
      summary: providerOptions.summary ?? this.settings.summary,
      approvalPolicy: providerOptions.approvalPolicy ?? this.settings.approvalPolicy,
      sandboxPolicy: providerOptions.sandboxPolicy ?? this.settings.sandboxPolicy,
      baseInstructions: providerOptions.baseInstructions ?? this.settings.baseInstructions,
      developerInstructions:
        providerOptions.developerInstructions ?? this.settings.developerInstructions,
      autoApprove: providerOptions.autoApprove ?? this.settings.autoApprove,
      persistExtendedHistory:
        providerOptions.persistExtendedHistory ?? this.settings.persistExtendedHistory,
      threadMode: providerOptions.threadMode ?? this.settings.threadMode,
      resume: providerOptions.resume ?? this.settings.resume,
      includeRawChunks: providerOptions.includeRawChunks ?? this.settings.includeRawChunks,
      rmcpClient: providerOptions.rmcpClient ?? this.settings.rmcpClient,
      configOverrides: {
        ...(this.settings.configOverrides ?? {}),
        ...(providerOptions.configOverrides ?? {}),
      },
      serverRequests: mergeServerRequests(
        this.settings.serverRequests,
        providerOptions.serverRequests,
      ),
      onSessionCreated: providerOptions.onSessionCreated ?? this.settings.onSessionCreated,
    };

    merged.mcpServers = mergeAppServerMcpServers(
      this.settings.mcpServers,
      providerOptions.mcpServers,
    );

    return merged;
  }

  private resolveThreadMode(
    settings: CodexAppServerSettings,
    providerOptions?: CodexAppServerProviderOptions,
  ): AppServerThreadMode {
    return providerOptions?.threadMode ?? settings.threadMode ?? 'stateless';
  }

  private resolveTargetThreadId(
    settings: CodexAppServerSettings,
    providerOptions?: CodexAppServerProviderOptions,
  ): { threadId?: string; explicit: boolean; persistent: boolean } {
    const mode = this.resolveThreadMode(settings, providerOptions);
    const explicit = providerOptions?.threadId ?? providerOptions?.resume ?? settings.resume;
    if (explicit) {
      return {
        threadId: explicit,
        explicit: true,
        persistent: mode === 'persistent',
      };
    }

    if (mode === 'persistent' && this.persistentThreadId) {
      return {
        threadId: this.persistentThreadId,
        explicit: false,
        persistent: true,
      };
    }

    return {
      threadId: undefined,
      explicit: false,
      persistent: mode === 'persistent',
    };
  }

  private async resolveConfig(settings: CodexAppServerSettings): Promise<ResolvedConfig> {
    const resolvedMcpServers: Record<string, McpServerConfig> = {};

    for (const [name, server] of Object.entries(settings.mcpServers ?? {})) {
      if (isSdkMcpServer(server)) {
        const started = await server._start();
        this.onSdkMcpServerUsed?.(server);
        resolvedMcpServers[name] = started;
        continue;
      }

      resolvedMcpServers[name] = server;
    }

    const mcpOverrides = mcpServersToConfigOverrides(
      Object.keys(resolvedMcpServers).length > 0 ? resolvedMcpServers : undefined,
      settings.rmcpClient,
    );

    const configOverrides = {
      ...mcpOverrides,
      ...(settings.configOverrides ?? {}),
    };

    return {
      configOverrides: Object.keys(configOverrides).length > 0 ? configOverrides : undefined,
    };
  }

  private async buildUserInput(
    text: string,
    images: PromptImage[],
  ): Promise<{ input: UserInput[]; tempImagePaths: string[] }> {
    const input: UserInput[] = [];
    const tempImagePaths: string[] = [];

    if (text.trim().length > 0) {
      input.push({ type: 'text', text, text_elements: [] });
    }

    for (const image of images) {
      if (image.type === 'remote') {
        input.push({ type: 'image', url: image.url, imageUrl: image.url });
        continue;
      }

      try {
        const tempPath = writeImageToTempFile(image.data);
        tempImagePaths.push(tempPath);
        input.push({ type: 'localImage', path: tempPath });
      } catch (error) {
        this.logger.warn(`[codex-app-server] Failed to write image to temp file: ${String(error)}`);
      }
    }

    return { input, tempImagePaths };
  }

  private async startOrResumeThread(args: {
    settings: CodexAppServerSettings;
    providerOptions?: CodexAppServerProviderOptions;
    configOverrides?: Record<string, unknown>;
    developerInstructions?: string;
  }): Promise<{
    threadId: string;
    persistent: boolean;
    explicit: boolean;
    recreatedFromStale: boolean;
  }> {
    const { settings, providerOptions, configOverrides, developerInstructions } = args;
    const threadState = this.resolveTargetThreadId(settings, providerOptions);

    const startThread = async (ephemeral: boolean) => {
      const thread = await this.client.threadStart({
        model: this.modelId,
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings),
        sandbox: mapSandboxToThreadSandboxMode(settings),
        config: configOverrides,
        baseInstructions: settings.baseInstructions,
        developerInstructions,
        personality: settings.personality,
        ephemeral,
        experimentalRawEvents: Boolean(
          providerOptions?.includeRawChunks ?? settings.includeRawChunks,
        ),
        persistExtendedHistory: settings.persistExtendedHistory ?? false,
      });
      return thread.thread.id;
    };

    if (!threadState.threadId) {
      const newThreadId = await startThread(!threadState.persistent);
      if (threadState.persistent) {
        this.persistentThreadId = newThreadId;
      }
      return {
        threadId: newThreadId,
        persistent: threadState.persistent,
        explicit: false,
        recreatedFromStale: false,
      };
    }

    try {
      await this.client.threadResume({
        threadId: threadState.threadId,
        model: this.modelId,
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings),
        sandbox: mapSandboxToThreadSandboxMode(settings),
        config: configOverrides,
        baseInstructions: settings.baseInstructions,
        developerInstructions,
        personality: settings.personality,
        persistExtendedHistory: settings.persistExtendedHistory ?? false,
      });

      if (threadState.persistent) {
        this.persistentThreadId = threadState.threadId;
      }

      return {
        threadId: threadState.threadId,
        persistent: threadState.persistent,
        explicit: threadState.explicit,
        recreatedFromStale: false,
      };
    } catch (error) {
      if (!isThreadNotFoundError(error)) {
        throw error;
      }

      if (!threadState.persistent || threadState.explicit) {
        throw createStaleThreadError(threadState.threadId);
      }

      const recreatedThreadId = await startThread(false);
      this.persistentThreadId = recreatedThreadId;
      return {
        threadId: recreatedThreadId,
        persistent: true,
        explicit: false,
        recreatedFromStale: true,
      };
    }
  }

  private async createOrReuseSession(args: {
    threadId: string;
    settings: CodexAppServerSettings;
    providerOptions?: CodexAppServerProviderOptions;
  }): Promise<AppServerSession | undefined> {
    const { threadId, settings, providerOptions } = args;
    const onSessionCreated = providerOptions?.onSessionCreated ?? settings.onSessionCreated;

    if (!onSessionCreated) {
      return undefined;
    }

    const persistent = this.resolveThreadMode(settings, providerOptions) === 'persistent';
    if (persistent && this.persistentSession && this.persistentSession.threadId === threadId) {
      return this.persistentSession;
    }

    const session = new AppServerSession({
      threadId,
      modelId: this.modelId,
      client: this.client,
      defaultTurnParams: {
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings),
        sandboxPolicy: mapSandboxToTurnSandboxPolicy(settings),
        effort: settings.effort,
        summary: settings.summary,
        personality: settings.personality,
      },
    });

    if (persistent) {
      this.persistentSession = session;
    }

    await onSessionCreated(session);
    return session;
  }

  private preparePrompt(
    prompt: readonly unknown[],
    hasExistingThreadContext: boolean,
  ): {
    promptText: string;
    images: PromptImage[];
    warnings: SharedV3Warning[];
    systemInstruction?: string;
  } {
    const converted = convertPromptToCodexInput({
      prompt: prompt as readonly PromptMessage[],
      mode: hasExistingThreadContext ? 'persistent' : 'stateless',
    });

    return {
      promptText: converted.text,
      images: [
        ...converted.localImages.map((image) => ({ type: 'local', data: image }) as PromptImage),
        ...converted.remoteImageUrls.map((url) => ({ type: 'remote', url }) as PromptImage),
      ],
      warnings: converted.warnings.map((warning) =>
        warning.type === 'unsupported'
          ? {
              type: 'unsupported',
              feature: warning.feature,
              details: warning.details,
            }
          : {
              type: 'other',
              message: warning.message,
            },
      ),
      systemInstruction: converted.systemInstruction,
    };
  }

  async doGenerate(
    options: Parameters<LanguageModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const { stream, request } = await this.doStream(
      options as Parameters<LanguageModelV3['doStream']>[0],
    );

    const content: LanguageModelV3Content[] = [];
    const textPartsById = new Map<string, LanguageModelV3Text>();
    const reasoningPartsById = new Map<string, LanguageModelV3Reasoning>();
    let activeTextBlockId: string | undefined;
    let activeReasoningBlockId: string | undefined;
    let responseMetadata: LanguageModelV3ResponseMetadata = {
      id: generateId(),
      timestamp: new Date(),
      modelId: this.modelId,
    };
    let usage: LanguageModelV3Usage = createEmptyCodexUsage();
    let finishReason: LanguageModelV3FinishReason = { unified: 'other', raw: undefined };
    let warnings: SharedV3Warning[] = [];
    let providerMetadata: SharedV3ProviderMetadata | undefined;

    const ensureTextPart = (
      id: string,
      metadata?: SharedV3ProviderMetadata,
    ): LanguageModelV3Text => {
      const existing = textPartsById.get(id);
      if (existing) {
        if (metadata) existing.providerMetadata = metadata;
        return existing;
      }

      const part: LanguageModelV3Text = {
        type: 'text',
        text: '',
        ...(metadata ? { providerMetadata: metadata } : {}),
      };
      textPartsById.set(id, part);
      content.push(part);
      return part;
    };

    const ensureReasoningPart = (
      id: string,
      metadata?: SharedV3ProviderMetadata,
    ): LanguageModelV3Reasoning => {
      const existing = reasoningPartsById.get(id);
      if (existing) {
        if (metadata) existing.providerMetadata = metadata;
        return existing;
      }

      const part: LanguageModelV3Reasoning = {
        type: 'reasoning',
        text: '',
        ...(metadata ? { providerMetadata: metadata } : {}),
      };
      reasoningPartsById.set(id, part);
      content.push(part);
      return part;
    };

    const pushContentPart = (
      part:
        | LanguageModelV3File
        | LanguageModelV3Source
        | LanguageModelV3ToolApprovalRequest
        | LanguageModelV3ToolCall
        | LanguageModelV3ToolResult,
    ): void => {
      content.push(part);
    };

    for await (const part of stream as AsyncIterable<LanguageModelV3StreamPart>) {
      if (part.type === 'stream-start') {
        warnings = part.warnings;
        continue;
      }

      if (part.type === 'response-metadata') {
        responseMetadata = {
          id: part.id,
          timestamp: part.timestamp,
          modelId: part.modelId,
        };
        continue;
      }

      if (part.type === 'text-start') {
        activeTextBlockId = part.id;
        ensureTextPart(part.id, part.providerMetadata);
        continue;
      }

      if (part.type === 'text-delta') {
        const blockId =
          typeof part.id === 'string' ? part.id : (activeTextBlockId ?? '__default_text_block__');
        activeTextBlockId = blockId;
        const textPart = ensureTextPart(blockId, part.providerMetadata);
        textPart.text = `${textPart.text}${part.delta}`;
        continue;
      }

      if (part.type === 'text-end') {
        const blockId = typeof part.id === 'string' ? part.id : activeTextBlockId;
        if (blockId) {
          const textPart = ensureTextPart(blockId, part.providerMetadata);
          if (part.providerMetadata) {
            textPart.providerMetadata = part.providerMetadata;
          }
        }
        if (activeTextBlockId === blockId) {
          activeTextBlockId = undefined;
        }
        continue;
      }

      if (part.type === 'reasoning-start') {
        activeReasoningBlockId = part.id;
        ensureReasoningPart(part.id, part.providerMetadata);
        continue;
      }

      if (part.type === 'reasoning-delta') {
        const blockId =
          typeof part.id === 'string'
            ? part.id
            : (activeReasoningBlockId ?? '__default_reasoning_block__');
        activeReasoningBlockId = blockId;
        const reasoningPart = ensureReasoningPart(blockId, part.providerMetadata);
        reasoningPart.text = `${reasoningPart.text}${part.delta}`;
        continue;
      }

      if (part.type === 'reasoning-end') {
        const blockId = typeof part.id === 'string' ? part.id : activeReasoningBlockId;
        if (blockId) {
          const reasoningPart = ensureReasoningPart(blockId, part.providerMetadata);
          if (part.providerMetadata) {
            reasoningPart.providerMetadata = part.providerMetadata;
          }
        }
        if (activeReasoningBlockId === blockId) {
          activeReasoningBlockId = undefined;
        }
        continue;
      }

      if (part.type === 'file') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'source') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'tool-approval-request') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'tool-call') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'tool-result') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'finish') {
        usage = part.usage;
        finishReason = part.finishReason;
        providerMetadata = part.providerMetadata;
      }
    }

    const normalizedContent = content.filter((part) => {
      if (part.type === 'text') return part.text.trim().length > 0;
      if (part.type === 'reasoning') return part.text.trim().length > 0;
      return true;
    });

    return {
      content: normalizedContent,
      usage,
      finishReason,
      warnings,
      response: responseMetadata,
      request,
      ...(providerMetadata ? { providerMetadata } : {}),
    };
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

    const warnings: SharedV3Warning[] = [
      ...mapUnsupportedSettingsWarnings({
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        maxOutputTokens: options.maxOutputTokens,
        presencePenalty: options.presencePenalty,
        frequencyPenalty: options.frequencyPenalty,
        stopSequences: options.stopSequences,
        seed: (options as { seed?: unknown }).seed,
        tools: (options as { tools?: unknown }).tools,
        toolChoice: (options as { toolChoice?: unknown }).toolChoice,
      }),
    ];

    const developerInstructionsOverride =
      providerOptions?.developerInstructions ?? settings.developerInstructions;

    const threadState = this.resolveTargetThreadId(settings, providerOptions);
    const prompt = this.preparePrompt(options.prompt as unknown[], Boolean(threadState.threadId));

    warnings.push(...prompt.warnings);

    const effectiveDeveloperInstructions =
      developerInstructionsOverride ??
      (!threadState.threadId ? prompt.systemInstruction : undefined);

    const resolvedConfig = await this.resolveConfig(settings);

    const threadResolution = await this.startOrResumeThread({
      settings,
      providerOptions,
      configOverrides: resolvedConfig.configOverrides,
      developerInstructions: effectiveDeveloperInstructions,
    });

    const threadId = threadResolution.threadId;

    if (threadResolution.recreatedFromStale) {
      warnings.push({
        type: 'other',
        message:
          'Persistent thread no longer exists after app-server restart; created a new thread automatically.',
      });
    }

    const { input, tempImagePaths } = await this.buildUserInput(prompt.promptText, prompt.images);
    const session = await this.createOrReuseSession({ threadId, settings, providerOptions });

    let usage: LanguageModelV3Usage = createEmptyCodexUsage();

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        const emitter = new AppServerStreamEmitter(controller, {
          modelId: this.modelId,
          threadId,
          includeRawChunks:
            options.includeRawChunks ??
            providerOptions?.includeRawChunks ??
            settings.includeRawChunks,
          jsonModeLastTextBlockOnly: options.responseFormat?.type === 'json',
        });

        emitter.emitStreamStart(warnings);
        emitter.emitResponseMetadata();

        let turnId: string | undefined;
        let settleTurn:
          | {
              resolve: (turn: Turn) => void;
              reject: (error: unknown) => void;
            }
          | undefined;
        const turnCompletionPromise = new Promise<Turn>((resolve, reject) => {
          settleTurn = { resolve, reject };
        });

        const router = new AppServerNotificationRouter({
          client: this.client,
          emitter,
          threadId,
          onUsage: (nextUsage) => {
            usage = nextUsage;
          },
          onTurnCompleted: (turn) => {
            session?.setInactive();
            settleTurn?.resolve(turn);
          },
          onError: (error) => {
            settleTurn?.reject(error);
          },
        });
        const unsubscribeRouter = router.subscribe();

        let aborted = false;
        let settled = false;
        let cleanedUp = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          unsubscribeRouter();
          this.client.clearActiveRequestHandlers(threadId);
          cleanupTempImages(tempImagePaths);
          if (options.abortSignal) {
            options.abortSignal.removeEventListener('abort', onAbort);
          }
        };

        let interruptWaitPromise: Promise<void> | undefined;
        const interruptAndAwaitCompletion = async (): Promise<void> => {
          if (!turnId) return;
          if (!interruptWaitPromise) {
            interruptWaitPromise = (async () => {
              await this.client.turnInterrupt({ threadId, turnId }).catch(() => undefined);
              await waitForPromiseOrTimeout(
                turnCompletionPromise.then(() => undefined),
                INTERRUPT_COMPLETION_TIMEOUT_MS,
              );
            })();
          }
          await interruptWaitPromise;
        };

        const abortError = () => options.abortSignal?.reason ?? new Error('Request aborted');

        const failWithError = async (error: unknown) => {
          if (settled) return;
          settled = true;
          emitter.error(error);
          cleanup();
        };

        const onAbort = () => {
          aborted = true;
          if (!turnId) return;
          void (async () => {
            await interruptAndAwaitCompletion();
            await failWithError(abortError());
          })();
        };

        if (options.abortSignal) {
          if (options.abortSignal.aborted) {
            aborted = true;
          } else {
            options.abortSignal.addEventListener('abort', onAbort, { once: true });
          }
        }

        if (aborted) {
          await failWithError(abortError());
          return;
        }

        this.client.setActiveRequestHandlers(threadId, settings.serverRequests ?? {});

        try {
          const turnParams: TurnStartParams = {
            threadId,
            input,
            cwd: settings.cwd,
            approvalPolicy: mapApprovalPolicy(settings),
            sandboxPolicy: mapSandboxToTurnSandboxPolicy(settings),
            model: this.modelId,
            effort: settings.effort,
            summary: settings.summary,
            personality: settings.personality,
            ...(options.responseFormat?.type === 'json' && options.responseFormat.schema
              ? { outputSchema: sanitizeJsonSchema(options.responseFormat.schema) }
              : {}),
          };

          const startTurn = async () => await this.client.turnStart(turnParams);
          const turnResponse = threadState.threadId
            ? await this.client.withThreadLock(threadId, startTurn)
            : await startTurn();

          turnId = turnResponse.turn.id;
          router.setTurnId(turnId);
          session?.setTurnId(turnId);

          if (aborted) {
            await interruptAndAwaitCompletion();
            throw abortError();
          }

          const turn = await turnCompletionPromise;
          if (aborted) {
            throw abortError();
          }

          if (settled) return;
          settled = true;
          const toolExecutionStats =
            router.getToolExecutionStats() as unknown as import('@ai-sdk/provider').JSONObject;

          emitter.emitFinish(mapTurnStatusToFinishReason(turn), usage, {
            'codex-app-server': {
              threadId,
              ...(turnId ? { turnId } : {}),
              toolExecutionStats,
            },
          });
          emitter.close();
          cleanup();
        } catch (error) {
          if (threadState.threadId && isThreadNotFoundError(error)) {
            await failWithError(createStaleThreadError(threadId));
            return;
          }

          if (aborted && turnId) {
            await interruptAndAwaitCompletion();
          }
          await failWithError(error);
        }
      },
    });

    return {
      stream,
      request: { body: prompt.promptText },
    };
  }
}
