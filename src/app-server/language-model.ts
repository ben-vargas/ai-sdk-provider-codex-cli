import type {
  LanguageModelV4,
  LanguageModelV4Content,
  LanguageModelV4File,
  LanguageModelV4FinishReason,
  LanguageModelV4Reasoning,
  LanguageModelV4Source,
  LanguageModelV4StreamPart,
  LanguageModelV4Text,
  LanguageModelV4ToolApprovalRequest,
  LanguageModelV4ToolCall,
  LanguageModelV4ToolResult,
  LanguageModelV4Usage,
  LanguageModelV4ResponseMetadata,
  SharedV4ProviderMetadata,
  SharedV4Warning,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId, parseProviderOptions } from '@ai-sdk/provider-utils';
import { createVerboseLogger, getLogger } from '../logger.js';
import {
  collectSystemInstruction,
  convertPromptToCodexInput,
  type PromptMessage,
} from '../converters/index.js';
import { cleanupTempImages, type ImageData, writeImageToTempFile } from '../image-utils.js';
import {
  createEmptyCodexUsage,
  isDeprecatedApprovalPolicyAlias,
  mapUnsupportedSettingsWarnings,
  mcpServersToConfigOverrides,
  mergeSingleMcpServer,
  normalizeApprovalPolicyAlias,
} from '../shared-utils.js';
import { assertValidMcpServerName } from '../config-key-utils.js';
import type {
  AppServerApprovalPolicy,
  AppServerMcpServerConfig,
  AppServerThreadMode,
  CodexAppServerProviderOptions,
  CodexAppServerRequestHandlers,
  CodexAppServerSettings,
} from './types.js';
import type { CodexModelId, Logger, McpServerConfig, ReasoningEffort } from '../types-shared.js';
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

// Codex reasoning effort levels; kept in compile-time sync with ReasoningEffort.
const CODEX_REASONING_EFFORTS: Record<ReasoningEffort, true> = {
  none: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  ultra: true,
};

function resolveReasoningEffort(args: {
  reasoning: string | undefined;
  providerEffort: ReasoningEffort | undefined;
  defaultEffort: ReasoningEffort | undefined;
}): { effort: ReasoningEffort | undefined; warning?: SharedV4Warning } {
  if (args.providerEffort !== undefined) {
    return { effort: args.providerEffort };
  }

  const { reasoning } = args;
  if (reasoning === undefined || reasoning === 'provider-default') {
    return { effort: args.defaultEffort };
  }

  if (Object.hasOwn(CODEX_REASONING_EFFORTS, reasoning)) {
    return { effort: reasoning as ReasoningEffort };
  }

  // Align with the exec provider: ignore the unmappable value and fall back
  // to the otherwise-configured effort (providerOptions > settings default).
  return {
    effort: args.defaultEffort,
    warning: {
      type: 'unsupported',
      feature: 'reasoning',
      details: `Codex app-server does not support reasoning effort '${reasoning}'; it will be ignored.`,
    },
  };
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

/**
 * Maps the public `approvalPolicy` setting onto the codex app-server v2
 * `AskForApproval` wire shape.
 *
 * - `'on-failure'` was retired by Codex CLI 0.143 and app-server >= 0.144
 *   rejects it (`-32600 unknown variant`), so it becomes `'on-request'`.
 * - The legacy `{ reject }` form (Codex ~0.105) used inverted flags
 *   (`true` = auto-reject); it becomes the equivalent `{ granular }` policy,
 *   where categories `reject` did not know about (skills, permission
 *   requests) keep their historical "shown to the client" behavior.
 */
export function mapApprovalPolicy(
  policy: AppServerApprovalPolicy | undefined,
  warnDeprecated?: (key: string, message: string) => void,
): unknown {
  if (policy === undefined) return undefined;

  if (isDeprecatedApprovalPolicyAlias(policy)) {
    const normalized = normalizeApprovalPolicyAlias(policy);
    warnDeprecated?.(
      `approvalPolicy:${policy}`,
      `approvalPolicy '${policy}' is deprecated (retired by Codex CLI 0.143 and rejected by app-server >= 0.144); sending '${normalized}' instead.`,
    );
    return normalized;
  }

  if (typeof policy === 'object' && policy !== null && 'reject' in policy) {
    const { reject } = policy;
    warnDeprecated?.(
      'approvalPolicy:reject',
      'approvalPolicy { reject } is deprecated (removed from the Codex app-server protocol); sending the equivalent { granular } policy instead.',
    );
    return {
      granular: {
        sandbox_approval: !reject.sandbox_approval,
        rules: !reject.rules,
        mcp_elicitations: !reject.mcp_elicitations,
        skill_approval: true,
        request_permissions: true,
      },
    };
  }

  return policy;
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

export class AppServerLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'codex-app-server';
  readonly supportedUrls = {};

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
  private readonly rawEventsByThreadId = new Map<string, boolean>();
  private persistentSession?: AppServerSession;
  private persistentBootstrapLock = Promise.resolve();
  private readonly deprecationWarningsEmitted = new Set<string>();

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

  private warnDeprecatedOnce(key: string, message: string): void {
    if (this.deprecationWarningsEmitted.has(key)) return;
    this.deprecationWarningsEmitted.add(key);
    this.logger.warn(`[codex-app-server] ${message}`);
  }

  private mapApprovalPolicy(settings: CodexAppServerSettings): unknown {
    return mapApprovalPolicy(settings.approvalPolicy, (key, message) =>
      this.warnDeprecatedOnce(key, message),
    );
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
    developerInstructionsOverride?: string;
    systemInstruction?: string;
    includeRawChunks: boolean;
  }): Promise<{
    threadId: string;
    persistent: boolean;
    explicit: boolean;
    resumed: boolean;
    rawEventsNegotiated?: boolean;
  }> {
    const {
      settings,
      providerOptions,
      configOverrides,
      developerInstructionsOverride,
      systemInstruction,
      includeRawChunks,
    } = args;
    const threadState = this.resolveTargetThreadId(settings, providerOptions);

    const startThread = async (ephemeral: boolean) => {
      const thread = await this.client.threadStart({
        model: this.modelId,
        cwd: settings.cwd,
        approvalPolicy: this.mapApprovalPolicy(settings),
        sandbox: mapSandboxToThreadSandboxMode(settings),
        config: configOverrides,
        baseInstructions: settings.baseInstructions,
        developerInstructions: developerInstructionsOverride ?? systemInstruction,
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
            approvalPolicy: this.mapApprovalPolicy(settings),
            sandbox: mapSandboxToThreadSandboxMode(settings),
            config: configOverrides,
            baseInstructions: settings.baseInstructions,
            developerInstructions: developerInstructionsOverride ?? systemInstruction,
            personality: settings.personality,
            persistExtendedHistory: settings.persistExtendedHistory ?? false,
          });

          const cachedRawEvents = this.rawEventsByThreadId.get(target.threadId);
          const knownRawEvents =
            cachedRawEvents ??
            (target.persistent && this.persistentThreadId === target.threadId
              ? this.persistentThreadRawEventsEnabled
              : undefined);
          if (cachedRawEvents !== undefined) {
            this.rememberThreadRawEvents(target.threadId, cachedRawEvents);
          }
          if (target.persistent) {
            this.persistentThreadId = target.threadId;
            this.persistentThreadRawEventsEnabled = knownRawEvents;
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
        this.rememberThreadRawEvents(newThreadId, includeRawChunks);
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
        this.rememberThreadRawEvents(newThreadId, includeRawChunks);
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

  private rememberThreadRawEvents(threadId: string, enabled: boolean): void {
    this.rawEventsByThreadId.delete(threadId);
    this.rawEventsByThreadId.set(threadId, enabled);

    if (this.rawEventsByThreadId.size <= 256) {
      return;
    }

    const oldestThreadId = this.rawEventsByThreadId.keys().next().value;
    if (typeof oldestThreadId === 'string') {
      this.rawEventsByThreadId.delete(oldestThreadId);
    }
  }

  private clearPersistentThreadState(threadId?: string): void {
    if (threadId && this.persistentThreadId && this.persistentThreadId !== threadId) {
      return;
    }

    this.persistentThreadId = undefined;
    this.persistentThreadRawEventsEnabled = undefined;
    if (threadId) {
      this.rawEventsByThreadId.delete(threadId);
    }

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
        approvalPolicy: this.mapApprovalPolicy(settings),
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
    warnings: SharedV4Warning[];
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
    options: Parameters<LanguageModelV4['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV4['doGenerate']>>> {
    const { stream, request } = await this.doStream(
      options as Parameters<LanguageModelV4['doStream']>[0],
    );

    const content: LanguageModelV4Content[] = [];
    const textPartsById = new Map<string, LanguageModelV4Text>();
    const reasoningPartsById = new Map<string, LanguageModelV4Reasoning>();
    let activeTextBlockId: string | undefined;
    let activeReasoningBlockId: string | undefined;
    let responseMetadata: LanguageModelV4ResponseMetadata = {
      id: generateId(),
      timestamp: new Date(),
      modelId: this.modelId,
    };
    let usage: LanguageModelV4Usage = createEmptyCodexUsage();
    let finishReason: LanguageModelV4FinishReason = { unified: 'other', raw: undefined };
    let warnings: SharedV4Warning[] = [];
    let providerMetadata: SharedV4ProviderMetadata | undefined;

    const ensureTextPart = (
      id: string,
      metadata?: SharedV4ProviderMetadata,
    ): LanguageModelV4Text => {
      const existing = textPartsById.get(id);
      if (existing) {
        if (metadata) existing.providerMetadata = metadata;
        return existing;
      }

      const part: LanguageModelV4Text = {
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
      metadata?: SharedV4ProviderMetadata,
    ): LanguageModelV4Reasoning => {
      const existing = reasoningPartsById.get(id);
      if (existing) {
        if (metadata) existing.providerMetadata = metadata;
        return existing;
      }

      const part: LanguageModelV4Reasoning = {
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
        | LanguageModelV4File
        | LanguageModelV4Source
        | LanguageModelV4ToolApprovalRequest
        | LanguageModelV4ToolCall
        | LanguageModelV4ToolResult,
    ): void => {
      content.push(part);
    };

    for await (const part of stream as AsyncIterable<LanguageModelV4StreamPart>) {
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
    options: Parameters<LanguageModelV4['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV4['doStream']>>> {
    const providerOptions = await parseProviderOptions<CodexAppServerProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: appServerProviderOptionsSchema as never,
    });

    const mergedSettings = this.mergeSettings(providerOptions);
    const resolvedReasoning = resolveReasoningEffort({
      reasoning: options.reasoning,
      providerEffort: providerOptions?.effort,
      defaultEffort: mergedSettings.effort,
    });
    const settings: CodexAppServerSettings =
      resolvedReasoning.effort === mergedSettings.effort
        ? mergedSettings
        : { ...mergedSettings, effort: resolvedReasoning.effort };
    const sdkServerLifecycle: 'provider' | 'request' =
      this.resolveThreadMode(settings, providerOptions) === 'persistent' ? 'provider' : 'request';
    const includeRawChunks = this.resolveIncludeRawChunks(
      options.includeRawChunks,
      settings,
      providerOptions,
    );

    const warnings: SharedV4Warning[] = [
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

    if (resolvedReasoning.warning) {
      warnings.push(resolvedReasoning.warning);
    }

    const developerInstructionsOverride =
      providerOptions?.developerInstructions ?? settings.developerInstructions;

    const systemInstruction = collectSystemInstruction(options.prompt as readonly PromptMessage[]);
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
        developerInstructionsOverride,
        systemInstruction,
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

    const prompt = this.preparePrompt(options.prompt as unknown[], threadResolution.resumed);

    warnings.push(...prompt.warnings);

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
        approvalPolicy: this.mapApprovalPolicy(settings),
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
      hadInitialThreadId: threadResolution.resumed,
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

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
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
