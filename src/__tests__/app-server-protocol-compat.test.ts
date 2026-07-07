import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  incomingNotificationSchemas,
  serverRequestSchema,
} from '../app-server/protocol/validators.js';

const fixturesRoot = join(process.cwd(), 'src', '__tests__', 'fixtures', 'app-server-protocol');

function loadJsonFixtures(dir: string): unknown[] {
  const folder = join(fixturesRoot, dir);
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
}

describe('app-server protocol validators', () => {
  it('parses notification fixtures', () => {
    const fixtures = loadJsonFixtures('notifications') as Array<{
      method: string;
      params: Record<string, unknown>;
    }>;

    for (const fixture of fixtures) {
      const schema = incomingNotificationSchemas[fixture.method];
      expect(schema, `missing schema for notification method ${fixture.method}`).toBeDefined();
      if (!schema) continue;
      const result = schema.safeParse(fixture.params);
      expect(result.success, `failed to parse ${fixture.method}`).toBe(true);
    }
  });

  it('parses server request fixtures', () => {
    const fixtures = loadJsonFixtures('server-requests');
    for (const fixture of fixtures) {
      const result = serverRequestSchema.safeParse(fixture);
      expect(result.success, `failed to parse server request ${JSON.stringify(fixture)}`).toBe(
        true,
      );
    }
  });

  it('allows unknown extra fields via passthrough', () => {
    const notification = {
      method: 'turn/completed',
      params: {
        threadId: 'thr_1',
        turn: {
          id: 'turn_1',
          items: [],
          status: 'completed',
          error: null,
          unknownFutureField: 'ok',
        },
        unknownOuterField: true,
      },
    };

    const schema = incomingNotificationSchemas[notification.method];
    expect(schema).toBeDefined();
    const parsedNotification = schema?.safeParse(notification.params);
    expect(parsedNotification).toBeDefined();
    expect(parsedNotification?.success).toBe(true);

    const request = {
      id: 999,
      method: 'account/chatgptAuthTokens/refresh',
      params: {
        reason: 'unauthorized',
        previousAccountId: 'acct_1',
        futureParam: 'supported',
      },
      futureRootField: 'supported',
    };

    expect(serverRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects invalid codexErrorInfo payloads', () => {
    const schema = incomingNotificationSchemas['turn/completed'];
    expect(schema).toBeDefined();
    if (!schema) return;

    const invalid = schema.safeParse({
      threadId: 'thr_1',
      turn: {
        id: 'turn_1',
        items: [],
        status: 'failed',
        error: {
          message: 'boom',
          codexErrorInfo: { unsupported: true },
          additionalDetails: null,
        },
      },
    });

    expect(invalid.success).toBe(false);
  });
});

describe('codex 0.142.5 protocol shapes', () => {
  it('parses a turn/completed payload with 0.142.5 turn metadata and item variants', () => {
    const schema = incomingNotificationSchemas['turn/completed'];
    expect(schema).toBeDefined();
    if (!schema) return;

    const result = schema.safeParse({
      threadId: 'thr_1',
      turn: {
        id: 'turn_1',
        itemsView: 'full',
        status: 'completed',
        error: null,
        startedAt: 1783384428,
        completedAt: 1783384500,
        durationMs: 72000,
        items: [
          {
            type: 'userMessage',
            id: 'item_user_1',
            clientId: null,
            content: [
              { type: 'text', text: 'hi', text_elements: [] },
              { type: 'image', url: 'https://example.com/cat.png', detail: 'auto' },
              { type: 'localImage', path: '/tmp/dog.png', detail: 'high' },
            ],
          },
          {
            type: 'agentMessage',
            id: 'item_msg_1',
            text: 'Hello',
            phase: 'final_answer',
            memoryCitation: null,
          },
          {
            type: 'commandExecution',
            id: 'item_cmd_1',
            command: 'ls',
            cwd: '/tmp',
            processId: null,
            source: 'agent',
            status: 'completed',
            commandActions: [],
            aggregatedOutput: 'ok',
            exitCode: 0,
            durationMs: 12,
          },
          {
            type: 'mcpToolCall',
            id: 'item_mcp_1',
            server: 'everything',
            tool: 'echo',
            status: 'completed',
            arguments: { message: 'ping' },
            appContext: null,
            pluginId: null,
            result: { content: [] },
            error: null,
            durationMs: 20,
          },
          {
            type: 'dynamicToolCall',
            id: 'item_dyn_1',
            namespace: null,
            tool: 'search',
            arguments: { q: 'hello' },
            status: 'completed',
            contentItems: [],
            success: true,
            durationMs: 5,
          },
          { type: 'hookPrompt', id: 'item_hook_1', fragments: [] },
          {
            type: 'subAgentActivity',
            id: 'item_sub_1',
            kind: 'started',
            agentThreadId: 'thr_child',
            agentPath: 'explorer',
          },
          { type: 'sleep', id: 'item_sleep_1', durationMs: 1000 },
          {
            type: 'imageGeneration',
            id: 'item_img_1',
            status: 'completed',
            revisedPrompt: null,
            result: 'done',
            savedPath: '/tmp/out.png',
          },
          {
            type: 'collabAgentToolCall',
            id: 'item_collab_1',
            tool: 'spawnAgent',
            status: 'completed',
            senderThreadId: 'thr_1',
            receiverThreadIds: ['thr_child'],
            prompt: 'do work',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
            agentsStates: {},
          },
        ],
      },
    });

    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
  });

  it('parses 0.142.5 codexErrorInfo variants', () => {
    const schema = incomingNotificationSchemas['error'];
    expect(schema).toBeDefined();
    if (!schema) return;

    for (const codexErrorInfo of [
      'cyberPolicy',
      { activeTurnNotSteerable: { turnKind: 'review' } },
    ]) {
      const result = schema.safeParse({
        threadId: 'thr_1',
        turnId: 'turn_1',
        willRetry: false,
        error: { message: 'boom', codexErrorInfo, additionalDetails: null },
      });
      expect(result.success, JSON.stringify(codexErrorInfo)).toBe(true);
    }
  });

  it('parses item lifecycle and reasoning delta notifications with 0.142.5 fields', () => {
    const cases: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/started',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          startedAtMs: 1783384428000,
          item: { type: 'plan', id: 'item_plan_1', text: 'plan' },
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          completedAtMs: 1783384429000,
          item: {
            type: 'reasoning',
            id: 'item_reason_1',
            summary: ['s'],
            content: ['c'],
          },
        },
      },
      {
        method: 'item/reasoning/textDelta',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'item_reason_1',
          delta: 'thinking',
          contentIndex: 0,
        },
      },
      {
        method: 'item/reasoning/summaryTextDelta',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'item_reason_1',
          delta: 'summary',
          summaryIndex: 1,
        },
      },
    ];

    for (const { method, params } of cases) {
      const schema = incomingNotificationSchemas[method];
      expect(schema, `missing schema for ${method}`).toBeDefined();
      if (!schema) continue;
      const result = schema.safeParse(params);
      expect(result.success, method).toBe(true);
    }
  });

  it('parses 0.142.5 server requests', () => {
    const requests = [
      {
        id: 201,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'item_cmd_1',
          startedAtMs: 1783384428000,
          approvalId: null,
          environmentId: null,
          command: 'npm test',
          cwd: '/tmp/project',
          commandActions: [],
          availableDecisions: ['accept', 'decline'],
          proposedNetworkPolicyAmendments: null,
        },
      },
      {
        id: 202,
        method: 'item/fileChange/requestApproval',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'item_file_1',
          startedAtMs: 1783384428000,
          reason: null,
        },
      },
      {
        id: 203,
        method: 'item/tool/requestUserInput',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'item_tool_1',
          questions: [],
          autoResolutionMs: null,
        },
      },
      {
        id: 204,
        method: 'item/tool/call',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          callId: 'call_1',
          namespace: null,
          tool: 'search',
          arguments: { q: 'hello' },
        },
      },
      {
        id: 205,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thr_1',
          turnId: null,
          serverName: 'everything',
          mode: 'openai/form',
          _meta: null,
          message: 'Fill the form',
          requestedSchema: { type: 'object', properties: {} },
        },
      },
    ];

    for (const request of requests) {
      const result = serverRequestSchema.safeParse(request);
      expect(result.success, request.method).toBe(true);
    }
  });
});
