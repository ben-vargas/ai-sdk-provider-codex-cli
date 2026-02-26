import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
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
    const root = pkgPath.replace(/package\.json$/, '');
    return { cmd: 'node', args: [root + 'bin/codex.js'] };
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
  private pending = new Map<JsonRpcId, PendingRequest>();
  private threadLocks = new Map<string, Promise<void>>();
  private activeRequestHandlers = new Map<string, ActiveHandlers>();
  private lastActiveThreadId?: string;
  private lastStderr = '';
  private idleTimer?: NodeJS.Timeout;
  private serverCapabilities?: Record<string, unknown> | null;
  private expectedExitSignal?: NodeJS.Signals;

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

      this.writeMessage(request);
    });
  }

  notify(method: string, params?: object): void {
    if (this.state !== 'ready') {
      throw new Error(`Cannot send notification '${method}' while client is not ready`);
    }

    this.writeMessage({ method, ...(params ? { params } : {}) });
    this.touchActivity();
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

  setActiveRequestHandlers(threadId: string, handlers: ActiveHandlers): void {
    this.activeRequestHandlers.set(threadId, handlers);
    this.lastActiveThreadId = threadId;
  }

  clearActiveRequestHandlers(threadId: string): void {
    this.activeRequestHandlers.delete(threadId);
    if (this.lastActiveThreadId === threadId) {
      this.lastActiveThreadId = Array.from(this.activeRequestHandlers.keys()).at(-1);
    }
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
    this.activeRequestHandlers.clear();
    this.lastActiveThreadId = undefined;
    this.serverCapabilities = undefined;

    if (this.child) {
      this.expectedExitSignal = 'SIGTERM';
      this.child.kill('SIGTERM');
      this.child = undefined;
    }
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

    this.writeMessage({ method: 'initialized' });
    this.touchActivity();
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

  private handleCrash(error: unknown): void {
    if (this.state === 'closed') return;

    this.state = 'error';
    this.clearIdleTimer();
    this.stdoutReader?.close();
    this.stdoutReader = undefined;
    this.child = undefined;

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error(`Request ${String(id)} failed after app-server crash: ${String(error)}`),
      );
    }
    this.pending.clear();
    this.activeRequestHandlers.clear();
    this.lastActiveThreadId = undefined;
    this.serverCapabilities = undefined;
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
      void this.handleServerRequest(data.id, data.method, data.params ?? {});
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
            `[codex-app-server] Notification '${data.method}' failed schema validation; continuing.`,
          );
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

  private getHandlersForThread(threadId?: string): ActiveHandlers {
    if (threadId) {
      const active = this.activeRequestHandlers.get(threadId);
      if (active) return active;
    }
    if (this.lastActiveThreadId) {
      const active = this.activeRequestHandlers.get(this.lastActiveThreadId);
      if (active) return active;
    }
    return this.settings.serverRequests ?? {};
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

    const sendResult = (result: unknown): void => {
      this.writeMessage({ id: normalized.id, result });
    };

    const sendError = (code: number, message: string): void => {
      this.writeMessage({ id: normalized.id, error: { code, message } });
    };

    const threadId = this.getThreadIdFromServerRequest(normalized.params);
    const handlers = this.getHandlersForThread(threadId);
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
          sendResult(handled);
          return;
        }
        sendResult({ decision: this.settings.autoApprove ? 'accept' : 'decline' });
        return;
      }
      case 'item/fileChange/requestApproval': {
        const handled = await runHandler(() =>
          handlers.onFileChangeApproval?.(
            normalized as unknown as AppServerFileChangeApprovalRequest,
          ),
        );
        if (handled !== undefined) {
          sendResult(handled);
          return;
        }
        sendResult({ decision: this.settings.autoApprove ? 'accept' : 'decline' });
        return;
      }
      case 'skill/requestApproval': {
        const handled = await runHandler(() =>
          handlers.onSkillApproval?.(normalized as unknown as AppServerSkillApprovalRequest),
        );
        if (handled !== undefined) {
          sendResult(handled);
          return;
        }
        sendResult({ decision: this.settings.autoApprove ? 'approve' : 'decline' });
        return;
      }
      case 'item/tool/requestUserInput': {
        const handled = await runHandler(() =>
          handlers.onToolRequestUserInput?.(
            normalized as unknown as AppServerToolRequestUserInputRequest,
          ),
        );
        if (handled !== undefined) {
          sendResult(handled);
          return;
        }
        sendResult({ answers: {} });
        return;
      }
      case 'item/tool/call': {
        const handled = await runHandler(() =>
          handlers.onDynamicToolCall?.(normalized as unknown as AppServerDynamicToolCallRequest),
        );
        if (handled !== undefined) {
          sendResult(handled);
          return;
        }
        sendResult({ contentItems: [], success: false });
        return;
      }
      case 'account/chatgptAuthTokens/refresh': {
        const handled = await runHandler(() =>
          handlers.onAuthRefresh?.(normalized as unknown as AppServerAuthRefreshRequest),
        );
        if (handled !== undefined) {
          sendResult(handled);
          return;
        }
        sendError(-32603, 'Auth token refresh not supported by this client');
        return;
      }
      default:
        {
          const handled = await runHandler(() =>
            handlers.onUnhandled?.(normalized as unknown as AppServerUnhandledRequest),
          );
          if (handled !== undefined) {
            sendResult(handled);
            return;
          }
        }
        sendError(-32601, 'Method not supported');
    }
  }

  private writeMessage(message: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new Error('codex app-server stdin is not writable');
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    this.touchActivity();
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
      if (this.pending.size > 0 || this.activeRequestHandlers.size > 0) {
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
      this.emit('idle-timeout');
    }, idleTimeoutMs);
  }
}
