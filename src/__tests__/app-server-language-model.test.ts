import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import type { TurnStartParams } from '../app-server/protocol/types.js';
import { AppServerLanguageModel } from '../app-server/language-model.js';
import * as imageUtils from '../image-utils.js';
import { SDK_MCP_SERVER_MARKER } from '../tools/sdk-mcp-server.js';

function flush(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeClient extends EventEmitter {
  threadStartCalls: unknown[] = [];
  threadResumeCalls: unknown[] = [];
  turnStartCalls: unknown[] = [];
  turnInterruptCalls: unknown[] = [];

  threadStartImpl?: (params: unknown) => Promise<unknown>;
  threadResumeError?: Error;
  turnStartError?: Error;
  turnStartImpl?: (params: TurnStartParams) => Promise<{ turn: { id: string } }>;
  turnInterruptImpl?: (params: { threadId: string; turnId: string }) => Promise<unknown>;
  withThreadLockCalls: string[] = [];
  withThreadLockImpl?: (threadId: string, fn: () => Promise<unknown>) => Promise<unknown>;
  registerRequestContextCalls: Array<{
    threadId: string;
    context: { handlers: Record<string, unknown>; autoApprove?: boolean };
    contextId: string;
  }> = [];
  bindRequestContextCalls: Array<{ contextId: string; turnId: string }> = [];
  clearRequestContextCalls: string[] = [];
  clearRequestContextForTurnCalls: string[] = [];
  private nextContextId = 1;

  async threadStart(params: unknown) {
    this.threadStartCalls.push(params);
    if (this.threadStartImpl) return await this.threadStartImpl(params);
    return {
      thread: { id: 'thr_new' },
      model: 'gpt-5.3-codex',
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
      model: 'gpt-5.3-codex',
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

  registerRequestContext(
    threadId: string,
    context: { handlers: Record<string, unknown>; autoApprove?: boolean },
  ): string {
    const contextId = `ctx_${this.nextContextId++}`;
    this.registerRequestContextCalls.push({ threadId, context, contextId });
    return contextId;
  }

  bindRequestContext(contextId: string, turnId: string) {
    this.bindRequestContextCalls.push({ contextId, turnId });
  }

  clearRequestContext(contextId: string) {
    this.clearRequestContextCalls.push(contextId);
  }

  clearRequestContextForTurn(turnId: string) {
    this.clearRequestContextForTurnCalls.push(turnId);
  }

  hasTurnCompleted(_turnId: string): boolean {
    return false;
  }
}

describe('AppServerLanguageModel', () => {
  it('doGenerate returns content and thread metadata in stateless mode', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Say hello' }] as never,
    });

    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.usage.inputTokens.total).toBeUndefined();
    expect(result.usage.outputTokens.total).toBeUndefined();
    expect(result.providerMetadata?.['codex-app-server']).toEqual(
      expect.objectContaining({
        threadId: 'thr_new',
        turnId: 'turn_1',
      }),
    );
    expect(client.threadStartCalls).toHaveLength(1);
  });

  it('passes merged autoApprove into active request context', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { autoApprove: false },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Say hello' }] as never,
      providerOptions: { 'codex-app-server': { autoApprove: true } },
    });

    expect(client.registerRequestContextCalls[0]).toEqual({
      threadId: 'thr_new',
      context: { handlers: {}, autoApprove: true },
      contextId: 'ctx_1',
    });
    expect(client.bindRequestContextCalls).toContainEqual({
      contextId: 'ctx_1',
      turnId: 'turn_1',
    });
  });

  it('doGenerate keeps only the final completed text block when multiple are emitted', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_multi_text_1',
          item: {
            type: 'agentMessage',
            id: 'item_progress_1',
            text: '{"status":"progress"}',
            phase: null,
          },
        });
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_multi_text_1',
          item: {
            type: 'agentMessage',
            id: 'item_final_1',
            text: '{"result":"done"}',
            phase: null,
          },
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_multi_text_1', items: [], status: 'completed', error: null },
        });
      }, 5);

      return { turn: { id: 'turn_multi_text_1' } };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Return JSON only' }] as never,
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
        },
      } as never,
    });

    expect(result.content).toEqual([{ type: 'text', text: '{"result":"done"}' }]);
  });

  it('doGenerate includes reasoning, tool calls, and tool results in content', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/started', {
          threadId: params.threadId,
          turnId: 'turn_content_1',
          item: {
            type: 'commandExecution',
            id: 'item_cmd_content_1',
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
        client.emit('notification', 'reasoningTextDelta', {
          threadId: params.threadId,
          turnId: 'turn_content_1',
          itemId: 'item_reason_content_1',
          delta: 'Thinking',
        });
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_content_1',
          item: {
            type: 'commandExecution',
            id: 'item_cmd_content_1',
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
        client.emit('notification', 'item/agentMessage/delta', {
          threadId: params.threadId,
          turnId: 'turn_content_1',
          itemId: 'item_message_content_1',
          delta: 'Done',
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_content_1', items: [], status: 'completed', error: null },
        });
      }, 5);
      return { turn: { id: 'turn_content_1' } };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'use tools and explain' }] as never,
    });

    expect(result.content.map((part) => part.type)).toEqual([
      'tool-call',
      'reasoning',
      'tool-result',
      'text',
    ]);

    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'item_cmd_content_1',
        toolName: 'exec',
      }),
    );
    expect(result.content[1]).toEqual(
      expect.objectContaining({
        type: 'reasoning',
        text: 'Thinking',
      }),
    );
    expect(result.content[2]).toEqual(
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'item_cmd_content_1',
        toolName: 'exec',
      }),
    );
    expect(result.content[3]).toEqual({
      type: 'text',
      text: 'Done',
    });
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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
    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });

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

  it('maps sandbox policy for both thread and turn wire formats', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: {
        sandboxPolicy: { type: 'workspaceWrite' },
      },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'sandbox normalize' }] as never,
    });

    const threadStart = client.threadStartCalls[0] as { sandbox?: unknown };
    const turnStart = client.turnStartCalls[0] as TurnStartParams & {
      sandboxPolicy?: unknown;
    };
    expect(threadStart.sandbox).toBe('workspace-write');
    expect(turnStart.sandboxPolicy).toEqual({ type: 'workspaceWrite' });
  });

  it('maps sandbox policy string to turn sandbox object', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: {
        sandboxPolicy: 'danger-full-access',
      },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'sandbox string mapping' }] as never,
    });

    const threadStart = client.threadStartCalls[0] as { sandbox?: unknown };
    const turnStart = client.turnStartCalls[0] as TurnStartParams & {
      sandboxPolicy?: unknown;
    };
    expect(threadStart.sandbox).toBe('danger-full-access');
    expect(turnStart.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
  });

  it('uses thread resume when threadId is provided and only sends last user message', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const result = await model.doGenerate({
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
    expect(
      result.warnings.some(
        (warning) =>
          warning.type === 'other' &&
          warning.message.includes('Stateful mode ignores earlier prompt messages'),
      ),
    ).toBe(true);
  });

  it('converts mixed stateless transcript parts into turn/start text input', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    await model.doGenerate({
      prompt: [
        { role: 'system', content: 'System A' },
        { role: 'system', content: 'System B' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'User says hi' },
            { type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Thinking' },
            { type: 'tool-call', toolName: 'search', toolCallId: 'call_1', input: { q: 'hello' } },
            {
              type: 'tool-result',
              toolName: 'search',
              toolCallId: 'call_1',
              output: { type: 'text', value: 'world' },
            },
          ],
        },
      ] as never,
    });

    const threadStart = client.threadStartCalls[0] as { developerInstructions?: string };
    const turnStart = client.turnStartCalls[0] as TurnStartParams;
    const promptText = (turnStart.input[0] as { text?: string })?.text ?? '';

    expect(threadStart.developerInstructions).toBe('System A\n\nSystem B');
    expect(promptText).toContain('User: User says hi');
    expect(promptText).toContain('[1 image attached]');
    expect(promptText).toContain('Assistant Reasoning: Thinking');
    expect(promptText).toContain('Tool Call (search): {"q":"hello"}');
    expect(promptText).toContain('Tool Result (search): world');
  });

  it('doStream emits text deltas and finish', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
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
    expect(finish?.usage?.inputTokens?.total).toBeUndefined();
    expect(finish?.usage?.outputTokens?.total).toBeUndefined();
  });

  it('doStream in json mode emits only the final text block', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_json_stream_1',
          item: { type: 'agentMessage', id: 'item_progress', text: '{"status":"progress"}' },
        });
        client.emit('notification', 'item/completed', {
          threadId: params.threadId,
          turnId: 'turn_json_stream_1',
          item: { type: 'agentMessage', id: 'item_final', text: '{"result":"done"}' },
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_json_stream_1', items: [], status: 'completed', error: null },
        });
      }, 5);

      return { turn: { id: 'turn_json_stream_1' } };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'JSON only' }] as never,
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          properties: { result: { type: 'string' } },
        },
      } as never,
    });

    let aggregated = '';
    for await (const part of stream as AsyncIterable<unknown>) {
      if ((part as { type?: string }).type === 'text-delta') {
        aggregated += (part as { delta?: string }).delta ?? '';
      }
    }

    expect(aggregated).toBe('{"result":"done"}');
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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

    const threadStart = client.threadStartCalls[0] as { experimentalRawEvents?: boolean };
    expect(threadStart.experimentalRawEvents).toBe(true);
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
      id: 'gpt-5.3-codex',
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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
      id: 'gpt-5.3-codex',
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

  it('serializes first persistent thread creation across concurrent calls and reapplies thread settings on resume', async () => {
    const client = new FakeClient();
    let createdThreadCounter = 0;
    client.threadStartImpl = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      createdThreadCounter += 1;
      return {
        thread: { id: `thr_created_${createdThreadCounter}` },
        model: 'gpt-5.3-codex',
        modelProvider: 'openai',
        cwd: '/tmp',
        approvalPolicy: 'never',
        sandbox: { type: 'workspaceWrite' },
        reasoningEffort: null,
      };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    const firstPromise = model.doGenerate({
      prompt: [{ role: 'user', content: 'First concurrent' }] as never,
    });
    await flush(1);
    const secondPromise = model.doGenerate({
      prompt: [{ role: 'user', content: 'Second concurrent' }] as never,
      providerOptions: {
        'codex-app-server': {
          configOverrides: { race_token: 'second-call' },
          baseInstructions: 'second-base',
          developerInstructions: 'second-dev',
        },
      },
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(client.threadStartCalls).toHaveLength(1);
    expect(client.threadResumeCalls).toHaveLength(1);
    const resumeCall = client.threadResumeCalls[0] as {
      threadId: string;
      config?: Record<string, unknown>;
      baseInstructions?: string;
      developerInstructions?: string;
    };
    expect(resumeCall.threadId).toBe('thr_created_1');
    expect(resumeCall.config?.race_token).toBe('second-call');
    expect(resumeCall.baseInstructions).toBe('second-base');
    expect(resumeCall.developerInstructions).toBe('second-dev');

    const firstThreadId = (first.providerMetadata?.['codex-app-server'] as { threadId?: string })
      ?.threadId;
    const secondThreadId = (second.providerMetadata?.['codex-app-server'] as { threadId?: string })
      ?.threadId;
    expect(firstThreadId).toBe('thr_created_1');
    expect(secondThreadId).toBe('thr_created_1');
    expect(client.withThreadLockCalls).toEqual(['thr_created_1', 'thr_created_1']);
  });

  it('throws clear stale-thread error when persistent thread resume fails', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });

    client.threadResumeError = new Error('thread not found');
    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Second' }] as never,
      }),
    ).rejects.toThrow(
      "Thread 'thr_new' not found after server restart. Create a new thread by omitting threadId.",
    );
    expect(client.threadStartCalls).toHaveLength(1);
  });

  it('clears cached persistent thread after stale failure so next call can start a fresh thread', async () => {
    const client = new FakeClient();
    let startedThreads = 0;
    client.threadStartImpl = async () => {
      startedThreads += 1;
      return {
        thread: { id: `thr_new_${startedThreads}` },
        model: 'gpt-5.3-codex',
        modelProvider: 'openai',
        cwd: '/tmp',
        approvalPolicy: 'never',
        sandbox: { type: 'workspaceWrite' },
        reasoningEffort: null,
      };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });

    client.threadResumeError = new Error('thread not found');
    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Second' }] as never,
      }),
    ).rejects.toThrow(
      "Thread 'thr_new_1' not found after server restart. Create a new thread by omitting threadId.",
    );

    client.threadResumeError = undefined;
    const recovered = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Third' }] as never,
    });

    expect(client.threadStartCalls).toHaveLength(2);
    expect(client.threadResumeCalls).toHaveLength(1);
    expect(
      (recovered.providerMetadata?.['codex-app-server'] as { threadId?: string } | undefined)
        ?.threadId,
    ).toBe('thr_new_2');
  });

  it('clears cached persistent thread after stale turn-start failure so next call can start a fresh thread', async () => {
    const client = new FakeClient();
    let startedThreads = 0;
    client.threadStartImpl = async () => {
      startedThreads += 1;
      return {
        thread: { id: `thr_new_${startedThreads}` },
        model: 'gpt-5.3-codex',
        modelProvider: 'openai',
        cwd: '/tmp',
        approvalPolicy: 'never',
        sandbox: { type: 'workspaceWrite' },
        reasoningEffort: null,
      };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });

    client.turnStartError = new Error('thread not found');
    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Second' }] as never,
      }),
    ).rejects.toThrow(
      "Thread 'thr_new_1' not found after server restart. Create a new thread by omitting threadId.",
    );

    client.turnStartError = undefined;
    const recovered = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Third' }] as never,
    });

    expect(client.threadStartCalls).toHaveLength(2);
    expect(client.threadResumeCalls).toHaveLength(1);
    expect(
      (recovered.providerMetadata?.['codex-app-server'] as { threadId?: string } | undefined)
        ?.threadId,
    ).toBe('thr_new_2');
  });

  it('fails fast for concurrent stale persistent-thread resumes without creating replacement threads', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { threadMode: 'persistent' },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });

    client.threadResumeError = new Error('thread not found');
    const [first, second] = await Promise.allSettled([
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Second' }] as never,
      }),
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Third' }] as never,
      }),
    ]);

    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
    if (first.status === 'rejected') {
      expect(String(first.reason)).toContain("Thread 'thr_new' not found");
    }
    if (second.status === 'rejected') {
      expect(String(second.reason)).toContain("Thread 'thr_new' not found");
    }
    expect(client.threadStartCalls).toHaveLength(1);
    expect(client.threadResumeCalls).toHaveLength(2);
  });

  it('releases request-scoped SDK MCP servers after a stateless turn completes', async () => {
    const client = new FakeClient();
    const sdkServer = {
      [SDK_MCP_SERVER_MARKER]: true as const,
      name: 'math-tools',
      tools: [],
      _start: vi.fn(async () => ({ transport: 'http', url: 'http://127.0.0.1:43210' })),
      _stop: vi.fn(async () => undefined),
    };
    const onUsed = vi.fn();
    const onReleased = vi.fn();

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: {
        mcpServers: {
          math: sdkServer as never,
        },
      },
      onSdkMcpServerUsed: onUsed,
      onSdkMcpServerReleased: onReleased,
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Use tool if needed and say hello' }] as never,
    });

    expect(sdkServer._start).toHaveBeenCalledTimes(1);
    expect(onUsed).toHaveBeenCalledWith(sdkServer, 'request');
    expect(onReleased).toHaveBeenCalledWith(sdkServer);
  });

  it('releases already-started request-scoped SDK MCP servers when resolveConfig fails', async () => {
    const client = new FakeClient();
    const startedServer = {
      [SDK_MCP_SERVER_MARKER]: true as const,
      name: 'started-tools',
      tools: [],
      _start: vi.fn(async () => ({ transport: 'http', url: 'http://127.0.0.1:43210' })),
      _stop: vi.fn(async () => undefined),
    };
    const failingServer = {
      [SDK_MCP_SERVER_MARKER]: true as const,
      name: 'failing-tools',
      tools: [],
      _start: vi.fn(async () => {
        throw new Error('failed to start second server');
      }),
      _stop: vi.fn(async () => undefined),
    };
    const onUsed = vi.fn();
    const onReleased = vi.fn();

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: {
        mcpServers: {
          first: startedServer as never,
          second: failingServer as never,
        },
      },
      onSdkMcpServerUsed: onUsed,
      onSdkMcpServerReleased: onReleased,
    });

    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Say hello' }] as never,
      }),
    ).rejects.toThrow('failed to start second server');

    expect(startedServer._start).toHaveBeenCalledTimes(1);
    expect(failingServer._start).toHaveBeenCalledTimes(1);
    expect(onUsed).toHaveBeenCalledTimes(1);
    expect(onUsed).toHaveBeenCalledWith(startedServer, 'request');
    expect(onReleased).toHaveBeenCalledTimes(1);
    expect(onReleased).toHaveBeenCalledWith(startedServer);
    expect(client.threadStartCalls).toHaveLength(0);
  });

  it('keeps provider-scoped SDK MCP servers running in persistent mode', async () => {
    const client = new FakeClient();
    const sdkServer = {
      [SDK_MCP_SERVER_MARKER]: true as const,
      name: 'math-tools',
      tools: [],
      _start: vi.fn(async () => ({ transport: 'http', url: 'http://127.0.0.1:43210' })),
      _stop: vi.fn(async () => undefined),
    };
    const onUsed = vi.fn();
    const onReleased = vi.fn();

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: {
        threadMode: 'persistent',
        mcpServers: {
          math: sdkServer as never,
        },
      },
      onSdkMcpServerUsed: onUsed,
      onSdkMcpServerReleased: onReleased,
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'Say hello' }] as never,
    });

    expect(sdkServer._start).toHaveBeenCalledTimes(1);
    expect(onUsed).toHaveBeenCalledWith(sdkServer, 'provider');
    expect(onReleased).not.toHaveBeenCalled();
  });

  it('warns when includeRawChunks is requested while resuming a persistent thread without raw-event negotiation', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: { threadMode: 'persistent', includeRawChunks: false },
    });

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'First' }] as never,
    });

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: 'Second' }] as never,
      includeRawChunks: true,
    });

    expect(
      result.warnings.some(
        (warning) =>
          warning.type === 'other' &&
          warning.message.includes('includeRawChunks was requested while resuming an existing'),
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
      id: 'gpt-5.3-codex',
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

  it('retries persistent session creation after callback failure and cleans temp images', async () => {
    const client = new FakeClient();
    let onSessionCreatedCalls = 0;
    const cleanupSpy = vi.spyOn(imageUtils, 'cleanupTempImages');

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
      settings: {
        threadMode: 'persistent',
        onSessionCreated: async () => {
          onSessionCreatedCalls += 1;
          if (onSessionCreatedCalls === 1) {
            throw new Error('session setup failed');
          }
        },
      },
    });

    await expect(
      model.doGenerate({
        prompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe image' },
              { type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=' },
            ],
          },
        ] as never,
      }),
    ).rejects.toThrow('session setup failed');

    expect(cleanupSpy).toHaveBeenCalled();
    const firstCleanupArg = cleanupSpy.mock.calls[0]?.[0] as unknown[] | undefined;
    expect(Array.isArray(firstCleanupArg)).toBe(true);
    expect(firstCleanupArg?.length ?? 0).toBeGreaterThan(0);

    await model.doGenerate({
      prompt: [{ role: 'user', content: 'retry setup' }] as never,
    });
    expect(onSessionCreatedCalls).toBe(2);

    cleanupSpy.mockRestore();
  });

  it('sends remote image URLs directly as image inputs', async () => {
    const client = new FakeClient();
    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });

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
    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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
      id: 'gpt-5.3-codex',
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

  it('doGenerate with pre-aborted signal rejects before turn/start', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async () => ({ turn: { id: 'turn_should_not_start' } });

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const ac = new AbortController();
    const reason = new Error('already aborted');
    ac.abort(reason);

    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'abort immediately' }] as never,
        abortSignal: ac.signal,
      }),
    ).rejects.toBe(reason);

    expect(client.turnStartCalls).toHaveLength(0);
    expect(client.turnInterruptCalls).toHaveLength(0);
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
      id: 'gpt-5.3-codex',
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

  it('doStream cancellation interrupts active turn and does not throw', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async (params) => {
      setTimeout(() => {
        client.emit('notification', 'item/agentMessage/delta', {
          threadId: params.threadId,
          turnId: 'turn_cancel_1',
          itemId: 'item_cancel_1',
          delta: 'in-flight',
        });
        client.emit('notification', 'turn/completed', {
          threadId: params.threadId,
          turn: { id: 'turn_cancel_1', items: [], status: 'interrupted', error: null },
        });
      }, 10);
      return { turn: { id: 'turn_cancel_1' } };
    };

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'cancel me' }] as never,
    });

    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    await expect(reader.cancel('user canceled')).resolves.toBeUndefined();
    await flush();

    expect(client.turnInterruptCalls).toHaveLength(1);
  });

  it('doStream cancellation before turn id interrupts once turn id is available', async () => {
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
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'cancel before turn id' }] as never,
    });

    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    const cancelPromise = reader.cancel('cancel now');
    resolveTurnStart?.({ turn: { id: 'turn_cancel_late' } });
    await cancelPromise;
    await flush();

    expect(client.turnInterruptCalls).toHaveLength(1);
  });

  it('doStream cancellation before turn id cleans up request context immediately', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async () =>
      await new Promise<{ turn: { id: string } }>(() => {
        // Intentionally never resolves to simulate a stuck turn/start request.
      });

    const model = new AppServerLanguageModel({
      id: 'gpt-5.3-codex',
      client: client as never,
    });

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'cancel pending turn start' }] as never,
    });

    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    await expect(reader.cancel('cancel now')).resolves.toBeUndefined();
    await flush();

    expect(client.clearRequestContextCalls).toHaveLength(1);
    expect(client.turnInterruptCalls).toHaveLength(0);
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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

    const model = new AppServerLanguageModel({ id: 'gpt-5.3-codex', client: client as never });
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
      id: 'gpt-5.3-codex',
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
      id: 'gpt-5.3-codex',
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
