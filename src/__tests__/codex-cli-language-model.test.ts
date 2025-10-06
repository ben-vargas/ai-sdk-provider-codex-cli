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
        type: 'thread.started',
        thread_id: 'thread-123',
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
    expect(res.providerMetadata?.['codex-cli']).toMatchObject({ sessionId: 'thread-123' });
    expect(res.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('doStream yields response-metadata, text-delta, finish', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({
        type: 'item.completed',
        item: { item_type: 'assistant_message', text: 'Streamed hello' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }),
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

  it('streams tool events for command execution items', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-tools' }),
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item_0',
          item_type: 'command_execution',
          command: 'ls -la',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          item_type: 'command_execution',
          command: 'ls -la',
          aggregated_output: 'README.md\n',
          exit_code: 0,
          status: 'completed',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', item_type: 'assistant_message', text: 'done' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1 },
      }),
    ];
    (childProc as any).__setSpawnMock(makeMockSpawn(lines, 0));

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, color: 'never' },
    });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'List files' }] as any,
    });

    const received: any[] = [];
    const rs = stream as ReadableStream<any>;
    const iterator = (rs as any)[Symbol.asyncIterator]();
    for await (const part of iterator) received.push(part);

    const toolCall = received.find((p) => p.type === 'tool-call');
    expect(toolCall?.toolName).toBe('exec');
    expect(toolCall?.providerExecuted).toBe(true);
    expect(toolCall?.input).toContain('ls -la');

    const toolResult = received.find((p) => p.type === 'tool-result');
    expect(toolResult?.toolCallId).toBe(toolCall?.toolCallId);
    expect(toolResult?.result).toMatchObject({
      command: 'ls -la',
      aggregatedOutput: 'README.md\n',
      exitCode: 0,
      status: 'completed',
    });

    const finish = received.find((p) => p.type === 'finish');
    expect(finish?.usage).toEqual({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
      cachedInputTokens: 1,
    });
  });

  it('includes approval/sandbox flags and output-last-message; uses npx with allowNpx', async () => {
    let seen: any = { cmd: '', args: [] as string[] };
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-2' }),
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

  it('sets isError for failed command execution', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-fail' }),
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item_fail',
          item_type: 'command_execution',
          command: 'false',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_fail',
          item_type: 'command_execution',
          command: 'false',
          aggregated_output: '',
          exit_code: 1,
          status: 'failed',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', item_type: 'assistant_message', text: 'oops' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }),
    ];
    (childProc as any).__setSpawnMock(makeMockSpawn(lines, 0));

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { allowNpx: true, color: 'never' },
    });
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: 'fail please' }] as any,
    });

    const received: any[] = [];
    const rs = stream as ReadableStream<any>;
    for await (const part of (rs as any)[Symbol.asyncIterator]()) received.push(part);

    const toolResult = received.find((p) => p.type === 'tool-result');
    expect(toolResult?.isError).toBe(true);
    expect(toolResult?.toolName).toBe('exec');
    expect(toolResult?.result).toMatchObject({
      command: 'false',
      exitCode: 1,
      status: 'failed',
    });
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

  describe('Phase 1: constructor-level parameters', () => {
    it('emits -c model_reasoning_* and model_verbosity args when set', async () => {
      let seen: any = { args: [] as string[] };
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-reason' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        seen = { args };
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5-codex',
        settings: {
          allowNpx: true,
          color: 'never',
          reasoningEffort: 'high',
          reasoningSummary: 'detailed',
          reasoningSummaryFormat: 'experimental',
          modelVerbosity: 'low',
        },
      });
      await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

      const a = seen.args as string[];
      expect(a).toContain('-c');
      expect(a).toContain('model_reasoning_effort=high');
      expect(a).toContain('model_reasoning_summary=detailed');
      expect(a).toContain('model_reasoning_summary_format=experimental');
      expect(a).toContain('model_verbosity=low');
    });

    it('emits advanced feature flags (--include-plan-tool, --profile, --oss) and webSearch config', async () => {
      let seen: any = { args: [] as string[] };
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-adv' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        seen = { args };
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: {
          allowNpx: true,
          includePlanTool: true,
          profile: 'production',
          oss: true,
          webSearch: true,
          color: 'never',
        },
      });
      await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

      const a = seen.args as string[];
      expect(a).toContain('--include-plan-tool');
      expect(a).toContain('--profile');
      expect(a).toContain('production');
      expect(a).toContain('--oss');
      expect(a).toContain('tools.web_search=true');
    });

    it('emits -c for configOverrides with string, number, boolean, and object', async () => {
      let seen: any = { args: [] as string[] };
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-over' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        seen = { args };
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: {
          allowNpx: true,
          color: 'never',
          configOverrides: {
            experimental_resume: '/tmp/session.jsonl',
            hide_agent_reasoning: true,
            model_context_window: 200000,
            sandbox_workspace_write: { network_access: true },
          },
        },
      });
      await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

      const a = seen.args as string[];
      expect(a).toContain('experimental_resume=/tmp/session.jsonl');
      expect(a).toContain('hide_agent_reasoning=true');
      expect(a).toContain('model_context_window=200000');
      expect(a).toContain('sandbox_workspace_write.network_access=true');
    });

    it('handles deep nesting, arrays, and dotted keys in configOverrides', async () => {
      let argsCaptured: string[] = [];
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-over-2' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        argsCaptured = args;
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: {
          allowNpx: true,
          color: 'never',
          configOverrides: {
            deep: { nested: { value: true } },
            arr: [1, 2],
            'dotted.key': 'val',
          },
        },
      });
      await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

      expect(argsCaptured).toContain('deep.nested.value=true');
      expect(argsCaptured).toContain('arr=[1,2]');
      expect(argsCaptured).toContain('dotted.key=val');
    });

    it('keeps reasoning flags when fullAuto is enabled (but omits approval/sandbox overrides)', async () => {
      let lastArgs: string[] = [];
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-fa' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        lastArgs = args;
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: { allowNpx: true, color: 'never', fullAuto: true, reasoningEffort: 'medium' },
      });
      await model.doGenerate({ prompt: [{ role: 'user', content: 'Hi' }] as any });

      expect(lastArgs).toContain('--full-auto');
      expect(lastArgs.join(' ')).not.toMatch(/approval_policy|sandbox_mode/);
      expect(lastArgs).toContain('model_reasoning_effort=medium');
    });
  });

  describe('Phase 2: providerOptions overrides', () => {
    it('overrides constructor reasoning settings per call', async () => {
      let argsCaptured: string[] = [];
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-phase2' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        argsCaptured = args;
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5-codex',
        settings: {
          allowNpx: true,
          color: 'never',
          reasoningEffort: 'low',
        },
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: 'Hi' }] as any,
        providerOptions: {
          'codex-cli': {
            reasoningEffort: 'high',
            reasoningSummary: 'detailed',
          },
        },
      });

      expect(argsCaptured).toContain('model_reasoning_effort=high');
      expect(argsCaptured.join(' ')).not.toContain('model_reasoning_effort=low');
      expect(argsCaptured).toContain('model_reasoning_summary=detailed');
    });

    it('merges configOverrides with per-call overrides taking precedence', async () => {
      let argsCaptured: string[] = [];
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-config' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        argsCaptured = args;
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: {
          allowNpx: true,
          color: 'never',
          configOverrides: {
            setting1: 'value1',
            setting2: 'value2',
          },
        },
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: 'Hi' }] as any,
        providerOptions: {
          'codex-cli': {
            configOverrides: {
              setting2: 'override',
              setting3: 'value3',
            },
          },
        },
      });

      expect(argsCaptured).toContain('setting1=value1');
      expect(argsCaptured).toContain('setting2=override');
      expect(argsCaptured.join(' ')).not.toContain('setting2=value2');
      expect(argsCaptured).toContain('setting3=value3');
    });

    it('maps textVerbosity provider option to model_verbosity flag', async () => {
      let argsCaptured: string[] = [];
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-verbosity' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'ok' },
        }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        argsCaptured = args;
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: { allowNpx: true, color: 'never' },
      });

      await model.doGenerate({
        prompt: [{ role: 'user', content: 'Hi' }] as any,
        providerOptions: {
          'codex-cli': {
            textVerbosity: 'high',
          },
        },
      });

      expect(argsCaptured).toContain('model_verbosity=high');
    });

    it('applies providerOptions during streaming calls', async () => {
      let argsCaptured: string[] = [];
      const lines = [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-stream' }),
        JSON.stringify({
          type: 'item.completed',
          item: { item_type: 'assistant_message', text: 'stream ok' },
        }),
        JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } }),
      ];
      (childProc as any).__setSpawnMock((cmd: string, args: string[]) => {
        argsCaptured = args;
        return makeMockSpawn(lines, 0)(cmd, args);
      });

      const model = new CodexCliLanguageModel({
        id: 'gpt-5',
        settings: { allowNpx: true, color: 'never' },
      });

      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: 'Hi' }] as any,
        providerOptions: {
          'codex-cli': {
            reasoningEffort: 'medium',
            textVerbosity: 'low',
          },
        },
      });

      const reader = (stream as any)[Symbol.asyncIterator]();
      for await (const _ of reader) {
        // exhaust stream to ensure spawn completes
      }

      expect(argsCaptured).toContain('model_reasoning_effort=medium');
      expect(argsCaptured).toContain('model_verbosity=low');
    });
  });
});
