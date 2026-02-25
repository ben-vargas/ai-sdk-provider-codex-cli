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
  private readonly bufferedTextBlocks = new Map<string, string>();
  private readonly bufferedTextBlockOrder: string[] = [];
  private readonly completedBufferedTextBlockIds: string[] = [];

  constructor(
    private readonly controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    private readonly options: AppServerStreamEmitterOptions,
  ) {
    this.jsonModeLastTextBlockOnly = Boolean(options.jsonModeLastTextBlockOnly);
  }

  emitStreamStart(warnings: SharedV3Warning[]): void {
    this.controller.enqueue({ type: 'stream-start', warnings });
  }

  emitResponseMetadata(): void {
    this.controller.enqueue({
      type: 'response-metadata',
      id: generateId(),
      timestamp: new Date(),
      modelId: this.options.modelId,
    });
  }

  emitRaw(method: string, params: Record<string, unknown>, id?: string | number): void {
    if (!this.options.includeRawChunks) return;
    this.controller.enqueue({ type: 'raw', rawValue: { method, params, id } });
  }

  emitTextDelta(delta: string, itemId?: string): void {
    if (this.jsonModeLastTextBlockOnly) {
      const nextTextId = itemId ?? this.textId ?? generateId();

      if (this.textId && this.textId !== nextTextId) {
        this.completedBufferedTextBlockIds.push(this.textId);
        this.textId = undefined;
      }

      if (!this.textId) {
        this.textId = nextTextId;
      }

      if (!this.bufferedTextBlocks.has(this.textId)) {
        this.bufferedTextBlocks.set(this.textId, '');
        this.bufferedTextBlockOrder.push(this.textId);
      }

      this.bufferedTextBlocks.set(
        this.textId,
        `${this.bufferedTextBlocks.get(this.textId)}${delta}`,
      );
      return;
    }

    const nextTextId = itemId ?? this.textId ?? generateId();

    if (this.textId && this.textId !== nextTextId) {
      this.controller.enqueue({ type: 'text-end', id: this.textId });
      this.textId = undefined;
    }

    if (!this.textId) {
      this.textId = nextTextId;
      this.controller.enqueue({ type: 'text-start', id: this.textId });
    }

    this.controller.enqueue({ type: 'text-delta', id: this.textId, delta });
  }

  emitReasoningDelta(delta: string, isSummary = false, itemId?: string): void {
    if (!this.reasoningId) {
      this.reasoningId = itemId ?? generateId();
      this.controller.enqueue({ type: 'reasoning-start', id: this.reasoningId });
    }

    this.controller.enqueue({
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
    this.controller.enqueue({
      type: 'tool-input-start',
      id: toolCallId,
      toolName,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
    });
    if (input) {
      this.controller.enqueue({ type: 'tool-input-delta', id: toolCallId, delta: input });
    }
    this.controller.enqueue({ type: 'tool-input-end', id: toolCallId });

    this.controller.enqueue({
      type: 'tool-call',
      toolCallId,
      toolName,
      input,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
    });
  }

  emitToolOutputDelta(toolCallId: string, toolName: string, delta: string): void {
    this.controller.enqueue({
      type: 'tool-result',
      toolCallId,
      toolName,
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
    this.controller.enqueue({
      type: 'tool-result',
      toolCallId,
      toolName,
      result: (result ?? {}) as NonNullable<JSONValue>,
      ...(dynamic ? { dynamic: true } : {}),
      ...(isError ? { isError: true } : {}),
    });
  }

  emitApprovalRequest(approvalId: string): void {
    this.controller.enqueue({
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
        this.completedBufferedTextBlockIds.push(this.textId);
      }

      const finalBlockId =
        this.completedBufferedTextBlockIds.at(-1) ?? this.bufferedTextBlockOrder.at(-1);
      if (finalBlockId) {
        const finalText = this.bufferedTextBlocks.get(finalBlockId) ?? '';
        this.controller.enqueue({ type: 'text-start', id: finalBlockId });
        if (finalText.length > 0) {
          this.controller.enqueue({ type: 'text-delta', id: finalBlockId, delta: finalText });
        }
        this.controller.enqueue({ type: 'text-end', id: finalBlockId });
      }
    } else if (this.textId) {
      this.controller.enqueue({ type: 'text-end', id: this.textId });
    }

    if (this.reasoningId) {
      this.controller.enqueue({ type: 'reasoning-end', id: this.reasoningId });
    }
    this.controller.enqueue({
      type: 'finish',
      finishReason,
      usage,
      ...(providerMetadata ? { providerMetadata } : {}),
    });
  }

  close(): void {
    this.controller.close();
  }

  error(error: unknown): void {
    this.controller.error(error);
  }
}
