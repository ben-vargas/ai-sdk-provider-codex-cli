import { z } from 'zod';
import type { CodexCliSettings } from './types.js';

const settingsSchema = z
  .object({
    codexPath: z.string().optional(),
    cwd: z.string().optional(),
    approvalMode: z.enum(['untrusted', 'on-failure', 'on-request', 'never']).optional(),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
    fullAuto: z.boolean().optional(),
    dangerouslyBypassApprovalsAndSandbox: z.boolean().optional(),
    skipGitRepoCheck: z.boolean().optional(),
    color: z.enum(['always', 'never', 'auto']).optional(),
    allowNpx: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    verbose: z.boolean().optional(),
    logger: z.any().optional(),
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

  return { valid: true, warnings, errors };
}

export function validateModelId(modelId: string): string | undefined {
  if (!modelId || modelId.trim() === '') return 'Model ID cannot be empty';
  // We don’t restrict model values here; Codex forwards to Responses API
  return undefined;
}
