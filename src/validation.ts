import { z } from 'zod';
import type { CodexCliSettings } from './types.js';

const loggerFunctionSchema = z.object({
  debug: z.any().refine((val) => typeof val === 'function', {
    message: 'debug must be a function',
  }),
  info: z.any().refine((val) => typeof val === 'function', {
    message: 'info must be a function',
  }),
  warn: z.any().refine((val) => typeof val === 'function', {
    message: 'warn must be a function',
  }),
  error: z.any().refine((val) => typeof val === 'function', {
    message: 'error must be a function',
  }),
});

const mcpServerBaseSchema = z.object({
  enabled: z.boolean().optional(),
  startupTimeoutSec: z.number().int().positive().optional(),
  toolTimeoutSec: z.number().int().positive().optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

const mcpServerStdioSchema = mcpServerBaseSchema.extend({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const mcpServerHttpSchema = mcpServerBaseSchema.extend({
  transport: z.literal('http'),
  url: z.string().min(1),
  bearerToken: z.string().optional(),
  bearerTokenEnvVar: z.string().optional(),
  httpHeaders: z.record(z.string(), z.string()).optional(),
  envHttpHeaders: z.record(z.string(), z.string()).optional(),
});

const mcpServerSchema = z.discriminatedUnion('transport', [
  mcpServerStdioSchema,
  mcpServerHttpSchema,
]);

export const mcpServersSchema = z.record(z.string(), mcpServerSchema);

const settingsSchema = z
  .object({
    codexPath: z.string().optional(),
    cwd: z.string().optional(),
    addDirs: z.array(z.string().min(1)).optional(),
    approvalMode: z.enum(['untrusted', 'on-failure', 'on-request', 'never']).optional(),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
    fullAuto: z.boolean().optional(),
    dangerouslyBypassApprovalsAndSandbox: z.boolean().optional(),
    skipGitRepoCheck: z.boolean().optional(),
    color: z.enum(['always', 'never', 'auto']).optional(),
    allowNpx: z.boolean().optional(),
    outputLastMessageFile: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    verbose: z.boolean().optional(),
    logger: z.union([z.literal(false), loggerFunctionSchema]).optional(),

    // NEW: Reasoning & Verbosity
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    // Note: API rejects 'concise' and 'none' despite error messages claiming they're valid
    reasoningSummary: z.enum(['auto', 'detailed']).optional(),
    reasoningSummaryFormat: z.enum(['none', 'experimental']).optional(),
    modelVerbosity: z.enum(['low', 'medium', 'high']).optional(),

    // NEW: Advanced features
    profile: z.string().optional(),
    oss: z.boolean().optional(),
    webSearch: z.boolean().optional(),
    mcpServers: mcpServersSchema.optional(),
    rmcpClient: z.boolean().optional(),

    // NEW: Generic overrides
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

export function validateSettings(settings: unknown): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const parsed = settingsSchema.safeParse(settings);
  if (!parsed.success) {
    // zod v3 => error.errors, zod v4 => error.issues
    type ZodIssueLike = { path?: (string | number)[]; message?: string };
    const raw = parsed.error as unknown;
    let issues: ZodIssueLike[] = [];
    if (raw && typeof raw === 'object') {
      const v4 = (raw as { issues?: unknown }).issues;
      const v3 = (raw as { errors?: unknown }).errors;
      if (Array.isArray(v4)) issues = v4 as ZodIssueLike[];
      else if (Array.isArray(v3)) issues = v3 as ZodIssueLike[];
    }
    for (const i of issues) {
      const path = Array.isArray(i?.path) ? i.path.join('.') : '';
      const message = i?.message || 'Invalid value';
      errors.push(`${path ? path + ': ' : ''}${message}`);
    }
    return { valid: false, warnings, errors };
  }

  const s = parsed.data as CodexCliSettings;
  if (s.fullAuto && s.dangerouslyBypassApprovalsAndSandbox) {
    warnings.push(
      'Both fullAuto and dangerouslyBypassApprovalsAndSandbox specified; fullAuto takes precedence.',
    );
  }

  // Note: Previously warned about reasoningSummary='none', but 'none' is now rejected
  // by the schema as an invalid value (only 'auto' and 'detailed' are accepted)

  return { valid: true, warnings, errors };
}

export function validateModelId(modelId: string): string | undefined {
  if (!modelId || modelId.trim() === '') return 'Model ID cannot be empty';
  // We don’t restrict model values here; Codex forwards to Responses API
  return undefined;
}
