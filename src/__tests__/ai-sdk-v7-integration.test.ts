/**
 * End-to-end integration tests: AI SDK v7 (`ai` package) <-> this provider.
 *
 * These tests call the provider exclusively through the real `ai@7`
 * entrypoints (generateText, streamText, generateObject) so that any
 * spec-version or shape mismatch between ai@7 and the LanguageModelV4
 * implementation fails loudly. The Codex CLI child process is mocked at the
 * `node:child_process` boundary using the same pattern as
 * exec-language-model.test.ts; everything between `ai` and `spawn` is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateText, streamText, generateObject } from 'ai';
import { z } from 'zod';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { createCodexExec } from '../index.js';

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: (signal?: string) => void;
  /** Returns everything the provider wrote to the child's stdin (the prompt). */
  _stdinData: () => string;
}

type SpawnFn = (cmd: string, args: string[]) => MockChildProcess;

interface MockableChildProcess {
  __setSpawnMock: (fn: SpawnFn) => void;
}

vi.mock('node:child_process', () => {
  let currentSpawn: ((cmd: string, args: string[]) => unknown) | undefined;
  return {
    spawn: (cmd: string, args: string[]) => {
      if (!currentSpawn) throw new Error('spawn mock not installed for this test');
      return currentSpawn(cmd, args);
    },
    __setSpawnMock: (fn: (cmd: string, args: string[]) => unknown) => {
      currentSpawn = fn;
    },
  };
});

// The vi.mock factory augments the mocked module with __setSpawnMock, which
// the node:child_process module type cannot express.
const mockableChildProcess = childProcess as unknown as MockableChildProcess;

/** Emits the given JSONL lines on stdout, then closes with the exit code. */
function makeMockSpawn(lines: string[], exitCode = 0): SpawnFn {
  return (_cmd, args) => {
    const child = new EventEmitter() as MockChildProcess;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = vi.fn();

    let stdinData = '';
    child.stdin.on('data', (chunk: Buffer) => {
      stdinData += chunk.toString();
    });

    // Mirror the real CLI: --output-last-message file gets the final text.
    const idx = args.indexOf('--output-last-message');
    const lastMessagePath = idx !== -1 ? args[idx + 1] : undefined;
    if (lastMessagePath) {
      try {
        writeFileSync(lastMessagePath, 'Fallback last message\n');
      } catch {
        // best-effort, like the real CLI
      }
    }

    // Emit asynchronously (deterministic, no wall-clock delay) so the
    // provider has attached its stdout listeners before data flows.
    setImmediate(() => {
      for (const l of lines) child.stdout.write(l + '\n');
      child.stdout.end();
      child.emit('close', exitCode);
    });

    child._stdinData = () => stdinData;
    return child;
  };
}

/**
 * What the provider actually handed to the (mocked) codex process.
 * Temp files (--output-schema, --image) are snapshotted at spawn time,
 * before the provider deletes them on process close.
 */
interface SpawnCapture {
  cmd: string;
  args: string[];
  stdin: () => string;
  schemaFileAtSpawn: string | undefined;
  imageFilesAtSpawn: Buffer[];
}

function installCapturingSpawn(lines: string[]): SpawnCapture {
  const capture: SpawnCapture = {
    cmd: '',
    args: [],
    stdin: () => '',
    schemaFileAtSpawn: undefined,
    imageFilesAtSpawn: [],
  };

  mockableChildProcess.__setSpawnMock((cmd, args) => {
    capture.cmd = cmd;
    capture.args = [...args];

    const schemaIdx = args.indexOf('--output-schema');
    const schemaPath = schemaIdx === -1 ? undefined : args[schemaIdx + 1];
    if (schemaPath) {
      capture.schemaFileAtSpawn = readFileSync(schemaPath, 'utf8');
    }

    for (let i = 0; i < args.length - 1; i += 1) {
      const value = args[i + 1];
      if (args[i] === '--image' && value) {
        capture.imageFilesAtSpawn.push(readFileSync(value));
      }
    }

    const child = makeMockSpawn(lines)(cmd, args);
    capture.stdin = () => child._stdinData();
    return child;
  });

  return capture;
}

function codexTurn(text: string, threadId = 'thread-v7'): string[] {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: threadId }),
    JSON.stringify({
      type: 'item.completed',
      item: { item_type: 'assistant_message', text },
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 12, output_tokens: 7 },
    }),
  ];
}

const provider = createCodexExec({
  defaultSettings: { allowNpx: true, color: 'never' },
});

describe('AI SDK v7 integration (exec provider)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generateText returns the text produced by the codex output', async () => {
    const capture = installCapturingSpawn(
      codexTurn('Hello from Codex via AI SDK v7', 'thread-gen'),
    );

    const result = await generateText({
      model: provider('gpt-5'),
      prompt: 'Say hi',
    });

    expect(result.text).toBe('Hello from Codex via AI SDK v7');
    expect(result.finishReason).toBe('stop');
    // v4 nested usage is mapped into ai@7's flat usage numbers.
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(7);
    // Provider metadata (session id) survives the round trip.
    expect(result.finalStep.providerMetadata?.['codex-cli']).toMatchObject({
      sessionId: 'thread-gen',
    });
    // The model id chosen through the v7 provider call routes into the CLI.
    const modelFlag = capture.args.indexOf('-m');
    expect(modelFlag).toBeGreaterThan(-1);
    expect(capture.args[modelFlag + 1]).toBe('gpt-5');
    // The prompt text actually reaches codex on stdin.
    expect(capture.stdin()).toContain('User: Say hi');
  });

  // KNOWN BUG (do not "fix" this test — fix the provider): ai@7 normalizes an
  // unset toolChoice to { type: 'auto' } before calling the model, and the
  // provider warns on ANY defined toolChoice. A bare generateText call should
  // be warning-free. Marked `.fails` so it passes while the bug exists and
  // flags loudly once the provider stops warning on ai@7's default toolChoice
  // (then remove `.fails`).
  it.fails('a bare generateText call surfaces no unsupported-setting warnings', async () => {
    installCapturingSpawn(codexTurn('plain'));

    const result = await generateText({
      model: provider('gpt-5'),
      prompt: 'Plain call',
    });

    expect(result.warnings ?? []).toEqual([]);
  });

  it('streamText yields text deltas and a finish part via result.stream', async () => {
    installCapturingSpawn(codexTurn('Streamed via v7', 'thread-stream'));

    const result = streamText({
      model: provider('gpt-5'),
      prompt: 'Stream it',
    });

    let streamedText = '';
    let sawTextStart = false;
    let sawTextEnd = false;
    let finishReason: string | undefined;
    let finishOutputTokens: number | undefined;

    for await (const part of result.stream) {
      if (part.type === 'text-start') sawTextStart = true;
      if (part.type === 'text-delta') streamedText += part.text;
      if (part.type === 'text-end') sawTextEnd = true;
      if (part.type === 'finish') {
        finishReason = part.finishReason;
        finishOutputTokens = part.totalUsage.outputTokens;
      }
    }

    expect(streamedText).toBe('Streamed via v7');
    expect(sawTextStart).toBe(true);
    expect(sawTextEnd).toBe(true);
    expect(finishReason).toBe('stop');
    expect(finishOutputTokens).toBe(7);
    await expect(result.text).resolves.toBe('Streamed via v7');
  });

  it('generateObject parses codex JSON output and sends the zod schema via --output-schema', async () => {
    const capture = installCapturingSpawn(
      codexTurn('{"name":"Ada Lovelace","age":36}', 'thread-obj'),
    );

    const result = await generateObject({
      model: provider('gpt-5'),
      schema: z.object({ name: z.string(), age: z.number() }),
      prompt: 'Extract the person',
    });

    expect(result.object).toEqual({ name: 'Ada Lovelace', age: 36 });

    // The zod schema flowed through ai@7's responseFormat into the CLI's
    // --output-schema temp file (snapshotted before the provider cleaned it up).
    expect(capture.args).toContain('--output-schema');
    expect(capture.schemaFileAtSpawn).toBeDefined();
    const schemaJson = JSON.parse(capture.schemaFileAtSpawn ?? '{}') as Record<string, unknown>;
    expect(schemaJson).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    });
    expect(schemaJson.required).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('top-level reasoning option maps to the codex reasoning-effort config', async () => {
    const capture = installCapturingSpawn(codexTurn('Thought hard.'));

    await generateText({
      model: provider('gpt-5'),
      prompt: 'Think hard',
      reasoning: 'high',
    });

    expect(capture.args.join(' ')).toContain('-c model_reasoning_effort=high');
  });

  it('provider-specific reasoningEffort wins over the top-level reasoning option', async () => {
    const capture = installCapturingSpawn(codexTurn('Thought a little.'));

    await generateText({
      model: provider('gpt-5'),
      prompt: 'Think a little',
      reasoning: 'high',
      providerOptions: { 'codex-cli': { reasoningEffort: 'low' } },
    });

    const joined = capture.args.join(' ');
    expect(joined).toContain('model_reasoning_effort=low');
    expect(joined).not.toContain('model_reasoning_effort=high');
  });

  it('instructions arrive as system guidance ahead of the user turn in the prompt', async () => {
    const capture = installCapturingSpawn(codexTurn('Bonjour !'));

    const result = await generateText({
      model: provider('gpt-5'),
      instructions: 'Answer only in French.',
      prompt: 'Greet me',
    });

    expect(result.text).toBe('Bonjour !');
    const stdin = capture.stdin();
    expect(stdin).toContain('Answer only in French.');
    expect(stdin).toContain('User: Greet me');
    // System guidance precedes the user turn.
    expect(stdin.indexOf('Answer only in French.')).toBeLessThan(stdin.indexOf('User: Greet me'));
  });

  it('a v4 tagged-data image file part flows into the --image temp-file pathway', async () => {
    const capture = installCapturingSpawn(codexTurn('A tiny PNG'));

    // PNG signature + start of an IHDR chunk.
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ]);

    const result = await generateText({
      model: provider('gpt-5'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'file', mediaType: 'image/png', data: { type: 'data', data: pngBytes } },
          ],
        },
      ],
    });

    expect(result.text).toBe('A tiny PNG');

    // The image bytes were written to a temp file and passed via --image,
    // byte-for-byte identical to the original input.
    expect(capture.args).toContain('--image');
    expect(capture.imageFilesAtSpawn).toHaveLength(1);
    const [imageFile] = capture.imageFilesAtSpawn;
    if (!imageFile) throw new Error('expected an --image temp file at spawn time');
    expect(Buffer.compare(imageFile, Buffer.from(pngBytes))).toBe(0);

    // Regression guard (issue #19): '--' must separate the greedy --image
    // flag from the '-' stdin marker.
    expect(capture.args.at(-2)).toBe('--');
    expect(capture.args.at(-1)).toBe('-');

    // The user turn carries the attachment marker on stdin.
    expect(capture.stdin()).toContain('[1 image attached]');

    // Conversion is warning-free: the tagged-data path succeeded rather than
    // falling into an unsupported-image warning.
    const warningText = JSON.stringify(result.warnings ?? []);
    expect(warningText).not.toMatch(/image/i);
  });
});
