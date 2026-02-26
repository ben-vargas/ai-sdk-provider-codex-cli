import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ReadableStreamDefaultController } from 'node:stream/web';
import { z } from 'zod';
import type {
  LanguageModelV3,
  LanguageModelV3File,
  LanguageModelV3FinishReason,
  LanguageModelV3Reasoning,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3Source,
  LanguageModelV3StreamPart,
  LanguageModelV3Text,
  LanguageModelV3ToolApprovalRequest,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolResult,
  LanguageModelV3Usage,
  LanguageModelV3Content,
  JSONObject,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { generateId, parseProviderOptions } from '@ai-sdk/provider-utils';
import { getLogger, createVerboseLogger } from './logger.js';
import type { CodexExecProviderOptions, CodexExecSettings, Logger } from './types.js';
import { mcpServersSchema, validateModelId } from './validation.js';
import { mapMessagesToPrompt, type ImageData } from './message-mapper.js';
import { writeImageToTempFile, cleanupTempImages } from './image-utils.js';
import { createAPICallError, createAuthenticationError } from './errors.js';
import {
  assertValidConfigOverrideKey,
  assertValidMcpServerName,
  isValidConfigOverrideKey,
} from './config-key-utils.js';
import {
  createEmptyCodexUsage,
  isPlainObject,
  mapCodexCliFinishReason,
  mapUnsupportedSettingsWarnings,
  mergeMcpServers,
  safeStringify,
  sanitizeJsonSchema,
} from './shared-utils.js';
import type { CodexModelId } from './types-shared.js';

export interface ExecLanguageModelOptions {
  id: CodexModelId; // model id for Codex (-m)
  settings?: CodexExecSettings;
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

const codexCliProviderOptionsSchema: z.ZodType<CodexExecProviderOptions> = z
  .object({
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    reasoningSummary: z.enum(['auto', 'detailed']).optional(),
    reasoningSummaryFormat: z.enum(['none', 'experimental']).optional(),
    textVerbosity: z.enum(['low', 'medium', 'high']).optional(),
    addDirs: z.array(z.string().min(1)).optional(),
    configOverrides: z
      .record(
        z.string().refine((key) => isValidConfigOverrideKey(key), {
          message: 'configOverrides keys must match /^[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*$/.',
        }),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.object({}).passthrough(),
          z.array(z.any()),
        ]),
      )
      .optional(),
    mcpServers: mcpServersSchema.optional(),
    rmcpClient: z.boolean().optional(),
  })
  .strict();

function resolveCodexPath(
  explicitPath?: string,
  allowNpx?: boolean,
): { cmd: string; args: string[] } {
  if (explicitPath) {
    // `codexPath` may be either a JS entrypoint (e.g. `.../bin/codex.js`) or an executable
    // (e.g. Homebrew's `/opt/homebrew/bin/codex`). Only force `node` for explicit JS files.
    const lower = explicitPath.toLowerCase();
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
      return { cmd: 'node', args: [explicitPath] };
    }
    return { cmd: explicitPath, args: [] };
  }

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

export class ExecLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'codex-cli';
  readonly defaultObjectGenerationMode = 'json' as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls = {};
  readonly supportsStructuredOutputs = true;

  readonly modelId: string;
  readonly settings: CodexExecSettings;

  private logger: Logger;
  private sessionId?: string;

  constructor(options: ExecLanguageModelOptions) {
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

  private mergeSettings(providerOptions?: CodexExecProviderOptions): CodexExecSettings {
    if (!providerOptions) return this.settings;

    const mergedConfigOverrides =
      providerOptions.configOverrides || this.settings.configOverrides
        ? {
            ...(this.settings.configOverrides ?? {}),
            ...(providerOptions.configOverrides ?? {}),
          }
        : undefined;

    const mergedAddDirs =
      providerOptions.addDirs || this.settings.addDirs
        ? [...(this.settings.addDirs ?? []), ...(providerOptions.addDirs ?? [])]
        : undefined;

    const mergedMcpServers = mergeMcpServers(this.settings.mcpServers, providerOptions.mcpServers);

    return {
      ...this.settings,
      reasoningEffort: providerOptions.reasoningEffort ?? this.settings.reasoningEffort,
      reasoningSummary: providerOptions.reasoningSummary ?? this.settings.reasoningSummary,
      reasoningSummaryFormat:
        providerOptions.reasoningSummaryFormat ?? this.settings.reasoningSummaryFormat,
      modelVerbosity: providerOptions.textVerbosity ?? this.settings.modelVerbosity,
      configOverrides: mergedConfigOverrides,
      addDirs: mergedAddDirs,
      mcpServers: mergedMcpServers,
      rmcpClient: providerOptions.rmcpClient ?? this.settings.rmcpClient,
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
    images: ImageData[] = [],
    responseFormat?: { type: 'json'; schema: unknown },
    settings: CodexExecSettings = this.settings,
  ): {
    cmd: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    lastMessagePath?: string;
    lastMessageIsTemp?: boolean;
    schemaPath?: string;
    tempImagePaths?: string[];
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
    if (settings.profile) {
      args.push('--profile', settings.profile);
    }
    if (settings.oss) {
      args.push('--oss');
    }
    if (settings.webSearch) {
      args.push('-c', 'tools.web_search=true');
    }

    // MCP configuration
    this.applyMcpSettings(args, settings);

    // Color handling
    if (settings.color) {
      args.push('--color', settings.color);
    }

    if (this.modelId) {
      args.push('-m', this.modelId);
    }

    if (settings.addDirs?.length) {
      for (const dir of settings.addDirs) {
        if (typeof dir === 'string' && dir.trim().length > 0) {
          args.push('--add-dir', dir);
        }
      }
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
      const sanitizedSchema = sanitizeJsonSchema(schema) as Record<string, unknown>;

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

    // Add image arguments
    const tempImagePaths: string[] = [];
    for (const img of images) {
      try {
        const tempPath = writeImageToTempFile(img);
        tempImagePaths.push(tempPath);
        args.push('--image', tempPath);
      } catch (e) {
        this.logger.warn(`[codex-cli] Failed to write image to temp file: ${String(e)}`);
      }
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(settings.env || {}),
      RUST_LOG: process.env.RUST_LOG || 'error',
    };

    // Configure output-last-message (must be added before '--' separator)
    let lastMessagePath: string | undefined = settings.outputLastMessageFile;
    let lastMessageIsTemp = false;
    if (!lastMessagePath) {
      // create a temp folder for this run
      const dir = mkdtempSync(join(tmpdir(), 'codex-cli-'));
      lastMessagePath = join(dir, 'last-message.txt');
      lastMessageIsTemp = true;
    }
    args.push('--output-last-message', lastMessagePath);

    // Prompt is passed via stdin to avoid command line length limits and escaping issues
    // Use '-' to read prompt from stdin
    // IMPORTANT: Use '--' separator when images are present because Codex CLI's
    // --image flag uses `num_args = 1..` (greedy), which consumes subsequent
    // values until another flag is encountered. Without '--', the '-' for stdin
    // would be interpreted as an additional image path.
    // See: https://github.com/ben-vargas/ai-sdk-provider-codex-cli/issues/19
    if (tempImagePaths.length > 0) {
      args.push('--');
    }
    args.push('-');

    return {
      cmd: base.cmd,
      args,
      env,
      cwd: settings.cwd,
      lastMessagePath,
      lastMessageIsTemp,
      schemaPath,
      tempImagePaths: tempImagePaths.length > 0 ? tempImagePaths : undefined,
    };
  }

  private applyMcpSettings(args: string[], settings: CodexExecSettings): void {
    if (settings.rmcpClient) {
      this.addConfigOverride(args, 'features.rmcp_client', true);
    }

    if (!settings.mcpServers) return;

    for (const [rawName, server] of Object.entries(settings.mcpServers)) {
      const name = assertValidMcpServerName(rawName);
      const prefix = `mcp_servers.${name}`;

      if (server.enabled !== undefined) {
        this.addConfigOverride(args, `${prefix}.enabled`, server.enabled);
      }
      if (server.startupTimeoutSec !== undefined) {
        this.addConfigOverride(args, `${prefix}.startup_timeout_sec`, server.startupTimeoutSec);
      }
      if (server.toolTimeoutSec !== undefined) {
        this.addConfigOverride(args, `${prefix}.tool_timeout_sec`, server.toolTimeoutSec);
      }
      if (server.enabledTools !== undefined) {
        this.addConfigOverride(args, `${prefix}.enabled_tools`, server.enabledTools);
      }
      if (server.disabledTools !== undefined) {
        this.addConfigOverride(args, `${prefix}.disabled_tools`, server.disabledTools);
      }

      if (server.transport === 'stdio') {
        this.addConfigOverride(args, `${prefix}.command`, server.command);
        if (server.args !== undefined) this.addConfigOverride(args, `${prefix}.args`, server.args);
        if (server.env !== undefined) this.addConfigOverride(args, `${prefix}.env`, server.env);
        if (server.cwd) this.addConfigOverride(args, `${prefix}.cwd`, server.cwd);
      } else {
        this.addConfigOverride(args, `${prefix}.url`, server.url);
        if (server.bearerToken !== undefined)
          this.addConfigOverride(args, `${prefix}.bearer_token`, server.bearerToken);
        if (server.bearerTokenEnvVar)
          this.addConfigOverride(args, `${prefix}.bearer_token_env_var`, server.bearerTokenEnvVar);
        if (server.httpHeaders !== undefined)
          this.addConfigOverride(args, `${prefix}.http_headers`, server.httpHeaders);
        if (server.envHttpHeaders !== undefined)
          this.addConfigOverride(args, `${prefix}.env_http_headers`, server.envHttpHeaders);
      }
    }
  }

  private addConfigOverride(
    args: string[],
    key: string,
    value: string | number | boolean | object,
  ): void {
    assertValidConfigOverrideKey(key);
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        args.push('-c', `${key}={}`);
        return;
      }
      for (const [childKey, childValue] of entries) {
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

  private parseExperimentalJsonEvent(line: string): ExperimentalJsonEvent | undefined {
    try {
      return JSON.parse(line) as ExperimentalJsonEvent;
    } catch {
      return undefined;
    }
  }

  private extractUsage(evt: ExperimentalJsonEvent): LanguageModelV3Usage | undefined {
    const reported = evt.usage;
    if (!reported) return undefined;
    const inputTotal = reported.input_tokens ?? 0;
    const outputTotal = reported.output_tokens ?? 0;
    const cachedInputTokens = reported.cached_input_tokens ?? 0;
    return {
      inputTokens: {
        total: inputTotal,
        noCache: inputTotal - cachedInputTokens,
        cacheRead: cachedInputTokens,
        cacheWrite: 0,
      },
      outputTokens: {
        total: outputTotal,
        text: undefined,
        reasoning: undefined,
      },
      raw: reported as JSONObject,
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

  private emitToolInvocation(
    controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
    toolCallId: string,
    toolName: string,
    inputPayload: unknown,
  ): void {
    const inputString = safeStringify(inputPayload);
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
    controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
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
      result: (resultPayload ?? {}) as NonNullable<import('@ai-sdk/provider').JSONValue>,
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
    options: Parameters<LanguageModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doGenerate']>>> {
    this.logger.debug(`[codex-cli] Starting doGenerate request with model: ${this.modelId}`);

    const { stream, request } = await this.doStream(
      options as Parameters<LanguageModelV3['doStream']>[0],
    );

    const content: LanguageModelV3Content[] = [];
    const textPartsById = new Map<string, LanguageModelV3Text>();
    const reasoningPartsById = new Map<string, LanguageModelV3Reasoning>();
    let activeTextBlockId: string | undefined;
    let activeReasoningBlockId: string | undefined;
    let responseMetadata: LanguageModelV3ResponseMetadata = {
      id: generateId(),
      timestamp: new Date(),
      modelId: this.modelId,
    };
    let usage: LanguageModelV3Usage = createEmptyCodexUsage();
    let finishReason: LanguageModelV3FinishReason = { unified: 'other', raw: undefined };
    let warnings: SharedV3Warning[] = [];
    let providerMetadata: SharedV3ProviderMetadata | undefined;

    const ensureTextPart = (
      id: string,
      metadata?: SharedV3ProviderMetadata,
    ): LanguageModelV3Text => {
      const existing = textPartsById.get(id);
      if (existing) {
        if (metadata) existing.providerMetadata = metadata;
        return existing;
      }

      const part: LanguageModelV3Text = {
        type: 'text',
        text: '',
        ...(metadata ? { providerMetadata: metadata } : {}),
      };
      textPartsById.set(id, part);
      content.push(part);
      return part;
    };

    const ensureReasoningPart = (
      id: string,
      metadata?: SharedV3ProviderMetadata,
    ): LanguageModelV3Reasoning => {
      const existing = reasoningPartsById.get(id);
      if (existing) {
        if (metadata) existing.providerMetadata = metadata;
        return existing;
      }

      const part: LanguageModelV3Reasoning = {
        type: 'reasoning',
        text: '',
        ...(metadata ? { providerMetadata: metadata } : {}),
      };
      reasoningPartsById.set(id, part);
      content.push(part);
      return part;
    };

    const pushContentPart = (
      part:
        | LanguageModelV3File
        | LanguageModelV3Source
        | LanguageModelV3ToolApprovalRequest
        | LanguageModelV3ToolCall
        | LanguageModelV3ToolResult,
    ): void => {
      content.push(part);
    };

    for await (const part of stream as AsyncIterable<LanguageModelV3StreamPart>) {
      if (part.type === 'stream-start') {
        warnings = part.warnings;
        continue;
      }

      if (part.type === 'response-metadata') {
        responseMetadata = {
          id: part.id,
          timestamp: part.timestamp,
          modelId: part.modelId,
        };
        continue;
      }

      if (part.type === 'text-start') {
        activeTextBlockId = part.id;
        ensureTextPart(part.id, part.providerMetadata);
        continue;
      }

      if (part.type === 'text-delta') {
        const blockId =
          typeof part.id === 'string' ? part.id : (activeTextBlockId ?? '__default_text_block__');
        activeTextBlockId = blockId;
        const textPart = ensureTextPart(blockId, part.providerMetadata);
        textPart.text = `${textPart.text}${part.delta}`;
        continue;
      }

      if (part.type === 'text-end') {
        const blockId = typeof part.id === 'string' ? part.id : activeTextBlockId;
        if (blockId) {
          const textPart = ensureTextPart(blockId, part.providerMetadata);
          if (part.providerMetadata) {
            textPart.providerMetadata = part.providerMetadata;
          }
        }
        if (activeTextBlockId === blockId) {
          activeTextBlockId = undefined;
        }
        continue;
      }

      if (part.type === 'reasoning-start') {
        activeReasoningBlockId = part.id;
        ensureReasoningPart(part.id, part.providerMetadata);
        continue;
      }

      if (part.type === 'reasoning-delta') {
        const blockId =
          typeof part.id === 'string'
            ? part.id
            : (activeReasoningBlockId ?? '__default_reasoning_block__');
        activeReasoningBlockId = blockId;
        const reasoningPart = ensureReasoningPart(blockId, part.providerMetadata);
        reasoningPart.text = `${reasoningPart.text}${part.delta}`;
        continue;
      }

      if (part.type === 'reasoning-end') {
        const blockId = typeof part.id === 'string' ? part.id : activeReasoningBlockId;
        if (blockId) {
          const reasoningPart = ensureReasoningPart(blockId, part.providerMetadata);
          if (part.providerMetadata) {
            reasoningPart.providerMetadata = part.providerMetadata;
          }
        }
        if (activeReasoningBlockId === blockId) {
          activeReasoningBlockId = undefined;
        }
        continue;
      }

      if (part.type === 'file') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'source') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'tool-approval-request') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'tool-call') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'tool-result') {
        pushContentPart(part);
        continue;
      }

      if (part.type === 'finish') {
        usage = part.usage;
        finishReason = part.finishReason;
        providerMetadata = part.providerMetadata;
      }
    }

    const normalizedContent = content.filter((part) => {
      if (part.type === 'text') return part.text.trim().length > 0;
      if (part.type === 'reasoning') return part.text.trim().length > 0;
      return true;
    });

    const codexProviderMetadata =
      providerMetadata && typeof providerMetadata === 'object'
        ? { ...providerMetadata }
        : ({} as SharedV3ProviderMetadata);

    if (this.sessionId) {
      const existing = codexProviderMetadata['codex-cli'];
      const existingObject =
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      codexProviderMetadata['codex-cli'] = {
        ...existingObject,
        sessionId: this.sessionId,
      };
    }

    return {
      content: normalizedContent,
      usage,
      finishReason,
      warnings,
      response: responseMetadata,
      request,
      ...(Object.keys(codexProviderMetadata).length > 0
        ? { providerMetadata: codexProviderMetadata }
        : {}),
    };
  }

  async doStream(
    options: Parameters<LanguageModelV3['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV3['doStream']>>> {
    this.logger.debug(`[codex-cli] Starting doStream request with model: ${this.modelId}`);

    const { promptText, images, warnings: mappingWarnings } = mapMessagesToPrompt(options.prompt);
    const promptExcerpt = promptText.slice(0, 200);
    const warnings = [
      ...mapUnsupportedSettingsWarnings({
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        maxOutputTokens: options.maxOutputTokens,
        presencePenalty: options.presencePenalty,
        frequencyPenalty: options.frequencyPenalty,
        stopSequences: options.stopSequences,
        seed: (options as { seed?: unknown }).seed,
        tools: (options as { tools?: unknown }).tools,
        toolChoice: (options as { toolChoice?: unknown }).toolChoice,
      }),
      ...(mappingWarnings ?? []),
    ] as SharedV3Warning[];

    this.logger.debug(
      `[codex-cli] Converted ${options.prompt.length} messages (${images.length} images) for streaming, response format: ${options.responseFormat?.type ?? 'none'}`,
    );

    const providerOptions = await parseProviderOptions<CodexExecProviderOptions>({
      provider: this.provider,
      providerOptions: options.providerOptions,
      schema: codexCliProviderOptionsSchema,
    });
    const effectiveSettings = this.mergeSettings(providerOptions);

    const responseFormat =
      options.responseFormat?.type === 'json'
        ? { type: 'json' as const, schema: options.responseFormat.schema }
        : undefined;
    const { cmd, args, env, cwd, lastMessagePath, lastMessageIsTemp, schemaPath, tempImagePaths } =
      this.buildArgs(images, responseFormat, effectiveSettings);

    this.logger.debug(
      `[codex-cli] Executing Codex CLI for streaming: ${cmd} with ${args.length} arguments`,
    );

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        const startTime = Date.now();
        // Use stdin to pass prompt - avoids command line length limits and escaping issues on Windows
        const child = spawn(cmd, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });

        // Write prompt to stdin
        child.stdin.write(promptText);
        child.stdin.end();

        // Emit stream-start
        controller.enqueue({ type: 'stream-start', warnings });

        let stderr = '';
        let accumulatedText = '';
        const activeTools = new Map<string, ActiveToolItem>();
        let responseMetadataSent = false;
        let lastUsage: LanguageModelV3Usage | undefined;
        let turnFailureMessage: string | undefined;

        // Define cleanup early so it's available for early abort
        const cleanupTempFiles = () => {
          // Clean up temp schema file
          if (schemaPath) {
            try {
              const schemaDir = dirname(schemaPath);
              rmSync(schemaDir, { recursive: true, force: true });
            } catch {}
          }
          // Clean up temp image files
          if (tempImagePaths?.length) {
            cleanupTempImages(tempImagePaths);
          }
        };

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
            this.logger.debug(
              `[codex-cli] Received assistant message, length: ${item.text.length}`,
            );
            return;
          }

          const toolName = this.getToolName(item);
          if (!toolName) {
            return;
          }

          this.logger.debug(
            `[codex-cli] Tool detected: ${toolName}, item type: ${this.getItemType(item)}`,
          );

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
            // Clean up temp files before returning
            cleanupTempFiles();
            controller.error(options.abortSignal.reason ?? new Error('Request aborted'));
            return;
          }
          options.abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        const finishStream = (code: number | null) => {
          const duration = Date.now() - startTime;

          if (code !== 0) {
            this.logger.error(
              `[codex-cli] Stream process exited with code ${code} after ${duration}ms`,
            );
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
            if (lastMessageIsTemp) {
              try {
                rmSync(lastMessagePath, { force: true });
              } catch {}
            }
          }

          // No JSON extraction needed - native schema guarantees valid JSON
          if (finalText) {
            const textId = randomUUID();
            controller.enqueue({ type: 'text-start', id: textId });
            controller.enqueue({ type: 'text-delta', id: textId, delta: finalText });
            controller.enqueue({ type: 'text-end', id: textId });
          }

          const usageSummary: LanguageModelV3Usage = lastUsage ?? createEmptyCodexUsage();
          const totalTokens =
            (usageSummary.inputTokens.total ?? 0) + (usageSummary.outputTokens.total ?? 0);
          this.logger.info(
            `[codex-cli] Stream completed - Session: ${this.sessionId ?? 'N/A'}, Duration: ${duration}ms, Tokens: ${totalTokens}`,
          );
          this.logger.debug(
            `[codex-cli] Token usage - Input: ${usageSummary.inputTokens.total ?? 0}, Output: ${usageSummary.outputTokens.total ?? 0}, Total: ${totalTokens}`,
          );
          controller.enqueue({
            type: 'finish',
            finishReason: mapCodexCliFinishReason(undefined),
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

        child.on('error', (e) => {
          this.logger.error(`[codex-cli] Stream spawn error: ${String(e)}`);
          if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);
          cleanupTempFiles();
          controller.error(this.handleSpawnError(e, promptExcerpt));
        });
        child.on('close', (code) => {
          if (options.abortSignal) options.abortSignal.removeEventListener('abort', onAbort);

          // Clean up temp files (schema and images)
          cleanupTempFiles();

          // Use setImmediate to ensure all stdout 'data' events are processed first
          setImmediate(() => finishStream(code));
        });
      },
      cancel: () => {},
    });

    return { stream, request: { body: promptText } } as Awaited<
      ReturnType<LanguageModelV3['doStream']>
    >;
  }
}
