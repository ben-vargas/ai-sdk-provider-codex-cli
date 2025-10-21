import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ReadableStreamDefaultController } from 'node:stream/web';
import { z } from 'zod';
import type {
  LanguageModelV2,
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  LanguageModelV2Content,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId, parseProviderOptions } from '@ai-sdk/provider-utils';
import { getLogger, createVerboseLogger } from './logger.js';
import type { CodexCliProviderOptions, CodexCliSettings, Logger } from './types.js';
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

const codexCliProviderOptionsSchema: z.ZodType<CodexCliProviderOptions> = z
  .object({
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    reasoningSummary: z.enum(['auto', 'detailed']).optional(),
    reasoningSummaryFormat: z.enum(['none', 'experimental']).optional(),
    textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
    configOverrides: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.object({}).passthrough(),
          z.array(z.any()),
        ]),
      )
      .optional(),
  })
  .strict();

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
    const baseLogger = getLogger(this.settings.logger);
    this.logger = createVerboseLogger(baseLogger, this.settings.verbose ?? false);
    if (!this.modelId || this.modelId.trim() === '') {
      throw new NoSuchModelError({ modelId: this.modelId, modelType: 'languageModel' });
    }
    const warn = validateModelId(this.modelId);
    if (warn) this.logger.warn(`Codex CLI model: ${warn}`);
  }

  private mergeSettings(providerOptions?: CodexCliProviderOptions): CodexCliSettings {
    if (!providerOptions) return this.settings;

    const mergedConfigOverrides =
      providerOptions.configOverrides || this.settings.configOverrides
        ? {
            ...(this.settings.configOverrides ?? {}),
            ...(providerOptions.configOverrides ?? {}),
          }
        : undefined;

    return {
      ...this.settings,
      reasoningEffort: providerOptions.reasoningEffort ?? this.settings.reasoningEffort,
      reasoningSummary: providerOptions.reasoningSummary ?? this.settings.reasoningSummary,
      reasoningSummaryFormat:
        providerOptions.reasoningSummaryFormat ?? this.settings.reasoningSummaryFormat,
      modelVerbosity: providerOptions.textVerbosity ?? this.settings.modelVerbosity,
      configOverrides: mergedConfigOverrides,
    };
  }

  // Codex JSONL items use `type` for the item discriminator, but some
  // earlier fixtures (and defensive parsing) might still surface `item_type`.
  // This helper returns whichever is present.
  private getItemType(item?: ExperimentalJsonItem): string | undefined {
    if (!item) return undefined;
    const data = item as Record<string, unknown>;
    const legacy = typeof data.item_type === 'string' ? (data.item_type as string) : undefined;
    const current = typeof data.type === 'string' ? (data.type as string) : undefined;
    return legacy ?? current;
  }

  private buildArgs(
    promptText: string,
    responseFormat?: { type: 'json'; schema: unknown },
    settings: CodexCliSettings = this.settings,
  ): {
    cmd: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    lastMessagePath?: string;
    schemaPath?: string;
  } {
    const base = resolveCodexPath(settings.codexPath, settings.allowNpx);
    const args: string[] = [...base.args, 'exec', '--experimental-json'];

    // Approval/sandbox (exec subcommand does not accept -a/-s directly; use -c overrides)
    if (settings.fullAuto) {
      args.push('--full-auto');
    } else if (settings.dangerouslyBypassApprovalsAndSandbox) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      const approval = settings.approvalMode ?? 'on-failure';
      args.push('-c', `approval_policy=${approval}`);
      const sandbox = settings.sandboxMode ?? 'workspace-write';
      args.push('-c', `sandbox_mode=${sandbox}`);
    }

    if (settings.skipGitRepoCheck !== false) {
      args.push('--skip-git-repo-check');
    }

    // Reasoning & verbosity
    if (settings.reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${settings.reasoningEffort}`);
    }
    if (settings.reasoningSummary) {
      args.push('-c', `model_reasoning_summary=${settings.reasoningSummary}`);
    }
    if (settings.reasoningSummaryFormat) {
      args.push('-c', `model_reasoning_summary_format=${settings.reasoningSummaryFormat}`);
    }
    if (settings.modelVerbosity) {
      args.push('-c', `model_verbosity=${settings.modelVerbosity}`);
    }

    // Advanced Codex features
    if (settings.includePlanTool) {
      args.push('--include-plan-tool');
    }
    if (settings.profile) {
      args.push('--profile', settings.profile);
    }
    if (settings.oss) {
      args.push('--oss');
    }
    if (settings.webSearch) {
      args.push('-c', 'tools.web_search=true');
    }

    // Color handling
    if (settings.color) {
      args.push('--color', settings.color);
    }

    if (this.modelId) {
      args.push('-m', this.modelId);
    }

    // Generic config overrides (-c key=value)
    if (settings.configOverrides) {
      for (const [key, value] of Object.entries(settings.configOverrides)) {
        this.addConfigOverride(args, key, value);
      }
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
      ...(settings.env || {}),
      RUST_LOG: process.env.RUST_LOG || 'error',
    };

    // Configure output-last-message
    let lastMessagePath: string | undefined = settings.outputLastMessageFile;
    if (!lastMessagePath) {
      // create a temp folder for this run
      const dir = mkdtempSync(join(tmpdir(), 'codex-cli-'));
      lastMessagePath = join(dir, 'last-message.txt');
    }
    args.push('--output-last-message', lastMessagePath);

    return { cmd: base.cmd, args, env, cwd: settings.cwd, lastMessagePath, schemaPath };
  }

  private addConfigOverride(
    args: string[],
    key: string,
    value: string | number | boolean | object,
  ): void {
    if (this.isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        this.addConfigOverride(
          args,
          `${key}.${childKey}`,
          childValue as string | number | boolean | object,
        );
      }
      return;
    }
    const serialized = this.serializeConfigValue(value);
    args.push('-c', `${key}=${serialized}`);
  }

  /**
   * Serialize a config override value into a CLI-safe string.
   */
  private serializeConfigValue(value: string | number | boolean | object): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    if (value && typeof value === 'object') {
      // Remaining plain objects are flattened earlier; fallback to JSON.
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.prototype.toString.call(value) === '[object Object]'
    );
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
    const itemType = this.getItemType(item);
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
    switch (this.getItemType(item)) {
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
    const itemType = this.getItemType(item);
    if (typeof itemType === 'string') metadata.itemType = itemType;
    if (typeof item.id === 'string') metadata.itemId = item.id;
    if (typeof data.status === 'string') metadata.status = data.status;

    const buildResult = (result: Record<string, unknown>) => ({
      result,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    });

    switch (itemType) {
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
    const itemType = this.getItemType(item);
    if (itemType && providerMetadataEntries.itemType === undefined) {
      providerMetadataEntries.itemType = itemType;
    }
    if (item.id && providerMetadataEntries.itemId === undefined) {
      providerMetadataEntries.itemId = item.id;
    }

    // Determine error status for command executions
    let isError: boolean | undefined;
    if (itemType === 'command_execution') {
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
    this.logger.debug(`[codex-cli] Starting doGenerate request with model: ${this.modelId}`);

    const { promptText, warnings: mappingWarnings } = mapMessagesToPrompt(options.prompt);
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...this.mapWarnings(options),
      ...(mappingWarnings?.map((m) => ({ type: 'other', message: m })) || []),
    ] as LanguageModelV2CallWarning[];

    this.logger.debug(
      `[codex-cli] Converted ${options.prompt.length} messages, response format: ${options.responseFormat?.type ?? 'none'}`
    );

    const providerOptions = await parseProviderOptions<CodexCliProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: codexCliProviderOptionsSchema,
    });
    const effectiveSettings = this.mergeSettings(providerOptions);

    const responseFormat =
      options.responseFormat?.type === 'json'
        ? { type: 'json' as const, schema: options.responseFormat.schema }
        : undefined;
    const { cmd, args, env, cwd, lastMessagePath, schemaPath } = this.buildArgs(
      promptText,
      responseFormat,
      effectiveSettings,
    );

    this.logger.debug(
      `[codex-cli] Executing Codex CLI: ${cmd} with ${args.length} arguments, cwd: ${cwd ?? 'default'}`
    );

    let text = '';
    const usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const finishReason: LanguageModelV2FinishReason = 'stop';
    const startTime = Date.now();

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

            this.logger.debug(`[codex-cli] Received event type: ${event.type ?? 'unknown'}`);

            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
              this.sessionId = event.thread_id;
              this.logger.debug(`[codex-cli] Session started: ${this.sessionId}`);
            }
            if (event.type === 'session.created' && typeof event.session_id === 'string') {
              // Backwards compatibility in case older events appear
              this.sessionId = event.session_id;
              this.logger.debug(`[codex-cli] Session created: ${this.sessionId}`);
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
              this.getItemType(event.item) === 'assistant_message' &&
              typeof event.item?.text === 'string'
            ) {
              text = event.item.text;
            }

            if (event.type === 'turn.failed') {
              const errorText =
                (event.error && typeof event.error.message === 'string' && event.error.message) ||
                (typeof event.message === 'string' ? event.message : undefined);
              turnFailureMessage = errorText ?? turnFailureMessage ?? 'Codex turn failed';
              this.logger.error(`[codex-cli] Turn failed: ${turnFailureMessage}`);
            }

            if (event.type === 'error') {
              const errorText = typeof event.message === 'string' ? event.message : undefined;
              turnFailureMessage = errorText ?? turnFailureMessage ?? 'Codex error';
              this.logger.error(`[codex-cli] Error event: ${turnFailureMessage}`);
            }
          }
        });
        child.on('error', (e) => {
          this.logger.error(`[codex-cli] Spawn error: ${String(e)}`);
          reject(this.handleSpawnError(e, promptExcerpt));
        });
        child.on('close', (code) => {
          const duration = Date.now() - startTime;
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
            this.logger.info(
              `[codex-cli] Request completed - Session: ${this.sessionId ?? 'N/A'}, Duration: ${duration}ms, Tokens: ${usage.totalTokens}`
            );
            this.logger.debug(
              `[codex-cli] Token usage - Input: ${usage.inputTokens}, Output: ${usage.outputTokens}, Total: ${usage.totalTokens}`
            );
            resolve();
          } else {
            this.logger.error(`[codex-cli] Process exited with code ${code} after ${duration}ms`);
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
    this.logger.debug(`[codex-cli] Starting doStream request with model: ${this.modelId}`);

    const { promptText, warnings: mappingWarnings } = mapMessagesToPrompt(options.prompt);
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...this.mapWarnings(options),
      ...(mappingWarnings?.map((m) => ({ type: 'other', message: m })) || []),
    ] as LanguageModelV2CallWarning[];

    this.logger.debug(
      `[codex-cli] Converted ${options.prompt.length} messages for streaming, response format: ${options.responseFormat?.type ?? 'none'}`
    );

    const providerOptions = await parseProviderOptions<CodexCliProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: codexCliProviderOptionsSchema,
    });
    const effectiveSettings = this.mergeSettings(providerOptions);

    const responseFormat =
      options.responseFormat?.type === 'json'
        ? { type: 'json' as const, schema: options.responseFormat.schema }
        : undefined;
    const { cmd, args, env, cwd, lastMessagePath, schemaPath } = this.buildArgs(
      promptText,
      responseFormat,
      effectiveSettings,
    );

    this.logger.debug(
      `[codex-cli] Executing Codex CLI for streaming: ${cmd} with ${args.length} arguments`
    );

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start: (controller) => {
        const startTime = Date.now();
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
            this.getItemType(item) === 'assistant_message' &&
            typeof item.text === 'string'
          ) {
            accumulatedText = item.text;
            this.logger.debug(`[codex-cli] Received assistant message, length: ${item.text.length}`);
            return;
          }

          const toolName = this.getToolName(item);
          if (!toolName) {
            return;
          }

          this.logger.debug(`[codex-cli] Tool detected: ${toolName}, item type: ${this.getItemType(item)}`);

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
            this.logger.debug(`[codex-cli] Emitting tool invocation: ${toolState.toolName}`);
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
            this.logger.debug(`[codex-cli] Tool completed: ${toolState.toolName}`);
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
          const duration = Date.now() - startTime;

          if (code !== 0) {
            this.logger.error(`[codex-cli] Stream process exited with code ${code} after ${duration}ms`);
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
            this.logger.error(`[codex-cli] Stream failed: ${turnFailureMessage}`);
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
          this.logger.info(
            `[codex-cli] Stream completed - Session: ${this.sessionId ?? 'N/A'}, Duration: ${duration}ms, Tokens: ${usageSummary.totalTokens}`
          );
          this.logger.debug(
            `[codex-cli] Token usage - Input: ${usageSummary.inputTokens}, Output: ${usageSummary.outputTokens}, Total: ${usageSummary.totalTokens}`
          );
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

            this.logger.debug(`[codex-cli] Stream event: ${event.type ?? 'unknown'}`);

            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
              this.sessionId = event.thread_id;
              this.logger.debug(`[codex-cli] Stream session started: ${this.sessionId}`);
              if (!responseMetadataSent) {
                responseMetadataSent = true;
                sendMetadata();
              }
              continue;
            }

            if (event.type === 'session.created' && typeof event.session_id === 'string') {
              this.sessionId = event.session_id;
              this.logger.debug(`[codex-cli] Stream session created: ${this.sessionId}`);
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
              this.logger.error(`[codex-cli] Stream turn failed: ${turnFailureMessage}`);
              sendMetadata({ error: turnFailureMessage });
              continue;
            }

            if (event.type === 'error') {
              const errorText = typeof event.message === 'string' ? event.message : undefined;
              const effective = errorText ?? 'Codex error';
              turnFailureMessage = turnFailureMessage ?? effective;
              this.logger.error(`[codex-cli] Stream error event: ${effective}`);
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
          this.logger.error(`[codex-cli] Stream spawn error: ${String(e)}`);
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
