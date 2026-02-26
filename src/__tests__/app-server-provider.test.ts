import { describe, expect, it, vi } from 'vitest';
import { NoSuchModelError } from '@ai-sdk/provider';
import { z } from 'zod';
import { createCodexAppServer } from '../app-server/provider.js';
import { AppServerRpcClient } from '../app-server/rpc/client.js';
import { UnsupportedFeatureError } from '../errors.js';
import { createSdkMcpServer, tool } from '../tools/index.js';

describe('createCodexAppServer', () => {
  it('creates language model instances', () => {
    const provider = createCodexAppServer({
      defaultSettings: { minCodexVersion: '0.105.0', personality: 'pragmatic' },
    });

    const model: any = provider('gpt-5.3-codex');
    expect(model.provider).toBe('codex-app-server');
    expect(model.modelId).toBe('gpt-5.3-codex');
  });

  it('exposes close()', async () => {
    const provider = createCodexAppServer();
    await expect(provider.close()).resolves.toBeUndefined();
    await expect(provider.dispose()).resolves.toBeUndefined();
  });

  it('exposes listModels()', async () => {
    const listSpy = vi.spyOn(AppServerRpcClient.prototype, 'modelList').mockResolvedValue({
      data: [{ id: 'gpt-5.3-codex', isDefault: true }],
      nextCursor: null,
    });

    const provider = createCodexAppServer();
    const listed = await provider.listModels(['openai']);
    expect(listSpy).toHaveBeenCalledWith({ modelProviders: ['openai'] });
    expect(listed.defaultModel?.id).toBe('gpt-5.3-codex');
    listSpy.mockRestore();
    await provider.close();
  });

  it('propagates unsupported feature errors from listModels()', async () => {
    const listSpy = vi
      .spyOn(AppServerRpcClient.prototype, 'modelList')
      .mockRejectedValue(new UnsupportedFeatureError({ feature: 'model/list' }));

    const provider = createCodexAppServer();
    await expect(provider.listModels()).rejects.toBeInstanceOf(UnsupportedFeatureError);
    listSpy.mockRestore();
    await provider.close();
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
    expect(() => provider('gpt-5.3-codex', { minCodexVersion: 'not-semver' } as never)).toThrow(
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

    const model = provider('gpt-5.3-codex', {
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

  it('uses a distinct RPC client when per-model transport settings differ', async () => {
    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: '0.105.0',
        requestTimeoutMs: 10_000,
      },
    });

    const baseModel = provider('gpt-5.3-codex') as unknown as {
      client: unknown;
    };
    const tunedModel = provider('gpt-5.3-codex', {
      requestTimeoutMs: 25_000,
    }) as unknown as {
      client: unknown;
    };

    const baseClient = baseModel.client as { settings: { requestTimeoutMs?: number } };
    const tunedClient = tunedModel.client as { settings: { requestTimeoutMs?: number } };

    expect(baseClient).not.toBe(tunedClient);
    expect(baseClient.settings.requestTimeoutMs).toBe(10_000);
    expect(tunedClient.settings.requestTimeoutMs).toBe(25_000);

    await provider.close();
  });

  it('reuses RPC client when only non-transport model settings differ', async () => {
    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: '0.105.0',
      },
    });

    const pragmatic = provider('gpt-5.3-codex', {
      personality: 'pragmatic',
    }) as unknown as { client: AppServerRpcClient };
    const friendly = provider('gpt-5.3-codex', {
      personality: 'friendly',
    }) as unknown as { client: AppServerRpcClient };

    expect(pragmatic.client).toBe(friendly.client);

    await provider.close();
  });

  it('reuses persistent model instances for identical model + settings', async () => {
    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: '0.105.0',
      },
    });

    const first = provider('gpt-5.3-codex', { threadMode: 'persistent' });
    const second = provider('gpt-5.3-codex', { threadMode: 'persistent' });
    const different = provider('gpt-5.3-codex', {
      threadMode: 'persistent',
      developerInstructions: 'different',
    });

    expect(first).toBe(second);
    expect(different).not.toBe(first);

    await provider.close();
  });

  it('keeps persistent model cache key stable when sdk MCP runtime state changes', async () => {
    const add = tool({
      name: 'add',
      description: 'Add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a + b }),
    });

    const sdkServer = createSdkMcpServer({
      name: 'math-tools',
      tools: [add],
    });

    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: '0.105.0',
        threadMode: 'persistent',
        mcpServers: {
          math: sdkServer,
        },
      },
    });

    try {
      const first = provider('gpt-5.3-codex');
      expect(sdkServer._server).toBeUndefined();

      await sdkServer._start();
      expect(sdkServer._server).toBeDefined();

      const second = provider('gpt-5.3-codex');
      expect(second).toBe(first);
    } finally {
      await Promise.allSettled([provider.close(), sdkServer._stop()]);
    }
  });

  it('supports explicit sdk MCP cacheKey for stable persistent model reuse across recreated tool objects', async () => {
    const createSettings = (cacheKey = 'math-v1') => {
      const add = tool({
        name: 'add',
        description: 'Add two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({ result: a + b }),
      });

      return {
        threadMode: 'persistent' as const,
        mcpServers: {
          math: createSdkMcpServer({
            name: 'math-tools',
            cacheKey,
            tools: [add],
          }),
        },
      };
    };

    const provider = createCodexAppServer({
      defaultSettings: { minCodexVersion: '0.105.0' },
    });

    const first = provider('gpt-5.3-codex', createSettings());
    const second = provider('gpt-5.3-codex', createSettings());
    const differentCacheKey = provider('gpt-5.3-codex', createSettings('math-v2'));

    expect(second).toBe(first);
    expect(differentCacheKey).not.toBe(first);

    await provider.close();
  });

  it('does not reuse persistent model across recreated sdk MCP tools without cacheKey', async () => {
    const createSettings = () => {
      const add = tool({
        name: 'add',
        description: 'Add two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({ result: a + b }),
      });

      return {
        threadMode: 'persistent' as const,
        mcpServers: {
          math: createSdkMcpServer({
            name: 'math-tools',
            tools: [add],
          }),
        },
      };
    };

    const provider = createCodexAppServer({
      defaultSettings: { minCodexVersion: '0.105.0' },
    });

    const first = provider('gpt-5.3-codex', createSettings());
    const second = provider('gpt-5.3-codex', createSettings());

    expect(second).not.toBe(first);

    await provider.close();
  });

  it('does not conflate recreated sdk MCP tools when only closure-captured state changes', async () => {
    const createSettings = (offset: number) => {
      const add = tool({
        name: 'add',
        description: 'Add two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => ({ result: a + b + offset }),
      });

      return {
        threadMode: 'persistent' as const,
        mcpServers: {
          math: createSdkMcpServer({
            name: 'math-tools',
            tools: [add],
          }),
        },
      };
    };

    const provider = createCodexAppServer({
      defaultSettings: { minCodexVersion: '0.105.0' },
    });

    const first = provider('gpt-5.3-codex', createSettings(0));
    const second = provider('gpt-5.3-codex', createSettings(100));

    expect(second).not.toBe(first);

    await provider.close();
  });

  it('creates a new persistent model when recreated sdk MCP tool implementation source changes', async () => {
    const sumTool = tool({
      name: 'calculate',
      description: 'Combine two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a + b }),
    });
    const multiplyTool = tool({
      name: 'calculate',
      description: 'Combine two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a * b }),
    });

    const provider = createCodexAppServer({
      defaultSettings: { minCodexVersion: '0.105.0' },
    });

    const first = provider('gpt-5.3-codex', {
      threadMode: 'persistent',
      mcpServers: {
        math: createSdkMcpServer({
          name: 'math-tools',
          tools: [sumTool],
        }),
      },
    });
    const changed = provider('gpt-5.3-codex', {
      threadMode: 'persistent',
      mcpServers: {
        math: createSdkMcpServer({
          name: 'math-tools',
          tools: [multiplyTool],
        }),
      },
    });

    expect(changed).not.toBe(first);

    await provider.close();
  });

  it('retains persistent model cache entries until provider.close()', async () => {
    const provider = createCodexAppServer({
      defaultSettings: {
        minCodexVersion: '0.105.0',
      },
    });

    const first = provider('gpt-5.3-codex', {
      threadMode: 'persistent',
      developerInstructions: 'cache-0',
    });

    for (let i = 1; i <= 256; i += 1) {
      provider('gpt-5.3-codex', {
        threadMode: 'persistent',
        developerInstructions: `cache-${i}`,
      });
    }

    const firstAgain = provider('gpt-5.3-codex', {
      threadMode: 'persistent',
      developerInstructions: 'cache-0',
    });

    expect(firstAgain).toBe(first);

    await provider.close();
  });
});
