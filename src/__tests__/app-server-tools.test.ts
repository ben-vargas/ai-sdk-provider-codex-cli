import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLocalMcpServer, createSdkMcpServer, isSdkMcpServer, tool } from '../tools/index.js';
import * as localMcpServerModule from '../tools/local-mcp-server.js';

async function rpc<T>(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  id = 1,
  bearerToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const json = (await response.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? 'RPC error');
  }
  return json.result as T;
}

describe('app-server local tools', () => {
  const serversToStop: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.allSettled(serversToStop.splice(0).map((server) => server.stop()));
  });

  it('tool() validates params and executes handler', async () => {
    const add = tool({
      name: 'add',
      description: 'Add two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a + b }),
    });

    await expect(add.execute({ a: 2, b: 3 })).resolves.toEqual({ result: 5 });
    await expect(add.execute({ a: 2, b: 'x' })).rejects.toBeDefined();
  });

  it('tool() converts richer zod schemas to JSON schema', async () => {
    const advanced = tool({
      name: 'advanced',
      description: 'Advanced schema',
      parameters: z.object({
        name: z.string(),
        tags: z.array(z.string()),
        mode: z.enum(['fast', 'safe']),
        settings: z
          .object({
            retries: z.number().optional(),
            strict: z.boolean().nullable(),
          })
          .optional(),
      }),
      execute: async (params) => params,
    });

    const schema = advanced.inputSchema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties?.name).toBeDefined();
    expect(schema.properties?.tags).toBeDefined();
    expect(schema.properties?.mode).toBeDefined();
    expect(schema.required).toContain('name');
    expect(schema.required).toContain('tags');
    expect(schema.required).toContain('mode');
  });

  it('createLocalMcpServer handles initialize/list/call', async () => {
    const multiply = tool({
      name: 'multiply',
      description: 'Multiply two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ result: a * b }),
    });

    const server = await createLocalMcpServer({
      name: 'math-tools',
      tools: [multiply],
      port: 0,
    });
    serversToStop.push(server);

    const token = server.config.bearerToken;
    expect(typeof token).toBe('string');
    expect(token?.length).toBeGreaterThan(0);

    const initialize = await rpc<{ serverInfo: { name: string } }>(
      server.url,
      'initialize',
      undefined,
      1,
      token,
    );
    expect(initialize.serverInfo.name).toBe('math-tools');

    const list = await rpc<{ tools: Array<{ name: string }> }>(
      server.url,
      'tools/list',
      undefined,
      1,
      token,
    );
    expect(list.tools.some((entry) => entry.name === 'multiply')).toBe(true);

    const call = await rpc<{ content: Array<{ text: string }> }>(
      server.url,
      'tools/call',
      {
        name: 'multiply',
        arguments: { a: 4, b: 5 },
      },
      1,
      token,
    );
    expect(call.content[0]?.text).toContain('20');
  });

  it('createSdkMcpServer starts/stops and passes type guard', async () => {
    const echo = tool({
      name: 'echo',
      description: 'Echo text',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => ({ text }),
    });

    const sdkServer = createSdkMcpServer({ name: 'echo-tools', tools: [echo] });
    expect(isSdkMcpServer(sdkServer)).toBe(true);

    const first = await sdkServer._start();
    const second = await sdkServer._start();
    expect(first.url).toBe(second.url);
    expect(first.bearerToken).toBe(second.bearerToken);
    expect(typeof first.bearerToken).toBe('string');

    await sdkServer._stop();
  });

  it('createSdkMcpServer can recover after a startup failure', async () => {
    const startError = new Error('startup failed');
    const stop = vi.fn(async () => undefined);
    const createSpy = vi
      .spyOn(localMcpServerModule, 'createLocalMcpServer')
      .mockRejectedValueOnce(startError)
      .mockResolvedValueOnce({
        config: {
          transport: 'http',
          url: 'http://127.0.0.1:43210',
          bearerToken: 'fake-token',
        },
        url: 'http://127.0.0.1:43210',
        port: 43210,
        stop,
      });

    try {
      const sdkServer = createSdkMcpServer({ name: 'recoverable-tools', tools: [] });

      await expect(sdkServer._start()).rejects.toThrow('startup failed');
      const recovered = await sdkServer._start();
      expect(recovered.url).toBe('http://127.0.0.1:43210');
      expect(recovered.bearerToken).toBe('fake-token');
      expect(createSpy).toHaveBeenCalledTimes(2);

      await sdkServer._stop();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      createSpy.mockRestore();
    }
  });

  it('createSdkMcpServer waits for in-flight startup during stop and shuts down the started server', async () => {
    const stop = vi.fn(async () => undefined);
    let resolveStart:
      | ((server: Awaited<ReturnType<typeof createLocalMcpServer>>) => void)
      | undefined;
    const createSpy = vi.spyOn(localMcpServerModule, 'createLocalMcpServer').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );

    try {
      const sdkServer = createSdkMcpServer({ name: 'startup-race-tools', tools: [] });
      const startPromise = sdkServer._start();
      expect(createSpy).toHaveBeenCalledTimes(1);

      const stopPromise = sdkServer._stop();
      let stopSettled = false;
      void stopPromise.then(() => {
        stopSettled = true;
      });
      await Promise.resolve();
      expect(stopSettled).toBe(false);

      resolveStart?.({
        config: {
          transport: 'http',
          url: 'http://127.0.0.1:43210',
          bearerToken: 'fake-token',
        },
        url: 'http://127.0.0.1:43210',
        port: 43210,
        stop,
      });

      await expect(startPromise).resolves.toEqual({
        transport: 'http',
        url: 'http://127.0.0.1:43210',
        bearerToken: 'fake-token',
      });
      await stopPromise;
      expect(stop).toHaveBeenCalledTimes(1);
      expect(sdkServer._server).toBeUndefined();
    } finally {
      createSpy.mockRestore();
    }
  });

  it('createLocalMcpServer serializes undefined tool results as valid text', async () => {
    const maybeUndefined = tool({
      name: 'maybe_undefined',
      description: 'Returns undefined',
      parameters: z.object({}),
      execute: async () => undefined,
    });

    const server = await createLocalMcpServer({
      name: 'undefined-tools',
      tools: [maybeUndefined],
      port: 0,
    });
    serversToStop.push(server);
    const token = server.config.bearerToken;

    const call = await rpc<{ content: Array<{ type: string; text: string }> }>(
      server.url,
      'tools/call',
      {
        name: 'maybe_undefined',
        arguments: {},
      },
      1,
      token,
    );

    expect(call.content[0]).toEqual({ type: 'text', text: 'undefined' });
  });

  it('createLocalMcpServer rejects requests without bearer auth', async () => {
    const echo = tool({
      name: 'echo',
      description: 'Echo text',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => ({ text }),
    });

    const server = await createLocalMcpServer({
      name: 'auth-tools',
      tools: [echo],
      port: 0,
    });
    serversToStop.push(server);

    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
  });

  it('createLocalMcpServer rejects non-loopback host unless explicitly allowed', async () => {
    const echo = tool({
      name: 'echo',
      description: 'Echo text',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => ({ text }),
    });

    await expect(
      createLocalMcpServer({
        name: 'host-guard-tools',
        tools: [echo],
        host: '0.0.0.0',
        port: 0,
      }),
    ).rejects.toThrow("Refusing to bind local MCP server to non-loopback host '0.0.0.0'");

    const allowed = await createLocalMcpServer({
      name: 'host-guard-tools-allowed',
      tools: [echo],
      host: '0.0.0.0',
      allowNonLoopbackHost: true,
      port: 0,
    });
    serversToStop.push(allowed);
    expect(allowed.url.startsWith('http://0.0.0.0:')).toBe(true);
  });

  it('createLocalMcpServer brackets IPv6 loopback host in returned URL', async () => {
    const echo = tool({
      name: 'echo',
      description: 'Echo text',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => ({ text }),
    });

    let server: Awaited<ReturnType<typeof createLocalMcpServer>>;
    try {
      server = await createLocalMcpServer({
        name: 'ipv6-tools',
        tools: [echo],
        host: '::1',
        port: 0,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Some environments disable IPv6 loopback binding; skip this integration assertion there.
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') {
        return;
      }
      throw error;
    }

    serversToStop.push(server);
    expect(server.url).toMatch(/^http:\/\/\[::1\]:\d+$/);
    expect(() => new URL(server.url)).not.toThrow();
  });
});
