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
      minCodexVersion: '0.105.0',
      sandboxPolicy: 'workspace-write',
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
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
