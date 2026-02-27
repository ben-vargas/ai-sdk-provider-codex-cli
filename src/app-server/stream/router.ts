import type { LanguageModelV3Usage } from '@ai-sdk/provider';
import type { Turn } from '../protocol/types.js';
import { AppServerRpcClient } from '../rpc/client.js';
import { AppServerStreamEmitter } from './emitter.js';
import { ToolTracker, type ToolExecutionStats } from './tool-tracker.js';
import {
  createNotificationHandlers,
  type NotificationHandler,
} from './router-notification-handlers.js';
import {
  createServerRequestHandlers,
  type ServerRequestHandler,
} from './router-server-request-handlers.js';

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

  private readonly notificationHandlers: Record<string, NotificationHandler>;
  private readonly serverRequestHandlers: Record<string, ServerRequestHandler>;

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

    this.notificationHandlers = createNotificationHandlers({
      emitter: this.emitter,
      toolTracker: this.toolTracker,
      textItemIdsWithDelta: this.textItemIdsWithDelta,
      reasoningItemIdsWithDelta: this.reasoningItemIdsWithDelta,
      onUsage: this.onUsage,
      onTurnCompleted: this.onTurnCompleted,
      onError: this.onError,
      isSameTurn: (params) => this.isSameTurn(params),
      getBoundTurnId: () => this.turnId,
    });

    this.serverRequestHandlers = createServerRequestHandlers({
      emitter: this.emitter,
      isSameTurn: (params) => this.isSameTurn(params),
    });
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
    return notificationThreadId === this.threadId;
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
    const handler = this.notificationHandlers[method];
    if (!handler) return;
    handler(params);
  }

  private handleServerRequest(method: string, params: Record<string, unknown>): void {
    if (!this.isSameThread(params)) return;
    const handler = this.serverRequestHandlers[method];
    if (!handler) return;
    handler(params);
  }
}
