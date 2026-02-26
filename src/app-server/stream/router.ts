import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import type { ThreadItem, ThreadTokenUsageUpdatedNotification, Turn } from '../protocol/types.js';
import { AppServerRpcClient } from '../rpc/client.js';
import { safeStringify } from '../../shared-utils.js';
import { AppServerStreamEmitter } from './emitter.js';
import { ToolTracker, type ToolExecutionStats } from './tool-tracker.js';

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

export interface AppServerNotificationRouterOptions {
  client: AppServerRpcClient;
  emitter: AppServerStreamEmitter;
  threadId: string;
  onUsage: (usage: LanguageModelV3Usage) => void;
  onThreadTurnCompleted?: (turn: Turn) => void;
  onTurnCompleted: (turn: Turn) => void;
  onError: (error: Error) => void;
}

type BufferedTurnScopedEvent =
  | { kind: 'notification'; method: string; params: Record<string, unknown> }
  | {
      kind: 'server-request';
      method: string;
      params: Record<string, unknown>;
      id: string | number;
    };

export class AppServerNotificationRouter {
  private readonly client: AppServerRpcClient;
  private readonly emitter: AppServerStreamEmitter;
  private readonly threadId: string;
  private readonly onUsage: (usage: LanguageModelV3Usage) => void;
  private readonly onThreadTurnCompleted?: (turn: Turn) => void;
  private readonly onTurnCompleted: (turn: Turn) => void;
  private readonly onError: (error: Error) => void;

  private turnId?: string;
  private bufferedTurnScopedEvents: BufferedTurnScopedEvent[] = [];
  private readonly toolTracker = new ToolTracker();
  private textItemIdsWithDelta = new Set<string>();
  private reasoningItemIdsWithDelta = new Set<string>();

  private notificationListener?: (method: string, params: Record<string, unknown>) => void;
  private serverRequestListener?: (
    method: string,
    params: Record<string, unknown>,
    id: string | number,
  ) => void;

  constructor(options: AppServerNotificationRouterOptions) {
    this.client = options.client;
    this.emitter = options.emitter;
    this.threadId = options.threadId;
    this.onUsage = options.onUsage;
    this.onThreadTurnCompleted = options.onThreadTurnCompleted;
    this.onTurnCompleted = options.onTurnCompleted;
    this.onError = options.onError;
  }

  setTurnId(turnId: string): void {
    this.turnId = turnId;
    this.flushBufferedTurnScopedEvents();
  }

  getToolExecutionStats(): ToolExecutionStats {
    return this.toolTracker.getStats();
  }

  subscribe(): () => void {
    this.notificationListener = (method: string, params: Record<string, unknown>) => {
      if (!this.isSameThread(params)) return;
      if (method === 'turn/completed' && params.turn && typeof params.turn === 'object') {
        this.onThreadTurnCompleted?.(params.turn as Turn);
      }
      if (this.bufferTurnScopedEventBeforeBinding({ kind: 'notification', method, params })) {
        return;
      }
      this.emitter.emitRaw(method, params);
      this.handleNotification(method, params);
    };
    this.client.on('notification', this.notificationListener);

    this.serverRequestListener = (
      method: string,
      params: Record<string, unknown>,
      id: string | number,
    ) => {
      if (!this.isSameThread(params)) return;
      if (
        this.bufferTurnScopedEventBeforeBinding({
          kind: 'server-request',
          method,
          params,
          id,
        })
      ) {
        return;
      }
      this.emitter.emitRaw(method, params, id);
      this.handleServerRequest(method, params);
    };
    this.client.on('server-request', this.serverRequestListener);

    return () => this.unsubscribe();
  }

  unsubscribe(): void {
    if (this.notificationListener) {
      this.client.off('notification', this.notificationListener);
      this.notificationListener = undefined;
    }
    if (this.serverRequestListener) {
      this.client.off('server-request', this.serverRequestListener);
      this.serverRequestListener = undefined;
    }
    this.bufferedTurnScopedEvents = [];
  }

  private isSameThread(params: Record<string, unknown>): boolean {
    const notificationThreadId = typeof params.threadId === 'string' ? params.threadId : undefined;
    return notificationThreadId === undefined || notificationThreadId === this.threadId;
  }

  private getTurnIdFromParams(params: Record<string, unknown>): string | undefined {
    const turnObject =
      params.turn && typeof params.turn === 'object'
        ? (params.turn as { id?: unknown })
        : undefined;

    return typeof params.turnId === 'string'
      ? params.turnId
      : typeof turnObject?.id === 'string'
        ? turnObject.id
        : undefined;
  }

  private bufferTurnScopedEventBeforeBinding(event: BufferedTurnScopedEvent): boolean {
    if (this.turnId) return false;
    const turnIdInParams = this.getTurnIdFromParams(event.params);
    if (turnIdInParams === undefined) return false;
    this.bufferedTurnScopedEvents.push(event);
    return true;
  }

  private flushBufferedTurnScopedEvents(): void {
    if (!this.turnId || this.bufferedTurnScopedEvents.length === 0) return;

    const buffered = this.bufferedTurnScopedEvents;
    this.bufferedTurnScopedEvents = [];

    for (const event of buffered) {
      if (!this.isSameThread(event.params)) {
        continue;
      }
      if (this.getTurnIdFromParams(event.params) !== this.turnId) {
        continue;
      }

      if (event.kind === 'notification') {
        this.emitter.emitRaw(event.method, event.params);
        this.handleNotification(event.method, event.params);
      } else {
        this.emitter.emitRaw(event.method, event.params, event.id);
        this.handleServerRequest(event.method, event.params);
      }
    }
  }

  private isSameTurn(params: Record<string, unknown>): boolean {
    const turnIdInParams = this.getTurnIdFromParams(params);
    if (!this.turnId) {
      return turnIdInParams === undefined;
    }

    return turnIdInParams === undefined || turnIdInParams === this.turnId;
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    if (!this.isSameThread(params)) return;

    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      if (!this.isSameTurn(params)) return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      this.textItemIdsWithDelta.add(itemId);
      this.emitter.emitTextDelta(params.delta, itemId);
      return;
    }

    if (
      (method === 'reasoningTextDelta' || method === 'item/reasoning/textDelta') &&
      typeof params.delta === 'string'
    ) {
      if (!this.isSameTurn(params)) return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      this.reasoningItemIdsWithDelta.add(itemId);
      this.emitter.emitReasoningDelta(params.delta, false, itemId);
      return;
    }

    if (
      (method === 'reasoningSummaryTextDelta' || method === 'item/reasoning/summaryTextDelta') &&
      typeof params.delta === 'string'
    ) {
      if (!this.isSameTurn(params)) return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      this.reasoningItemIdsWithDelta.add(itemId);
      this.emitter.emitReasoningDelta(params.delta, true, itemId);
      return;
    }

    if (method === 'item/started' && params.item && typeof params.item === 'object') {
      if (!this.isSameTurn(params)) return;
      const item = params.item as ThreadItem;
      const tool = mapTool(item);
      if (!tool) return;
      const toolCallId = typeof item.id === 'string' ? item.id : generateId();
      this.toolTracker.start(toolCallId, tool);
      this.emitter.emitToolCall(toolCallId, tool.toolName, safeStringify(item), tool.dynamic);
      return;
    }

    if (method === 'item/completed' && params.item && typeof params.item === 'object') {
      if (!this.isSameTurn(params)) return;
      const item = params.item as ThreadItem;
      const type = normalizeItemType(item.type);

      if (type === 'agentmessage') {
        const itemId = typeof item.id === 'string' ? item.id : generateId();
        const text = (item as { text?: unknown }).text;
        if (!this.textItemIdsWithDelta.has(itemId) && typeof text === 'string' && text.length > 0) {
          this.emitter.emitTextDelta(text, itemId);
        }
        return;
      }

      if (type === 'reasoning') {
        const itemId = typeof item.id === 'string' ? item.id : generateId();
        if (!this.reasoningItemIdsWithDelta.has(itemId)) {
          const summary = (item as { summary?: unknown }).summary;
          const content = (item as { content?: unknown }).content;
          if (Array.isArray(summary) && summary.length > 0) {
            this.emitter.emitReasoningDelta(summary.join('\n'), true, itemId);
          }
          if (typeof summary === 'string' && summary.length > 0) {
            this.emitter.emitReasoningDelta(summary, true, itemId);
          }
          if (Array.isArray(content) && content.length > 0) {
            this.emitter.emitReasoningDelta(content.join('\n'), false, itemId);
          }
          if (typeof content === 'string' && content.length > 0) {
            this.emitter.emitReasoningDelta(content, false, itemId);
          }
        }
        return;
      }

      const tool = mapTool(item);
      if (!tool) return;

      const toolCallId = typeof item.id === 'string' ? item.id : generateId();
      const resolved = this.toolTracker.complete(
        toolCallId,
        tool,
        typeof (item as { durationMs?: unknown }).durationMs === 'number'
          ? (item as { durationMs: number }).durationMs
          : undefined,
      );
      this.emitter.emitToolResult(
        toolCallId,
        resolved.toolName,
        item,
        resolved.dynamic,
        (item as { status?: unknown }).status === 'failed',
      );
      return;
    }

    if (
      (method === 'item/commandExecution/outputDelta' ||
        method === 'item/fileChange/outputDelta') &&
      typeof params.delta === 'string'
    ) {
      if (!this.isSameTurn(params)) return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      const tracked = this.toolTracker.get(itemId);
      const defaultToolName = method === 'item/commandExecution/outputDelta' ? 'exec' : 'patch';
      this.emitter.emitToolOutputDelta(itemId, tracked?.toolName ?? defaultToolName, params.delta);
      return;
    }

    if (method === 'thread/tokenUsage/updated') {
      if (!this.isSameTurn(params)) return;
      const event = params as unknown as ThreadTokenUsageUpdatedNotification;
      const last = event.tokenUsage?.last;
      if (!last) return;

      this.onUsage({
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
      return;
    }

    if (method === 'turn/completed' && params.turn && typeof params.turn === 'object') {
      const turn = params.turn as Turn;
      if (this.turnId && turn.id !== this.turnId) return;
      this.onTurnCompleted(turn);
      return;
    }

    if (method === 'error') {
      if (!this.isSameTurn(params)) return;
      const nested = params.error;
      if (
        nested &&
        typeof nested === 'object' &&
        typeof (nested as { message?: unknown }).message === 'string'
      ) {
        this.onError(new Error((nested as { message: string }).message));
      }
    }
  }

  private handleServerRequest(method: string, params: Record<string, unknown>): void {
    if (!this.isSameThread(params) || !this.isSameTurn(params)) return;
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      this.emitter.emitApprovalRequest(itemId);
    }
  }
}
