import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  LanguageModelV2Content,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId } from '@ai-sdk/provider-utils';
import { getLogger } from './logger.js';
import type { CodexCliSettings, Logger } from './types.js';
import { validateModelId } from './validation.js';
import { mapMessagesToPrompt } from './message-mapper.js';
import { createAPICallError, createAuthenticationError } from './errors.js';

export interface CodexLanguageModelOptions {
  id: string; // model id for Codex (-m)
  settings?: CodexCliSettings;
}

// Experimental JSON event format from --experimental-json
interface ExperimentalJsonEvent {
  type?: string;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  item?: {
    id?: string;
    item_type?: string; // Flattened from ConversationItemDetails
    text?: string; // For assistant_message and reasoning items
    [k: string]: unknown;
  };
  message?: string; // For error events
  [k: string]: unknown;
}

function resolveCodexPath(
  explicitPath?: string,
  allowNpx?: boolean,
): { cmd: string; args: string[] } {
  if (explicitPath) return { cmd: 'node', args: [explicitPath] };

  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('@openai/codex/package.json');
    const root = pkgPath.replace(/package\.json$/, '');
    return { cmd: 'node', args: [root + 'bin/codex.js'] };
  } catch {
    // Fallback to PATH or npx
    if (allowNpx) return { cmd: 'npx', args: ['-y', '@openai/codex'] };
    return { cmd: 'codex', args: [] };
  }
}

export class CodexCliLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'codex-cli';
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = false;

  readonly modelId: string;
  readonly settings: CodexCliSettings;

  private logger: Logger;
  private sessionId?: string;

  constructor(options: CodexLanguageModelOptions) {
    this.modelId = options.id;
    this.settings = options.settings ?? {};
    this.logger = getLogger(this.settings.logger);
    if (!this.modelId || this.modelId.trim() === '') {
      throw new NoSuchModelError({ modelId: this.modelId, modelType: 'languageModel' });
    }
    const warn = validateModelId(this.modelId);
    if (warn) this.logger.warn(`Codex CLI model: ${warn}`);
  }

  private buildArgs(
    promptText: string,
    responseFormat?: { type: 'json'; schema: unknown },
  ): {
    cmd: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    lastMessagePath?: string;
    schemaPath?: string;
  } {
    const base = resolveCodexPath(this.settings.codexPath, this.settings.allowNpx);
    const args: string[] = [...base.args, 'exec', '--experimental-json'];

    // Approval/sandbox (exec subcommand does not accept -a/-s directly; use -c overrides)
    if (this.settings.fullAuto) {
      args.push('--full-auto');
    } else if (this.settings.dangerouslyBypassApprovalsAndSandbox) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      const approval = this.settings.approvalMode ?? 'on-failure';
      args.push('-c', `approval_policy=${approval}`);
      const sandbox = this.settings.sandboxMode ?? 'workspace-write';
      args.push('-c', `sandbox_mode=${sandbox}`);
    }

    if (this.settings.skipGitRepoCheck !== false) {
      args.push('--skip-git-repo-check');
    }

    if (this.settings.color) {
      args.push('--color', this.settings.color);
    }

    if (this.modelId) {
      args.push('-m', this.modelId);
    }

    // Handle JSON schema if provided
    let schemaPath: string | undefined;
    if (responseFormat?.type === 'json' && responseFormat.schema) {
      const dir = mkdtempSync(join(tmpdir(), 'codex-schema-'));
      schemaPath = join(dir, 'schema.json');

      // Sanitize and prepare schema for OpenAI strict mode
      const schema = typeof responseFormat.schema === 'object' ? responseFormat.schema : {};
      const sanitizedSchema = this.sanitizeJsonSchema(schema) as Record<string, unknown>;
      const schemaWithAdditional = {
        ...sanitizedSchema,
        // OpenAI strict mode requires additionalProperties=false even if user requested otherwise.
        additionalProperties: false,
      };

      writeFileSync(schemaPath, JSON.stringify(schemaWithAdditional, null, 2));
      args.push('--output-schema', schemaPath);
    }

    // Prompt as positional arg (avoid stdin for reliability)
    args.push(promptText);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(this.settings.env || {}),
      RUST_LOG: process.env.RUST_LOG || 'error',
    };

    // Configure output-last-message
    let lastMessagePath: string | undefined = this.settings.outputLastMessageFile;
    if (!lastMessagePath) {
      // create a temp folder for this run
      const dir = mkdtempSync(join(tmpdir(), 'codex-cli-'));
      lastMessagePath = join(dir, 'last-message.txt');
    }
    args.push('--output-last-message', lastMessagePath);

    return { cmd: base.cmd, args, env, cwd: this.settings.cwd, lastMessagePath, schemaPath };
  }

  private sanitizeJsonSchema(value: unknown): unknown {
    // Remove fields that OpenAI strict mode doesn't support
    // Based on codex-rs/core/src/openai_tools.rs sanitize_json_schema
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeJsonSchema(item));
    }

    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      // Special handling for 'properties' - preserve all property names, sanitize their schemas
      if (key === 'properties' && typeof val === 'object' && val !== null && !Array.isArray(val)) {
        const props = val as Record<string, unknown>;
        const sanitizedProps: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(props)) {
          // Keep property name, sanitize its schema
          sanitizedProps[propName] = this.sanitizeJsonSchema(propSchema);
        }
        result[key] = sanitizedProps;
        continue;
      }

      // Remove unsupported metadata fields
      if (
        key === '$schema' ||
        key === '$id' ||
        key === '$ref' ||
        key === '$defs' ||
        key === 'definitions' ||
        key === 'title' ||
        key === 'examples' ||
        key === 'default' ||
        key === 'format' || // OpenAI strict mode doesn't support format
        key === 'pattern' // OpenAI strict mode doesn't support pattern
      ) {
        continue;
      }

      // Recursively sanitize nested objects and arrays
      result[key] = this.sanitizeJsonSchema(val);
    }

    return result;
  }

  private mapWarnings(
    options: Parameters<LanguageModelV2['doGenerate']>[0],
  ): LanguageModelV2CallWarning[] {
    const unsupported: LanguageModelV2CallWarning[] = [];
    const add = (setting: unknown, name: string) => {
      if (setting !== undefined)
        unsupported.push({
          type: 'unsupported-setting',
          setting: name,
          details: `Codex CLI does not support ${name}; it will be ignored.`,
        } as LanguageModelV2CallWarning);
    };
    add(options.temperature, 'temperature');
    add(options.topP, 'topP');
    add(options.topK, 'topK');
    add(options.presencePenalty, 'presencePenalty');
    add(options.frequencyPenalty, 'frequencyPenalty');
    add(options.stopSequences?.length ? options.stopSequences : undefined, 'stopSequences');
    add((options as { seed?: unknown }).seed, 'seed');
    return unsupported;
  }

  private parseExperimentalJsonEvent(line: string): {
    sessionId?: string;
    text?: string;
    usage?: { inputTokens: number; outputTokens: number };
    error?: string;
  } {
    try {
      const evt: ExperimentalJsonEvent = JSON.parse(line);
      const result: ReturnType<typeof this.parseExperimentalJsonEvent> = {};

      switch (evt.type) {
        case 'session.created':
          result.sessionId = evt.session_id;
          break;

        case 'turn.completed':
          if (evt.usage) {
            result.usage = {
              inputTokens: evt.usage.input_tokens || 0,
              outputTokens: evt.usage.output_tokens || 0,
            };
          }
          break;

        case 'item.completed':
          // Extract assistant message text
          if (evt.item?.item_type === 'assistant_message' || evt.item?.item_type === 'reasoning') {
            result.text = evt.item.text;
          }
          break;

        case 'error':
          result.error = evt.message;
          break;
      }

      return result;
    } catch {
      return {};
    }
  }

  private handleSpawnError(err: unknown, promptExcerpt: string) {
    const e =
      err && typeof err === 'object'
        ? (err as {
            message?: unknown;
            code?: unknown;
            exitCode?: unknown;
            stderr?: unknown;
          })
        : undefined;
    const message = String((e?.message ?? err) || 'Failed to run Codex CLI');
    // crude auth detection
    if (/login|auth|unauthorized|not\s+logged/i.test(message)) {
      throw createAuthenticationError(message);
    }
    throw createAPICallError({
      message,
      code: typeof e?.code === 'string' ? e.code : undefined,
      exitCode: typeof e?.exitCode === 'number' ? e.exitCode : undefined,
      stderr: typeof e?.stderr === 'string' ? e.stderr : undefined,
      promptExcerpt,
    });
  }

  async doGenerate(
    options: Parameters<LanguageModelV2['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doGenerate']>>> {
    const { promptText, warnings: mappingWarnings } = mapMessagesToPrompt(options.prompt);
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...this.mapWarnings(options),
      ...(mappingWarnings?.map((m) => ({ type: 'other', message: m })) || []),
    ] as LanguageModelV2CallWarning[];

    const responseFormat =
      options.responseFormat?.type === 'json'
        ? { type: 'json' as const, schema: options.responseFormat.schema }
        : undefined;
    const { cmd, args, env, cwd, lastMessagePath, schemaPath } = this.buildArgs(
      promptText,
      responseFormat,
    );
    let text = '';
    const usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const finishReason: LanguageModelV2FinishReason = 'stop';

    const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    // Abort support
    let onAbort: (() => void) | undefined;
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        child.kill('SIGTERM');
        throw options.abortSignal.reason ?? new Error('Request aborted');
      }
      onAbort = () => child.kill('SIGTERM');
      options.abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await new Promise<void>((resolve, reject) => {
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += String(d)));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          const lines = chunk.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            const parsed = this.parseExperimentalJsonEvent(line);
            if (parsed.sessionId) this.sessionId = parsed.sessionId;
            if (parsed.text) text = parsed.text;
            if (parsed.usage) {
              usage.inputTokens = parsed.usage.inputTokens;
              usage.outputTokens = parsed.usage.outputTokens;
              usage.totalTokens = usage.inputTokens + usage.outputTokens;
            }
          }
        });
        child.on('error', (e) => reject(this.handleSpawnError(e, promptExcerpt)));
        child.on('close', (code) => {
          if (code === 0) resolve();
          else
            reject(
              createAPICallError({
                message: `Codex CLI exited with code ${code}`,
                exitCode: code ?? undefined,
                stderr,
                promptExcerpt,
              }),
            );
        });
      });
    } finally {
      if (options.abortSignal && onAbort) options.abortSignal.removeEventListener('abort', onAbort);
      // Clean up temp schema file
      if (schemaPath) {
        try {
          const schemaDir = dirname(schemaPath);
          rmSync(schemaDir, { recursive: true, force: true });
        } catch {}
      }
    }

    // Fallback: read last message file if needed
    if (!text && lastMessagePath) {
      try {
        const fileText = readFileSync(lastMessagePath, 'utf8');
        if (fileText && typeof fileText === 'string') {
          text = fileText.trim();
        }
      } catch {}
      // best-effort cleanup
      try {
        rmSync(lastMessagePath, { force: true });
      } catch {}
    }

    // No JSON extraction needed - native schema guarantees valid JSON

    const content: LanguageModelV2Content[] = [{ type: 'text', text }];
    return {
      content,
      usage,
      finishReason,
      warnings,
      response: { id: generateId(), timestamp: new Date(), modelId: this.modelId },
      request: { body: promptText },
      providerMetadata: {
        'codex-cli': { ...(this.sessionId ? { sessionId: this.sessionId } : {}) },
      },
    };
  }

  async doStream(
    options: Parameters<LanguageModelV2['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV2['doStream']>>> {
    const { promptText, warnings: mappingWarnings } = mapMessagesToPrompt(options.prompt);
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...this.mapWarnings(options),
      ...(mappingWarnings?.map((m) => ({ type: 'other', message: m })) || []),
    ] as LanguageModelV2CallWarning[];

    const responseFormat =
      options.responseFormat?.type === 'json'
        ? { type: 'json' as const, schema: options.responseFormat.schema }
        : undefined;
    const { cmd, args, env, cwd, lastMessagePath, schemaPath } = this.buildArgs(
      promptText,
      responseFormat,
    );

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: (controller) => {
        const child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });

        // Emit stream-start
        controller.enqueue({ type: 'stream-start', warnings });

        let stderr = '';
        let accumulatedText = '';

        // Abort support
        const onAbort = () => {
          child.kill('SIGTERM');
        };
        if (options.abortSignal) {
          if (options.abortSignal.aborted) {
            child.kill('SIGTERM');
            controller.error(options.abortSignal.reason ?? new Error('Request aborted'));
            return;
          }
          options.abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        child.stderr.on('data', (d) => (stderr += String(d)));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          const lines = chunk.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            const parsed = this.parseExperimentalJsonEvent(line);
            if (parsed.sessionId) {
              this.sessionId = parsed.sessionId;
              controller.enqueue({
                type: 'response-metadata',
                id: randomUUID(),
                timestamp: new Date(),
                modelId: this.modelId,
              });
            }
            if (parsed.text) {
              accumulatedText = parsed.text;
            }
          }
        });

        const cleanupSchema = () => {
          if (!schemaPath) return;
          try {
            const schemaDir = dirname(schemaPath);
            rmSync(schemaDir, { recursive: true, force: true });
          } catch {}
        };

        child.on('error', (e) => {
          if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);
          cleanupSchema();
          controller.error(this.handleSpawnError(e, promptExcerpt));
        });
        child.on('close', (code) => {
          if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);

          // Clean up temp schema file
          cleanupSchema();

          if (code !== 0) {
            controller.error(
              createAPICallError({
                message: `Codex CLI exited with code ${code}`,
                exitCode: code ?? undefined,
                stderr,
                promptExcerpt,
              }),
            );
            return;
          }

          // Emit text (non-streaming JSONL suppresses deltas; we send final text once)
          let finalText = accumulatedText;
          if (!finalText && lastMessagePath) {
            try {
              const fileText = readFileSync(lastMessagePath, 'utf8');
              if (fileText) finalText = fileText.trim();
            } catch {}
            try {
              rmSync(lastMessagePath, { force: true });
            } catch {}
          }

          // No JSON extraction needed - native schema guarantees valid JSON
          if (finalText) {
            controller.enqueue({ type: 'text-delta', id: randomUUID(), delta: finalText });
          }

          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          });
          controller.close();
        });
      },
      cancel: () => {},
    });

    return { stream, request: { body: promptText } } as Awaited<
      ReturnType<LanguageModelV2['doStream']>
    >;
  }
}
