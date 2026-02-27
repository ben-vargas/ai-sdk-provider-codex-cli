import { describe, expect, it } from 'vitest';
import {
  createEmptyCodexUsage,
  isPlainObject,
  mapCodexCliFinishReason,
  mapUnsupportedSettingsWarnings,
  mcpServersToConfigOverrides,
  mergeSingleMcpServer,
  mergeStringRecord,
  safeStringify,
  mergeMcpServers,
  sanitizeJsonSchema,
} from '../shared-utils.js';

describe('shared-utils', () => {
  it('creates empty usage shape', () => {
    expect(createEmptyCodexUsage()).toEqual({
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
      raw: undefined,
    });
  });

  it('maps finish reasons', () => {
    expect(mapCodexCliFinishReason('stop')).toEqual({ unified: 'stop', raw: 'stop' });
    expect(mapCodexCliFinishReason('length')).toEqual({ unified: 'length', raw: 'length' });
    expect(mapCodexCliFinishReason('other')).toEqual({ unified: 'other', raw: 'other' });
  });

  it('sanitizes unsupported schema keys', () => {
    const sanitized = sanitizeJsonSchema({
      type: 'object',
      title: 'Title',
      properties: {
        a: { type: 'string', format: 'email' },
      },
    });

    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
    });
  });

  it('merges mcp servers deeply by name', () => {
    const merged = mergeMcpServers(
      {
        s1: { transport: 'stdio', command: 'node', args: ['a'], env: { A: '1' } },
      },
      {
        s1: { transport: 'stdio', command: 'node', env: { B: '2' } },
      },
    );

    expect(merged?.s1).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['a'],
      env: { A: '1', B: '2' },
      cwd: undefined,
      enabled: undefined,
      startupTimeoutSec: undefined,
      toolTimeoutSec: undefined,
      enabledTools: undefined,
      disabledTools: undefined,
    });
  });

  it('mergeSingleMcpServer merges http auth bundle and headers', () => {
    const merged = mergeSingleMcpServer(
      {
        transport: 'http',
        url: 'https://old',
        bearerToken: 'old-token',
        httpHeaders: { A: '1' },
      },
      {
        transport: 'http',
        url: 'https://new',
        bearerTokenEnvVar: 'TOKEN_ENV',
        httpHeaders: { B: '2' },
      },
    );

    expect(merged).toEqual({
      transport: 'http',
      url: 'https://new',
      bearerToken: undefined,
      bearerTokenEnvVar: 'TOKEN_ENV',
      httpHeaders: { A: '1', B: '2' },
      envHttpHeaders: undefined,
      enabled: undefined,
      startupTimeoutSec: undefined,
      toolTimeoutSec: undefined,
      enabledTools: undefined,
      disabledTools: undefined,
    });
  });

  it('mergeStringRecord handles empty override as clear', () => {
    expect(mergeStringRecord({ A: '1' }, {})).toEqual({});
    expect(mergeStringRecord({ A: '1' }, { B: '2' })).toEqual({ A: '1', B: '2' });
  });

  it('isPlainObject excludes arrays/null and accepts object literals', () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
  });

  it('safeStringify handles strings, objects, and circular references', () => {
    expect(safeStringify('plain')).toBe('plain');
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStringify(circular)).toContain('[object Object]');
  });

  it('maps unsupported settings warnings', () => {
    const warnings = mapUnsupportedSettingsWarnings({
      temperature: 0.2,
      topP: 0.9,
      topK: 10,
      maxOutputTokens: 256,
      presencePenalty: 1,
      frequencyPenalty: 1,
      stopSequences: ['stop'],
      seed: 42,
      tools: [{ name: 'x' }],
      toolChoice: { type: 'tool', toolName: 'x' },
    });

    expect(warnings).toHaveLength(10);
    expect(warnings.every((warning) => warning.type === 'unsupported')).toBe(true);
    const features = warnings
      .map((warning) => (warning.type === 'unsupported' ? warning.feature : undefined))
      .filter((feature): feature is string => typeof feature === 'string');
    expect(features).toContain('maxOutputTokens');
    expect(features).toContain('tools');
    expect(features).toContain('toolChoice');
  });

  it('converts MCP settings into config override keys', () => {
    const overrides = mcpServersToConfigOverrides(
      {
        local: { transport: 'stdio', command: 'node', args: ['server.js'] },
        remote: {
          transport: 'http',
          url: 'https://mcp.example.com',
          bearerTokenEnvVar: 'TOKEN_ENV',
        },
      },
      true,
    );

    expect(overrides['features.rmcp_client']).toBe(true);
    expect(overrides['mcp_servers.local.command']).toBe('node');
    expect(overrides['mcp_servers.local.args']).toEqual(['server.js']);
    expect(overrides['mcp_servers.remote.url']).toBe('https://mcp.example.com');
    expect(overrides['mcp_servers.remote.bearer_token_env_var']).toBe('TOKEN_ENV');
  });

  it('rejects invalid MCP server names consistently during merge and override mapping', () => {
    expect(() =>
      mergeMcpServers(
        {
          ' local ': { transport: 'stdio', command: 'node' },
        },
        undefined,
      ),
    ).toThrow(/Invalid MCP server name/);

    expect(() =>
      mcpServersToConfigOverrides({
        'bad.name': { transport: 'stdio', command: 'node' },
      }),
    ).toThrow(/Invalid MCP server name/);
  });

  it('rejects MCP server names containing equals in both merge and override mapping', () => {
    expect(() =>
      mergeMcpServers(
        {
          'a=b': { transport: 'stdio', command: 'node' },
        },
        undefined,
      ),
    ).toThrow(/Invalid MCP server name/);

    expect(() =>
      mcpServersToConfigOverrides({
        'a=b': { transport: 'stdio', command: 'node' },
      }),
    ).toThrow(/Invalid MCP server name/);
  });

  it('rejects whitespace-wrapped MCP names in both merge and override mapping', () => {
    expect(() =>
      mergeMcpServers(
        {
          ' local ': { transport: 'stdio', command: 'node' },
        },
        undefined,
      ),
    ).toThrow(/Invalid MCP server name/);

    expect(() =>
      mcpServersToConfigOverrides({
        ' local ': { transport: 'stdio', command: 'node' },
      }),
    ).toThrow(/Invalid MCP server name/);
  });
});
