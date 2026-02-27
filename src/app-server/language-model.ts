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
} from '../shared-utils.js';
import { assertValidMcpServerName } from '../config-key-utils.js';
import type {
  AppServerMcpServerConfig,
  AppServerThreadMode,
  CodexAppServerProviderOptions,
  CodexAppServerRequestHandlers,
  CodexAppServerSettings,
} from './types.js';
import type { CodexModelId, Logger, McpServerConfig } from '../types-shared.js';
import type { UserInput } from './protocol/types.js';
import { AppServerRpcClient } from './rpc/client.js';
import { AppServerSession } from './session.js';
import { buildTurnStartParams, TurnStreamController } from './stream/turn-stream-controller.js';
import { isSdkMcpServer, type SdkMcpServer } from '../tools/sdk-mcp-server.js';
import { appServerProviderOptionsSchema } from '../validation.js';

type PromptImage =
  | {
      type: 'local';
      data: ImageData;
    }
  | {
      type: 'remote';
      url: string;
    };

function isThreadNotFoundError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return /thread.*not found/i.test(message);
}

function createStaleThreadError(threadId: string): Error {
  return new Error(
    `Thread '${threadId}' not found after server restart. Create a new thread by omitting threadId.`,
  );
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
  if (!base && !override) return undefined;

  const merged: Record<string, AppServerMcpServerConfig> = {};
  for (const [rawName, server] of Object.entries(base ?? {})) {
    const name = assertValidMcpServerName(rawName);
    merged[name] = server;
  }

  if (!override) return merged;

  for (const [rawName, incoming] of Object.entries(override)) {
    const name = assertValidMcpServerName(rawName);
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
  usedSdkMcpServers: SdkMcpServer[];
}

export interface AppServerLanguageModelOptions {
  id: CodexModelId;
  settings?: CodexAppServerSettings;
  client: AppServerRpcClient;
  onSdkMcpServerUsed?: (server: SdkMcpServer, lifecycle: 'provider' | 'request') => void;
  onSdkMcpServerReleased?: (server: SdkMcpServer) => void;
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
  private readonly onSdkMcpServerUsed?: (
    server: SdkMcpServer,
    lifecycle: 'provider' | 'request',
  ) => void;
  private readonly onSdkMcpServerReleased?: (server: SdkMcpServer) => void;

  private persistentThreadId?: string;
  private persistentThreadRawEventsEnabled?: boolean;
  private persistentSession?: AppServerSession;
  private persistentBootstrapLock = Promise.resolve();

  constructor(options: AppServerLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.client = options.client;
    this.onSdkMcpServerUsed = options.onSdkMcpServerUsed;
    this.onSdkMcpServerReleased = options.onSdkMcpServerReleased;
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

  private resolveIncludeRawChunks(
    optionsIncludeRawChunks: boolean | undefined,
    settings: CodexAppServerSettings,
    providerOptions?: CodexAppServerProviderOptions,
  ): boolean {
    return (
      (optionsIncludeRawChunks ??
        providerOptions?.includeRawChunks ??
        settings.includeRawChunks) === true
    );
  }

  private async resolveConfig(
    settings: CodexAppServerSettings,
    sdkServerLifecycle: 'provider' | 'request',
  ): Promise<ResolvedConfig> {
    const resolvedMcpServers: Record<string, McpServerConfig> = {};
    const usedSdkMcpServers: SdkMcpServer[] = [];

    try {
      for (const [name, server] of Object.entries(settings.mcpServers ?? {})) {
        if (isSdkMcpServer(server)) {
          const started = await server._start();
          this.onSdkMcpServerUsed?.(server, sdkServerLifecycle);
          usedSdkMcpServers.push(server);
          resolvedMcpServers[name] = started;
          continue;
        }

        resolvedMcpServers[name] = server;
      }
    } catch (error) {
      if (sdkServerLifecycle === 'request') {
        for (const server of usedSdkMcpServers) {
          this.onSdkMcpServerReleased?.(server);
        }
      }
      throw error;
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
      usedSdkMcpServers,
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
    includeRawChunks: boolean;
  }): Promise<{
    threadId: string;
    persistent: boolean;
    explicit: boolean;
    resumed: boolean;
    rawEventsNegotiated?: boolean;
  }> {
    const { settings, providerOptions, configOverrides, developerInstructions, includeRawChunks } =
      args;
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
        experimentalRawEvents: includeRawChunks,
        persistExtendedHistory: settings.persistExtendedHistory ?? false,
      });
      return thread.thread.id;
    };

    const resolveThread = async (): Promise<{
      threadId: string;
      persistent: boolean;
      explicit: boolean;
      resumed: boolean;
      rawEventsNegotiated?: boolean;
    }> => {
      const resumeThread = async (target: {
        threadId: string;
        persistent: boolean;
        explicit: boolean;
      }): Promise<{
        threadId: string;
        persistent: boolean;
        explicit: boolean;
        resumed: boolean;
        rawEventsNegotiated?: boolean;
      }> => {
        try {
          await this.client.threadResume({
            threadId: target.threadId,
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

          const knownRawEvents =
            target.persistent && this.persistentThreadId === target.threadId
              ? this.persistentThreadRawEventsEnabled
              : undefined;
          if (target.persistent) {
            this.persistentThreadId = target.threadId;
            if (target.explicit) {
              this.persistentThreadRawEventsEnabled = undefined;
            }
          }

          return {
            threadId: target.threadId,
            persistent: target.persistent,
            explicit: target.explicit,
            resumed: true,
            rawEventsNegotiated: knownRawEvents,
          };
        } catch (error) {
          if (!isThreadNotFoundError(error)) {
            throw error;
          }
          if (target.persistent && !target.explicit) {
            this.clearPersistentThreadState(target.threadId);
          }
          throw createStaleThreadError(target.threadId);
        }
      };

      if (!threadState.threadId && threadState.persistent) {
        if (this.persistentThreadId) {
          return await resumeThread({
            threadId: this.persistentThreadId,
            persistent: true,
            explicit: false,
          });
        }

        const newThreadId = await startThread(false);
        this.persistentThreadId = newThreadId;
        this.persistentThreadRawEventsEnabled = includeRawChunks;
        return {
          threadId: newThreadId,
          persistent: true,
          explicit: false,
          resumed: false,
          rawEventsNegotiated: includeRawChunks,
        };
      }

      if (!threadState.threadId) {
        const newThreadId = await startThread(!threadState.persistent);
        if (threadState.persistent) {
          this.persistentThreadId = newThreadId;
          this.persistentThreadRawEventsEnabled = includeRawChunks;
        }
        return {
          threadId: newThreadId,
          persistent: threadState.persistent,
          explicit: false,
          resumed: false,
          rawEventsNegotiated: includeRawChunks,
        };
      }

      return await resumeThread({
        threadId: threadState.threadId,
        persistent: threadState.persistent,
        explicit: threadState.explicit,
      });
    };

    if (threadState.persistent && !threadState.explicit) {
      return await this.withPersistentBootstrapLock(resolveThread);
    }

    return await resolveThread();
  }

  private async withPersistentBootstrapLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.persistentBootstrapLock;

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const chained = previous.then(() => gate);
    this.persistentBootstrapLock = chained;
    await previous;

    try {
      return await fn();
    } finally {
      release?.();
      if (this.persistentBootstrapLock === chained) {
        this.persistentBootstrapLock = Promise.resolve();
      }
    }
  }

  private clearPersistentThreadState(threadId?: string): void {
    if (threadId && this.persistentThreadId && this.persistentThreadId !== threadId) {
      return;
    }

    this.persistentThreadId = undefined;
    this.persistentThreadRawEventsEnabled = undefined;

    if (!threadId || this.persistentSession?.threadId === threadId) {
      this.persistentSession = undefined;
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
      requestHandlers: settings.serverRequests ?? {},
      autoApprove: settings.autoApprove,
    });

    await onSessionCreated(session);
    if (persistent) {
      this.persistentSession = session;
    }
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
    const sdkServerLifecycle: 'provider' | 'request' =
      this.resolveThreadMode(settings, providerOptions) === 'persistent' ? 'provider' : 'request';
    const includeRawChunks = this.resolveIncludeRawChunks(
      options.includeRawChunks,
      settings,
      providerOptions,
    );

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

    const resolvedConfig = await this.resolveConfig(settings, sdkServerLifecycle);
    let releasedSdkServers = false;
    const releaseUsedSdkMcpServers = () => {
      if (releasedSdkServers || sdkServerLifecycle !== 'request') {
        return;
      }
      releasedSdkServers = true;
      for (const server of resolvedConfig.usedSdkMcpServers) {
        this.onSdkMcpServerReleased?.(server);
      }
    };

    let threadResolution: Awaited<ReturnType<AppServerLanguageModel['startOrResumeThread']>>;
    try {
      threadResolution = await this.startOrResumeThread({
        settings,
        providerOptions,
        configOverrides: resolvedConfig.configOverrides,
        developerInstructions: effectiveDeveloperInstructions,
        includeRawChunks,
      });
    } catch (error) {
      releaseUsedSdkMcpServers();
      throw error;
    }

    const threadId = threadResolution.threadId;

    if (
      includeRawChunks &&
      threadResolution.resumed &&
      threadResolution.rawEventsNegotiated !== true
    ) {
      warnings.push({
        type: 'other',
        message:
          'includeRawChunks was requested while resuming an existing thread that may not emit raw events. Start a new thread to guarantee raw chunk events.',
      });
    }

    let input: UserInput[] = [];
    let tempImagePaths: string[] = [];
    let session: AppServerSession | undefined;
    try {
      const builtInput = await this.buildUserInput(prompt.promptText, prompt.images);
      input = builtInput.input;
      tempImagePaths = builtInput.tempImagePaths;
      session = await this.createOrReuseSession({ threadId, settings, providerOptions });
    } catch (error) {
      cleanupTempImages(tempImagePaths);
      releaseUsedSdkMcpServers();
      throw error;
    }

    const turnStartParams = buildTurnStartParams({
      threadId,
      modelId: this.modelId,
      input,
      settings: {
        cwd: settings.cwd,
        approvalPolicy: mapApprovalPolicy(settings),
        sandboxPolicy: mapSandboxToTurnSandboxPolicy(settings),
        effort: settings.effort,
        summary: settings.summary,
        personality: settings.personality,
      },
      responseFormat: options.responseFormat as { type?: string; schema?: unknown } | undefined,
    });

    const turnStreamController = new TurnStreamController({
      client: this.client,
      modelId: this.modelId,
      threadId,
      warnings,
      includeRawChunks,
      jsonModeLastTextBlockOnly: options.responseFormat?.type === 'json',
      turnStartParams,
      requestHandlers: settings.serverRequests,
      autoApprove: settings.autoApprove,
      session,
      abortSignal: options.abortSignal,
      shouldSerializeTurnStart: threadResolution.persistent || threadResolution.explicit,
      hadInitialThreadId: Boolean(threadState.threadId),
      threadResolution: {
        persistent: threadResolution.persistent,
        explicit: threadResolution.explicit,
      },
      releaseResources: () => {
        cleanupTempImages(tempImagePaths);
        releaseUsedSdkMcpServers();
      },
      clearPersistentThreadState: (staleThreadId) => {
        this.clearPersistentThreadState(staleThreadId);
      },
    });

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        await turnStreamController.start(controller);
      },
      cancel: async (reason) => {
        await turnStreamController.cancel(reason);
      },
    });

    return {
      stream,
      request: { body: prompt.promptText },
    };
  }
}
