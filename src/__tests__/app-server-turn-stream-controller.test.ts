import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { TurnStreamController } from '../app-server/stream/turn-stream-controller.js';
import type { TurnStartParams } from '../app-server/protocol/types.js';

function flush(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeClient extends EventEmitter {
  turnStartCalls: TurnStartParams[] = [];
  turnInterruptCalls: Array<{ threadId: string; turnId: string }> = [];
  registerRequestContextCalls: Array<{ threadId: string; contextId: string }> = [];
  bindRequestContextCalls: Array<{ contextId: string; turnId: string }> = [];
  clearRequestContextCalls: string[] = [];
  clearRequestContextForTurnCalls: string[] = [];

  turnStartImpl: (params: TurnStartParams) => Promise<{ turn: { id: string } }> = async () => ({
    turn: { id: 'turn_default' },
  });

  turnInterruptImpl: (params: { threadId: string; turnId: string }) => Promise<unknown> = async ({
    threadId,
    turnId,
  }) => {
    setTimeout(() => {
      this.emit('notification', 'turn/completed', {
        threadId,
        turn: { id: turnId, items: [], status: 'interrupted', error: null },
      });
    }, 0);
    return {};
  };

  async withThreadLock<T>(_threadId: string, fn: () => Promise<T>): Promise<T> {
    return await fn();
  }

  registerRequestContext(
    threadId: string,
    _context: {
      handlers: Record<string, unknown>;
      autoApprove?: boolean;
    },
  ): string {
    const contextId = `ctx_${this.registerRequestContextCalls.length + 1}`;
    this.registerRequestContextCalls.push({ threadId, contextId });
    return contextId;
  }

  bindRequestContext(contextId: string, turnId: string): void {
    this.bindRequestContextCalls.push({ contextId, turnId });
  }

  clearRequestContext(contextId: string): void {
    this.clearRequestContextCalls.push(contextId);
  }

  clearRequestContextForTurn(turnId: string): void {
    this.clearRequestContextForTurnCalls.push(turnId);
  }

  async turnStart(params: TurnStartParams): Promise<{ turn: { id: string } }> {
    this.turnStartCalls.push(params);
    return await this.turnStartImpl(params);
  }

  async turnInterrupt(params: { threadId: string; turnId: string }): Promise<unknown> {
    this.turnInterruptCalls.push(params);
    return await this.turnInterruptImpl(params);
  }
}

function createCapture() {
  const parts: LanguageModelV3StreamPart[] = [];
  const controller = {
    enqueue: (part: LanguageModelV3StreamPart) => parts.push(part),
    close: vi.fn(),
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController<LanguageModelV3StreamPart>;

  return { parts, controller };
}

function createController(
  options: {
    client?: FakeClient;
    abortSignal?: AbortSignal;
    shouldSerializeTurnStart?: boolean;
    releaseResources?: () => void;
  } = {},
) {
  const client = options.client ?? new FakeClient();
  const releaseResources = options.releaseResources ?? vi.fn();

  return {
    controller: new TurnStreamController({
      client: client as never,
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      warnings: [],
      includeRawChunks: false,
      jsonModeLastTextBlockOnly: false,
      turnStartParams: {
        threadId: 'thr_1',
        input: [{ type: 'text', text: 'hello', text_elements: [] }],
        model: 'gpt-5.3-codex',
      },
      requestHandlers: {},
      autoApprove: false,
      abortSignal: options.abortSignal,
      shouldSerializeTurnStart: options.shouldSerializeTurnStart ?? false,
      hadInitialThreadId: false,
      threadResolution: { persistent: false, explicit: false },
      releaseResources,
      clearPersistentThreadState: () => undefined,
    }),
    client,
    releaseResources,
  };
}

describe('TurnStreamController', () => {
  it('created + cancel transitions to closed and does not start a turn', async () => {
    const { controller, client, releaseResources } = createController();

    await controller.cancel('cancelled-before-start');
    await controller.start(createCapture().controller);

    expect(client.turnStartCalls).toHaveLength(0);
    expect(releaseResources).toHaveBeenCalledTimes(1);
    expect((controller as unknown as { state: string }).state).toBe('closed');
  });

  it('running + turn completed transitions through finishing to closed', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async () => {
      setTimeout(() => {
        client.emit('notification', 'turn/completed', {
          threadId: 'thr_1',
          turn: { id: 'turn_done', items: [], status: 'completed', error: null },
        });
      }, 0);
      return { turn: { id: 'turn_done' } };
    };

    const releaseResources = vi.fn();
    const { controller } = createController({ client, releaseResources });
    await controller.start(createCapture().controller);

    expect(releaseResources).toHaveBeenCalledTimes(1);
    expect((controller as unknown as { state: string }).state).toBe('closed');
  });

  it('running + cancel transitions to interrupting and then closed', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async () => ({ turn: { id: 'turn_cancel' } });

    const releaseResources = vi.fn();
    const { controller } = createController({ client, releaseResources });
    const startPromise = controller.start(createCapture().controller);

    await flush();
    await controller.cancel('cancel-now');
    await startPromise;

    expect(client.turnInterruptCalls).toHaveLength(1);
    expect(releaseResources).toHaveBeenCalledTimes(1);
    expect((controller as unknown as { state: string }).state).toBe('closed');
  });

  it('running + abort transitions to errored and releases resources', async () => {
    const client = new FakeClient();
    client.turnStartImpl = async () => ({ turn: { id: 'turn_abort' } });

    const abortController = new AbortController();
    const releaseResources = vi.fn();
    const { controller } = createController({
      client,
      abortSignal: abortController.signal,
      releaseResources,
    });

    const startPromise = controller.start(createCapture().controller);
    await flush();
    abortController.abort(new Error('abort-now'));
    await startPromise;

    expect(client.turnInterruptCalls).toHaveLength(1);
    expect(releaseResources).toHaveBeenCalledTimes(1);
    expect((controller as unknown as { state: string }).state).toBe('errored');
  });

  it('cancel() uses state dispatch for terminal and interrupting states', async () => {
    const { controller, client } = createController();

    const terminalStates = ['closed', 'errored', 'finishing'] as const;
    for (const state of terminalStates) {
      (controller as unknown as { state: string }).state = state;
      await controller.cancel(`cancel-${state}`);
      expect(client.turnInterruptCalls).toHaveLength(0);
    }

    let awaited = false;
    (controller as unknown as { state: string }).state = 'interrupting';
    (controller as unknown as { cancelWaitPromise?: Promise<void> }).cancelWaitPromise =
      Promise.resolve().then(() => {
        awaited = true;
      });
    await controller.cancel('cancel-interrupting');
    expect(awaited).toBe(true);
    expect(client.turnInterruptCalls).toHaveLength(0);
  });
});
