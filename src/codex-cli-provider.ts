import type { LanguageModelV1, ProviderV1 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { CodexCliLanguageModel } from './codex-cli-language-model.js';
import type { CodexCliProviderSettings, CodexCliSettings } from './types.js';
import { getLogger } from './logger.js';
import { validateSettings } from './validation.js';

export interface CodexCliProvider extends ProviderV1 {
  (modelId: string, settings?: CodexCliSettings): LanguageModelV1;
  languageModel(modelId: string, settings?: CodexCliSettings): LanguageModelV1;
  chat(modelId: string, settings?: CodexCliSettings): LanguageModelV1;
  textEmbeddingModel(modelId: string): never;
  imageModel(modelId: string): never;
}

export function createCodexCli(options: CodexCliProviderSettings = {}): CodexCliProvider {
  const logger = getLogger(options.defaultSettings?.logger);

  if (options.defaultSettings) {
    const v = validateSettings(options.defaultSettings);
    if (!v.valid) {
      throw new Error(`Invalid default settings: ${v.errors.join(', ')}`);
    }
    for (const w of v.warnings) logger.warn(`Codex CLI Provider: ${w}`);
  }

  const createModel = (modelId: string, settings: CodexCliSettings = {}): LanguageModelV1 => {
    const merged: CodexCliSettings = { ...options.defaultSettings, ...settings };
    const v = validateSettings(merged);
    if (!v.valid) throw new Error(`Invalid settings: ${v.errors.join(', ')}`);
    for (const w of v.warnings) logger.warn(`Codex CLI: ${w}`);
    return new CodexCliLanguageModel({ id: modelId, settings: merged });
  };

  const provider = function (modelId: string, settings?: CodexCliSettings) {
    if (new.target) throw new Error('The Codex CLI provider function cannot be called with new.');
    return createModel(modelId, settings);
  } as CodexCliProvider;

  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.textEmbeddingModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'textEmbeddingModel' });
  }) as never;
  provider.imageModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  }) as never;

  return provider;
}

export const codexCli = createCodexCli();
