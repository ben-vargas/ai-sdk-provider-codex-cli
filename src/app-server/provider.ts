import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { AppServerLanguageModel } from './language-model.js';
import { AppServerRpcClient } from './rpc/client.js';
import type { CodexAppServerProviderSettings, CodexAppServerSettings } from './types.js';
import type { SdkMcpServer } from '../tools/sdk-mcp-server.js';
import { validateAppServerSettings } from '../validation.js';
import { getLogger } from '../logger.js';
import type { ModelInfo } from './protocol/types.js';
import type { CodexModelId } from '../types-shared.js';
import type { Logger } from '../types-shared.js';

export interface CodexAppServerModelListResult {
  models: ModelInfo[];
  defaultModel?: ModelInfo;
  nextCursor?: string | null;
}

const MAX_PERSISTENT_MODEL_CACHE_SIZE = 128;

type ClientScopedSettings = Pick<
  CodexAppServerSettings,
  | 'codexPath'
  | 'cwd'
  | 'env'
  | 'logger'
  | 'connectionTimeoutMs'
  | 'requestTimeoutMs'
  | 'idleTimeoutMs'
  | 'minCodexVersion'
>;

function pickClientScopedSettings(settings: CodexAppServerSettings): ClientScopedSettings {
  return {
    codexPath: settings.codexPath,
    cwd: settings.cwd,
    env: settings.env,
    logger: settings.logger,
    connectionTimeoutMs: settings.connectionTimeoutMs,
    requestTimeoutMs: settings.requestTimeoutMs,
    idleTimeoutMs: settings.idleTimeoutMs,
    minCodexVersion: settings.minCodexVersion,
  };
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Provider interface for the persistent Codex app-server transport.
 *
 * Use this via `createCodexAppServer()` or the default `codexAppServer` export.
 */
export interface CodexAppServerProvider extends ProviderV3 {
  (modelId: CodexModelId, settings?: CodexAppServerSettings): LanguageModelV3;
  languageModel(modelId: CodexModelId, settings?: CodexAppServerSettings): LanguageModelV3;
  chat(modelId: CodexModelId, settings?: CodexAppServerSettings): LanguageModelV3;
  embeddingModel(modelId: string): never;
  imageModel(modelId: string): never;
  close(): Promise<void>;
  dispose(): Promise<void>;
  listModels(modelProviders?: string[]): Promise<CodexAppServerModelListResult>;
}

/**
 * Creates a Codex app-server provider instance.
 *
 * The provider maintains a shared JSON-RPC client process and can be reused
 * across many model calls. Always call `provider.close()` (or `dispose()`)
 * when finished.
 *
 * @example
 * ```ts
 * const provider = createCodexAppServer({
 *   defaultSettings: { minCodexVersion: '0.105.0-alpha.0' },
 * });
 *
 * try {
 *   const model = provider('gpt-5.3-codex');
 *   // use with generateText / streamText / generateObject
 * } finally {
 *   await provider.close();
 * }
 * ```
 */
export function createCodexAppServer(
  options: CodexAppServerProviderSettings = {},
): CodexAppServerProvider {
  const logger = getLogger(options.defaultSettings?.logger);
  const sharedClients = new Map<string, AppServerRpcClient>();
  const persistentModels = new Map<string, AppServerLanguageModel>();
  const loggerIdentityIds = new WeakMap<Logger, number>();
  const functionIdentityIds = new WeakMap<(...args: unknown[]) => unknown, number>();
  const objectIdentityIds = new WeakMap<object, number>();
  let nextLoggerIdentityId = 1;
  let nextValueIdentityId = 1;

  if (options.defaultSettings) {
    const validated = validateAppServerSettings(options.defaultSettings);
    if (!validated.valid) {
      throw new Error(`Invalid default settings: ${validated.errors.join(', ')}`);
    }
    for (const warning of validated.warnings) {
      logger.warn(`Codex App Server Provider: ${warning}`);
    }
  }

  const managedSdkServers = new Set<SdkMcpServer>();

  const getLoggerIdentity = (value: Logger | false | undefined): string => {
    if (value === false) {
      return 'logger:false';
    }
    if (!value) {
      return 'logger:default';
    }

    const existing = loggerIdentityIds.get(value);
    if (existing !== undefined) {
      return `logger:${existing}`;
    }

    const id = nextLoggerIdentityId++;
    loggerIdentityIds.set(value, id);
    return `logger:${id}`;
  };

  const getFunctionIdentity = (value: (...args: unknown[]) => unknown): string => {
    const existing = functionIdentityIds.get(value);
    if (existing !== undefined) {
      return `fn:${existing}`;
    }

    const id = nextValueIdentityId++;
    functionIdentityIds.set(value, id);
    return `fn:${id}`;
  };

  const getObjectIdentity = (value: object): string => {
    const existing = objectIdentityIds.get(value);
    if (existing !== undefined) {
      return `obj:${existing}`;
    }

    const id = nextValueIdentityId++;
    objectIdentityIds.set(value, id);
    return `obj:${id}`;
  };

  const normalizeForModelKey = (value: unknown, seen = new WeakSet<object>()): unknown => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (typeof value === 'bigint') {
      return { __bigint: value.toString() };
    }

    if (typeof value === 'symbol') {
      return { __symbol: String(value) };
    }

    if (typeof value === 'function') {
      return { __functionIdentity: getFunctionIdentity(value as (...args: unknown[]) => unknown) };
    }

    if (Array.isArray(value)) {
      return value.map((item) => normalizeForModelKey(item, seen));
    }

    if (typeof value === 'object') {
      if (seen.has(value)) {
        return { __objectRef: getObjectIdentity(value) };
      }
      seen.add(value);

      if (!isPlainObject(value)) {
        return { __objectIdentity: getObjectIdentity(value) };
      }

      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
        normalized[key] = normalizeForModelKey(value[key], seen);
      }
      return normalized;
    }

    return String(value);
  };

  const createClientKey = (settings: ClientScopedSettings): string => {
    const envEntries =
      settings.env && Object.keys(settings.env).length > 0
        ? Object.entries(settings.env).sort(([a], [b]) => a.localeCompare(b))
        : undefined;

    return JSON.stringify({
      codexPath: settings.codexPath ?? null,
      cwd: settings.cwd ?? null,
      connectionTimeoutMs: settings.connectionTimeoutMs ?? null,
      requestTimeoutMs: settings.requestTimeoutMs ?? null,
      idleTimeoutMs: settings.idleTimeoutMs ?? null,
      minCodexVersion: settings.minCodexVersion ?? null,
      env: envEntries ?? null,
      logger: getLoggerIdentity(settings.logger),
    });
  };

  const getOrCreateClient = (settings: CodexAppServerSettings): AppServerRpcClient => {
    const clientSettings = pickClientScopedSettings(settings);
    const key = createClientKey(clientSettings);
    const existing = sharedClients.get(key);
    if (existing) {
      return existing;
    }

    const created = new AppServerRpcClient({
      settings: clientSettings,
      logger: clientSettings.logger,
    });
    sharedClients.set(key, created);
    return created;
  };

  const createPersistentModelKey = (
    modelId: CodexModelId,
    settings: CodexAppServerSettings,
  ): string => {
    const settingsForKey: Record<string, unknown> = {
      ...settings,
      logger:
        settings.logger === false
          ? false
          : settings.logger
            ? { __loggerIdentity: getLoggerIdentity(settings.logger) }
            : undefined,
    };

    return JSON.stringify({
      modelId,
      settings: normalizeForModelKey(settingsForKey),
    });
  };

  const createModel = (
    modelId: CodexModelId,
    settings: CodexAppServerSettings = {},
  ): AppServerLanguageModel => {
    const merged: CodexAppServerSettings = {
      ...options.defaultSettings,
      ...settings,
      configOverrides: {
        ...(options.defaultSettings?.configOverrides ?? {}),
        ...(settings.configOverrides ?? {}),
      },
    };

    const validated = validateAppServerSettings(merged);
    if (!validated.valid) {
      throw new Error(`Invalid settings: ${validated.errors.join(', ')}`);
    }
    for (const warning of validated.warnings) {
      logger.warn(`Codex App Server: ${warning}`);
    }

    const buildModel = () =>
      new AppServerLanguageModel({
        id: modelId,
        settings: merged,
        client: getOrCreateClient(merged),
        onSdkMcpServerUsed: (server) => managedSdkServers.add(server),
      });

    if ((merged.threadMode ?? 'stateless') !== 'persistent') {
      return buildModel();
    }

    const persistentModelKey = createPersistentModelKey(modelId, merged);
    const existingPersistentModel = persistentModels.get(persistentModelKey);
    if (existingPersistentModel) {
      // Refresh insertion order for simple LRU behavior.
      persistentModels.delete(persistentModelKey);
      persistentModels.set(persistentModelKey, existingPersistentModel);
      return existingPersistentModel;
    }

    const createdPersistentModel = buildModel();
    persistentModels.set(persistentModelKey, createdPersistentModel);
    if (persistentModels.size > MAX_PERSISTENT_MODEL_CACHE_SIZE) {
      const oldestKey = persistentModels.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        persistentModels.delete(oldestKey);
        logger.warn(
          `[codex-app-server] Evicted persistent model cache entry (max=${MAX_PERSISTENT_MODEL_CACHE_SIZE}). Reuse model settings or call provider.close() to limit cache churn.`,
        );
      }
    }
    return createdPersistentModel;
  };

  const provider = Object.assign(
    function (modelId: CodexModelId, settings?: CodexAppServerSettings) {
      if (new.target) {
        throw new Error('The Codex app-server provider function cannot be called with new.');
      }

      return createModel(modelId, settings);
    },
    { specificationVersion: 'v3' as const },
  ) as unknown as CodexAppServerProvider;

  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.embeddingModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  }) as never;
  provider.imageModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  }) as never;
  provider.close = async () => {
    await Promise.allSettled(
      Array.from(managedSdkServers).map(async (server) => {
        await server._stop();
      }),
    );
    managedSdkServers.clear();
    await Promise.allSettled(
      Array.from(sharedClients.values()).map(async (client) => {
        await client.close();
      }),
    );
    sharedClients.clear();
    persistentModels.clear();
  };
  provider.dispose = provider.close;
  provider.listModels = async (modelProviders?: string[]) => {
    const client = getOrCreateClient(options.defaultSettings ?? {});
    const response = await client.modelList({ modelProviders: modelProviders ?? null });
    const models = response.data ?? [];
    return {
      models,
      defaultModel: models.find((model) => model.isDefault === true),
      nextCursor: response.nextCursor,
    };
  };

  return provider;
}

export const codexAppServer = createCodexAppServer();
