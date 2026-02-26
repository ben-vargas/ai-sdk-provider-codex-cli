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
