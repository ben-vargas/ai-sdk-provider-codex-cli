import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AppServerRpcClient } from '../app-server-rpc-client.js';

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
                data: [{ id: 'gpt-5.1-codex', isDefault: true }],
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
              model: 'gpt-5.1-codex',
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
    expect(result.data[0].id).toBe('gpt-5.1-codex');
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
    expect(received[0].method).toBe('thread/started');
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

    client.setActiveRequestHandlers('thr_1', {
      onDynamicToolCall: async () => ({
        contentItems: [{ type: 'outputText', text: 'active-handler' }],
        success: true,
      }),
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
    client.setActiveRequestHandlers('thr_1', {});

    await vi.advanceTimersByTimeAsync(60);
    expect(child.kill).not.toHaveBeenCalled();

    client.clearActiveRequestHandlers('thr_1');
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
});
