import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';
import { AppServerStreamEmitter } from '../app-server/stream/emitter.js';
import { AppServerNotificationRouter } from '../app-server/stream/router.js';

class FakeClient extends EventEmitter {}

function createCapture() {
  const parts: LanguageModelV4StreamPart[] = [];
  const controller = {
    enqueue: (part: LanguageModelV4StreamPart) => parts.push(part),
    close: vi.fn(),
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController<LanguageModelV4StreamPart>;

  return { parts, controller };
}

describe('AppServerNotificationRouter', () => {
  it('routes reasoning deltas, approvals, usage, and turn completion', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      includeRawChunks: true,
    });

    let usage: LanguageModelV4Usage | undefined;
    let completedTurnId: string | undefined;
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_1',
      onUsage: (nextUsage) => {
        usage = nextUsage;
      },
      onTurnCompleted: (turn) => {
        completedTurnId = turn.id;
      },
      onError: () => {
        throw new Error('unexpected error callback');
      },
    });

    router.setTurnId('turn_1');
    router.subscribe();

    client.emit('notification', 'reasoningTextDelta', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_reason_1',
      delta: 'thinking',
    });

    client.emit(
      'server-request',
      'item/commandExecution/requestApproval',
      {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_approval_1',
        command: 'npm test',
      },
      1,
    );

    client.emit('notification', 'thread/tokenUsage/updated', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      tokenUsage: {
        total: {
          totalTokens: 20,
          inputTokens: 7,
          cachedInputTokens: 1,
          outputTokens: 13,
          reasoningOutputTokens: 3,
        },
        last: {
          totalTokens: 20,
          inputTokens: 7,
          cachedInputTokens: 1,
          outputTokens: 13,
          reasoningOutputTokens: 3,
        },
        modelContextWindow: null,
      },
    });

    client.emit('notification', 'turn/completed', {
      threadId: 'thr_1',
      turn: { id: 'turn_1', items: [], status: 'completed', error: null },
    });

    router.unsubscribe();

    expect(parts.some((part) => part.type === 'reasoning-delta')).toBe(true);
    expect(
      parts.some(
        (part) => part.type === 'tool-approval-request' && part.approvalId === 'item_approval_1',
      ),
    ).toBe(true);
    expect(parts.some((part) => part.type === 'raw')).toBe(true);
    expect(usage?.inputTokens.total).toBe(7);
    expect(completedTurnId).toBe('turn_1');
  });

  it('normalizes tool item casing variants consistently', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_case',
    });

    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_case',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError: () => undefined,
    });

    router.setTurnId('turn_case_1');
    router.subscribe();

    client.emit('notification', 'item/started', {
      threadId: 'thr_case',
      turnId: 'turn_case_1',
      item: {
        type: 'CommandExecution',
        id: 'item_case_1',
        command: 'npm test',
        cwd: '/tmp',
      },
    });
    client.emit('notification', 'item/completed', {
      threadId: 'thr_case',
      turnId: 'turn_case_1',
      item: {
        type: 'CommandExecution',
        id: 'item_case_1',
        status: 'completed',
      },
    });

    router.unsubscribe();

    expect(
      parts.some(
        (part) => part.type === 'tool-call' && (part as { toolName?: string }).toolName === 'exec',
      ),
    ).toBe(true);
    expect(
      parts.some(
        (part) =>
          part.type === 'tool-result' && (part as { toolName?: string }).toolName === 'exec',
      ),
    ).toBe(true);
  });

  it('emits output deltas and filters events from other threads', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_output',
    });

    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_output',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError: () => undefined,
    });

    router.setTurnId('turn_output_1');
    router.subscribe();

    client.emit('notification', 'item/commandExecution/outputDelta', {
      threadId: 'thr_output',
      turnId: 'turn_output_1',
      itemId: 'item_output_1',
      delta: 'hello',
    });
    client.emit('notification', 'item/commandExecution/outputDelta', {
      threadId: 'thr_other',
      turnId: 'turn_output_1',
      itemId: 'item_output_ignored',
      delta: 'ignore-me',
    });

    router.unsubscribe();

    const outputDeltaResults = parts.filter(
      (part) =>
        part.type === 'tool-result' &&
        (part as { result?: { type?: string } }).result?.type === 'output-delta',
    );
    expect(outputDeltaResults).toHaveLength(1);
    expect((outputDeltaResults[0] as { result?: { delta?: string } }).result?.delta).toBe('hello');
  });

  it('buffers turn-scoped events until turnId is bound and drops other-turn buffered events', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_bind',
    });

    let completedTurnId: string | undefined;
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_bind',
      onUsage: () => undefined,
      onTurnCompleted: (turn) => {
        completedTurnId = turn.id;
      },
      onError: () => undefined,
    });

    router.subscribe();

    client.emit('notification', 'item/agentMessage/delta', {
      threadId: 'thr_bind',
      turnId: 'turn_other',
      itemId: 'item_other',
      delta: 'other turn text',
    });
    client.emit('notification', 'item/agentMessage/delta', {
      threadId: 'thr_bind',
      turnId: 'turn_target',
      itemId: 'item_target_early',
      delta: 'early text',
    });
    client.emit('notification', 'turn/completed', {
      threadId: 'thr_bind',
      turn: { id: 'turn_other', items: [], status: 'completed', error: null },
    });
    client.emit('notification', 'turn/completed', {
      threadId: 'thr_bind',
      turn: { id: 'turn_target', items: [], status: 'completed', error: null },
    });

    expect(parts.some((part) => part.type === 'text-delta')).toBe(false);
    expect(completedTurnId).toBeUndefined();

    router.setTurnId('turn_target');

    const textDeltasAfterBind = parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => (part as { delta?: string }).delta);
    expect(textDeltasAfterBind).toEqual(['early text']);
    expect(completedTurnId).toBe('turn_target');

    client.emit('notification', 'item/agentMessage/delta', {
      threadId: 'thr_bind',
      turnId: 'turn_target',
      itemId: 'item_target_late',
      delta: 'late text',
    });
    client.emit('notification', 'turn/completed', {
      threadId: 'thr_bind',
      turn: { id: 'turn_target', items: [], status: 'completed', error: null },
    });

    const finalTextDeltas = parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => (part as { delta?: string }).delta);
    expect(finalTextDeltas).toEqual(['early text', 'late text']);

    router.unsubscribe();
  });

  it('does not buffer pre-bind turn-scoped events from other threads', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_target',
      includeRawChunks: true,
    });

    let completedTurnId: string | undefined;
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_target',
      onUsage: () => undefined,
      onTurnCompleted: (turn) => {
        completedTurnId = turn.id;
      },
      onError: () => undefined,
    });

    router.subscribe();

    client.emit('notification', 'item/agentMessage/delta', {
      threadId: 'thr_other',
      turnId: 'turn_1',
      itemId: 'item_other',
      delta: 'other-thread text',
    });
    client.emit('notification', 'turn/completed', {
      threadId: 'thr_other',
      turn: { id: 'turn_1', items: [], status: 'completed', error: null },
    });

    router.setTurnId('turn_1');

    expect(parts.some((part) => part.type === 'text-delta')).toBe(false);
    expect(parts.some((part) => part.type === 'raw')).toBe(false);
    expect(completedTurnId).toBeUndefined();

    router.unsubscribe();
  });

  it('ignores threadless notifications to avoid cross-router fan-out', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_target',
      includeRawChunks: true,
    });

    const onError = vi.fn();
    const onTurnCompleted = vi.fn();
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_target',
      onUsage: () => undefined,
      onTurnCompleted,
      onError,
    });

    router.setTurnId('turn_target');
    router.subscribe();

    client.emit('notification', 'item/agentMessage/delta', {
      turnId: 'turn_target',
      itemId: 'item_1',
      delta: 'should-be-ignored',
    });
    client.emit('notification', 'turn/completed', {
      turn: { id: 'turn_target', items: [], status: 'completed', error: null },
    });
    client.emit('notification', 'error', {
      turnId: 'turn_target',
      willRetry: false,
      error: { message: 'should-not-fire' },
    });

    expect(parts.some((part) => part.type === 'text-delta')).toBe(false);
    expect(parts.some((part) => part.type === 'raw')).toBe(false);
    expect(onTurnCompleted).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    router.unsubscribe();
  });

  it('ignores token usage updates for other turns when turnId is bound', () => {
    const client = new FakeClient();
    const { controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_usage',
    });

    let usage: LanguageModelV4Usage | undefined;
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_usage',
      onUsage: (nextUsage) => {
        usage = nextUsage;
      },
      onTurnCompleted: () => undefined,
      onError: () => undefined,
    });

    router.setTurnId('turn_target');
    router.subscribe();

    client.emit('notification', 'thread/tokenUsage/updated', {
      threadId: 'thr_usage',
      turnId: 'turn_other',
      tokenUsage: {
        last: {
          totalTokens: 10,
          inputTokens: 6,
          cachedInputTokens: 1,
          outputTokens: 4,
          reasoningOutputTokens: 2,
        },
      },
    });
    expect(usage).toBeUndefined();

    client.emit('notification', 'thread/tokenUsage/updated', {
      threadId: 'thr_usage',
      turnId: 'turn_target',
      tokenUsage: {
        last: {
          totalTokens: 20,
          inputTokens: 12,
          cachedInputTokens: 3,
          outputTokens: 8,
          reasoningOutputTokens: 5,
        },
      },
    });

    expect(usage?.inputTokens.total).toBe(12);
    expect(usage?.outputTokens.total).toBe(8);
    expect(usage?.outputTokens.reasoning).toBe(5);

    router.unsubscribe();
  });

  describe('token usage increments', () => {
    type Breakdown = {
      totalTokens: number;
      inputTokens: number;
      cachedInputTokens: number;
      cacheWriteInputTokens?: number;
      outputTokens: number;
      reasoningOutputTokens: number;
    };

    const breakdown = (
      inputTokens: number,
      cachedInputTokens: number,
      outputTokens: number,
      extra: Partial<Breakdown> = {},
    ): Breakdown => ({
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens: 0,
      ...extra,
    });

    function setup(baseline?: Breakdown) {
      const client = new FakeClient() as FakeClient & {
        getTokenUsageTotalBeforeTurn?: (threadId: string, turnId: string) => Breakdown | undefined;
      };
      const baselineCalls: Array<[string, string]> = [];
      if (baseline) {
        client.getTokenUsageTotalBeforeTurn = (threadId, turnId) => {
          baselineCalls.push([threadId, turnId]);
          return baseline;
        };
      }
      const { controller } = createCapture();
      const emitter = new AppServerStreamEmitter(controller, {
        modelId: 'gpt-5.3-codex',
        threadId: 'thr_inc',
      });
      const received: LanguageModelV4Usage[] = [];
      const router = new AppServerNotificationRouter({
        client: client as never,
        emitter,
        threadId: 'thr_inc',
        onUsage: (nextUsage) => {
          received.push(nextUsage);
        },
        onTurnCompleted: () => undefined,
        onError: () => undefined,
      });
      router.setTurnId('turn_inc');
      router.subscribe();
      const update = (total: Breakdown, last: Breakdown) =>
        client.emit('notification', 'thread/tokenUsage/updated', {
          threadId: 'thr_inc',
          turnId: 'turn_inc',
          tokenUsage: { total, last, modelContextWindow: null },
        });
      return { router, received, update, baselineCalls };
    }

    it('maps cacheWriteInputTokens when reported and leaves it undefined when absent', () => {
      const withCacheWrite = setup();
      const first = breakdown(100, 60, 10, { cacheWriteInputTokens: 30 });
      withCacheWrite.update(first, first);
      expect(withCacheWrite.received[0]?.inputTokens).toEqual({
        total: 100,
        noCache: 10,
        cacheRead: 60,
        cacheWrite: 30,
      });
      withCacheWrite.router.unsubscribe();

      const withoutCacheWrite = setup();
      const plain = breakdown(100, 60, 10);
      withoutCacheWrite.update(plain, plain);
      expect(withoutCacheWrite.received[0]?.inputTokens).toEqual({
        total: 100,
        noCache: 40,
        cacheRead: 60,
        cacheWrite: undefined,
      });
      withoutCacheWrite.router.unsubscribe();
    });

    it('counts distinct responses with identical breakdowns', () => {
      const { router, received, update } = setup();
      const response = breakdown(100, 50, 10);
      update(breakdown(100, 50, 10), response);
      update(breakdown(200, 100, 20), response);
      expect(received.map((usage) => usage.inputTokens.total)).toEqual([100, 100]);
      router.unsubscribe();
    });

    it('ignores re-emitted snapshots that add no new usage', () => {
      // e.g. rate limits arrive, then the response stream fails and is retried.
      const { router, received, update } = setup();
      const response = breakdown(100, 50, 10);
      update(breakdown(100, 50, 10), response);
      update(breakdown(100, 50, 10), response);
      update(breakdown(250, 150, 30), breakdown(150, 100, 20));
      expect(received.map((usage) => usage.inputTokens.total)).toEqual([100, 150]);
      expect(received.map((usage) => usage.outputTokens.total)).toEqual([10, 20]);
      router.unsubscribe();
    });

    it('ignores compaction estimates that carry no input or output tokens', () => {
      const { router, received, update } = setup();
      update(breakdown(100, 50, 10), breakdown(100, 50, 10));
      update(breakdown(100, 50, 10), {
        totalTokens: 42,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      });
      expect(received).toHaveLength(1);
      expect(received[0]?.raw).toMatchObject({ totalTokens: 110 });
      router.unsubscribe();
    });

    it('ignores a compaction estimate reported before any response', () => {
      const { router, received, update } = setup();
      update(breakdown(0, 0, 0, { totalTokens: 5000 }), breakdown(0, 0, 0, { totalTokens: 5000 }));
      expect(received).toHaveLength(0);
      router.unsubscribe();
    });

    it('recovers after Codex resets the cumulative total to fill the context window', () => {
      const { router, received, update } = setup();
      update(breakdown(100, 50, 10), breakdown(100, 50, 10));
      const filled = { ...breakdown(0, 0, 0), totalTokens: 258_400 };
      update(filled, { ...breakdown(0, 0, 0), totalTokens: 258_290 });
      update({ ...breakdown(80, 40, 5), totalTokens: 258_485 }, breakdown(80, 40, 5));
      expect(received.map((usage) => usage.inputTokens.total)).toEqual([100, 80]);
      router.unsubscribe();
    });

    it('measures a resumed turn against the thread total from before the turn', () => {
      const previousTurnTotal = breakdown(1000, 800, 50);
      const { router, received, update, baselineCalls } = setup(previousTurnTotal);
      // Stale snapshot re-emitted under the new turn id before its first response completes.
      update(previousTurnTotal, breakdown(400, 300, 20));
      update(breakdown(1150, 900, 70), breakdown(150, 100, 20));
      expect(baselineCalls).toEqual([['thr_inc', 'turn_inc']]);
      expect(received).toHaveLength(1);
      expect(received[0]?.inputTokens).toEqual({
        total: 150,
        noCache: 50,
        cacheRead: 100,
        cacheWrite: undefined,
      });
      expect(received[0]?.outputTokens.total).toBe(20);
      router.unsubscribe();
    });
  });

  it('routes error notifications for the active turn only', () => {
    const client = new FakeClient();
    const { controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_error',
    });

    const onError = vi.fn();
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_error',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError,
    });

    router.setTurnId('turn_target');
    router.subscribe();

    client.emit('notification', 'error', {
      threadId: 'thr_error',
      turnId: 'turn_other',
      willRetry: false,
      error: { message: 'ignore this' },
    });
    client.emit('notification', 'error', {
      threadId: 'thr_error',
      turnId: 'turn_target',
      willRetry: false,
      error: { message: 'expected failure' },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'expected failure' }));

    router.unsubscribe();
  });

  it('ignores retriable error notifications for the active turn', () => {
    const client = new FakeClient();
    const { controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_error_retry',
    });

    const onError = vi.fn();
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_error_retry',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError,
    });

    router.setTurnId('turn_target');
    router.subscribe();

    client.emit('notification', 'error', {
      threadId: 'thr_error_retry',
      turnId: 'turn_target',
      willRetry: true,
      error: { message: 'transient failure' },
    });
    expect(onError).not.toHaveBeenCalled();

    client.emit('notification', 'error', {
      threadId: 'thr_error_retry',
      turnId: 'turn_target',
      willRetry: false,
      error: { message: 'terminal failure' },
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'terminal failure' }));

    router.unsubscribe();
  });

  it('reports thread turn completion for non-bound turns while keeping stream completion bound', () => {
    const client = new FakeClient();
    const { controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_injected',
    });

    const onThreadTurnCompleted = vi.fn();
    const onTurnCompleted = vi.fn();
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_injected',
      onUsage: () => undefined,
      onThreadTurnCompleted,
      onTurnCompleted,
      onError: () => undefined,
    });

    router.setTurnId('turn_stream');
    router.subscribe();

    client.emit('notification', 'turn/completed', {
      threadId: 'thr_injected',
      turn: { id: 'turn_injected', items: [], status: 'completed', error: null },
    });
    client.emit('notification', 'turn/completed', {
      threadId: 'thr_injected',
      turn: { id: 'turn_stream', items: [], status: 'completed', error: null },
    });

    expect(onThreadTurnCompleted).toHaveBeenCalledTimes(2);
    expect(onThreadTurnCompleted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'turn_injected' }),
    );
    expect(onThreadTurnCompleted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'turn_stream' }),
    );
    expect(onTurnCompleted).toHaveBeenCalledTimes(1);
    expect(onTurnCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: 'turn_stream' }));

    router.unsubscribe();
  });

  it('registers expected notification and server-request handlers', () => {
    const client = new FakeClient();
    const { controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_registry',
    });

    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_registry',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError: () => undefined,
    });

    const internals = router as unknown as {
      notificationHandlers: Record<string, unknown>;
      serverRequestHandlers: Record<string, unknown>;
    };

    expect(Object.keys(internals.notificationHandlers).sort()).toEqual(
      [
        'error',
        'item/agentMessage/delta',
        'item/commandExecution/outputDelta',
        'item/completed',
        'item/fileChange/outputDelta',
        'item/reasoning/summaryTextDelta',
        'item/reasoning/textDelta',
        'item/started',
        'reasoningSummaryTextDelta',
        'reasoningTextDelta',
        'thread/tokenUsage/updated',
        'turn/completed',
      ].sort(),
    );
    expect(Object.keys(internals.serverRequestHandlers).sort()).toEqual(
      ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].sort(),
    );
  });

  it('maps dynamicToolCall items to provider-executed dynamic tool parts like mcpToolCall', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_dynamic',
    });

    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_dynamic',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError: () => undefined,
    });

    router.setTurnId('turn_dynamic_1');
    router.subscribe();

    client.emit('notification', 'item/started', {
      threadId: 'thr_dynamic',
      turnId: 'turn_dynamic_1',
      item: {
        type: 'dynamicToolCall',
        id: 'item_dyn_1',
        namespace: 'search',
        tool: 'lookup',
        arguments: { q: 'hello' },
        status: 'inProgress',
        contentItems: null,
        success: null,
        durationMs: null,
      },
    });
    client.emit('notification', 'item/completed', {
      threadId: 'thr_dynamic',
      turnId: 'turn_dynamic_1',
      item: {
        type: 'dynamicToolCall',
        id: 'item_dyn_1',
        namespace: 'search',
        tool: 'lookup',
        arguments: { q: 'hello' },
        status: 'completed',
        contentItems: [],
        success: true,
        durationMs: 8,
      },
    });

    router.unsubscribe();

    expect(parts.map((part) => part.type)).toEqual([
      'tool-input-start',
      'tool-input-delta',
      'tool-input-end',
      'tool-call',
      'tool-result',
    ]);

    const toolCall = parts.find((part) => part.type === 'tool-call');
    expect(toolCall).toMatchObject({
      toolCallId: 'item_dyn_1',
      toolName: 'search__lookup',
      providerExecuted: true,
      dynamic: true,
    });

    const toolResult = parts.find((part) => part.type === 'tool-result');
    expect(toolResult).toMatchObject({
      toolCallId: 'item_dyn_1',
      toolName: 'search__lookup',
      dynamic: true,
    });
    expect(toolResult).not.toMatchObject({ isError: true });
  });

  it('marks failed dynamicToolCall results as errors and uses bare tool name without namespace', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_dynamic_fail',
    });

    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_dynamic_fail',
      onUsage: () => undefined,
      onTurnCompleted: () => undefined,
      onError: () => undefined,
    });

    router.setTurnId('turn_dynamic_fail_1');
    router.subscribe();

    client.emit('notification', 'item/started', {
      threadId: 'thr_dynamic_fail',
      turnId: 'turn_dynamic_fail_1',
      item: {
        type: 'dynamicToolCall',
        id: 'item_dyn_fail_1',
        namespace: null,
        tool: 'lookup',
        arguments: {},
        status: 'inProgress',
        contentItems: null,
        success: null,
        durationMs: null,
      },
    });
    client.emit('notification', 'item/completed', {
      threadId: 'thr_dynamic_fail',
      turnId: 'turn_dynamic_fail_1',
      item: {
        type: 'dynamicToolCall',
        id: 'item_dyn_fail_1',
        namespace: null,
        tool: 'lookup',
        arguments: {},
        status: 'failed',
        contentItems: null,
        success: false,
        durationMs: 3,
      },
    });

    router.unsubscribe();

    const toolCall = parts.find((part) => part.type === 'tool-call');
    expect(toolCall).toMatchObject({
      toolCallId: 'item_dyn_fail_1',
      toolName: 'lookup',
      providerExecuted: true,
      dynamic: true,
    });

    const toolResult = parts.find((part) => part.type === 'tool-result');
    expect(toolResult).toMatchObject({
      toolCallId: 'item_dyn_fail_1',
      toolName: 'lookup',
      dynamic: true,
      isError: true,
    });
  });

  it('ignores unknown item types but still completes the turn', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_future',
    });

    let completedTurnId: string | undefined;
    const router = new AppServerNotificationRouter({
      client: client as never,
      emitter,
      threadId: 'thr_future',
      onUsage: () => undefined,
      onTurnCompleted: (turn) => {
        completedTurnId = turn.id;
      },
      onError: () => {
        throw new Error('unexpected error callback');
      },
    });

    router.setTurnId('turn_future_1');
    router.subscribe();

    const futureWidget = {
      type: 'futureWidget',
      id: 'item_future_1',
      widgetPayload: { nested: true },
    };

    client.emit('notification', 'item/started', {
      threadId: 'thr_future',
      turnId: 'turn_future_1',
      item: futureWidget,
    });
    client.emit('notification', 'item/completed', {
      threadId: 'thr_future',
      turnId: 'turn_future_1',
      item: futureWidget,
    });
    client.emit('notification', 'turn/completed', {
      threadId: 'thr_future',
      turn: {
        id: 'turn_future_1',
        items: [futureWidget],
        status: 'failed',
        error: {
          message: 'future failure',
          codexErrorInfo: { futureVariant: { detail: 'x' } },
          additionalDetails: null,
        },
      },
    });

    router.unsubscribe();

    expect(parts.filter((part) => part.type !== 'raw')).toHaveLength(0);
    expect(completedTurnId).toBe('turn_future_1');
  });
});
