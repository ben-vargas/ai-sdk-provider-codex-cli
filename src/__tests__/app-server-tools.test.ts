import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLocalMcpServer, createSdkMcpServer, isSdkMcpServer, tool } from '../tools/index.js';

async function rpc<T>(
  url: string,
  method: string,
  params?: Record<string, unknown>,
  id = 1,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

    const initialize = await rpc<{ serverInfo: { name: string } }>(server.url, 'initialize');
    expect(initialize.serverInfo.name).toBe('math-tools');

    const list = await rpc<{ tools: Array<{ name: string }> }>(server.url, 'tools/list');
    expect(list.tools.some((entry) => entry.name === 'multiply')).toBe(true);

    const call = await rpc<{ content: Array<{ text: string }> }>(server.url, 'tools/call', {
      name: 'multiply',
      arguments: { a: 4, b: 5 },
    });
    expect(call.content[0].text).toContain('20');
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

    await sdkServer._stop();
  });
});
