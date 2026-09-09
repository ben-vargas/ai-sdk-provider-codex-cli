import { describe, it, expect } from 'vitest';
import { validateAppServerSettings, validateSettings } from '../validation.js';

describe('validateSettings', () => {
  it('accepts minimal settings', () => {
    const res = validateSettings({});
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('warns when both autonomy flags are set', () => {
    const res = validateSettings({ fullAuto: true, dangerouslyBypassApprovalsAndSandbox: true });
    expect(res.valid).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('warns that fullAuto is deprecated and maps to workspace-write', () => {
    const res = validateSettings({ fullAuto: true });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => /fullAuto is deprecated/.test(w))).toBe(true);
    expect(res.warnings.some((w) => /workspace-write/.test(w))).toBe(true);
  });

  it('warns when fullAuto conflicts with an explicit sandboxMode', () => {
    const res = validateSettings({ fullAuto: true, sandboxMode: 'read-only' });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => /ignored because sandboxMode 'read-only'/.test(w))).toBe(true);
  });

  it('accepts the deprecated approvalMode on-failure with a warning', () => {
    const res = validateSettings({ approvalMode: 'on-failure' });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings.some((w) => /approvalMode 'on-failure' is deprecated/.test(w))).toBe(true);
  });

  it('does not warn for the current approvalMode values', () => {
    for (const approvalMode of ['untrusted', 'on-request', 'never'] as const) {
      const res = validateSettings({ approvalMode });
      expect(res.valid).toBe(true);
      expect(res.warnings.some((w) => /approvalMode/.test(w))).toBe(false);
    }
  });

  it('rejects invalid reasoningSummary value "none"', () => {
    const res = validateSettings({ reasoningEffort: 'high', reasoningSummary: 'none' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /reasoningSummary/i.test(e))).toBe(true);
  });

  it('rejects invalid reasoningSummary value "concise"', () => {
    const res = validateSettings({ reasoningEffort: 'high', reasoningSummary: 'concise' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /reasoningSummary/i.test(e))).toBe(true);
  });

  it('accepts xhigh reasoningEffort for max models', () => {
    const res = validateSettings({ reasoningEffort: 'xhigh' });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts none reasoningEffort (GPT-5.1+)', () => {
    const res = validateSettings({ reasoningEffort: 'none' });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts addDirs with valid paths', () => {
    const res = validateSettings({ addDirs: ['../shared', '/tmp/lib'] });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects addDirs with empty strings', () => {
    const res = validateSettings({ addDirs: ['valid', ''] });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /addDirs/i.test(e))).toBe(true);
  });

  it('accepts outputLastMessageFile', () => {
    const res = validateSettings({ outputLastMessageFile: '/tmp/last.txt' });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts app-server settings', () => {
    const res = validateAppServerSettings({
      codexPath: '/opt/homebrew/bin/codex',
      personality: 'pragmatic',
      minCodexVersion: '0.142.5',
      sandboxPolicy: 'workspace-write',
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts the granular app-server approvalPolicy object', () => {
    const res = validateAppServerSettings({
      approvalPolicy: {
        granular: { sandbox_approval: true, rules: false, mcp_elicitations: true },
      },
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
  });

  it('rejects a granular approvalPolicy missing required flags', () => {
    const res = validateAppServerSettings({
      approvalPolicy: { granular: { sandbox_approval: true } },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /approvalPolicy/i.test(e))).toBe(true);
  });

  it('warns for the deprecated on-failure app-server approvalPolicy', () => {
    const res = validateAppServerSettings({ approvalPolicy: 'on-failure' });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => /approvalPolicy 'on-failure' is deprecated/.test(w))).toBe(
      true,
    );
  });

  it('warns for the deprecated reject app-server approvalPolicy', () => {
    const res = validateAppServerSettings({
      approvalPolicy: { reject: { sandbox_approval: true, rules: true, mcp_elicitations: false } },
    });
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => /approvalPolicy \{ reject \} is deprecated/.test(w))).toBe(
      true,
    );
  });

  it('rejects invalid app-server minCodexVersion', () => {
    const res = validateAppServerSettings({
      minCodexVersion: 'bad-version',
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /minCodexVersion/i.test(e))).toBe(true);
  });

  it('accepts app-server serverRequests object', () => {
    const res = validateAppServerSettings({
      serverRequests: {
        onDynamicToolCall: async () => ({ contentItems: [], success: true }),
      },
      threadMode: 'persistent',
      requestTimeoutMs: 10_000,
      includeRawChunks: true,
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('accepts onMcpElicitation in app-server serverRequests', () => {
    const res = validateAppServerSettings({
      serverRequests: {
        onMcpElicitation: async () => ({ action: 'accept', content: {} }),
      },
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects invalid app-server serverRequests values', () => {
    const res = validateAppServerSettings({
      serverRequests: {
        onDynamicToolCall: 'not-a-function',
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /onDynamicToolCall/i.test(e))).toBe(true);
  });

  it('rejects deprecated app-server aliases', () => {
    const res = validateAppServerSettings({
      approvalMode: 'on-failure' as never,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /approvalMode/i.test(e))).toBe(true);
  });

  it('rejects invalid mcp server names', () => {
    const res = validateSettings({
      mcpServers: {
        'bad.name': {
          transport: 'stdio',
          command: 'node',
        },
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /mcpServers\.bad\.name/i.test(e))).toBe(true);
  });

  it('rejects mcp server names containing equals', () => {
    const res = validateSettings({
      mcpServers: {
        'a=b': {
          transport: 'stdio',
          command: 'node',
        },
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /mcpServers\.a=b/i.test(e))).toBe(true);
  });

  it('rejects mcp server names with surrounding whitespace', () => {
    const res = validateSettings({
      mcpServers: {
        ' local ': {
          transport: 'stdio',
          command: 'node',
        },
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /mcpServers\..*local/i.test(e))).toBe(true);
  });

  it('rejects invalid configOverrides keys', () => {
    const res = validateSettings({
      configOverrides: {
        'bad=key': 'value',
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /configOverrides\.bad=key/i.test(e))).toBe(true);
  });

  it('rejects configOverrides keys with empty path segments', () => {
    const res = validateSettings({
      configOverrides: {
        'x..y': 'value',
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /configOverrides\.x\.\.y/i.test(e))).toBe(true);
  });

  it('rejects configOverrides keys containing newlines', () => {
    const res = validateSettings({
      configOverrides: {
        'key\ninjection': 'value',
      },
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /configOverrides[\s\S]*injection/i.test(e))).toBe(true);
  });
});
