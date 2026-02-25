import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { AppServerLanguageModel } from './app-server-language-model.js';
import { AppServerRpcClient } from './app-server-rpc-client.js';
import type { CodexAppServerProviderSettings, CodexAppServerSettings } from './types-app-server.js';
import type { SdkMcpServer } from './tools/sdk-mcp-server.js';
import { validateAppServerSettings } from './validation.js';
import { getLogger } from './logger.js';
import type { ModelInfo } from './app-server-protocol-types.js';

export interface CodexAppServerModelListResult {
  models: ModelInfo[];
  defaultModel?: ModelInfo;
  nextCursor?: string | null;
}

export interface CodexAppServerProvider extends ProviderV3 {
  (modelId: string, settings?: CodexAppServerSettings): LanguageModelV3;
  languageModel(modelId: string, settings?: CodexAppServerSettings): LanguageModelV3;
  chat(modelId: string, settings?: CodexAppServerSettings): LanguageModelV3;
  embeddingModel(modelId: string): never;
  imageModel(modelId: string): never;
  close(): Promise<void>;
  dispose(): Promise<void>;
  listModels(modelProviders?: string[]): Promise<CodexAppServerModelListResult>;
}

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
    modelId: string,
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

  const provider = function (modelId: string, settings?: CodexAppServerSettings) {
    if (new.target) {
      throw new Error('The Codex app-server provider function cannot be called with new.');
    }

    return createModel(modelId, settings);
  } as unknown as CodexAppServerProvider;

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
