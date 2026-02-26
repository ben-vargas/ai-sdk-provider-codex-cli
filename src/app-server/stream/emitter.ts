import type {
  JSONValue,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';

export interface AppServerStreamEmitterOptions {
  modelId: string;
  threadId: string;
  includeRawChunks?: boolean;
  jsonModeLastTextBlockOnly?: boolean;
}

export class AppServerStreamEmitter {
  private textId?: string;
  private reasoningId?: string;
  private readonly jsonModeLastTextBlockOnly: boolean;
  private bufferedCurrentJsonText = '';
  private lastCompletedJsonTextId?: string;
  private lastCompletedJsonText = '';
  private closed = false;

  constructor(
    private readonly controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    private readonly options: AppServerStreamEmitterOptions,
  ) {
    this.jsonModeLastTextBlockOnly = Boolean(options.jsonModeLastTextBlockOnly);
  }

  private safeEnqueue(part: LanguageModelV3StreamPart): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(part);
    } catch {
      this.closed = true;
    }
  }

  emitStreamStart(warnings: SharedV3Warning[]): void {
    this.safeEnqueue({ type: 'stream-start', warnings });
  }

  emitResponseMetadata(): void {
    this.safeEnqueue({
      type: 'response-metadata',
      id: generateId(),
      timestamp: new Date(),
      modelId: this.options.modelId,
    });
  }

  emitRaw(method: string, params: Record<string, unknown>, id?: string | number): void {
    if (!this.options.includeRawChunks) return;
    this.safeEnqueue({ type: 'raw', rawValue: { method, params, id } });
  }

  emitTextDelta(delta: string, itemId?: string): void {
    if (this.jsonModeLastTextBlockOnly) {
      const nextTextId = itemId ?? this.textId ?? generateId();

      if (this.textId && this.textId !== nextTextId) {
        this.lastCompletedJsonTextId = this.textId;
        this.lastCompletedJsonText = this.bufferedCurrentJsonText;
        this.textId = undefined;
        this.bufferedCurrentJsonText = '';
      }

      if (!this.textId) {
        this.textId = nextTextId;
        this.bufferedCurrentJsonText = '';
      }

      this.bufferedCurrentJsonText = `${this.bufferedCurrentJsonText}${delta}`;
      return;
    }

    const nextTextId = itemId ?? this.textId ?? generateId();

    if (this.textId && this.textId !== nextTextId) {
      this.safeEnqueue({ type: 'text-end', id: this.textId });
      this.textId = undefined;
    }

    if (!this.textId) {
      this.textId = nextTextId;
      this.safeEnqueue({ type: 'text-start', id: this.textId });
    }

    this.safeEnqueue({ type: 'text-delta', id: this.textId, delta });
  }

  emitReasoningDelta(delta: string, isSummary = false, itemId?: string): void {
    const nextReasoningId = itemId ?? this.reasoningId ?? generateId();

    if (this.reasoningId && this.reasoningId !== nextReasoningId) {
      this.safeEnqueue({ type: 'reasoning-end', id: this.reasoningId });
      this.reasoningId = undefined;
    }

    if (!this.reasoningId) {
      this.reasoningId = nextReasoningId;
      this.safeEnqueue({ type: 'reasoning-start', id: this.reasoningId });
    }

    this.safeEnqueue({
      type: 'reasoning-delta',
      id: this.reasoningId,
      delta,
      ...(isSummary
        ? {
            providerMetadata: {
              'codex-app-server': {
                isSummary: true,
              },
            },
          }
        : {}),
    });
  }

  emitToolCall(toolCallId: string, toolName: string, input: string, dynamic?: boolean): void {
    this.safeEnqueue({
      type: 'tool-input-start',
      id: toolCallId,
      toolName,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
    });
    if (input) {
      this.safeEnqueue({ type: 'tool-input-delta', id: toolCallId, delta: input });
    }
    this.safeEnqueue({ type: 'tool-input-end', id: toolCallId });

    this.safeEnqueue({
      type: 'tool-call',
      toolCallId,
      toolName,
      input,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
    });
  }

  emitToolOutputDelta(toolCallId: string, toolName: string, delta: string): void {
    this.safeEnqueue({
      type: 'tool-result',
      toolCallId,
      toolName,
      preliminary: true,
      result: {
        type: 'output-delta',
        delta,
      } as NonNullable<JSONValue>,
    });
  }

  emitToolResult(
    toolCallId: string,
    toolName: string,
    result: unknown,
    dynamic?: boolean,
    isError?: boolean,
  ): void {
    this.safeEnqueue({
      type: 'tool-result',
      toolCallId,
      toolName,
      result: (result ?? {}) as NonNullable<JSONValue>,
      ...(dynamic ? { dynamic: true } : {}),
      ...(isError ? { isError: true } : {}),
    });
  }

  emitApprovalRequest(approvalId: string): void {
    this.safeEnqueue({
      type: 'tool-approval-request',
      approvalId,
      toolCallId: approvalId,
    });
  }

  emitFinish(
    finishReason: LanguageModelV3FinishReason,
    usage: LanguageModelV3Usage,
    providerMetadata?: SharedV3ProviderMetadata,
  ): void {
    if (this.jsonModeLastTextBlockOnly) {
      if (this.textId) {
        this.lastCompletedJsonTextId = this.textId;
        this.lastCompletedJsonText = this.bufferedCurrentJsonText;
        this.textId = undefined;
        this.bufferedCurrentJsonText = '';
      }

      const finalBlockId = this.lastCompletedJsonTextId;
      if (finalBlockId) {
        const finalText = this.lastCompletedJsonText;
        this.safeEnqueue({ type: 'text-start', id: finalBlockId });
        if (finalText.length > 0) {
          this.safeEnqueue({ type: 'text-delta', id: finalBlockId, delta: finalText });
        }
        this.safeEnqueue({ type: 'text-end', id: finalBlockId });
      }

      // Prevent retention in long-lived streaming sessions.
      this.lastCompletedJsonTextId = undefined;
      this.lastCompletedJsonText = '';
    } else if (this.textId) {
      this.safeEnqueue({ type: 'text-end', id: this.textId });
    }

    if (this.reasoningId) {
      this.safeEnqueue({ type: 'reasoning-end', id: this.reasoningId });
    }
    this.safeEnqueue({
      type: 'finish',
      finishReason,
      usage,
      ...(providerMetadata ? { providerMetadata } : {}),
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // Ignore close-after-cancel stream errors.
    }
  }

  error(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.error(error);
    } catch {
      // Ignore terminal errors once stream is no longer writable.
    }
  }
}
