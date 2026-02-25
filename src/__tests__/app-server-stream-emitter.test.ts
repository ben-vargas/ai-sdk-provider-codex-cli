import { describe, expect, it, vi } from 'vitest';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { AppServerStreamEmitter } from '../app-server-stream-emitter.js';
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
      modelId: 'gpt-5.1-codex',
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

  it('emits raw parts only when includeRawChunks is enabled', () => {
    const withRaw = createCapture();
    const emitterWithRaw = new AppServerStreamEmitter(withRaw.controller, {
      modelId: 'gpt-5.1-codex',
      threadId: 'thr_1',
      includeRawChunks: true,
    });
    emitterWithRaw.emitRaw('item/agentMessage/delta', { delta: 'x' });
    expect(withRaw.parts.some((part) => part.type === 'raw')).toBe(true);

    const withoutRaw = createCapture();
    const emitterWithoutRaw = new AppServerStreamEmitter(withoutRaw.controller, {
      modelId: 'gpt-5.1-codex',
      threadId: 'thr_1',
      includeRawChunks: false,
    });
    emitterWithoutRaw.emitRaw('item/agentMessage/delta', { delta: 'x' });
    expect(withoutRaw.parts.some((part) => part.type === 'raw')).toBe(false);
  });

  it('maps approval request and tool output delta parts', () => {
    const { parts, controller } = createCapture();
    const emitter = new AppServerStreamEmitter(controller, {
      modelId: 'gpt-5.1-codex',
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
});
