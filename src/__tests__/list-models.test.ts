import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModels } from '../app-server/list-models.js';
import { AppServerRpcClient } from '../app-server/rpc/client.js';
import { UnsupportedFeatureError } from '../errors.js';

describe('listModels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns models and detects default model', async () => {
    const modelListSpy = vi.spyOn(AppServerRpcClient.prototype, 'modelList').mockResolvedValue({
      data: [
        { id: 'gpt-5.3-codex', isDefault: false },
        { id: 'gpt-5.2-codex-max', isDefault: true },
      ],
      nextCursor: null,
    });
    const disposeSpy = vi.spyOn(AppServerRpcClient.prototype, 'dispose').mockResolvedValue();

    const result = await listModels({ modelProviders: ['openai'] });

    expect(modelListSpy).toHaveBeenCalledWith({ modelProviders: ['openai'] });
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(result.defaultModel?.id).toBe('gpt-5.2-codex-max');
    expect(result.models).toHaveLength(2);
  });

  it('always disposes client when model/list fails', async () => {
    vi.spyOn(AppServerRpcClient.prototype, 'modelList').mockRejectedValue(new Error('boom'));
    const disposeSpy = vi.spyOn(AppServerRpcClient.prototype, 'dispose').mockResolvedValue();

    await expect(listModels()).rejects.toThrow('boom');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces UnsupportedFeatureError for model/list', async () => {
    vi.spyOn(AppServerRpcClient.prototype, 'modelList').mockRejectedValue(
      new UnsupportedFeatureError({ feature: 'model/list' }),
    );
    const disposeSpy = vi.spyOn(AppServerRpcClient.prototype, 'dispose').mockResolvedValue();

    await expect(listModels()).rejects.toBeInstanceOf(UnsupportedFeatureError);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
