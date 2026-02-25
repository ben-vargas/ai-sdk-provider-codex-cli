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
        total: 0,
        noCache: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: 0,
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
      presencePenalty: 1,
      frequencyPenalty: 1,
      stopSequences: ['stop'],
      seed: 42,
    });

    expect(warnings).toHaveLength(7);
    expect(warnings.every((warning) => warning.type === 'unsupported')).toBe(true);
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
});
