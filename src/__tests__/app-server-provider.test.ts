import { describe, expect, it } from 'vitest';
import { NoSuchModelError } from '@ai-sdk/provider';
import { createCodexAppServer } from '../app-server-provider.js';

describe('createCodexAppServer', () => {
  it('creates language model instances', () => {
    const provider = createCodexAppServer({
      defaultSettings: { minCodexVersion: '0.105.0', personality: 'pragmatic' },
    });

    const model: any = provider('gpt-5.1-codex');
    expect(model.provider).toBe('codex-app-server');
    expect(model.modelId).toBe('gpt-5.1-codex');
  });

  it('exposes close()', async () => {
    const provider = createCodexAppServer();
    await expect(provider.close()).resolves.toBeUndefined();
  });

  it('throws for invalid default settings', () => {
    expect(() =>
      createCodexAppServer({
        defaultSettings: { minCodexVersion: 'not-semver' } as never,
      }),
    ).toThrow(/Invalid default settings/);
  });

  it('throws for invalid per-model settings', () => {
    const provider = createCodexAppServer();
    expect(() => provider('gpt-5.1-codex', { minCodexVersion: 'not-semver' } as never)).toThrow(
      /Invalid settings/,
    );
  });

  it('throws NoSuchModelError for embedding and image models', () => {
    const provider = createCodexAppServer();
    expect(() => provider.embeddingModel('embed-1')).toThrow(NoSuchModelError);
    expect(() => provider.imageModel('img-1')).toThrow(NoSuchModelError);
  });

  it('merges config overrides from defaults and per-model settings', () => {
    const provider = createCodexAppServer({
      defaultSettings: {
        configOverrides: { one: '1', shared: 'default' },
      },
    });

    const model = provider('gpt-5.1-codex', {
      configOverrides: { two: '2', shared: 'model' },
    }) as unknown as { settings: { configOverrides?: Record<string, unknown> } };

    expect(model.settings.configOverrides).toEqual({
      one: '1',
      two: '2',
      shared: 'model',
    });
  });

  it('rejects construction with new', () => {
    const provider = createCodexAppServer();
    expect(() => new (provider as unknown as new () => unknown)()).toThrow(
      'The Codex app-server provider function cannot be called with new.',
    );
  });
});
