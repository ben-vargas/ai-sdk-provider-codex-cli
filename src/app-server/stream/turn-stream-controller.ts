import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { createEmptyCodexUsage, sanitizeJsonSchema } from '../../shared-utils.js';
import type { Turn, TurnStartParams } from '../protocol/types.js';
import { AppServerRpcClient } from '../rpc/client.js';
import type { CodexAppServerRequestHandlers } from '../types.js';
import { AppServerSession } from '../session.js';
import { AppServerNotificationRouter } from './router.js';
import { AppServerStreamEmitter } from './emitter.js';

const INTERRUPT_COMPLETION_TIMEOUT_MS = 5_000;

function waitForPromiseOrTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

function isThreadNotFoundError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return /thread.*not found/i.test(message);
}

function createStaleThreadError(threadId: string): Error {
  return new Error(
    `Thread '${threadId}' not found after server restart. Create a new thread by omitting threadId.`,
  );
}

function mapTurnStatusToFinishReason(turn: Turn) {
  switch (turn.status) {
    case 'completed':
      return { unified: 'stop', raw: 'completed' } as const;
    case 'interrupted':
      return { unified: 'stop', raw: 'interrupted' } as const;
    case 'failed': {
      const errorInfo = turn.error?.codexErrorInfo;
      if (errorInfo === 'contextWindowExceeded') {
        return { unified: 'length', raw: 'context_window_exceeded' } as const;
      }
      if (errorInfo === 'usageLimitExceeded') {
        return { unified: 'length', raw: 'usage_limit_exceeded' } as const;
      }
      return { unified: 'error', raw: turn.error?.message ?? 'failed' } as const;
    }
    default:
      return { unified: 'other', raw: turn.status } as const;
  }
}

type TurnStreamState =
  | 'created'
  | 'starting'
  | 'awaiting_turn_id'
  | 'running'
  | 'interrupting'
  | 'finishing'
  | 'errored'
  | 'closed';

export interface TurnStreamControllerOptions {
  client: AppServerRpcClient;
  modelId: string;
  threadId: string;
  warnings: SharedV3Warning[];
  includeRawChunks: boolean;
  jsonModeLastTextBlockOnly: boolean;
  turnStartParams: TurnStartParams;
  requestHandlers?: Partial<CodexAppServerRequestHandlers>;
  autoApprove?: boolean;
  session?: AppServerSession;
  abortSignal?: AbortSignal;
  shouldSerializeTurnStart: boolean;
  hadInitialThreadId: boolean;
  threadResolution: {
    persistent: boolean;
    explicit: boolean;
  };
  releaseResources: () => void;
  clearPersistentThreadState: (threadId: string) => void;
}

export class TurnStreamController {
  private state: TurnStreamState = 'created';
  private usage: LanguageModelV3Usage = createEmptyCodexUsage();
  private turnId?: string;
  private requestContextId?: string;
  private cleanedUp = false;
  private pendingCancelReason: unknown | undefined;
  private cancelBeforeTurnId = false;
  private pendingAbortReason: unknown | undefined;
  private interruptWaitPromise?: Promise<void>;
  private cancelWaitPromise?: Promise<void>;
  private settleTurn:
    | {
        resolve: (turn: Turn) => void;
        reject: (error: unknown) => void;
      }
    | undefined;
  private turnCompletionPromise: Promise<Turn> = new Promise<Turn>(() => undefined);
  private emitter?: AppServerStreamEmitter;
  private router?: AppServerNotificationRouter;
  private unsubscribeRouter?: () => void;
  private onAbort?: () => void;

  constructor(private readonly options: TurnStreamControllerOptions) {}

  private isTerminalState(): boolean {
    return this.state === 'closed' || this.state === 'errored' || this.state === 'finishing';
  }

  private isClosedState(): boolean {
    return this.state === 'closed';
  }

  async start(
    controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  ): Promise<void> {
    if (this.state !== 'created') {
      return;
    }
    this.state = 'starting';

    this.turnCompletionPromise = new Promise<Turn>((resolve, reject) => {
      this.settleTurn = { resolve, reject };
    });

    this.emitter = new AppServerStreamEmitter(controller, {
      modelId: this.options.modelId,
      threadId: this.options.threadId,
      includeRawChunks: this.options.includeRawChunks,
      jsonModeLastTextBlockOnly: this.options.jsonModeLastTextBlockOnly,
    });
    this.emitter.emitStreamStart(this.options.warnings);
    this.emitter.emitResponseMetadata();

    this.router = new AppServerNotificationRouter({
      client: this.options.client,
      emitter: this.emitter,
      threadId: this.options.threadId,
      onUsage: (nextUsage) => {
        this.usage = nextUsage;
      },
      onThreadTurnCompleted: (turn) => {
        this.options.session?.setInactive(turn.id);
      },
      onTurnCompleted: (turn) => {
        this.settleTurn?.resolve(turn);
      },
      onError: (error) => {
        this.settleTurn?.reject(error);
      },
    });
    this.unsubscribeRouter = this.router.subscribe();

    this.attachAbortSignal();

    if (this.pendingCancelReason !== undefined) {
      await this.requestCancel(this.pendingCancelReason);
      if (this.isClosedState()) return;
    }

    if (this.pendingAbortReason !== undefined) {
      await this.failWithError(this.pendingAbortReason);
      return;
    }

    try {
      this.state = 'awaiting_turn_id';
      const turnResponse = this.options.shouldSerializeTurnStart
        ? await this.options.client.withThreadLock(
            this.options.threadId,
            async () => await this.startTurnWithContext(),
          )
        : await this.startTurnWithContext();

      this.turnId = turnResponse.turn.id;
      this.router.setTurnId(this.turnId);
      this.options.session?.setTurnId(this.turnId);

      if (this.isClosedState()) {
        if (this.pendingCancelReason !== undefined && this.cancelBeforeTurnId) {
          await this.requestCancel(this.pendingCancelReason);
        }
        return;
      }
      this.state = 'running';

      if (this.pendingCancelReason !== undefined) {
        await this.requestCancel(this.pendingCancelReason);
        return;
      }

      if (this.pendingAbortReason !== undefined) {
        await this.interruptAndAwaitCompletion();
        throw this.pendingAbortReason;
      }

      const turn = await this.turnCompletionPromise;
      if (this.pendingCancelReason !== undefined) {
        this.finishSilently();
        return;
      }
      if (this.pendingAbortReason !== undefined) {
        throw this.pendingAbortReason;
      }

      if (this.isTerminalState()) return;
      this.state = 'finishing';
      const toolExecutionStats =
        this.router.getToolExecutionStats() as unknown as import('@ai-sdk/provider').JSONObject;

      this.emitter.emitFinish(mapTurnStatusToFinishReason(turn), this.usage, {
        'codex-app-server': {
          threadId: this.options.threadId,
          ...(this.turnId ? { turnId: this.turnId } : {}),
          toolExecutionStats,
        },
      });
      this.emitter.close();
      this.cleanup();
      this.state = 'closed';
    } catch (error) {
      if (this.pendingCancelReason !== undefined) {
        if (this.turnId) {
          await this.requestCancel(this.pendingCancelReason);
        } else {
          this.finishSilently();
        }
        return;
      }

      if (this.options.hadInitialThreadId && isThreadNotFoundError(error)) {
        if (this.options.threadResolution.persistent && !this.options.threadResolution.explicit) {
          this.options.clearPersistentThreadState(this.options.threadId);
        }
        await this.failWithError(createStaleThreadError(this.options.threadId));
        return;
      }

      if (this.pendingAbortReason !== undefined && this.turnId) {
        await this.interruptAndAwaitCompletion();
      }
      await this.failWithError(error);
    }
  }

  async cancel(reason?: unknown): Promise<void> {
    this.pendingCancelReason = reason ?? this.pendingCancelReason ?? new Error('Stream canceled');

    switch (this.state) {
      case 'closed':
      case 'errored':
      case 'finishing':
        return;
      case 'interrupting':
        await this.cancelWaitPromise;
        return;
      default:
        await this.requestCancel(reason);
    }
  }

  private async startTurnWithContext() {
    this.requestContextId = this.options.client.registerRequestContext(this.options.threadId, {
      handlers: this.options.requestHandlers ?? {},
      autoApprove: this.options.autoApprove,
    });

    try {
      const turnResponse = await this.options.client.turnStart(this.options.turnStartParams);
      this.options.client.bindRequestContext(this.requestContextId, turnResponse.turn.id);
      return turnResponse;
    } catch (error) {
      if (this.requestContextId) {
        this.options.client.clearRequestContext(this.requestContextId);
        this.requestContextId = undefined;
      }
      throw error;
    }
  }

  private attachAbortSignal(): void {
    const signal = this.options.abortSignal;
    if (!signal) {
      return;
    }

    if (signal.aborted) {
      this.pendingAbortReason = signal.reason ?? new Error('Request aborted');
      return;
    }

    this.onAbort = () => {
      this.pendingAbortReason = signal.reason ?? new Error('Request aborted');
      if (!this.turnId) return;
      void (async () => {
        await this.interruptAndAwaitCompletion();
        await this.failWithError(this.pendingAbortReason);
      })();
    };
    signal.addEventListener('abort', this.onAbort, { once: true });
  }

  private async requestCancel(reason?: unknown): Promise<void> {
    this.pendingCancelReason = reason ?? this.pendingCancelReason ?? new Error('Stream canceled');

    if (!this.turnId) {
      this.cancelBeforeTurnId = this.state === 'starting' || this.state === 'awaiting_turn_id';
      this.finishSilently();
      return;
    }

    if (this.isTerminalState() && !this.cancelBeforeTurnId) return;

    if (!this.cancelWaitPromise) {
      this.cancelWaitPromise = (async () => {
        this.state = 'interrupting';
        if (this.cancelBeforeTurnId) {
          await this.options.client
            .turnInterrupt({ threadId: this.options.threadId, turnId: this.turnId! })
            .catch(() => undefined);
          this.cancelBeforeTurnId = false;
        } else {
          await this.interruptAndAwaitCompletion();
        }
        this.finishSilently();
      })();
    }
    await this.cancelWaitPromise;
  }

  private async interruptAndAwaitCompletion(): Promise<void> {
    if (!this.turnId) return;
    if (!this.interruptWaitPromise) {
      this.interruptWaitPromise = (async () => {
        await this.options.client
          .turnInterrupt({ threadId: this.options.threadId, turnId: this.turnId! })
          .catch(() => undefined);
        await waitForPromiseOrTimeout(
          this.turnCompletionPromise.then(() => undefined),
          INTERRUPT_COMPLETION_TIMEOUT_MS,
        );
      })();
    }
    await this.interruptWaitPromise;
  }

  private async failWithError(error: unknown): Promise<void> {
    if (this.isTerminalState()) return;
    this.state = 'errored';
    this.emitter?.error(error);
    this.cleanup();
  }

  private finishSilently(): void {
    if (this.isTerminalState()) return;
    this.cleanup();
    this.state = 'closed';
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    this.unsubscribeRouter?.();
    this.unsubscribeRouter = undefined;

    if (this.turnId) {
      this.options.client.clearRequestContextForTurn(this.turnId);
    }
    if (this.requestContextId) {
      this.options.client.clearRequestContext(this.requestContextId);
      this.requestContextId = undefined;
    }

    if (this.options.abortSignal && this.onAbort) {
      this.options.abortSignal.removeEventListener('abort', this.onAbort);
    }
    this.onAbort = undefined;

    this.options.releaseResources();
  }
}

export function buildTurnStartParams(args: {
  threadId: string;
  modelId: string;
  input: TurnStartParams['input'];
  settings: {
    cwd?: string;
    approvalPolicy?: unknown;
    sandboxPolicy?: unknown;
    effort?: TurnStartParams['effort'];
    summary?: TurnStartParams['summary'];
    personality?: TurnStartParams['personality'];
  };
  responseFormat?: {
    type?: string;
    schema?: unknown;
  };
}): TurnStartParams {
  return {
    threadId: args.threadId,
    input: args.input,
    cwd: args.settings.cwd,
    approvalPolicy: args.settings.approvalPolicy,
    sandboxPolicy: args.settings.sandboxPolicy,
    model: args.modelId,
    effort: args.settings.effort,
    summary: args.settings.summary,
    personality: args.settings.personality,
    ...(args.responseFormat?.type === 'json' && args.responseFormat.schema
      ? { outputSchema: sanitizeJsonSchema(args.responseFormat.schema) }
      : {}),
  };
}
