import { describe, expect, it, vi } from 'vitest';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { AppServerStreamEmitter } from '../app-server/stream/emitter.js';
import { createEmptyCodexUsage } from '../shared-utils.js';

function createCapture() {
  const parts: LanguageModelV3StreamPart[] = [];
  const controller = {
    enqueue: (part: LanguageModelV3StreamPart) => parts.push(part),
    close: vi.fn(),
    error: vi.fn(),
  } as unknown as ReadableStreamDefaultController<LanguageModelV3StreamPart>;

  return { parts, controller };
}

describe('AppServerStreamEmitter', () => {
  it('emits text/reasoning lifecycle parts', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
    });

    emitter.emitTextDelta('hello', 'text_1');
    emitter.emitReasoningDelta('thinking', false, 'reason_1');
    emitter.emitFinish({ unified: 'stop', raw: 'completed' }, createEmptyCodexUsage());

    expect(parts.some((part) => part.type === 'text-start')).toBe(true);
    expect(parts.some((part) => part.type === 'text-end')).toBe(true);
    expect(parts.some((part) => part.type === 'reasoning-start')).toBe(true);
    expect(parts.some((part) => part.type === 'reasoning-end')).toBe(true);
  });

  it('splits text blocks when item id changes', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
    });

    emitter.emitTextDelta('first', 'item_1');
    emitter.emitTextDelta('second', 'item_2');
    emitter.emitFinish({ unified: 'stop', raw: 'completed' }, createEmptyCodexUsage());

    const textStarts = parts.filter((part) => part.type === 'text-start');
    const textEnds = parts.filter((part) => part.type === 'text-end');
    expect(textStarts).toHaveLength(2);
    expect(textEnds).toHaveLength(2);
  });

  it('splits reasoning blocks when item id changes', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
    });

    emitter.emitReasoningDelta('summary', true, 'reason_1');
    emitter.emitReasoningDelta('details', false, 'reason_2');
    emitter.emitFinish({ unified: 'stop', raw: 'completed' }, createEmptyCodexUsage());

    const reasoningStarts = parts.filter((part) => part.type === 'reasoning-start');
    const reasoningEnds = parts.filter((part) => part.type === 'reasoning-end');

    expect(reasoningStarts).toHaveLength(2);
    expect(reasoningEnds).toHaveLength(2);
    expect((reasoningStarts[0] as { id?: string }).id).toBe('reason_1');
    expect((reasoningStarts[1] as { id?: string }).id).toBe('reason_2');
  });

  it('in json mode emits only the final completed text block', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      jsonModeLastTextBlockOnly: true,
    });

    emitter.emitTextDelta('{"status":"progress"}', 'item_1');
    emitter.emitTextDelta('{"result":"done"}', 'item_2');
    emitter.emitFinish({ unified: 'stop', raw: 'completed' }, createEmptyCodexUsage());

    const textDeltas = parts.filter((part) => part.type === 'text-delta');
    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0] as { delta?: string }).delta).toBe('{"result":"done"}');
  });

  it('clears json-mode buffered text state after finish', () => {
    const { controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      jsonModeLastTextBlockOnly: true,
    });

    emitter.emitTextDelta('{"result":"done"}', 'item_1');
    emitter.emitFinish({ unified: 'stop', raw: 'completed' }, createEmptyCodexUsage());

    const internal = emitter as unknown as {
      bufferedCurrentJsonText: string;
      lastCompletedJsonText: string;
      lastCompletedJsonTextId?: string;
    };
    expect(internal.bufferedCurrentJsonText).toBe('');
    expect(internal.lastCompletedJsonText).toBe('');
    expect(internal.lastCompletedJsonTextId).toBeUndefined();
  });

  it('json mode retains only current and last completed block across many item transitions', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      jsonModeLastTextBlockOnly: true,
    });

    for (let i = 0; i < 300; i += 1) {
      emitter.emitTextDelta(`${i}`, `item_${i}`);
    }

    const internal = emitter as unknown as {
      bufferedCurrentJsonText: string;
      lastCompletedJsonText: string;
      lastCompletedJsonTextId?: string;
    };
    expect(internal.bufferedCurrentJsonText).toBe('299');
    expect(internal.lastCompletedJsonText).toBe('298');
    expect(internal.lastCompletedJsonTextId).toBe('item_298');

    emitter.emitFinish({ unified: 'stop', raw: 'completed' }, createEmptyCodexUsage());

    const textDeltas = parts.filter((part) => part.type === 'text-delta');
    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0] as { delta?: string }).delta).toBe('299');
  });

  it('emits raw parts only when includeRawChunks is enabled', () => {
    const withRaw = createCapture();
    const emitterWithRaw = new AppServerStreamEmitter(withRaw.controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      includeRawChunks: true,
    });
    emitterWithRaw.emitRaw('item/agentMessage/delta', { delta: 'x' });
    expect(withRaw.parts.some((part) => part.type === 'raw')).toBe(true);

    const withoutRaw = createCapture();
    const emitterWithoutRaw = new AppServerStreamEmitter(withoutRaw.controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
      includeRawChunks: false,
    });
    emitterWithoutRaw.emitRaw('item/agentMessage/delta', { delta: 'x' });
    expect(withoutRaw.parts.some((part) => part.type === 'raw')).toBe(false);
  });

  it('maps approval request and tool output delta parts', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
    });

    emitter.emitApprovalRequest('approval_1');
    emitter.emitToolOutputDelta('tool_1', 'exec', 'chunk');

    expect(parts).toContainEqual({
      type: 'tool-approval-request',
      approvalId: 'approval_1',
      toolCallId: 'approval_1',
    });
    expect(
      parts.some((part) => {
        if (part.type !== 'tool-result') return false;
        return (
          part.toolCallId === 'tool_1' &&
          (part.result as { type?: string; delta?: string }).type === 'output-delta'
        );
      }),
    ).toBe(true);
  });

  it('ignores enqueue and terminal errors after stream is no longer writable', () => {
    const controller = {
      enqueue: vi.fn(() => {
        throw new Error('stream closed');
      }),
      close: vi.fn(() => {
        throw new Error('already closed');
      }),
      error: vi.fn(() => {
        throw new Error('already errored');
      }),
    } as unknown as ReadableStreamDefaultController<LanguageModelV3StreamPart>;

    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.3-codex',
      threadId: 'thr_1',
    });

    expect(() => emitter.emitTextDelta('hello', 'text_1')).not.toThrow();
    expect(() => emitter.emitTextDelta('world', 'text_1')).not.toThrow();
    expect(() => emitter.close()).not.toThrow();
    expect(() => emitter.error(new Error('boom'))).not.toThrow();
  });
});
