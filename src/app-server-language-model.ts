import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
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
  mcpServersToConfigOverrides,
  mergeSingleMcpServer,
  sanitizeJsonSchema,
} from './shared-utils.js';
import type {
  AppServerMcpServerConfig,
  AppServerThreadMode,
  CodexAppServerProviderOptions,
  CodexAppServerRequestHandlers,
  CodexAppServerSettings,
} from './types-app-server.js';
import type { Logger, McpServerConfig } from './types-shared.js';
import type { Turn, TurnStartParams, UserInput } from './app-server-protocol-types.js';
import { AppServerRpcClient } from './app-server-rpc-client.js';
import { AppServerSession } from './app-server-session.js';
import { AppServerNotificationRouter } from './app-server-notification-router.js';
import { AppServerStreamEmitter } from './app-server-stream-emitter.js';
import { isSdkMcpServer, type SdkMcpServer } from './tools/sdk-mcp-server.js';

const appServerProviderOptionsSchema = z
  .object({
    threadId: z.string().optional(),
    resume: z.string().optional(),
    threadMode: z.enum(['stateless', 'persistent']).optional(),
    includeRawChunks: z.boolean().optional(),

    personality: z.enum(['none', 'friendly', 'pragmatic']).optional(),
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    summary: z.enum(['auto', 'concise', 'detailed', 'none']).optional(),
    approvalPolicy: z
      .union([
        z.enum(['untrusted', 'on-failure', 'on-request', 'never']),
        z.object({
          reject: z.object({
            sandbox_approval: z.boolean(),
            rules: z.boolean(),
            mcp_elicitations: z.boolean(),
          }),
        }),
      ])
      .optional(),
    sandboxPolicy: z.object({ type: z.string() }).passthrough().optional(),
    baseInstructions: z.string().optional(),
    developerInstructions: z.string().optional(),

    mcpServers: z.record(z.string(), z.any()).optional(),
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

    autoApprove: z.boolean().optional(),
    persistExtendedHistory: z.boolean().optional(),

    serverRequests: z.object({}).passthrough().optional(),
    onSessionCreated: z
      .any()
      .refine((value) => value === undefined || typeof value === 'function', {
        message: 'onSessionCreated must be a function',
      })
      .optional(),
  })
  .strict();

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

function mapSandboxToThreadSandbox(settings: CodexAppServerSettings): unknown {
  return settings.sandboxPolicy;
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

function extractSystemInstruction(prompt: readonly unknown[]): string | undefined {
  const parts: string[] = [];
  for (const message of prompt) {
    if (!message || typeof message !== 'object') continue;
    if ((message as { role?: unknown }).role !== 'system') continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim().length > 0) {
      parts.push(content.trim());
      continue;
    }

    if (Array.isArray(content)) {
      const textParts = content
        .filter(
          (part) =>
            part && typeof part === 'object' && (part as { type?: unknown }).type === 'text',
        )
        .map((part) => String((part as { text?: unknown }).text ?? ''))
        .filter((text) => text.trim().length > 0);
      if (textParts.length > 0) {
        parts.push(textParts.join('\n'));
      }
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

function filterOutSystemMessages(prompt: readonly unknown[]): unknown[] {
  return (Array.isArray(prompt) ? prompt : []).filter((message) => {
    if (!message || typeof message !== 'object') return true;
    return (message as { role?: unknown }).role !== 'system';
  });
}

function extractRemoteImageUrl(value: unknown): string | undefined {
  const asString = (input: unknown): string | undefined =>
    typeof input === 'string' && /^https?:\/\//i.test(input.trim()) ? input.trim() : undefined;

  if (!value || typeof value !== 'object') return undefined;
  const part = value as {
    image?: unknown;
    url?: unknown;
  };

  if (part.image instanceof URL) {
    const url = part.image.toString();
    if (/^https?:\/\//i.test(url)) return url;
  }

  return asString(part.image) ?? asString(part.url);
}

function extractTextAndImagesFromLastUserMessage(prompt: unknown[]): {
  text: string;
  images: PromptImage[];
  warning?: string;
} {
  const messages = Array.isArray(prompt) ? prompt : [];
  const userMessages = messages.filter((message) => {
    if (!message || typeof message !== 'object') return false;
    return (message as { role?: unknown }).role === 'user';
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
  const images: PromptImage[] = [];

  if (Array.isArray(lastUser.content)) {
    for (const part of lastUser.content) {
      if (!part || typeof part !== 'object') continue;
      const asPart = part as { type?: unknown; text?: unknown };
      if (asPart.type === 'text' && typeof asPart.text === 'string') {
        textParts.push(asPart.text);
        continue;
      }

      if (asPart.type === 'image') {
        const remote = extractRemoteImageUrl(part);
        if (remote) {
          images.push({ type: 'remote', url: remote });
          continue;
        }

        const localImage = extractImageData(part);
        if (localImage) {
          images.push({ type: 'local', data: localImage });
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

function collectRemoteImageUrls(prompt: readonly unknown[]): string[] {
  const urls: string[] = [];

  for (const message of prompt) {
    if (!message || typeof message !== 'object') continue;
    if ((message as { role?: unknown }).role !== 'user') continue;

    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if ((part as { type?: unknown }).type !== 'image') continue;
      const remote = extractRemoteImageUrl(part);
      if (remote) urls.push(remote);
    }
  }

  return urls;
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
  id: string;
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
        sandbox: mapSandboxToThreadSandbox(settings),
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
        sandbox: mapSandboxToThreadSandbox(settings),
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
        sandboxPolicy: settings.sandboxPolicy,
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
    developerInstructions?: string,
  ): {
    promptText: string;
    images: PromptImage[];
    warnings: SharedV3Warning[];
    systemInstruction?: string;
  } {
    const warnings: SharedV3Warning[] = [];

    if (hasExistingThreadContext) {
      const stateful = extractTextAndImagesFromLastUserMessage(prompt as unknown[]);
      if (stateful.warning) {
        warnings.push({ type: 'other', message: stateful.warning });
      }
      return {
        promptText: stateful.text,
        images: stateful.images,
        warnings,
      };
    }

    const systemInstruction = extractSystemInstruction(prompt);
    const promptForText =
      !developerInstructions && systemInstruction
        ? (filterOutSystemMessages(prompt) as import('ai').ModelMessage[])
        : (prompt as import('ai').ModelMessage[]);

    const mapped = mapMessagesToPrompt(promptForText);
    const remoteImageUrls = collectRemoteImageUrls(prompt);

    for (const warning of mapped.warnings ?? []) {
      if (warning.includes('HTTP URLs not supported') && remoteImageUrls.length > 0) {
        continue;
      }
      warnings.push({ type: 'other', message: warning });
    }

    return {
      promptText: mapped.promptText,
      images: [
        ...mapped.images.map((image) => ({ type: 'local', data: image }) as PromptImage),
        ...remoteImageUrls.map((url) => ({ type: 'remote', url }) as PromptImage),
      ],
      warnings,
      systemInstruction,
    };
  }

  async doGenerate(
    options: Parameters<LanguageModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    const { stream, request } = await this.doStream(
      options as Parameters<LanguageModelV3['doStream']>[0],
    );

    let text = '';
    let usage: LanguageModelV3Usage = createEmptyCodexUsage();
    let finishReason: LanguageModelV3FinishReason = { unified: 'other', raw: undefined };
    let warnings: SharedV3Warning[] = [];
    let providerMetadata: SharedV3ProviderMetadata | undefined;

    for await (const part of stream as AsyncIterable<LanguageModelV3StreamPart>) {
      if (part.type === 'stream-start') {
        warnings = part.warnings;
        continue;
      }

      if (part.type === 'text-delta') {
        text += part.delta;
        continue;
      }

      if (part.type === 'finish') {
        usage = part.usage;
        finishReason = part.finishReason;
        providerMetadata = part.providerMetadata;
      }
    }

    const content: LanguageModelV3Content[] = [{ type: 'text', text }];
    return {
      content,
      usage,
      finishReason,
      warnings,
      response: { id: generateId(), timestamp: new Date(), modelId: this.modelId },
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
        presencePenalty: options.presencePenalty,
        frequencyPenalty: options.frequencyPenalty,
        stopSequences: options.stopSequences,
        seed: (options as { seed?: unknown }).seed,
      }),
    ];

    const developerInstructionsOverride =
      providerOptions?.developerInstructions ?? settings.developerInstructions;

    const threadState = this.resolveTargetThreadId(settings, providerOptions);
    const prompt = this.preparePrompt(
      options.prompt as unknown[],
      Boolean(threadState.threadId),
      developerInstructionsOverride,
    );

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

        let aborted = false;
        let settled = false;
        let cleanedUp = false;

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          router.unsubscribe();
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

        router.subscribe();
        this.client.setActiveRequestHandlers(threadId, settings.serverRequests ?? {});

        if (options.abortSignal) {
          if (options.abortSignal.aborted) {
            aborted = true;
          }
          options.abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        try {
          const turnParams: TurnStartParams = {
            threadId,
            input,
            cwd: settings.cwd,
            approvalPolicy: mapApprovalPolicy(settings),
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
