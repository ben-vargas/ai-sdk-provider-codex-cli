import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  incomingNotificationSchemas,
  serverRequestSchema,
} from '../app-server/protocol/validators.js';
// Imported from the package entry point on purpose: consumers must be able to
// name these types from 'ai-sdk-provider-codex-cli', not just the internal module.
import type { CodexErrorInfo, TurnError } from '../index.js';

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

  it('tolerates unknown codexErrorInfo variants but rejects non-string/non-object payloads', () => {
    const schema = incomingNotificationSchemas['turn/completed'];
    expect(schema).toBeDefined();
    if (!schema) return;

    const turnWithErrorInfo = (codexErrorInfo: unknown) => ({
      threadId: 'thr_1',
      turn: {
        id: 'turn_1',
        items: [],
        status: 'failed',
        error: {
          message: 'boom',
          codexErrorInfo,
          additionalDetails: null,
        },
      },
    });

    // Unknown future variants must validate; dropping the notification would
    // hang the stream (turn/completed is the only completion signal).
    expect(schema.safeParse(turnWithErrorInfo({ unsupported: true })).success).toBe(true);
    expect(schema.safeParse(turnWithErrorInfo('futureErrorCode')).success).toBe(true);

    // Structurally invalid payloads are still rejected.
    expect(schema.safeParse(turnWithErrorInfo(42)).success).toBe(false);
    expect(schema.safeParse(turnWithErrorInfo(['other'])).success).toBe(false);
  });
});

describe('codex 0.153.4 protocol shapes', () => {
  // Every fixture below was captured from a real `codex app-server` 0.153.4
  // turn on gpt-6-astra; only the cwd (/tmp/project) and the thread/turn/item
  // identifiers were replaced with synthetic values of the same shape.
  function loadFixture(name: string): { method: string; params: Record<string, unknown> } {
    return JSON.parse(readFileSync(join(fixturesRoot, 'notifications', name), 'utf8')) as {
      method: string;
      params: Record<string, unknown>;
    };
  }

  function parse(name: string) {
    const fixture = loadFixture(name);
    const schema = incomingNotificationSchemas[fixture.method];
    expect(schema, `missing schema for ${fixture.method}`).toBeDefined();
    const result = schema!.safeParse(fixture.params);
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
    return result.success ? (result.data as Record<string, unknown>) : {};
  }

  it('parses thread/started with the 0.153 thread metadata (model, reasoningEffort, cliVersion)', () => {
    const data = parse('thread-started-codex-0153.json');
    const thread = data.thread as Record<string, unknown>;
    expect(thread.model).toBe('gpt-6-astra');
    expect(thread.reasoningEffort).toBe('xhigh');
    expect(thread.cliVersion).toBe('0.153.4');
    expect(thread.modelProvider).toBe('openai');
  });

  it('parses turn/started and turn/completed with itemsView/startedAt/durationMs', () => {
    const started = parse('turn-started-codex-0153.json');
    expect((started.turn as Record<string, unknown>).status).toBe('inProgress');
    expect((started.turn as Record<string, unknown>).itemsView).toBe('notLoaded');

    const completed = parse('turn-completed-codex-0153.json');
    const turn = completed.turn as Record<string, unknown>;
    expect(turn.status).toBe('completed');
    expect(turn.itemsView).toBe('summary');
    expect(typeof turn.durationMs).toBe('number');
    const items = turn.items as Array<Record<string, unknown>>;
    expect(items[0]?.type).toBe('agentMessage');
    expect(items[0]?.text).toBe('pong');
  });

  it('parses agentMessage items carrying delivery/questions and completedAtMs', () => {
    const data = parse('item-completed-agent-message-codex-0153.json');
    const item = data.item as Record<string, unknown>;
    expect(item.type).toBe('agentMessage');
    expect(item.phase).toBe('final_answer');
    expect(item.delivery).toBeNull();
    expect(item.questions).toBeNull();
    expect(typeof data.completedAtMs).toBe('number');
  });

  it('parses userMessage items started by the server (clientId, text_elements)', () => {
    const data = parse('item-started-user-message-codex-0153.json');
    const item = data.item as { type: string; content: Array<{ type: string }> };
    expect(item.type).toBe('userMessage');
    expect(item.content[0]?.type).toBe('text');
    expect(typeof data.startedAtMs).toBe('number');
  });

  it('parses thread/tokenUsage/updated including cacheWriteInputTokens', () => {
    const data = parse('token-usage-updated-codex-0153.json');
    const usage = data.tokenUsage as { last: Record<string, number>; modelContextWindow: number };
    expect(usage.last.inputTokens).toBe(16539);
    expect(usage.last.cacheWriteInputTokens).toBe(0);
    expect(usage.last.reasoningOutputTokens).toBe(0);
    expect(usage.modelContextWindow).toBe(258400);
  });

  it('types the 0.153 error codes and forward-compat variants the validator accepts', () => {
    // Compile-time: every value the schema admits must be representable without
    // casts, and comparisons against the new codes must not be no-overlap errors.
    const known: CodexErrorInfo[] = [
      'rateLimitExceeded',
      'sessionBudgetExceeded',
      'misalignmentPolicyViolation',
      'cyberPolicy',
      { activeTurnNotSteerable: { turnKind: 'review' } },
      { httpConnectionFailed: { httpStatusCode: 429 } },
      'someFutureCode',
    ];
    // Compile-time: `in` guards on known object variants must keep narrowing
    // their payload (an open object catch-all in the union would make these
    // `unknown`, which is why the type has none).
    const narrow = (info: CodexErrorInfo): number | string | null | undefined => {
      if (typeof info === 'object' && 'httpConnectionFailed' in info) {
        return info.httpConnectionFailed.httpStatusCode;
      }
      if (typeof info === 'object' && 'activeTurnNotSteerable' in info) {
        return info.activeTurnNotSteerable.turnKind;
      }
      return undefined;
    };
    expect(narrow({ httpConnectionFailed: { httpStatusCode: 429 } })).toBe(429);
    expect(narrow({ activeTurnNotSteerable: { turnKind: 'review' } })).toBe('review');
    expect(narrow('rateLimitExceeded')).toBeUndefined();
    const schema = incomingNotificationSchemas['turn/completed'];
    expect(schema).toBeDefined();
    if (!schema) return;

    for (const codexErrorInfo of known) {
      const error: TurnError = { message: 'boom', codexErrorInfo, additionalDetails: null };
      const parsed = schema.safeParse({
        threadId: 'thr_1',
        turn: { id: 'turn_1', items: [], status: 'failed', error },
      });
      expect(parsed.success, JSON.stringify(codexErrorInfo)).toBe(true);
      if (parsed.success) {
        const data = parsed.data as { turn: { error: TurnError } };
        const roundTripped: CodexErrorInfo | null = data.turn.error.codexErrorInfo;
        expect(roundTripped).toEqual(codexErrorInfo);
        if (roundTripped === 'rateLimitExceeded') expect(codexErrorInfo).toBe('rateLimitExceeded');
      }
    }
  });

  it('parses the 0.153 error codes without dropping the notification', () => {
    const schema = incomingNotificationSchemas['error'];
    expect(schema).toBeDefined();
    if (!schema) return;

    for (const codexErrorInfo of [
      'rateLimitExceeded',
      'sessionBudgetExceeded',
      'misalignmentPolicyViolation',
    ]) {
      const result = schema.safeParse({
        threadId: 'thr_1',
        turnId: 'turn_1',
        willRetry: false,
        error: {
          message: `failed with ${codexErrorInfo}`,
          codexErrorInfo,
          additionalDetails: null,
          misalignment: null,
        },
      });
      expect(result.success, codexErrorInfo).toBe(true);
    }
  });

  it('accepts the 0.153 approval policy variants on server request fixtures', () => {
    const result = serverRequestSchema.safeParse({
      id: 301,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_cmd_1',
        environmentId: null,
        startedAtMs: 1788939107841,
        approvalId: null,
        reason: null,
        networkApprovalContext: null,
        command: 'npm test',
        cwd: '/tmp/project',
        commandActions: [],
        additionalPermissions: null,
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
      },
    });
    expect(result.success).toBe(true);
  });
});
