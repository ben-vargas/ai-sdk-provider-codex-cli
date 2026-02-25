import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import type { TurnStartParams } from '../app-server-protocol-types.js';
import { AppServerLanguageModel } from '../app-server-language-model.js';

class FakeClient extends EventEmitter {
  threadStartCalls: unknown[] = [];
  threadResumeCalls: unknown[] = [];
  turnStartCalls: unknown[] = [];
  turnInterruptCalls: unknown[] = [];

  threadResumeError?: Error;
  turnStartError?: Error;
  turnStartImpl?: (params: TurnStartParams) => Promise<{ turn: { id: string } }>;
  turnInterruptImpl?: (params: { threadId: string; turnId: string }) => Promise<unknown>;
  withThreadLockCalls: string[] = [];
  withThreadLockImpl?: (threadId: string, fn: () => Promise<unknown>) => Promise<unknown>;
  setActiveRequestHandlersCalls: Array<{ threadId: string }> = [];
  clearActiveRequestHandlersCalls: string[] = [];

  async threadStart(params: unknown) {
    this.threadStartCalls.push(params);
    return {
      thread: { id: 'thr_new' },
      model: 'gpt-5.1-codex',
      modelProvider: 'openai',
      cwd: '/tmp',
      approvalPolicy: 'never',
      sandbox: { type: 'workspaceWrite' },
      reasoningEffort: null,
    };
  }

  async threadResume(params: unknown) {
    this.threadResumeCalls.push(params);
    if (this.threadResumeError) throw this.threadResumeError;
    const data = params as { threadId: string };
    return {
      thread: { id: data.threadId },
      model: 'gpt-5.1-codex',
      modelProvider: 'openai',
      cwd: '/tmp',
      approvalPolicy: 'never',
      sandbox: { type: 'workspaceWrite' },
      reasoningEffort: null,
    };
  }

  async turnStart(params: TurnStartParams) {
    this.turnStartCalls.push(params);
    if (this.turnStartError) throw this.turnStartError;
    if (this.turnStartImpl) return await this.turnStartImpl(params);

    setTimeout(() => {
      this.emit('notification', 'item/agentMessage/delta', {
        threadId: params.threadId,
        turnId: 'turn_1',
        itemId: 'item_1',
        delta: 'Hello',
      });
      this.emit('notification', 'turn/completed', {
        threadId: params.threadId,
        turn: { id: 'turn_1', items: [], status: 'completed', error: null },
      });
    }, 5);

    return {
      turn: { id: 'turn_1' },
    };
  }

  async turnInterrupt(params: { threadId: string; turnId: string }) {
    this.turnInterruptCalls.push(params);
    if (this.turnInterruptImpl) return await this.turnInterruptImpl(params);
    return {};
  }

  async withThreadLock(_threadId: string, fn: () => Promise<unknown>) {
    this.withThreadLockCalls.push(_threadId);
    if (this.withThreadLockImpl) {
      return await this.withThreadLockImpl(_threadId, fn);
    }
    return await fn();
  }

  setActiveRequestHandlers(threadId: string) {
    this.setActiveRequestHandlersCalls.push({ threadId });
  }

  clearActiveRequestHandlers(threadId: string) {
    this.clearActiveRequestHandlersCalls.push(threadId);
  }
}

describe('AppServerLanguageModel', () => {
  it('doGenerate returns content and thread metadata in stateless mode', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Say hello' }] as never,
    });

    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.usage.inputTokens.total).toBe(0);
    expect(result.usage.outputTokens.total).toBe(0);
    expect(result.providerMetadata?.['codex-app-server']).toEqual(
      expect.objectContaining({
        threadId: 'thr_new',
        turnId: 'turn_1',
      }),
    );
    expect(client.threadStartCalls).toHaveLength(1);
  });

  it('maps token usage updates in doGenerate', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'thread/tokenUsage/updated', {
          threadId: params.threadId,
          turnId: 'turn_usage_1',
          tokenUsage: {
            total: {
              totalTokens: 120,
              inputTokens: 70,
              cachedInputTokens: 10,
              outputTokens: 50,
              reasoningOutputTokens: 15,
            },
            last: {
              totalTokens: 120,
              inputTokens: 70,
              cachedInputTokens: 10,
              outputTokens: 50,
              reasoningOutputTokens: 15,
            },
            modelContextWindow: null,
          },
        });
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_usage_1',
          item: { type: 'agentMessage', id: 'item_msg_1', text: 'Done', phase: null },
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_usage_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_usage_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'usage please' }] as never,
    });

    expect(result.usage.inputTokens.total).toBe(70);
    expect(result.usage.inputTokens.cacheRead).toBe(10);
    expect(result.usage.inputTokens.noCache).toBe(60);
    expect(result.usage.outputTokens.total).toBe(50);
    expect(result.usage.outputTokens.reasoning).toBe(15);
  });

  it('maps failed turn finish reason for context window exceeded', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: {
            id: 'turn_failed_1',
            items: [],
            status: 'failed',
            error: {
              message: 'Too much context',
              codexErrorInfo: 'contextWindowExceeded',
              additionalDetails: null,
            },
          },
        });
      }, 5);
      return { turn: { id: 'turn_failed_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'fail please' }] as never,
    });

    expect(result.finishReason).toEqual({
      unified: 'length',
      raw: 'context_window_exceeded',
    });
  });

  it('passes sanitized output schema to turn/start', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'schema' }] as never,
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          title: 'Should be stripped',
          properties: {
            email: { type: 'string', format: 'email', pattern: '.+@.+' },
          },
        },
      } as never,
    });

    const params = client.turnStartCalls[0] as TurnStartParams & {
      outputSchema?: {
        title?: string;
        properties?: { email?: { format?: string; pattern?: string } };
      };
    };
    expect(params.outputSchema).toEqual({
      type: 'object',
      properties: { email: { type: 'string' } },
    });
  });

  it('uses thread resume when threadId is provided and only sends last user message', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    await model.doGenerate({
      prompt: [
        { role: 'system', content: 'ignored' },
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'ignored assistant history' },
        { role: 'user', content: 'Second' },
      ] as never,
      providerOptions: { 'codex-app-server': { threadId: 'thr_existing' } },
    });

    expect(client.threadResumeCalls).toHaveLength(1);
    expect((client.threadResumeCalls[0] as { threadId: string }).threadId).toBe('thr_existing');
    const firstInput = ((client.turnStartCalls[0] as TurnStartParams).input[0] as { text?: string })
      .text;
    expect(firstInput).toBe('Second');
  });

  it('doStream emits text deltas and finish', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'Stream please' }] as never,
    });

    const parts: unknown[] = [];
    for await (const part of stream as AsyncIterable<unknown>) {
      parts.push(part);
    }

    expect(
      parts.some((part) => {
        const data = part as { type?: string; delta?: string };
        return data.type === 'text-delta' && data.delta === 'Hello';
      }),
    ).toBe(true);
    expect(
      parts.some((part) => {
        const data = part as { type?: string };
        return data.type === 'finish';
      }),
    ).toBe(true);
    const finish = parts.find((part) => (part as { type?: string }).type === 'finish') as
      | { usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } } }
      | undefined;
    expect(finish?.usage?.inputTokens?.total).toBe(0);
    expect(finish?.usage?.outputTokens?.total).toBe(0);
  });

  it('doStream maps tool events and usage updates', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/started', {
          threadId: params.threadId,
          turnId: 'turn_tool_1',
          item: {
            type: 'commandExecution',
            id: 'item_cmd_1',
            command: 'npm test',
            cwd: '/tmp/project',
            processId: null,
            status: 'inProgress',
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          },
        });
        client.emit('notification', 'thread/tokenUsage/updated', {
          threadId: params.threadId,
          turnId: 'turn_tool_1',
          tokenUsage: {
            total: {
              totalTokens: 25,
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 15,
              reasoningOutputTokens: 4,
            },
            last: {
              totalTokens: 25,
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 15,
              reasoningOutputTokens: 4,
            },
            modelContextWindow: null,
          },
        });
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_tool_1',
          item: {
            type: 'commandExecution',
            id: 'item_cmd_1',
            command: 'npm test',
            cwd: '/tmp/project',
            processId: null,
            status: 'completed',
            commandActions: [],
            aggregatedOutput: 'ok',
            exitCode: 0,
            durationMs: 1,
          },
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_tool_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_tool_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'use tools' }] as never,
    });

    const parts: unknown[] = [];
    for await (const part of stream as AsyncIterable<unknown>) {
      parts.push(part);
    }

    expect(
      parts.some((part) => {
        const data = part as { type?: string; toolName?: string };
        return data.type === 'tool-call' && data.toolName === 'exec';
      }),
    ).toBe(true);
    expect(
      parts.some((part) => {
        const data = part as { type?: string; toolName?: string };
        return data.type === 'tool-result' && data.toolName === 'exec';
      }),
    ).toBe(true);

    const finish = parts.find((part) => (part as { type?: string }).type === 'finish') as
      | {
          usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
          providerMetadata?: {
            'codex-app-server'?: {
              toolExecutionStats?: { totalCalls?: number; byType?: { exec?: number } };
            };
          };
        }
      | undefined;
    expect(finish?.usage?.inputTokens?.total).toBe(10);
    expect(finish?.usage?.outputTokens?.total).toBe(15);
    expect(finish?.providerMetadata?.['codex-app-server']?.toolExecutionStats?.totalCalls).toBe(1);
    expect(finish?.providerMetadata?.['codex-app-server']?.toolExecutionStats?.byType?.exec).toBe(
      1,
    );
  });

  it('doStream maps failed finish reason for usage limit exceeded', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: {
            id: 'turn_failed_stream_1',
            items: [],
            status: 'failed',
            error: {
              message: 'usage capped',
              codexErrorInfo: 'usageLimitExceeded',
              additionalDetails: null,
            },
          },
        });
      }, 5);
      return { turn: { id: 'turn_failed_stream_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'stream fail' }] as never,
    });
    const parts: unknown[] = [];
    for await (const part of stream as AsyncIterable<unknown>) {
      parts.push(part);
    }

    const finish = parts.find((part) => (part as { type?: string }).type === 'finish') as
      | { finishReason?: unknown }
      | undefined;
    expect(finish?.finishReason).toEqual({
      unified: 'length',
      raw: 'usage_limit_exceeded',
    });
  });

  it('emits raw chunks when includeRawChunks is enabled', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/agentMessage/delta', {
          threadId: params.threadId,
          turnId: 'turn_raw_1',
          itemId: 'item_raw_1',
          delta: 'raw text',
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_raw_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_raw_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'raw please' }] as never,
      includeRawChunks: true,
    });

    const parts: unknown[] = [];
    for await (const part of stream as AsyncIterable<unknown>) {
      parts.push(part);
    }

    const rawParts = parts.filter((part) => (part as { type?: string }).type === 'raw') as Array<{
      rawValue?: { method?: string };
    }>;
    expect(rawParts.length).toBeGreaterThan(0);
    expect(rawParts.some((part) => part.rawValue?.method === 'item/agentMessage/delta')).toBe(true);
  });

  it('uses settings includeRawChunks as default when per-call option is absent', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/agentMessage/delta', {
          threadId: params.threadId,
          turnId: 'turn_raw_default_1',
          itemId: 'item_raw_default_1',
          delta: 'raw from defaults',
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_raw_default_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_raw_default_1' } };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
      settings: { includeRawChunks: true },
    });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'raw default please' }] as never,
    });

    const parts: Array<{ type?: string }> = [];
    for await (const part of stream as AsyncIterable<{ type?: string }>) {
      parts.push(part);
    }

    expect(parts.some((part) => part.type === 'raw')).toBe(true);
  });

  it('streams reasoning lifecycle parts from reasoning deltas', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'reasoningTextDelta', {
          threadId: params.threadId,
          turnId: 'turn_reason_1',
          itemId: 'item_reason_1',
          delta: 'Thinking...',
        });
        client.emit('notification', 'reasoningSummaryTextDelta', {
          threadId: params.threadId,
          turnId: 'turn_reason_1',
          itemId: 'item_reason_1',
          delta: 'Summary',
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_reason_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_reason_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'reason please' }] as never,
    });

    const parts: Array<{ type?: string }> = [];
    for await (const part of stream as AsyncIterable<{ type?: string }>) {
      parts.push(part);
    }

    expect(parts.some((part) => part.type === 'reasoning-start')).toBe(true);
    expect(parts.some((part) => part.type === 'reasoning-delta')).toBe(true);
    expect(parts.some((part) => part.type === 'reasoning-end')).toBe(true);
  });

  it('emits tool-approval-request on approval server requests', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit(
          'server-request',
          'item/commandExecution/requestApproval',
          {
            threadId: params.threadId,
            turnId: 'turn_approval_1',
            itemId: 'item_approval_1',
            command: 'npm test',
          },
          101,
        );
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_approval_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_approval_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'approval event' }] as never,
    });

    const parts: unknown[] = [];
    for await (const part of stream as AsyncIterable<unknown>) {
      parts.push(part);
    }

    expect(
      parts.some((part) => {
        const p = part as { type?: string; approvalId?: string };
        return p.type === 'tool-approval-request' && p.approvalId === 'item_approval_1';
      }),
    ).toBe(true);
  });

  it('reuses persistent thread automatically when threadMode is persistent', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });
    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Second' }] as never,
    });

    expect(client.threadStartCalls).toHaveLength(1);
    expect(client.threadResumeCalls).toHaveLength(1);
    expect((client.threadResumeCalls[0] as { threadId: string }).threadId).toBe('thr_new');
  });

  it('recreates stale persistent thread with warning instead of throwing', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });

    client.threadResumeError = new Error('thread not found');
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Second' }] as never,
    });

    expect(client.threadStartCalls).toHaveLength(2);
    expect(
      result.warnings.some(
        (warning) =>
          warning.type === 'other' && /Persistent thread no longer exists/i.test(warning.message),
      ),
    ).toBe(true);
  });

  it('invokes onSessionCreated and supports injectMessage()', async () => {
    const client = new FakeClient();
    let session:
      | {
          threadId: string;
          injectMessage: (content: string) => Promise<void>;
        }
      | undefined;

    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
      settings: {
        onSessionCreated: (created) => {
          session = created as typeof session;
        },
      },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'start' }] as never,
    });

    expect(session?.threadId).toBe('thr_new');
    await session?.injectMessage('follow-up');

    const followUpCall = client.turnStartCalls.find((call) =>
      (call as TurnStartParams).input.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (item as { type?: unknown }).type === 'text' &&
          (item as { text?: unknown }).text === 'follow-up',
      ),
    );
    expect(followUpCall).toBeDefined();
  });

  it('sends remote image URLs directly as image inputs', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });

    await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe remote image' },
            { type: 'image', image: 'https://example.com/cat.png' },
          ],
        },
      ] as never,
    });

    const turnStart = client.turnStartCalls[0] as TurnStartParams;
    expect(turnStart.input.some((item) => item.type === 'image')).toBe(true);
    expect(turnStart.input.some((item) => item.type === 'localImage')).toBe(false);
  });

  it('passes sanitized output schema in doStream turn/start', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'schema stream' }] as never,
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          title: 'remove me',
          properties: { url: { type: 'string', format: 'uri' } },
        },
      } as never,
    });

    for await (const _ of stream as AsyncIterable<unknown>) {
      // drain stream
    }

    const params = client.turnStartCalls[0] as TurnStartParams & {
      outputSchema?: unknown;
    };
    expect(params.outputSchema).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
    });
  });

  it('doGenerate abort sends turn/interrupt and rejects with abort reason', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (_params) => ({ turn: { id: 'turn_abort' } });
    client.turnInterruptImpl = async ({ threadId, turnId }) => {
      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId,
          turn: { id: turnId, items: [], status: 'interrupted', error: null },
        });
      }, 5);
      return {};
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    const ac = new AbortController();
    const reason = new Error('manual abort');
    const promise = model.doGenerate({
      prompt: [{ role: 'user', content: 'abort me' }] as never,
      abortSignal: ac.signal,
    });
    setTimeout(() => ac.abort(reason), 0);

    await expect(promise).rejects.toBe(reason);
    expect(client.turnInterruptCalls).toHaveLength(1);
  });

  it('doStream abort before turn id interrupts once turn id is available', async () => {
    const client = new FakeClient();
    let resolveTurnStart: ((value: { turn: { id: string } }) => void) | undefined;
    client.turnStartImpl = async () =>
      await new Promise<{ turn: { id: string } }>((resolve) => {
        resolveTurnStart = resolve;
      });
    client.turnInterruptImpl = async ({ threadId, turnId }) => {
      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId,
          turn: { id: turnId, items: [], status: 'interrupted', error: null },
        });
      }, 5);
      return {};
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    const ac = new AbortController();
    const reason = new Error('stream abort');
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'stream abort' }] as never,
      abortSignal: ac.signal,
    });

    const reader = stream.getReader();
    await reader.read(); // stream-start
    await reader.read(); // response-metadata

    ac.abort(reason);
    resolveTurnStart?.({ turn: { id: 'turn_late' } });

    await expect(reader.read()).rejects.toBe(reason);
    expect(client.turnInterruptCalls).toHaveLength(1);
  });

  it('serializes concurrent stateful turns through withThreadLock', async () => {
    const client = new FakeClient();
    let lockChain = Promise.resolve();
    client.withThreadLockImpl = async (_threadId, fn) => {
      const run = lockChain.then(fn);
      lockChain = run.then(
        () => undefined,
        () => undefined,
      );
      return await run;
    };

    let activeTurnStarts = 0;
    let maxActiveTurnStarts = 0;
    let counter = 0;
    client.turnStartImpl = async (params) => {
      counter += 1;
      const turnId = `turn_lock_${counter}`;
      activeTurnStarts += 1;
      maxActiveTurnStarts = Math.max(maxActiveTurnStarts, activeTurnStarts);

      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: turnId, items: [], status: 'completed', error: null },
        });
      }, 5);

      await new Promise((resolve) => setTimeout(resolve, 15));
      activeTurnStarts -= 1;
      return { turn: { id: turnId } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    await Promise.all([
      model.doGenerate({
        prompt: [{ role: 'user', content: 'A' }] as never,
        providerOptions: { 'codex-app-server': { threadId: 'thr_lock' } },
      }),
      model.doGenerate({
        prompt: [{ role: 'user', content: 'B' }] as never,
        providerOptions: { 'codex-app-server': { threadId: 'thr_lock' } },
      }),
    ]);

    expect(client.withThreadLockCalls).toEqual(['thr_lock', 'thr_lock']);
    expect(maxActiveTurnStarts).toBe(1);
  });

  it('cleans up temp image files after completion', async () => {
    const client = new FakeClient();
    let capturedImagePath: string | undefined;
    client.turnStartImpl = async (params) => {
      const localImage = params.input.find(
        (item): item is { type: 'localImage'; path: string } =>
          typeof item === 'object' &&
          item !== null &&
          (item as { type?: unknown }).type === 'localImage' &&
          typeof (item as { path?: unknown }).path === 'string',
      );
      capturedImagePath = localImage?.path;

      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_img_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_img_1' } };
    };

    const model = new AppServerLanguageModel({ id: 'gpt-5.1-codex', client: client as never });
    await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe image' },
            { type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        },
      ] as never,
    });

    expect(capturedImagePath).toBeDefined();
    expect(existsSync(capturedImagePath!)).toBe(false);
  });

  it('throws clear stale-thread error when stateful thread resume fails', async () => {
    const client = new FakeClient();
    client.threadResumeError = new Error('thread not found');
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'hello' }] as never,
        providerOptions: { 'codex-app-server': { threadId: 'thr_stale' } },
      }),
    ).rejects.toThrow(
      "Thread 'thr_stale' not found after server restart. Create a new thread by omitting threadId.",
    );
  });

  it('throws clear stale-thread error when stateful turn start fails', async () => {
    const client = new FakeClient();
    client.turnStartError = new Error('thread not found');
    const model = new AppServerLanguageModel({
      id: 'gpt-5.1-codex',
      client: client as never,
    });

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'hello' }] as never,
      providerOptions: { 'codex-app-server': { threadId: 'thr_stale' } },
    });

    const reader = stream.getReader();
    await reader.read(); // stream-start
    await reader.read(); // response-metadata
    await expect(reader.read()).rejects.toThrow(
      "Thread 'thr_stale' not found after server restart. Create a new thread by omitting threadId.",
    );
  });
});
