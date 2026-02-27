import { generateId } from '@ai-sdk/provider-utils';
import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import type { ThreadItem, ThreadTokenUsageUpdatedNotification, Turn } from '../protocol/types.js';
import { safeStringify } from '../../shared-utils.js';
import type { AppServerStreamEmitter } from './emitter.js';
import type { ToolTracker } from './tool-tracker.js';

function normalizeItemType(type: string): string {
  return type.toLowerCase();
}

function mapTool(item: ThreadItem): { toolName: string; dynamic?: boolean } | undefined {
  const type = normalizeItemType(item.type);

  if (type === 'commandexecution') {
    return { toolName: 'exec' };
  }

  if (type === 'filechange') {
    return { toolName: 'patch' };
  }

  if (type === 'mcptoolcall') {
    const server =
      typeof (item as { server?: unknown }).server === 'string'
        ? (item as { server: string }).server || 'server'
        : 'server';
    const tool =
      typeof (item as { tool?: unknown }).tool === 'string'
        ? (item as { tool: string }).tool || 'tool'
        : 'tool';
    return {
      toolName: `mcp__${server}__${tool}`,
      dynamic: true,
    };
  }

  if (type === 'websearch') {
    return { toolName: 'web_search' };
  }

  return undefined;
}

export interface NotificationHandlerContext {
  emitter: AppServerStreamEmitter;
  toolTracker: ToolTracker;
  textItemIdsWithDelta: Set<string>;
  reasoningItemIdsWithDelta: Set<string>;
  onUsage: (usage: LanguageModelV3Usage) => void;
  onTurnCompleted: (turn: Turn) => void;
  onError: (error: Error) => void;
  isSameTurn: (params: Record<string, unknown>) => boolean;
  getBoundTurnId: () => string | undefined;
}

export type NotificationHandler = (params: Record<string, unknown>) => void;

export function createNotificationHandlers(
  context: NotificationHandlerContext,
): Record<string, NotificationHandler> {
  const handleReasoningDelta =
    (isSummary: boolean): NotificationHandler =>
    (params) => {
      if (!context.isSameTurn(params) || typeof params.delta !== 'string') return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      context.reasoningItemIdsWithDelta.add(itemId);
      context.emitter.emitReasoningDelta(params.delta, isSummary, itemId);
    };

  const handleItemCompleted: NotificationHandler = (params) => {
    if (!context.isSameTurn(params)) return;
    if (!params.item || typeof params.item !== 'object') return;

    const item = params.item as ThreadItem;
    const type = normalizeItemType(item.type);

    if (type === 'agentmessage') {
      const itemId = typeof item.id === 'string' ? item.id : generateId();
      const text = (item as { text?: unknown }).text;
      if (
        !context.textItemIdsWithDelta.has(itemId) &&
        typeof text === 'string' &&
        text.length > 0
      ) {
        context.emitter.emitTextDelta(text, itemId);
      }
      return;
    }

    if (type === 'reasoning') {
      const itemId = typeof item.id === 'string' ? item.id : generateId();
      if (!context.reasoningItemIdsWithDelta.has(itemId)) {
        const summary = (item as { summary?: unknown }).summary;
        const content = (item as { content?: unknown }).content;
        if (Array.isArray(summary) && summary.length > 0) {
          context.emitter.emitReasoningDelta(summary.join('\n'), true, itemId);
        }
        if (typeof summary === 'string' && summary.length > 0) {
          context.emitter.emitReasoningDelta(summary, true, itemId);
        }
        if (Array.isArray(content) && content.length > 0) {
          context.emitter.emitReasoningDelta(content.join('\n'), false, itemId);
        }
        if (typeof content === 'string' && content.length > 0) {
          context.emitter.emitReasoningDelta(content, false, itemId);
        }
      }
      return;
    }

    const tool = mapTool(item);
    if (!tool) return;

    const toolCallId = typeof item.id === 'string' ? item.id : generateId();
    const resolved = context.toolTracker.complete(
      toolCallId,
      tool,
      typeof (item as { durationMs?: unknown }).durationMs === 'number'
        ? (item as { durationMs: number }).durationMs
        : undefined,
    );
    context.emitter.emitToolResult(
      toolCallId,
      resolved.toolName,
      item,
      resolved.dynamic,
      (item as { status?: unknown }).status === 'failed',
    );
  };

  const handleOutputDelta =
    (defaultToolName: 'exec' | 'patch'): NotificationHandler =>
    (params) => {
      if (!context.isSameTurn(params) || typeof params.delta !== 'string') return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      const tracked = context.toolTracker.get(itemId);
      context.emitter.emitToolOutputDelta(
        itemId,
        tracked?.toolName ?? defaultToolName,
        params.delta,
      );
    };

  return {
    'item/agentMessage/delta': (params) => {
      if (!context.isSameTurn(params) || typeof params.delta !== 'string') return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      context.textItemIdsWithDelta.add(itemId);
      context.emitter.emitTextDelta(params.delta, itemId);
    },
    reasoningTextDelta: handleReasoningDelta(false),
    'item/reasoning/textDelta': handleReasoningDelta(false),
    reasoningSummaryTextDelta: handleReasoningDelta(true),
    'item/reasoning/summaryTextDelta': handleReasoningDelta(true),
    'item/started': (params) => {
      if (!context.isSameTurn(params)) return;
      if (!params.item || typeof params.item !== 'object') return;

      const item = params.item as ThreadItem;
      const tool = mapTool(item);
      if (!tool) return;
      const toolCallId = typeof item.id === 'string' ? item.id : generateId();
      context.toolTracker.start(toolCallId, tool);
      context.emitter.emitToolCall(toolCallId, tool.toolName, safeStringify(item), tool.dynamic);
    },
    'item/completed': handleItemCompleted,
    'item/commandExecution/outputDelta': handleOutputDelta('exec'),
    'item/fileChange/outputDelta': handleOutputDelta('patch'),
    'thread/tokenUsage/updated': (params) => {
      if (!context.isSameTurn(params)) return;
      const event = params as unknown as ThreadTokenUsageUpdatedNotification;
      const last = event.tokenUsage?.last;
      if (!last) return;

      context.onUsage({
        inputTokens: {
          total: last.inputTokens,
          noCache: Math.max(0, last.inputTokens - last.cachedInputTokens),
          cacheRead: last.cachedInputTokens,
          cacheWrite: 0,
        },
        outputTokens: {
          total: last.outputTokens,
          text: undefined,
          reasoning: last.reasoningOutputTokens,
        },
        raw: (last as unknown as import('@ai-sdk/provider').JSONObject) ?? undefined,
      });
    },
    'turn/completed': (params) => {
      if (!params.turn || typeof params.turn !== 'object') return;
      const turn = params.turn as Turn;
      const boundTurnId = context.getBoundTurnId();
      if (boundTurnId && turn.id !== boundTurnId) return;
      context.onTurnCompleted(turn);
    },
    error: (params) => {
      if (!context.isSameTurn(params)) return;
      if (params.willRetry === true) return;
      const nested = params.error;
      if (
        nested &&
        typeof nested === 'object' &&
        typeof (nested as { message?: unknown }).message === 'string'
      ) {
        context.onError(new Error((nested as { message: string }).message));
      }
    },
  };
}
