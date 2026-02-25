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

export interface CodexAppServerModelListResult {
  models: ModelInfo[];
  defaultModel?: ModelInfo;
  nextCursor?: string | null;
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

  if (options.defaultSettings) {
    const validated = validateAppServerSettings(options.defaultSettings);
    if (!validated.valid) {
      throw new Error(`Invalid default settings: ${validated.errors.join(', ')}`);
    }
    for (const warning of validated.warnings) {
      logger.warn(`Codex App Server Provider: ${warning}`);
    }
  }

  const sharedClient = new AppServerRpcClient({
    settings: options.defaultSettings,
    logger: options.defaultSettings?.logger,
  });
  const managedSdkServers = new Set<SdkMcpServer>();

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

    return new AppServerLanguageModel({
      id: modelId,
      settings: merged,
      client: sharedClient,
      onSdkMcpServerUsed: (server) => managedSdkServers.add(server),
    });
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
    await sharedClient.close();
  };
  provider.dispose = provider.close;
  provider.listModels = async (modelProviders?: string[]) => {
    const response = await sharedClient.modelList({ modelProviders: modelProviders ?? null });
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
