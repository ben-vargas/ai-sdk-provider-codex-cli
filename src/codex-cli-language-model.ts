import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ReadableStreamDefaultController } from 'node:stream/web';
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
  thread_id?: string;
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
  error?: {
    message?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

type ExperimentalJsonItem = NonNullable<ExperimentalJsonEvent['item']>;

interface ActiveToolItem {
  toolCallId: string;
  toolName: string;
  inputPayload?: unknown;
  hasEmittedCall: boolean;
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
  readonly supportsStructuredOutputs = true;

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
      const schema = typeof responseFormat.schema === 'object' ? responseFormat.schema : {};
      const sanitizedSchema = this.sanitizeJsonSchema(schema) as Record<string, unknown>;

      // Only write schema if it has properties (not empty schema like z.any())
      const hasProperties = Object.keys(sanitizedSchema).length > 0;
      if (hasProperties) {
        const dir = mkdtempSync(join(tmpdir(), 'codex-schema-'));
        schemaPath = join(dir, 'schema.json');

        // OpenAI strict mode requires additionalProperties=false for structured schemas
        const schemaWithAdditional = {
          ...sanitizedSchema,
          additionalProperties: false,
        };

        writeFileSync(schemaPath, JSON.stringify(schemaWithAdditional, null, 2));
        args.push('--output-schema', schemaPath);
      }
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

  private parseExperimentalJsonEvent(line: string): ExperimentalJsonEvent | undefined {
    try {
      return JSON.parse(line) as ExperimentalJsonEvent;
    } catch {
      return undefined;
    }
  }

  private extractUsage(evt: ExperimentalJsonEvent): LanguageModelV2Usage | undefined {
    const reported = evt.usage;
    if (!reported) return undefined;
    const inputTokens = reported.input_tokens ?? 0;
    const outputTokens = reported.output_tokens ?? 0;
    const cachedInputTokens = reported.cached_input_tokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      // totalTokens should not double-count cached tokens; track cached separately
      totalTokens: inputTokens + outputTokens,
      cachedInputTokens,
    };
  }

  private getToolName(item?: ExperimentalJsonItem): string | undefined {
    if (!item) return undefined;
    const itemType = item.item_type;
    switch (itemType) {
      case 'command_execution':
        return 'exec';
      case 'file_change':
        return 'patch';
      case 'mcp_tool_call': {
        const tool = (item as Record<string, unknown>).tool;
        if (typeof tool === 'string' && tool.length > 0) return tool;
        return 'mcp_tool';
      }
      case 'web_search':
        return 'web_search';
      default:
        return undefined;
    }
  }

  private buildToolInputPayload(item?: ExperimentalJsonItem): unknown {
    if (!item) return undefined;
    const data = item as Record<string, unknown>;
    switch (item.item_type) {
      case 'command_execution': {
        const payload: Record<string, unknown> = {};
        if (typeof data.command === 'string') payload.command = data.command;
        if (typeof data.status === 'string') payload.status = data.status;
        if (typeof data.cwd === 'string') payload.cwd = data.cwd;
        return Object.keys(payload).length ? payload : undefined;
      }
      case 'file_change': {
        const payload: Record<string, unknown> = {};
        if (Array.isArray(data.changes)) payload.changes = data.changes;
        if (typeof data.status === 'string') payload.status = data.status;
        return Object.keys(payload).length ? payload : undefined;
      }
      case 'mcp_tool_call': {
        const payload: Record<string, unknown> = {};
        if (typeof data.server === 'string') payload.server = data.server;
        if (typeof data.tool === 'string') payload.tool = data.tool;
        if (typeof data.status === 'string') payload.status = data.status;
        // Include arguments so consumers can see what parameters were passed
        if (data.arguments !== undefined) payload.arguments = data.arguments;
        return Object.keys(payload).length ? payload : undefined;
      }
      case 'web_search': {
        const payload: Record<string, unknown> = {};
        if (typeof data.query === 'string') payload.query = data.query;
        return Object.keys(payload).length ? payload : undefined;
      }
      default:
        return undefined;
    }
  }

  private buildToolResultPayload(item?: ExperimentalJsonItem): {
    result: unknown;
    metadata?: Record<string, string>;
  } {
    if (!item) return { result: {} };
    const data = item as Record<string, unknown>;
    const metadata: Record<string, string> = {};
    if (typeof item.item_type === 'string') metadata.itemType = item.item_type;
    if (typeof item.id === 'string') metadata.itemId = item.id;
    if (typeof data.status === 'string') metadata.status = data.status;

    const buildResult = (result: Record<string, unknown>) => ({
      result,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    });

    switch (item.item_type) {
      case 'command_execution': {
        const result: Record<string, unknown> = {};
        if (typeof data.command === 'string') result.command = data.command;
        if (typeof data.aggregated_output === 'string')
          result.aggregatedOutput = data.aggregated_output;
        if (typeof data.exit_code === 'number') result.exitCode = data.exit_code;
        if (typeof data.status === 'string') result.status = data.status;
        return buildResult(result);
      }
      case 'file_change': {
        const result: Record<string, unknown> = {};
        if (Array.isArray(data.changes)) result.changes = data.changes;
        if (typeof data.status === 'string') result.status = data.status;
        return buildResult(result);
      }
      case 'mcp_tool_call': {
        const result: Record<string, unknown> = {};
        if (typeof data.server === 'string') {
          result.server = data.server;
          metadata.server = data.server;
        }
        if (typeof data.tool === 'string') result.tool = data.tool;
        if (typeof data.status === 'string') result.status = data.status;
        // Include result payload so consumers can see what the tool returned
        if (data.result !== undefined) result.result = data.result;
        // Include error details if present
        if (data.error !== undefined) result.error = data.error;
        return buildResult(result);
      }
      case 'web_search': {
        const result: Record<string, unknown> = {};
        if (typeof data.query === 'string') result.query = data.query;
        if (typeof data.status === 'string') result.status = data.status;
        return buildResult(result);
      }
      default: {
        const result = { ...data };
        return buildResult(result);
      }
    }
  }

  private safeStringify(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  private emitToolInvocation(
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
    toolCallId: string,
    toolName: string,
    inputPayload: unknown,
  ): void {
    const inputString = this.safeStringify(inputPayload);
    controller.enqueue({ type: 'tool-input-start', id: toolCallId, toolName });
    if (inputString) {
      controller.enqueue({ type: 'tool-input-delta', id: toolCallId, delta: inputString });
    }
    controller.enqueue({ type: 'tool-input-end', id: toolCallId });
    controller.enqueue({
      type: 'tool-call',
      toolCallId,
      toolName,
      input: inputString,
      providerExecuted: true,
    });
  }

  private emitToolResult(
    controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
    toolCallId: string,
    toolName: string,
    item: ExperimentalJsonItem,
    resultPayload: unknown,
    metadata?: Record<string, string>,
  ): void {
    const providerMetadataEntries: Record<string, string> = {
      ...(metadata ?? {}),
    };
    if (item.item_type && providerMetadataEntries.itemType === undefined) {
      providerMetadataEntries.itemType = item.item_type;
    }
    if (item.id && providerMetadataEntries.itemId === undefined) {
      providerMetadataEntries.itemId = item.id;
    }

    // Determine error status for command executions
    let isError: boolean | undefined;
    if (item.item_type === 'command_execution') {
      const data = item as Record<string, unknown>;
      const exitCode = typeof data.exit_code === 'number' ? (data.exit_code as number) : undefined;
      const status = typeof data.status === 'string' ? (data.status as string) : undefined;
      if ((exitCode !== undefined && exitCode !== 0) || status === 'failed') {
        isError = true;
      }
    }

    controller.enqueue({
      type: 'tool-result',
      toolCallId,
      toolName,
      result: resultPayload ?? {},
      ...(isError ? { isError: true } : {}),
      ...(Object.keys(providerMetadataEntries).length
        ? { providerMetadata: { 'codex-cli': providerMetadataEntries } }
        : {}),
    });
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
        let turnFailureMessage: string | undefined;
        child.stderr.on('data', (d) => (stderr += String(d)));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          const lines = chunk.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            const event = this.parseExperimentalJsonEvent(line);
            if (!event) continue;

            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
              this.sessionId = event.thread_id;
            }
            if (event.type === 'session.created' && typeof event.session_id === 'string') {
              // Backwards compatibility in case older events appear
              this.sessionId = event.session_id;
            }

            if (event.type === 'turn.completed') {
              const usageEvent = this.extractUsage(event);
              if (usageEvent) {
                usage.inputTokens = usageEvent.inputTokens;
                usage.outputTokens = usageEvent.outputTokens;
                usage.totalTokens = usageEvent.totalTokens;
              }
            }

            if (
              event.type === 'item.completed' &&
              event.item?.item_type === 'assistant_message' &&
              typeof event.item.text === 'string'
            ) {
              text = event.item.text;
            }

            if (event.type === 'turn.failed') {
              const errorText =
                (event.error && typeof event.error.message === 'string' && event.error.message) ||
                (typeof event.message === 'string' ? event.message : undefined);
              turnFailureMessage = errorText ?? turnFailureMessage ?? 'Codex turn failed';
            }

            if (event.type === 'error') {
              const errorText = typeof event.message === 'string' ? event.message : undefined;
              turnFailureMessage = errorText ?? turnFailureMessage ?? 'Codex error';
            }
          }
        });
        child.on('error', (e) => reject(this.handleSpawnError(e, promptExcerpt)));
        child.on('close', (code) => {
          if (code === 0) {
            if (turnFailureMessage) {
              reject(
                createAPICallError({
                  message: turnFailureMessage,
                  stderr,
                  promptExcerpt,
                }),
              );
              return;
            }
            resolve();
          } else {
            reject(
              createAPICallError({
                message: `Codex CLI exited with code ${code}`,
                exitCode: code ?? undefined,
                stderr,
                promptExcerpt,
              }),
            );
          }
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
        const activeTools = new Map<string, ActiveToolItem>();
        let responseMetadataSent = false;
        let lastUsage: LanguageModelV2Usage | undefined;
        let turnFailureMessage: string | undefined;

        const sendMetadata = (meta: Record<string, string> = {}) => {
          controller.enqueue({
            type: 'response-metadata',
            id: randomUUID(),
            timestamp: new Date(),
            modelId: this.modelId,
            ...(Object.keys(meta).length ? { providerMetadata: { 'codex-cli': meta } } : {}),
          });
        };

        const handleItemEvent = (event: ExperimentalJsonEvent) => {
          const item = event.item;
          if (!item) return;

          if (
            event.type === 'item.completed' &&
            item.item_type === 'assistant_message' &&
            typeof item.text === 'string'
          ) {
            accumulatedText = item.text;
            return;
          }

          const toolName = this.getToolName(item);
          if (!toolName) {
            return;
          }

          const mapKey = typeof item.id === 'string' && item.id.length > 0 ? item.id : randomUUID();
          let toolState = activeTools.get(mapKey);
          const latestInput = this.buildToolInputPayload(item);

          if (!toolState) {
            toolState = {
              toolCallId: mapKey,
              toolName,
              inputPayload: latestInput,
              hasEmittedCall: false,
            };
            activeTools.set(mapKey, toolState);
          } else {
            toolState.toolName = toolName;
            if (latestInput !== undefined) {
              toolState.inputPayload = latestInput;
            }
          }

          if (!toolState.hasEmittedCall) {
            this.emitToolInvocation(
              controller,
              toolState.toolCallId,
              toolState.toolName,
              toolState.inputPayload,
            );
            toolState.hasEmittedCall = true;
          }

          if (event.type === 'item.completed') {
            const { result, metadata } = this.buildToolResultPayload(item);
            this.emitToolResult(
              controller,
              toolState.toolCallId,
              toolState.toolName,
              item,
              result,
              metadata,
            );
            activeTools.delete(mapKey);
          }
        };

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

        const finishStream = (code: number | null) => {
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

          if (turnFailureMessage) {
            controller.error(
              createAPICallError({
                message: turnFailureMessage,
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
            const textId = randomUUID();
            controller.enqueue({ type: 'text-start', id: textId });
            controller.enqueue({ type: 'text-delta', id: textId, delta: finalText });
            controller.enqueue({ type: 'text-end', id: textId });
          }

          const usageSummary = lastUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: usageSummary,
          });
          controller.close();
        };

        child.stderr.on('data', (d) => (stderr += String(d)));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          const lines = chunk.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            const event = this.parseExperimentalJsonEvent(line);
            if (!event) continue;

            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
              this.sessionId = event.thread_id;
              if (!responseMetadataSent) {
                responseMetadataSent = true;
                sendMetadata();
              }
              continue;
            }

            if (event.type === 'session.created' && typeof event.session_id === 'string') {
              this.sessionId = event.session_id;
              if (!responseMetadataSent) {
                responseMetadataSent = true;
                sendMetadata();
              }
              continue;
            }

            if (event.type === 'turn.completed') {
              const usageEvent = this.extractUsage(event);
              if (usageEvent) {
                lastUsage = usageEvent;
              }
              continue;
            }

            if (event.type === 'turn.failed') {
              const errorText =
                (event.error && typeof event.error.message === 'string' && event.error.message) ||
                (typeof event.message === 'string' ? event.message : undefined);
              turnFailureMessage = errorText ?? turnFailureMessage ?? 'Codex turn failed';
              sendMetadata({ error: turnFailureMessage });
              continue;
            }

            if (event.type === 'error') {
              const errorText = typeof event.message === 'string' ? event.message : undefined;
              const effective = errorText ?? 'Codex error';
              turnFailureMessage = turnFailureMessage ?? effective;
              sendMetadata({ error: effective });
              continue;
            }

            if (event.type && event.type.startsWith('item.')) {
              handleItemEvent(event);
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

          // Use setImmediate to ensure all stdout 'data' events are processed first
          setImmediate(() => finishStream(code));
        });
      },
      cancel: () => {},
    });

    return { stream, request: { body: promptText } } as Awaited<
      ReturnType<LanguageModelV2['doStream']>
    >;
  }
}
