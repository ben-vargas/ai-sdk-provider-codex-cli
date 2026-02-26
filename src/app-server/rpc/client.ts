import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import { createAPICallError, UnsupportedFeatureError } from '../../errors.js';
import { getLogger } from '../../logger.js';
import type { Logger } from '../../types-shared.js';
import type {
  AppServerAuthRefreshRequest,
  AppServerCommandExecutionApprovalRequest,
  AppServerDynamicToolCallRequest,
  AppServerFileChangeApprovalRequest,
  AppServerSkillApprovalRequest,
  AppServerToolRequestUserInputRequest,
  AppServerUnhandledRequest,
  CodexAppServerRequestHandlers,
  CodexAppServerSettings,
} from '../types.js';
import type {
  InitializeParams,
  InitializeResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  ModelListParams,
  ModelListResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
} from '../protocol/types.js';
import {
  incomingNotificationSchemas,
  jsonRpcErrorResponseSchema,
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  serverRequestSchema,
} from '../protocol/validators.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

type ClientState = 'idle' | 'starting' | 'ready' | 'error' | 'closed';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMPLETED_TURN_IDS = 1_024;

export function resolveCodexPath(explicitPath?: string): { cmd: string; args: string[] } {
  if (explicitPath) {
    const lower = explicitPath.toLowerCase();
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
      return { cmd: 'node', args: [explicitPath] };
    }
    return { cmd: explicitPath, args: [] };
  }

  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('@openai/codex/package.json');
    const root = path.dirname(pkgPath);
    return { cmd: 'node', args: [path.join(root, 'bin', 'codex.js')] };
  } catch {
    return { cmd: 'codex', args: [] };
  }
}

function parseVersionFromUserAgent(userAgent: string): string | undefined {
  const match = userAgent.match(/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)/);
  return match?.[1];
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(input: string): ParsedSemver | undefined {
  const match = input.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const av = Number(a);
    const bv = Number(b);
    if (av > bv) return 1;
    if (av < bv) return -1;
    return 0;
  }
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return a.localeCompare(b);
}

function compareSemver(a: string, b: string): number | undefined {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return undefined;

  if (left.major !== right.major) return left.major > right.major ? 1 : -1;
  if (left.minor !== right.minor) return left.minor > right.minor ? 1 : -1;
  if (left.patch !== right.patch) return left.patch > right.patch ? 1 : -1;

  const aPre = left.prerelease;
  const bPre = right.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const maxLen = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLen; i++) {
    const av = aPre[i];
    const bv = bPre[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    const cmp = compareIdentifiers(av, bv);
    if (cmp !== 0) return cmp;
  }

  return 0;
}

export interface AppServerRpcClientOptions {
  settings?: CodexAppServerSettings;
  logger?: Logger | false;
  requestTimeoutMs?: number;
  clientVersion?: string;
}

type ActiveHandlers = Partial<CodexAppServerRequestHandlers>;
interface ActiveRequestContext {
  handlers: ActiveHandlers;
  autoApprove?: boolean;
}
interface PendingRequestContext {
  threadId: string;
  context: ActiveRequestContext;
}

class JsonRpcRequestError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`JSON-RPC error ${code}: ${message}`);
    this.name = 'JsonRpcRequestError';
    this.code = code;
  }
}

export class AppServerRpcClient extends EventEmitter {
  private readonly settings: CodexAppServerSettings;
  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly clientVersion: string;

  private child?: ChildProcessWithoutNullStreams;
  private stdoutReader?: readline.Interface;
  private state: ClientState = 'idle';
  private initPromise?: Promise<void>;
  private nextId = 1;
  private nextRequestContextId = 1;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private threadLocks = new Map<string, Promise<void>>();
  private pendingRequestContexts = new Map<string, PendingRequestContext>();
  private pendingRequestContextIdsByThread = new Map<string, Set<string>>();
  private activeRequestContextsByTurn = new Map<string, ActiveRequestContext>();
  private completedTurnIds = new Set<string>();
  private lastStderr = '';
  private idleTimer?: NodeJS.Timeout;
  private serverCapabilities?: Record<string, unknown> | null;
  private expectedExitSignal?: NodeJS.Signals;
  private writeQueue: Promise<void> = Promise.resolve();

  public serverVersion?: string;

  constructor(options: AppServerRpcClientOptions = {}) {
    super();
    this.settings = options.settings ?? {};
    this.logger = getLogger(options.logger ?? this.settings.logger);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? this.settings.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientVersion = options.clientVersion ?? '0.0.0';
  }

  async ensureReady(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'closed') throw new Error('AppServerRpcClient is closed');

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    const shouldEmitReconnected = this.state === 'error';
    this.state = 'starting';
    this.initPromise = this.startAndInitialize()
      .then(() => {
        this.state = 'ready';
        if (shouldEmitReconnected) this.emit('reconnected');
      })
      .catch((error) => {
        this.cleanupAfterInitializationFailure(error);
        throw error;
      })
      .finally(() => {
        this.initPromise = undefined;
      });

    await this.initPromise;
    this.touchActivity();
  }

  async request<T>(method: string, params?: object, timeoutMs?: number): Promise<T> {
    await this.ensureReady();
    this.touchActivity();
    return await this.requestInternal<T>(method, params, timeoutMs);
  }

  private async requestInternal<T>(
    method: string,
    params?: object,
    timeoutMs?: number,
  ): Promise<T> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      id,
      method,
      ...(params ? { params } : {}),
    };

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out for method '${method}'`));
      }, timeoutMs ?? this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      void this.writeMessage(request).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  notify(method: string, params?: object): void {
    if (this.state !== 'ready') {
      throw new Error(`Cannot send notification '${method}' while client is not ready`);
    }

    void this.writeMessage({ method, ...(params ? { params } : {}) }).catch((error) => {
      this.logger.warn(
        `[codex-app-server] Failed to send notification '${method}': ${String(error)}`,
      );
    });
  }

  async threadStart(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return await this.request<ThreadStartResponse>('thread/start', params as unknown as object);
  }

  async threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return await this.request<ThreadResumeResponse>('thread/resume', params as unknown as object);
  }

  async turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return await this.request<TurnStartResponse>('turn/start', params as unknown as object);
  }

  async turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return await this.request<TurnInterruptResponse>('turn/interrupt', params as unknown as object);
  }

  async modelList(params?: ModelListParams): Promise<ModelListResponse> {
    await this.ensureReady();
    this.touchActivity();

    if (this.serverCapabilities?.modelList === false) {
      throw new UnsupportedFeatureError({
        feature: 'model/list',
        minCodexVersion: this.settings.minCodexVersion ?? '0.105.0',
        serverVersion: this.serverVersion,
      });
    }

    try {
      return await this.requestInternal<ModelListResponse>(
        'model/list',
        params as unknown as object,
      );
    } catch (error) {
      if (error instanceof JsonRpcRequestError && error.code === -32601) {
        throw new UnsupportedFeatureError({
          feature: 'model/list',
          minCodexVersion: this.settings.minCodexVersion ?? '0.105.0',
          serverVersion: this.serverVersion,
        });
      }
      throw error;
    }
  }

  registerRequestContext(
    threadId: string,
    context: {
      handlers: ActiveHandlers;
      autoApprove?: boolean;
    },
  ): string {
    const contextId = `ctx_${this.nextRequestContextId++}`;
    this.pendingRequestContexts.set(contextId, {
      threadId,
      context: {
        handlers: context.handlers,
        autoApprove: context.autoApprove,
      },
    });

    const ids = this.pendingRequestContextIdsByThread.get(threadId) ?? new Set<string>();
    ids.add(contextId);
    this.pendingRequestContextIdsByThread.set(threadId, ids);

    return contextId;
  }

  bindRequestContext(contextId: string, turnId: string): void {
    const pending = this.pendingRequestContexts.get(contextId);
    if (!pending) return;
    if (this.completedTurnIds.has(turnId)) {
      this.clearRequestContext(contextId);
      return;
    }

    this.activeRequestContextsByTurn.set(turnId, {
      handlers: pending.context.handlers,
      autoApprove: pending.context.autoApprove,
    });
    this.clearRequestContext(contextId);
  }

  clearRequestContext(contextId: string): void {
    const pending = this.pendingRequestContexts.get(contextId);
    if (!pending) return;

    this.pendingRequestContexts.delete(contextId);
    const ids = this.pendingRequestContextIdsByThread.get(pending.threadId);
    if (!ids) return;
    ids.delete(contextId);
    if (ids.size === 0) {
      this.pendingRequestContextIdsByThread.delete(pending.threadId);
    }
  }

  clearRequestContextForTurn(turnId: string): void {
    this.activeRequestContextsByTurn.delete(turnId);
  }

  hasTurnCompleted(turnId: string): boolean {
    return this.completedTurnIds.has(turnId);
  }

  async withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.threadLocks.get(threadId) ?? Promise.resolve();

    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const chained = previous.then(() => current);
    this.threadLocks.set(threadId, chained);
    await previous;

    try {
      return await fn();
    } finally {
      release?.();
      if (this.threadLocks.get(threadId) === chained) {
        this.threadLocks.delete(threadId);
      }
    }
  }

  async close(): Promise<void> {
    this.state = 'closed';
    this.clearIdleTimer();
    this.stdoutReader?.close();
    this.stdoutReader = undefined;

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Client closed while request ${String(id)} was in flight`));
    }
    this.pending.clear();
    this.threadLocks.clear();
    this.pendingRequestContexts.clear();
    this.pendingRequestContextIdsByThread.clear();
    this.activeRequestContextsByTurn.clear();
    this.completedTurnIds.clear();
    this.serverCapabilities = undefined;

    if (this.child) {
      this.expectedExitSignal = 'SIGTERM';
      this.child.kill('SIGTERM');
      this.child = undefined;
    }
    this.writeQueue = Promise.resolve();
  }

  async dispose(): Promise<void> {
    await this.close();
  }

  private async startAndInitialize(): Promise<void> {
    const base = resolveCodexPath(this.settings.codexPath);
    const args = [...base.args, 'app-server', '--listen', 'stdio://'];

    this.lastStderr = '';
    this.expectedExitSignal = undefined;
    this.child = spawn(base.cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(this.settings.env ?? {}),
        RUST_LOG: process.env.RUST_LOG || 'error',
      },
      cwd: this.settings.cwd,
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.lastStderr += String(chunk);
      if (this.lastStderr.length > 4000) {
        this.lastStderr = this.lastStderr.slice(-4000);
      }
    });

    this.child.on('error', (error) => {
      this.logger.error(`[codex-app-server] process error: ${String(error)}`);
      this.handleCrash(error);
    });

    this.child.on('exit', (code, signal) => {
      const message = `codex app-server exited (code=${String(code)}, signal=${String(signal)})`;
      const expected =
        this.state === 'closed' || (signal !== null && signal === this.expectedExitSignal);
      this.expectedExitSignal = undefined;
      if (expected) {
        this.logger.info(`[codex-app-server] ${message}`);
        return;
      }

      this.logger.warn(`[codex-app-server] ${message}`);
      this.handleCrash(new Error(message));
    });

    this.stdoutReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    this.stdoutReader.on('line', (line) => this.handleLine(line));

    const initializeParams: InitializeParams = {
      clientInfo: {
        name: 'ai-sdk-provider-codex-cli',
        version: this.clientVersion,
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: null,
      },
    };

    let initializeResult: InitializeResponse;
    try {
      initializeResult = await this.requestInternal<InitializeResponse>(
        'initialize',
        initializeParams as unknown as object,
        this.settings.connectionTimeoutMs ?? this.requestTimeoutMs,
      );
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (message.includes('ENOENT') || message.includes('unknown subcommand')) {
        throw new Error(
          "codex app-server requires codex CLI >= 0.105.0. Run 'codex --version' to check.",
        );
      }

      throw createAPICallError({
        message: `Failed to initialize codex app-server: ${message}`,
        stderr: this.lastStderr,
        provider: 'app-server',
      });
    }

    await this.writeMessage({ method: 'initialized' });
    this.checkVersion(initializeResult.userAgent);
    this.serverCapabilities = initializeResult.capabilities ?? null;
  }

  private checkVersion(userAgent: string): void {
    const detected = parseVersionFromUserAgent(userAgent);
    if (!detected) {
      this.logger.warn(
        `[codex-app-server] Could not parse server version from userAgent: ${userAgent}`,
      );
      return;
    }

    this.serverVersion = detected;
    const minVersion = this.settings.minCodexVersion ?? '0.105.0';
    const compared = compareSemver(detected, minVersion);
    if (compared === undefined) {
      this.logger.warn(
        `[codex-app-server] Could not semver-compare '${detected}' against '${minVersion}'.`,
      );
      return;
    }

    if (compared < 0) {
      throw new Error(
        `codex app-server version '${detected}' is below required minimum '${minVersion}'.`,
      );
    }
  }

  private cleanupAfterInitializationFailure(error: unknown): void {
    if (this.state === 'closed') return;

    this.state = 'error';
    this.clearIdleTimer();
    this.stdoutReader?.close();
    this.stdoutReader = undefined;

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(
          `Request ${String(id)} failed during app-server initialization: ${String(error)}`,
        ),
      );
    }
    this.pending.clear();
    this.threadLocks.clear();
    this.pendingRequestContexts.clear();
    this.pendingRequestContextIdsByThread.clear();
    this.activeRequestContextsByTurn.clear();
    this.completedTurnIds.clear();
    this.serverCapabilities = undefined;

    if (this.child) {
      this.expectedExitSignal = 'SIGTERM';
      this.child.kill('SIGTERM');
      this.child = undefined;
    }
    this.writeQueue = Promise.resolve();
  }

  private handleCrash(error: unknown): void {
    if (this.state === 'closed') return;

    this.state = 'error';
    this.clearIdleTimer();
    this.stdoutReader?.close();
    this.stdoutReader = undefined;
    if (this.child) {
      this.expectedExitSignal = 'SIGTERM';
      this.child.kill('SIGTERM');
      this.child = undefined;
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(`Request ${String(id)} failed after app-server crash: ${String(error)}`),
      );
    }
    this.pending.clear();
    this.threadLocks.clear();
    this.pendingRequestContexts.clear();
    this.pendingRequestContextIdsByThread.clear();
    this.activeRequestContextsByTurn.clear();
    this.completedTurnIds.clear();
    this.serverCapabilities = undefined;
    this.writeQueue = Promise.resolve();
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.touchActivity();

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.logger.warn(`[codex-app-server] Ignoring non-JSON line: ${trimmed.slice(0, 200)}`);
      return;
    }

    const response = jsonRpcResponseSchema.safeParse(parsed);
    if (response.success) {
      this.handleResponse(response.data as JsonRpcResponse);
      return;
    }

    const errorResponse = jsonRpcErrorResponseSchema.safeParse(parsed);
    if (errorResponse.success) {
      this.handleErrorResponse(errorResponse.data.id, errorResponse.data.error);
      return;
    }

    const request = jsonRpcRequestSchema.safeParse(parsed);
    if (request.success) {
      const data = request.data;
      void this.handleServerRequest(data.id, data.method, data.params ?? {}).catch((error) => {
        this.logger.warn(
          `[codex-app-server] Failed to handle server request '${data.method}': ${String(error)}`,
        );
      });
      return;
    }

    const notification = jsonRpcNotificationSchema.safeParse(parsed);
    if (notification.success) {
      const data = notification.data;
      const schema = incomingNotificationSchemas[data.method];
      if (schema) {
        const notificationParsed = schema.safeParse(data.params ?? {});
        if (!notificationParsed.success) {
          this.logger.warn(
            `[codex-app-server] Notification '${data.method}' failed schema validation; dropping.`,
          );
          return;
        }
      }
      if (data.method === 'turn/completed') {
        const params = data.params as { turn?: { id?: unknown } } | undefined;
        const turnId = typeof params?.turn?.id === 'string' ? params.turn.id : undefined;
        if (turnId) {
          this.clearRequestContextForTurn(turnId);
          this.rememberCompletedTurn(turnId);
        }
      }
      this.emit('notification', data.method, data.params ?? {});
      return;
    }

    this.logger.warn('[codex-app-server] Received unrecognized JSON-RPC message');
  }

  private handleResponse(response: JsonRpcResponse): void {
    this.touchActivity();
    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response.result);
  }

  private handleErrorResponse(
    id: JsonRpcId | null,
    error: { code: number; message: string },
  ): void {
    this.touchActivity();
    if (id === null) {
      this.logger.error(`[codex-app-server] JSON-RPC error: ${error.message}`);
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(new JsonRpcRequestError(error.code, error.message));
  }

  private getThreadIdFromServerRequest(params: Record<string, unknown>): string | undefined {
    return typeof params.threadId === 'string' ? params.threadId : undefined;
  }

  private getTurnIdFromServerRequest(params: Record<string, unknown>): string | undefined {
    return typeof params.turnId === 'string' ? params.turnId : undefined;
  }

  private getPendingContextsForThread(threadId: string): ActiveRequestContext[] {
    const ids = this.pendingRequestContextIdsByThread.get(threadId);
    if (!ids || ids.size === 0) return [];

    const contexts: ActiveRequestContext[] = [];
    for (const id of ids) {
      const pending = this.pendingRequestContexts.get(id);
      if (pending) contexts.push(pending.context);
    }
    return contexts;
  }

  private getContextForRequest(params: Record<string, unknown>): ActiveRequestContext | undefined {
    const turnId = this.getTurnIdFromServerRequest(params);
    if (turnId) {
      const active = this.activeRequestContextsByTurn.get(turnId);
      if (active) return active;
    }

    const threadId = this.getThreadIdFromServerRequest(params);
    if (threadId) {
      const pending = this.getPendingContextsForThread(threadId);
      if (pending.length === 1) return pending[0];
      if (pending.length > 1) {
        this.logger.debug(
          `[codex-app-server] Received server request for thread '${threadId}' before turn binding with multiple pending contexts; using settings-level handlers.`,
        );
      }
      return undefined;
    }

    const totalActive = this.activeRequestContextsByTurn.size;
    const totalPending = this.pendingRequestContexts.size;
    if (totalActive + totalPending === 1) {
      if (totalActive === 1) {
        return this.activeRequestContextsByTurn.values().next().value;
      }
      return this.pendingRequestContexts.values().next().value?.context;
    }

    if (totalActive + totalPending > 1) {
      this.logger.debug(
        '[codex-app-server] Received threadless server request while multiple request contexts are active; using settings-level handlers.',
      );
    }

    return undefined;
  }

  private async handleServerRequest(
    id: JsonRpcId,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const parsed = serverRequestSchema.safeParse({ id, method, params });
    const normalized = parsed.success
      ? parsed.data
      : ({ id, method, params } as {
          id: JsonRpcId;
          method: string;
          params: Record<string, unknown>;
        });

    const sendResult = async (result: unknown): Promise<void> => {
      try {
        await this.writeMessage({ id: normalized.id, result });
      } catch (error) {
        this.logger.warn(
          `[codex-app-server] Failed to send server request result for '${normalized.method}': ${String(error)}`,
        );
      }
    };

    const sendError = async (code: number, message: string): Promise<void> => {
      try {
        await this.writeMessage({ id: normalized.id, error: { code, message } });
      } catch (error) {
        this.logger.warn(
          `[codex-app-server] Failed to send server request error for '${normalized.method}': ${String(error)}`,
        );
      }
    };

    const activeContext = this.getContextForRequest(normalized.params);
    const handlers = activeContext?.handlers ?? this.settings.serverRequests ?? {};
    const autoApprove = activeContext?.autoApprove ?? this.settings.autoApprove ?? false;
    this.emit('server-request', normalized.method, normalized.params, normalized.id);

    const runHandler = async <T>(
      handlerCall: (() => Promise<T | undefined> | undefined) | undefined,
    ) => {
      if (!handlerCall) return undefined;
      try {
        const pending = handlerCall();
        if (!pending) return undefined;
        return await pending;
      } catch (error) {
        this.logger.warn(
          `[codex-app-server] request handler failed for '${normalized.method}': ${String(error)}`,
        );
        return undefined;
      }
    };

    switch (normalized.method) {
      case 'item/commandExecution/requestApproval': {
        const handled = await runHandler(() =>
          handlers.onCommandExecutionApproval?.(
            normalized as unknown as AppServerCommandExecutionApprovalRequest,
          ),
        );
        if (handled !== undefined) {
          await sendResult(handled);
          return;
        }
        await sendResult({ decision: autoApprove ? 'accept' : 'decline' });
        return;
      }
      case 'item/fileChange/requestApproval': {
        const handled = await runHandler(() =>
          handlers.onFileChangeApproval?.(
            normalized as unknown as AppServerFileChangeApprovalRequest,
          ),
        );
        if (handled !== undefined) {
          await sendResult(handled);
          return;
        }
        await sendResult({ decision: autoApprove ? 'accept' : 'decline' });
        return;
      }
      case 'skill/requestApproval': {
        const handled = await runHandler(() =>
          handlers.onSkillApproval?.(normalized as unknown as AppServerSkillApprovalRequest),
        );
        if (handled !== undefined) {
          await sendResult(handled);
          return;
        }
        await sendResult({ decision: autoApprove ? 'approve' : 'decline' });
        return;
      }
      case 'item/tool/requestUserInput': {
        const handled = await runHandler(() =>
          handlers.onToolRequestUserInput?.(
            normalized as unknown as AppServerToolRequestUserInputRequest,
          ),
        );
        if (handled !== undefined) {
          await sendResult(handled);
          return;
        }
        await sendResult({ answers: {} });
        return;
      }
      case 'item/tool/call': {
        const handled = await runHandler(() =>
          handlers.onDynamicToolCall?.(normalized as unknown as AppServerDynamicToolCallRequest),
        );
        if (handled !== undefined) {
          await sendResult(handled);
          return;
        }
        await sendResult({ contentItems: [], success: false });
        return;
      }
      case 'account/chatgptAuthTokens/refresh': {
        const handled = await runHandler(() =>
          handlers.onAuthRefresh?.(normalized as unknown as AppServerAuthRefreshRequest),
        );
        if (handled !== undefined) {
          await sendResult(handled);
          return;
        }
        await sendError(-32603, 'Auth token refresh not supported by this client');
        return;
      }
      default:
        {
          const handled = await runHandler(() =>
            handlers.onUnhandled?.(normalized as unknown as AppServerUnhandledRequest),
          );
          if (handled !== undefined) {
            await sendResult(handled);
            return;
          }
        }
        await sendError(-32601, 'Method not supported');
    }
  }

  private async writeMessage(message: unknown): Promise<void> {
    const payload = `${JSON.stringify(message)}\n`;
    const writeOperation = async (): Promise<void> => {
      if (!this.child?.stdin.writable) {
        throw new Error('codex app-server stdin is not writable');
      }

      const stdin = this.child.stdin;
      const wrote = stdin.write(payload);
      if (!wrote) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onError = (error: unknown) => {
            cleanup();
            reject(error);
          };
          const onClose = () => {
            cleanup();
            reject(new Error('codex app-server stdin closed before drain'));
          };
          const cleanup = () => {
            stdin.off('drain', onDrain);
            stdin.off('error', onError);
            stdin.off('close', onClose);
          };

          stdin.once('drain', onDrain);
          stdin.once('error', onError);
          stdin.once('close', onClose);
        });
      }

      this.touchActivity();
    };

    const queued = this.writeQueue.then(writeOperation, writeOperation);
    this.writeQueue = queued.catch(() => undefined);
    await queued;
  }

  private rememberCompletedTurn(turnId: string): void {
    this.completedTurnIds.add(turnId);
    if (this.completedTurnIds.size <= MAX_COMPLETED_TURN_IDS) {
      return;
    }
    const oldest = this.completedTurnIds.values().next().value;
    if (typeof oldest === 'string') {
      this.completedTurnIds.delete(oldest);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private touchActivity(): void {
    const idleTimeoutMs = this.settings.idleTimeoutMs;
    if (!idleTimeoutMs || idleTimeoutMs <= 0 || this.state !== 'ready') {
      return;
    }

    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.state !== 'ready') return;
      if (
        this.pending.size > 0 ||
        this.activeRequestContextsByTurn.size > 0 ||
        this.pendingRequestContexts.size > 0
      ) {
        this.touchActivity();
        return;
      }
      if (this.child) {
        this.logger.info(
          `[codex-app-server] Closing idle app-server process after ${idleTimeoutMs}ms inactivity.`,
        );
        this.expectedExitSignal = 'SIGTERM';
        this.child.kill('SIGTERM');
        this.child = undefined;
      }
      this.stdoutReader?.close();
      this.stdoutReader = undefined;
      this.state = 'idle';
      this.threadLocks.clear();
      this.pendingRequestContexts.clear();
      this.pendingRequestContextIdsByThread.clear();
      this.activeRequestContextsByTurn.clear();
      this.completedTurnIds.clear();
      this.serverCapabilities = undefined;
      this.writeQueue = Promise.resolve();
      this.emit('idle-timeout');
    }, idleTimeoutMs);
  }
}
