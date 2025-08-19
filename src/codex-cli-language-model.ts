import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { extractJson } from './extract-json.js';
import { getLogger } from './logger.js';
import type { CodexCliSettings, Logger } from './types.js';
import { validateModelId } from './validation.js';
import { mapMessagesToPrompt } from './message-mapper.js';
import { createAPICallError, createAuthenticationError } from './errors.js';

export interface CodexLanguageModelOptions {
  id: string; // model id for Codex (-m)
  settings?: CodexCliSettings;
}

interface CodexEventMessage {
  type?: string;
  session_id?: string;
  last_agent_message?: unknown;
  [k: string]: unknown;
}

interface CodexJsonEvent {
  id?: string;
  msg?: CodexEventMessage;
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

  private buildArgs(promptText: string): {
    cmd: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    lastMessagePath?: string;
  } {
    const base = resolveCodexPath(this.settings.codexPath, this.settings.allowNpx);
    const args: string[] = [...base.args, 'exec', '--json'];

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

    return { cmd: base.cmd, args, env, cwd: this.settings.cwd, lastMessagePath };
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

  private parseJsonLine(line: string): CodexJsonEvent | undefined {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
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
    const mode =
      options.responseFormat?.type === 'json'
        ? { type: 'object-json' as const }
        : { type: 'regular' as const };
    const { promptText, warnings: mappingWarnings } = mapMessagesToPrompt(
      options.prompt,
      mode,
      options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined,
    );
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...this.mapWarnings(options),
      ...(mappingWarnings?.map((m) => ({ type: 'other', message: m })) || []),
    ] as LanguageModelV2CallWarning[];

    const { cmd, args, env, cwd, lastMessagePath } = this.buildArgs(promptText);
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
            const evt = this.parseJsonLine(line);
            if (!evt) continue;
            const msg = evt.msg;
            const type = msg?.type;
            if (type === 'session_configured' && msg) {
              this.sessionId = msg.session_id;
            } else if (type === 'task_complete' && msg) {
              const last = msg.last_agent_message;
              if (typeof last === 'string') text = last;
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

    if (options.responseFormat?.type === 'json' && text) {
      text = extractJson(text);
    }

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
    const mode =
      options.responseFormat?.type === 'json'
        ? { type: 'object-json' as const }
        : { type: 'regular' as const };
    const { promptText, warnings: mappingWarnings } = mapMessagesToPrompt(
      options.prompt,
      mode,
      options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined,
    );
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...this.mapWarnings(options),
      ...(mappingWarnings?.map((m) => ({ type: 'other', message: m })) || []),
    ] as LanguageModelV2CallWarning[];

    const { cmd, args, env, cwd, lastMessagePath } = this.buildArgs(promptText);

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
            const evt = this.parseJsonLine(line);
            if (!evt) continue;
            const msg = evt.msg;
            const type = msg?.type;
            if (type === 'session_configured' && msg) {
              this.sessionId = msg.session_id;
              controller.enqueue({
                type: 'response-metadata',
                id: randomUUID(),
                timestamp: new Date(),
                modelId: this.modelId,
              });
            } else if (type === 'task_complete' && msg) {
              const last = msg.last_agent_message;
              if (typeof last === 'string') {
                accumulatedText = last;
              }
            }
          }
        });

        child.on('error', (e) => {
          if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);
          controller.error(this.handleSpawnError(e, promptExcerpt));
        });
        child.on('close', (code) => {
          if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);

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

          if (finalText) {
            if (options.responseFormat?.type === 'json') {
              finalText = extractJson(finalText);
            }
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
