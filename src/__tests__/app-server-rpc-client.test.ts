import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AppServerRpcClient } from '../app-server/rpc/client.js';

function flush(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callServerRequest(
  client: AppServerRpcClient,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  await (
    client as unknown as {
      handleServerRequest: (
        requestId: number,
        requestMethod: string,
        requestParams: Record<string, unknown>,
      ) => Promise<void>;
    }
  ).handleServerRequest(id, method, params);
}

function registerBoundContext(
  client: AppServerRpcClient,
  args: {
    threadId: string;
    turnId: string;
    handlers?: Record<string, unknown>;
    autoApprove?: boolean;
  },
): string {
  const contextId = client.registerRequestContext(args.threadId, {
    handlers: (args.handlers ?? {}) as never,
    autoApprove: args.autoApprove,
  });
  client.bindRequestContext(contextId, args.turnId);
  return contextId;
}

interface MockProcess {
  child: EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  writes: unknown[];
  emitServerMessage(message: unknown): void;
}

function createMockProcess(
  options: {
    userAgent?: string;
    disableModelList?: boolean;
    initializeCapabilities?: Record<string, unknown> | null;
  } = {},
): MockProcess {
  const child = new EventEmitter() as MockProcess['child'];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();

  const writes: unknown[] = [];
  child.stdin.on('data', (chunk: Buffer) => {
    const payload = chunk.toString();
    for (const line of payload.split(/\r?\n/).filter(Boolean)) {
      const message = JSON.parse(line);
      writes.push(message);

      if (message.method === 'initialize') {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              userAgent: options.userAgent ?? 'codex-cli 0.105.0',
              capabilities: options.initializeCapabilities ?? null,
            },
          })}\n`,
        );
      } else if (message.method === 'model/list') {
        if (options.disableModelList) {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              error: { code: -32601, message: 'Method not supported' },
            })}\n`,
          );
        } else {
          child.stdout.write(
            `${JSON.stringify({
              id: message.id,
              result: {
                data: [{ id: 'gpt-5.3-codex', isDefault: true }],
                nextCursor: null,
              },
            })}\n`,
          );
        }
      } else if (message.method === 'thread/start') {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              thread: { id: 'thr_1' },
              model: 'gpt-5.3-codex',
              modelProvider: 'openai',
              cwd: '/tmp',
              approvalPolicy: 'never',
              sandbox: { type: 'workspaceWrite' },
              reasoningEffort: null,
            },
          })}\n`,
        );
      } else if (message.method === 'turn/interrupt') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
      }
    }
  });

  const emitServerMessage = (message: unknown) => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };

  return { child, writes, emitServerMessage };
}

vi.mock('node:child_process', async () => {
  let spawnImpl: ((cmd: string, args: string[]) => unknown) | undefined;

  return {
    spawn: (cmd: string, args: string[]) => {
      if (!spawnImpl) throw new Error('spawn mock not configured');
      return spawnImpl(cmd, args);
    },
    __setSpawnMock: (fn: (cmd: string, args: string[]) => unknown) => {
      spawnImpl = fn;
    },
  };
});

const childProcess = await import('node:child_process');
const setSpawnMock = (fn: (cmd: string, args: string[]) => unknown): void => {
  (childProcess as unknown as { __setSpawnMock: (spawnFn: typeof fn) => void }).__setSpawnMock(fn);
};

describe('AppServerRpcClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes and performs requests', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();
    const result = await client.threadStart({
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    expect(result.thread.id).toBe('thr_1');
    await client.close();
  });

  it('supports model/list requests', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    const result = await client.modelList({ modelProviders: ['openai'] });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.id).toBe('gpt-5.3-codex');
    await client.close();
  });

  it('throws UnsupportedFeatureError when model/list returns method-not-supported', async () => {
    const { child, writes } = createMockProcess({ disableModelList: true });
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await expect(client.modelList()).rejects.toThrow(/not supported/i);
    expect(writes.some((message) => (message as { method?: string }).method === 'model/list')).toBe(
      true,
    );
    await client.close();
  });

  it('capability-gates model/list when initialize reports modelList=false', async () => {
    const { child, writes } = createMockProcess({ initializeCapabilities: { modelList: false } });
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await expect(client.modelList()).rejects.toThrow(/not supported/i);
    expect(writes.some((message) => (message as { method?: string }).method === 'model/list')).toBe(
      false,
    );
    await client.close();
  });

  it('routes notifications through the notification event', async () => {
    const { child, emitServerMessage } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();

    const received: Array<{ method: string; params: Record<string, unknown> }> = [];
    client.on('notification', (method: string, params: Record<string, unknown>) => {
      received.push({ method, params });
    });

    emitServerMessage({ method: 'thread/started', params: { thread: { id: 'thr_2' } } });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe('thread/started');
    await client.close();
  });

  it('drops invalid notifications for known methods', async () => {
    const { child, emitServerMessage } = createMockProcess();
    setSpawnMock(() => child);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const client = new AppServerRpcClient({ settings: { logger } });
    await client.ensureReady();

    const received: Array<{ method: string; params: Record<string, unknown> }> = [];
    client.on('notification', (method: string, params: Record<string, unknown>) => {
      received.push({ method, params });
    });

    emitServerMessage({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thr_1',
      },
    });
    await flush();

    expect(received).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Notification 'thread/tokenUsage/updated' failed schema validation"),
    );
    await client.close();
  });

  it('defaults approval requests to decline when autoApprove is false', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: false } });
    await client.ensureReady();

    await callServerRequest(client, 11, 'item/commandExecution/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      command: 'npm test',
    });
    await callServerRequest(client, 12, 'item/fileChange/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_2',
    });
    await callServerRequest(client, 13, 'skill/requestApproval', {
      itemId: 'item_3',
      skillName: 'agent-browser',
    });

    expect(writes).toContainEqual({ id: 11, result: { decision: 'decline' } });
    expect(writes).toContainEqual({ id: 12, result: { decision: 'decline' } });
    expect(writes).toContainEqual({ id: 13, result: { decision: 'decline' } });
    await client.close();
  });

  it('defaults approval requests to accept/approve when autoApprove is true', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: true } });
    await client.ensureReady();

    await callServerRequest(client, 21, 'item/commandExecution/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      command: 'npm test',
    });
    await callServerRequest(client, 22, 'item/fileChange/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_2',
    });
    await callServerRequest(client, 23, 'skill/requestApproval', {
      itemId: 'item_3',
      skillName: 'agent-browser',
    });

    expect(writes).toContainEqual({ id: 21, result: { decision: 'accept' } });
    expect(writes).toContainEqual({ id: 22, result: { decision: 'accept' } });
    expect(writes).toContainEqual({ id: 23, result: { decision: 'approve' } });
    await client.close();
  });

  it('honors per-thread autoApprove override over client-level setting', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: false } });
    await client.ensureReady();

    registerBoundContext(client, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      autoApprove: true,
    });

    await callServerRequest(client, 24, 'item/commandExecution/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      command: 'npm test',
    });

    expect(writes).toContainEqual({ id: 24, result: { decision: 'accept' } });
    await client.close();
  });

  it('uses single active thread context for threadless approval requests', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: false } });
    await client.ensureReady();

    registerBoundContext(client, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      autoApprove: true,
    });

    await callServerRequest(client, 25, 'skill/requestApproval', {
      itemId: 'item_3',
      skillName: 'agent-browser',
    });

    expect(writes).toContainEqual({ id: 25, result: { decision: 'approve' } });
    await client.close();
  });

  it('does not route requests to unrelated thread handlers', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({
      settings: {
        serverRequests: {
          onDynamicToolCall: async () => ({
            contentItems: [{ type: 'outputText', text: 'settings-handler' }],
            success: true,
          }),
        },
      },
    });
    await client.ensureReady();

    registerBoundContext(client, {
      threadId: 'thr_b',
      turnId: 'turn_b',
      handlers: {
        onDynamicToolCall: async () => ({
          contentItems: [{ type: 'outputText', text: 'thread-b-handler' }],
          success: true,
        }),
      },
    });

    await callServerRequest(client, 26, 'item/tool/call', {
      threadId: 'thr_a',
      turnId: 'turn_1',
      callId: 'call_1',
      tool: 'search',
      arguments: { q: 'hello' },
    });

    expect(writes).toContainEqual({
      id: 26,
      result: { contentItems: [{ type: 'outputText', text: 'settings-handler' }], success: true },
    });
    expect(writes).not.toContainEqual({
      id: 26,
      result: { contentItems: [{ type: 'outputText', text: 'thread-b-handler' }], success: true },
    });

    await client.close();
  });

  it('keeps request context isolated per turn for concurrent same-thread turns', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: true } });
    await client.ensureReady();

    registerBoundContext(client, {
      threadId: 'thr_same',
      turnId: 'turn_1',
      autoApprove: false,
    });
    registerBoundContext(client, {
      threadId: 'thr_same',
      turnId: 'turn_2',
      autoApprove: true,
    });

    await callServerRequest(client, 80, 'item/commandExecution/requestApproval', {
      threadId: 'thr_same',
      turnId: 'turn_1',
      itemId: 'item_1',
      command: 'npm test',
    });
    await callServerRequest(client, 81, 'item/commandExecution/requestApproval', {
      threadId: 'thr_same',
      turnId: 'turn_2',
      itemId: 'item_2',
      command: 'npm test',
    });

    expect(writes).toContainEqual({ id: 80, result: { decision: 'decline' } });
    expect(writes).toContainEqual({ id: 81, result: { decision: 'accept' } });

    client.clearRequestContextForTurn('turn_1');
    await callServerRequest(client, 82, 'item/commandExecution/requestApproval', {
      threadId: 'thr_same',
      turnId: 'turn_1',
      itemId: 'item_3',
      command: 'npm test',
    });
    expect(writes).toContainEqual({ id: 82, result: { decision: 'accept' } });

    await client.close();
  });

  it('releases bound turn context when turn/completed notification arrives', async () => {
    const { child, writes, emitServerMessage } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: true } });
    await client.ensureReady();

    registerBoundContext(client, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      autoApprove: false,
    });

    await callServerRequest(client, 83, 'item/commandExecution/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      command: 'npm test',
    });
    expect(writes).toContainEqual({ id: 83, result: { decision: 'decline' } });

    emitServerMessage({
      method: 'turn/completed',
      params: {
        threadId: 'thr_1',
        turn: { id: 'turn_1', items: [], status: 'completed', error: null },
      },
    });
    await flush();

    await callServerRequest(client, 84, 'item/commandExecution/requestApproval', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_2',
      command: 'npm test',
    });
    expect(writes).toContainEqual({ id: 84, result: { decision: 'accept' } });

    await client.close();
  });

  it('skips binding request context when turn already completed before bind', async () => {
    const { child, emitServerMessage } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();

    emitServerMessage({
      method: 'turn/completed',
      params: {
        threadId: 'thr_1',
        turn: { id: 'turn_done', items: [], status: 'completed', error: null },
      },
    });
    await flush();

    const contextId = client.registerRequestContext('thr_1', {
      handlers: {},
      autoApprove: true,
    });
    client.bindRequestContext(contextId, 'turn_done');

    expect(
      (client as unknown as { activeRequestContextsByTurn: Map<string, unknown> })
        .activeRequestContextsByTurn.size,
    ).toBe(0);
    expect(
      (client as unknown as { pendingRequestContexts: Map<string, unknown> }).pendingRequestContexts
        .size,
    ).toBe(0);

    await client.close();
  });

  it('uses settings-level fallback for threadless requests when multiple threads are active', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ settings: { autoApprove: false } });
    await client.ensureReady();

    registerBoundContext(client, { threadId: 'thr_a', turnId: 'turn_a', autoApprove: true });
    registerBoundContext(client, { threadId: 'thr_b', turnId: 'turn_b', autoApprove: true });

    await callServerRequest(client, 27, 'skill/requestApproval', {
      itemId: 'item_4',
      skillName: 'agent-browser',
    });

    expect(writes).toContainEqual({ id: 27, result: { decision: 'decline' } });
    await client.close();
  });

  it('responds to non-approval server requests and unknown methods', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();

    await callServerRequest(client, 31, 'item/tool/requestUserInput', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_4',
      questions: [],
    });
    await callServerRequest(client, 32, 'item/tool/call', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      tool: 'search',
      arguments: { q: 'hello' },
    });
    await callServerRequest(client, 33, 'account/chatgptAuthTokens/refresh', {
      reason: 'unauthorized',
      previousAccountId: 'acct_1',
    });
    await callServerRequest(client, 34, 'unknown/method', {});

    expect(writes).toContainEqual({ id: 31, result: { answers: {} } });
    expect(writes).toContainEqual({ id: 32, result: { contentItems: [], success: false } });
    expect(writes).toContainEqual({
      id: 33,
      error: { code: -32603, message: 'Auth token refresh not supported by this client' },
    });
    expect(writes).toContainEqual({
      id: 34,
      error: { code: -32601, message: 'Method not supported' },
    });
    await client.close();
  });

  it('does not throw when server-request reply cannot be written', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const client = new AppServerRpcClient({ settings: { logger } });
    await client.ensureReady();
    child.stdin.destroy();

    await expect(
      callServerRequest(client, 99, 'item/tool/requestUserInput', {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        questions: [],
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to send server request result for 'item/tool/requestUserInput'",
      ),
    );

    await client.close();
  });

  it('uses typed serverRequests return values when provided', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({
      settings: {
        serverRequests: {
          onDynamicToolCall: async ({ id }) => {
            return {
              contentItems: [{ type: 'outputText', text: `handled-${String(id)}` }],
              success: true,
            };
          },
        },
      },
    });
    await client.ensureReady();

    await callServerRequest(client, 41, 'item/tool/call', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      tool: 'search',
      arguments: { q: 'hello' },
    });

    expect(writes).toContainEqual({
      id: 41,
      result: { contentItems: [{ type: 'outputText', text: 'handled-41' }], success: true },
    });
    await client.close();
  });

  it('prefers active per-thread handlers over settings-level handlers', async () => {
    const { child, writes } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({
      settings: {
        serverRequests: {
          onDynamicToolCall: async () => ({
            contentItems: [{ type: 'outputText', text: 'settings-handler' }],
            success: true,
          }),
        },
      },
    });
    await client.ensureReady();

    registerBoundContext(client, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      handlers: {
        onDynamicToolCall: async () => ({
          contentItems: [{ type: 'outputText', text: 'active-handler' }],
          success: true,
        }),
      },
    });

    await callServerRequest(client, 71, 'item/tool/call', {
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      tool: 'search',
      arguments: { q: 'hello' },
    });

    expect(writes).toContainEqual({
      id: 71,
      result: { contentItems: [{ type: 'outputText', text: 'active-handler' }], success: true },
    });
    await client.close();
  });

  it('removes thread lock entries after queued work completes', async () => {
    const client = new AppServerRpcClient();

    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const executionOrder: string[] = [];
    const first = client.withThreadLock('thr_lock', async () => {
      executionOrder.push('first-start');
      await firstGate;
      executionOrder.push('first-end');
    });

    const second = client.withThreadLock('thr_lock', async () => {
      executionOrder.push('second');
    });

    await flush();
    expect(
      (client as unknown as { threadLocks: Map<string, Promise<void>> }).threadLocks.size,
    ).toBe(1);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(executionOrder).toEqual(['first-start', 'first-end', 'second']);
    expect(
      (client as unknown as { threadLocks: Map<string, Promise<void>> }).threadLocks.size,
    ).toBe(0);
  });

  it('enforces min version against prerelease builds', async () => {
    const { child } = createMockProcess({ userAgent: 'codex-cli 0.105.0-alpha.17' });
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({
      settings: { minCodexVersion: '0.105.0' },
    });

    await expect(client.ensureReady()).rejects.toThrow(
      "codex app-server version '0.105.0-alpha.17' is below required minimum '0.105.0'.",
    );
  });

  it('kills spawned process and recovers cleanly after initialization failure', async () => {
    const first = createMockProcess({ userAgent: 'codex-cli 0.104.9' });
    const second = createMockProcess({ userAgent: 'codex-cli 0.105.0' });
    let spawns = 0;
    setSpawnMock(() => {
      spawns += 1;
      return spawns === 1 ? first.child : second.child;
    });

    const client = new AppServerRpcClient({
      settings: { minCodexVersion: '0.105.0' },
    });

    await expect(client.ensureReady()).rejects.toThrow(
      "codex app-server version '0.104.9' is below required minimum '0.105.0'.",
    );
    expect(first.child.kill).toHaveBeenCalledWith('SIGTERM');

    await expect(client.ensureReady()).resolves.toBeUndefined();
    expect(spawns).toBe(2);

    await client.close();
  });

  it('kills the child process after idle timeout with no in-flight requests', async () => {
    vi.useFakeTimers();

    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({
      settings: { idleTimeoutMs: 25 },
    });

    const idleEvents: string[] = [];
    client.on('idle-timeout', () => idleEvents.push('idle'));

    await client.ensureReady();
    await vi.advanceTimersByTimeAsync(30);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(idleEvents).toEqual(['idle']);
    await client.close();
  });

  it('does not idle-kill while a turn is active (active request handlers present)', async () => {
    vi.useFakeTimers();

    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({
      settings: { idleTimeoutMs: 25 },
    });

    await client.ensureReady();
    const contextId = client.registerRequestContext('thr_1', { handlers: {} });

    await vi.advanceTimersByTimeAsync(60);
    expect(child.kill).not.toHaveBeenCalled();

    client.clearRequestContext(contextId);
    await vi.advanceTimersByTimeAsync(30);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await client.close();
  });

  it('logs expected SIGTERM shutdowns at info level instead of warn', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const client = new AppServerRpcClient({
      settings: { logger },
    });
    await client.ensureReady();

    await client.close();
    child.emit('exit', null, 'SIGTERM');
    await flush();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[codex-app-server] codex app-server exited'),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('[codex-app-server] codex app-server exited'),
    );
  });

  it('times out requests that do not receive responses', async () => {
    vi.useFakeTimers();
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient({ requestTimeoutMs: 10 });
    await client.ensureReady();

    const pending = client.request('never/reply', {});
    const assertion = expect(pending).rejects.toThrow("Request timed out for method 'never/reply'");
    await vi.advanceTimersByTimeAsync(20);
    await assertion;

    await client.close();
  });

  it('cleans pending request bookkeeping when write fails synchronously', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();
    child.stdin.destroy();

    await expect(client.request('never/sent', {})).rejects.toThrow('stdin is not writable');

    expect((client as unknown as { pending: Map<number, unknown> }).pending.size).toBe(0);
    await client.close();
  });

  it('reconnects after crash and emits reconnected', async () => {
    const first = createMockProcess();
    const second = createMockProcess();
    let spawns = 0;
    setSpawnMock(() => {
      spawns += 1;
      return spawns === 1 ? first.child : second.child;
    });

    const client = new AppServerRpcClient();
    const events: string[] = [];
    client.on('reconnected', () => events.push('reconnected'));

    await client.ensureReady();
    first.child.emit('exit', 1, null);
    await client.ensureReady();

    expect(spawns).toBe(2);
    expect(events).toEqual(['reconnected']);

    const thread = await client.threadStart({
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });
    expect(thread.thread.id).toBe('thr_1');

    await client.close();
  });

  it('kills the child process on process error before entering error state', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();

    child.emit('error', new Error('boom'));
    await flush();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await client.close();
  });

  it('kills the child process when it exits unexpectedly with non-zero code', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();

    child.emit('exit', 1, null);
    await flush();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await client.close();
  });

  it('waits for stdin drain when write backpressure is signaled', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const originalWrite = child.stdin.write.bind(child.stdin);
    let backpressure = true;
    child.stdin.write = ((...args: Parameters<typeof originalWrite>) => {
      originalWrite(...args);
      return backpressure ? false : true;
    }) as typeof child.stdin.write;

    const client = new AppServerRpcClient();

    let ready = false;
    const readyPromise = client.ensureReady().then(() => {
      ready = true;
    });

    await flush();
    expect(ready).toBe(false);

    backpressure = false;
    child.stdin.emit('drain');
    await readyPromise;

    expect(ready).toBe(true);
    await client.close();
  });

  it('clears thread lock bookkeeping immediately after crash', async () => {
    const { child } = createMockProcess();
    setSpawnMock(() => child);

    const client = new AppServerRpcClient();
    await client.ensureReady();

    let releaseLock: (() => void) | undefined;
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const lockedTask = client.withThreadLock('thr_crash_lock', async () => {
      await lockGate;
    });

    await flush();
    expect(
      (client as unknown as { threadLocks: Map<string, Promise<void>> }).threadLocks.size,
    ).toBe(1);

    child.emit('exit', 1, null);
    await flush();

    expect(
      (client as unknown as { threadLocks: Map<string, Promise<void>> }).threadLocks.size,
    ).toBe(0);

    releaseLock?.();
    await lockedTask;
    await client.close();
  });
});
