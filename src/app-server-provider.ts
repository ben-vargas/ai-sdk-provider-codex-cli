import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { AppServerLanguageModel } from './app-server-language-model.js';
import { AppServerRpcClient } from './app-server-rpc-client.js';
import type { CodexAppServerProviderSettings, CodexAppServerSettings } from './types-app-server.js';
import { validateAppServerSettings } from './validation.js';
import { getLogger } from './logger.js';

export interface CodexAppServerProvider extends ProviderV3 {
  (modelId: string, settings?: CodexAppServerSettings): LanguageModelV3;
  languageModel(modelId: string, settings?: CodexAppServerSettings): LanguageModelV3;
  chat(modelId: string, settings?: CodexAppServerSettings): LanguageModelV3;
  embeddingModel(modelId: string): never;
  imageModel(modelId: string): never;
  close(): Promise<void>;
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
    await sharedClient.close();
  };

  return provider;
}

export const codexAppServer = createCodexAppServer();
