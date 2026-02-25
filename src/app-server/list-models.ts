import { AppServerRpcClient } from './rpc/client.js';
import type { ModelInfo } from './protocol/types.js';

export interface ListModelsOptions {
  codexPath?: string;
  env?: Record<string, string>;
  cwd?: string;
  minCodexVersion?: string;
  modelProviders?: string[];
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface ListModelsResult {
  models: ModelInfo[];
  defaultModel?: ModelInfo;
  nextCursor?: string | null;
}

export async function listModels(options: ListModelsOptions = {}): Promise<ListModelsResult> {
  const client = new AppServerRpcClient({
    settings: {
      codexPath: options.codexPath,
      env: options.env,
      cwd: options.cwd,
      minCodexVersion: options.minCodexVersion,
      connectionTimeoutMs: options.connectionTimeoutMs,
      requestTimeoutMs: options.requestTimeoutMs,
      logger: false,
    },
  });

  try {
    const result = await client.modelList({ modelProviders: options.modelProviders ?? null });
    const models = result.data ?? [];
    return {
      models,
      defaultModel: models.find((model) => model.isDefault === true),
      nextCursor: result.nextCursor,
    };
  } finally {
    await client.dispose();
  }
}
