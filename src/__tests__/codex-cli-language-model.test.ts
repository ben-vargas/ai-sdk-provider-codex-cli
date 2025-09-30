import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexCliLanguageModel } from '../codex-cli-language-model.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Helper to create a mock spawn that emits JSONL events
function makeMockSpawn(lines: string[], exitCode = 0) {
  return vi.fn((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();

    // If our code passes --output-last-message <path>, write there too
    const idx = args.indexOf('--output-last-message');
    if (idx !== -1 && args[idx + 1]) {
      try {
        writeFileSync(args[idx + 1], 'Fallback last message\n');
      } catch {}
    }

    // emit lines asynchronously
    setTimeout(() => {
      for (const l of lines) child.stdout.write(l + '\n');
      child.stdout.end();
      child.emit('close', exitCode);
    }, 5);

    return child;
  });
}

// Mock child_process
vi.mock('node:child_process', async () => {
  let currentMock: (cmd: string, args: string[]) => any = makeMockSpawn([], 0) as any;
  const mod = {
    spawn: (cmd: string, args: string[]) => currentMock(cmd, args),
    __setSpawnMock: (fn: any) => {
      currentMock = fn;
    },
  } as any;
  return mod;
});

// Access the helper to swap mocks inside tests
const childProc = await import('node:child_process');

describe('CodexCliLanguageModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('doGenerate returns text and sessionId from experimental JSON events', async () => {
    const lines = [
      JSON.stringify({
        type: 'session.created',
        session_id: 'session-123',
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { item_type: 'assistant_message', text: 'Hello JSON' },
      }),
    ];
    (childProc as any).__setSpawnMock(makeMockSpawn(lines, 0));

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, color: 'never' },
    });
    const res = await model.doGenerate({ prompt: [{ role: 'user', content: 'Say hi' }] as any });
    expect(res.content[0]).toMatchObject({ type: 'text', text: 'Hello JSON' });
    expect(res.providerMetadata?.['codex-cli']).toMatchObject({ sessionId: 'session-123' });
    expect(res.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('doStream yields response-metadata, text-delta, finish', async () => {
    const lines = [
      JSON.stringify({ type: 'session.created', session_id: 'sess-1' }),
      JSON.stringify({
        type: 'item.completed',
        item: { item_type: 'assistant_message', text: 'Streamed hello' },
      }),
    ];
    (childProc as any).__setSpawnMock(makeMockSpawn(lines, 0));

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, color: 'never' },
    });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'Say hi' }] as any,
    });

    const received: any[] = [];
    const _reader = (stream as any).getReader ? undefined : null; // ensure Web stream compat
    const rs = stream as ReadableStream<any>;
    const it = (rs as any)[Symbol.asyncIterator]();
    for await (const part of it) received.push(part);

    const types = received.map((p) => p.type);
    expect(types).toContain('response-metadata');
    expect(types).toContain('text-delta');
    expect(types).toContain('finish');
    const deltaPayload = received.find((p) => p.type === 'text-delta');
    expect(deltaPayload?.delta).toBe('Streamed hello');
  });

  it('includes approval/sandbox flags and output-last-message; uses npx with allowNpx', async () => {
    let seen: any = { cmd: '', args: [] as string[] };
    const lines = [
      JSON.stringify({ type: 'session.created', session_id: 'sess-2' }),
      JSON.stringify({
        type: 'item.completed',
        item: { item_type: 'assistant_message', text: 'OK' },
      }),
    ];
    (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
      seen = { cmd, args };
      return makeMockSpawn(lines, 0)(cmd, args);
    });

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: {
        allowNpx: true,
        color: 'never',
        approvalMode: 'on-failure',
        sandboxMode: 'workspace-write',
        skipGitRepoCheck: true,
        outputLastMessageFile: join(mkdtempSync(join(tmpdir(), 'codex-test-')), 'last.txt'),
      },
    });

    await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

    expect(['npx', 'node']).toContain(seen.cmd);
    expect(seen.args).toContain('exec');
    expect(seen.args).toContain('--experimental-json');
    expect(seen.args).not.toContain('--json');
    expect(seen.args).toContain('-c');
    expect(seen.args).toContain('approval_policy=on-failure');
    expect(seen.args).toContain('sandbox_mode=workspace-write');
    expect(seen.args).toContain('--skip-git-repo-check');
    expect(seen.args).toContain('--output-last-message');
  });

  it('uses --full-auto when specified and omits -c flags', async () => {
    let lastArgs: string[] = [];
    const lines = [
      JSON.stringify({
        id: '1',
        msg: {
          type: 'session_configured',
          session_id: 'sess-3',
          model: 'gpt-5',
          history_log_id: 0,
          history_entry_count: 0,
        },
      }),
      JSON.stringify({ id: '2', msg: { type: 'task_complete', last_agent_message: 'OK' } }),
    ];
    (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
      lastArgs = args;
      return makeMockSpawn(lines, 0)(cmd, args);
    });

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, fullAuto: true, color: 'never' },
    });
    await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

    expect(lastArgs).toContain('--full-auto');
    // No -c flags when fullAuto
    expect(lastArgs.join(' ')).not.toMatch(/approval_policy|sandbox_mode/);
  });

  it('rejects with APICallError on non-zero exit', async () => {
    (childProc as any).__setSpawnMock(makeMockSpawn([], 2));
    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, color: 'never' },
    });
    await expect(
      model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any }),
    ).rejects.toMatchObject({
      name: 'AI_APICallError',
      data: { exitCode: 2 },
    });
  });

  // Note: auth error mapping is covered via error helpers; CLI error path requires real process semantics.

  it('propagates pre-aborted signal reason and kills child', async () => {
    let killed = false;
    (childProc as any).__setSpawnMock((_cmd: string, _args: string[]) => {
      const child = new EventEmitter() as any;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn(() => {
        killed = true;
      });
      return child;
    });

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, color: 'never' },
    });
    const ac = new AbortController();
    const reason = new Error('aborted');
    ac.abort(reason);
    await expect(
      model.doGenerate({
        prompt: [{ role: 'user', content: 'Hi' }] as any,
        abortSignal: ac.signal,
      }),
    ).rejects.toBe(reason);
    expect(killed).toBe(true);
  });
});
