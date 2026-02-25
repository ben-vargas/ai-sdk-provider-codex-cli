import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { ExecLanguageModel } from './exec-language-model.js';
import type { CodexExecProviderSettings, CodexExecSettings } from './types.js';
import { getLogger } from './logger.js';
import { validateExecSettings } from './validation.js';
import type { CodexModelId } from './types-shared.js';

export interface CodexExecProvider extends ProviderV3 {
  (modelId: CodexModelId, settings?: CodexExecSettings): LanguageModelV3;
  languageModel(modelId: CodexModelId, settings?: CodexExecSettings): LanguageModelV3;
  chat(modelId: CodexModelId, settings?: CodexExecSettings): LanguageModelV3;
  embeddingModel(modelId: string): never;
  imageModel(modelId: string): never;
}

export function createCodexExec(options: CodexExecProviderSettings = {}): CodexExecProvider {
  const logger = getLogger(options.defaultSettings?.logger);

  if (options.defaultSettings) {
    const v = validateExecSettings(options.defaultSettings);
    if (!v.valid) {
      throw new Error(`Invalid default settings: ${v.errors.join(', ')}`);
    }
    for (const w of v.warnings) logger.warn(`Codex CLI Provider: ${w}`);
  }

  const createModel = (
    modelId: CodexModelId,
    settings: CodexExecSettings = {},
  ): LanguageModelV3 => {
    const merged: CodexExecSettings = { ...options.defaultSettings, ...settings };
    const v = validateExecSettings(merged);
    if (!v.valid) throw new Error(`Invalid settings: ${v.errors.join(', ')}`);
    for (const w of v.warnings) logger.warn(`Codex CLI: ${w}`);
    return new ExecLanguageModel({ id: modelId, settings: merged });
  };

  const provider = Object.assign(
    function (modelId: CodexModelId, settings?: CodexExecSettings) {
      if (new.target) throw new Error('The Codex CLI provider function cannot be called with new.');
      return createModel(modelId, settings);
    },
    { specificationVersion: 'v3' as const },
  ) as CodexExecProvider;

  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.embeddingModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  }) as never;
  provider.imageModel = ((modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
  }) as never;

  return provider;
}

export const codexExec = createCodexExec();
