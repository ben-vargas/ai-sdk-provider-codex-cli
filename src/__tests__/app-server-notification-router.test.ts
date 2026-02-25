import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider';
import { AppServerStreamEmitter } from '../app-server-stream-emitter.js';
import { AppServerNotificationRouter } from '../app-server-notification-router.js';

class FakeClient extends EventEmitter {}

function createCapture() {
  const parts: LanguageModelV3StreamPart[] = [];
  const controller = {
    enqueue: (part: LanguageModelV3StreamPart) => parts.push(part),
    close: vi.fn(),
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController<LanguageModelV3StreamPart>;

  return { parts, controller };
}

describe('AppServerNotificationRouter', () => {
  it('routes reasoning deltas, approvals, usage, and turn completion', () => {
    const client = new FakeClient();
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.1-codex',
      threadId: 'thr_1',
      includeRawChunks: true,
    });

    let usage: LanguageModelV3Usage | undefined;
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
      modelId: 'gpt-5.1-codex',
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
      modelId: 'gpt-5.1-codex',
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
});
