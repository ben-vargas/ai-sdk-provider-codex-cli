import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type {
  CodexConfigOverrideValue,
  McpServerConfig,
  McpServerHttp,
  McpServerStdio,
} from './types-shared.js';
import { assertValidConfigOverrideKey, assertValidMcpServerName } from './config-key-utils.js';

export function createEmptyCodexUsage(): LanguageModelV3Usage {
  return {
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
  };
}

export function mapCodexCliFinishReason(reason?: string): LanguageModelV3FinishReason {
  switch (reason) {
    case 'stop':
    case 'end_turn':
    case undefined:
      return { unified: 'stop', raw: reason };
    case 'length':
    case 'max_tokens':
      return { unified: 'length', raw: reason };
    case 'content_filter':
      return { unified: 'content-filter', raw: reason };
    case 'tool_calls':
      return { unified: 'tool-calls', raw: reason };
    case 'error':
      return { unified: 'error', raw: reason };
    default:
      return { unified: 'other', raw: reason };
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

export function sanitizeJsonSchema(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchema(item));
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (key === 'properties' && typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const props = val as Record<string, unknown>;
      const sanitizedProps: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(props)) {
        sanitizedProps[propName] = sanitizeJsonSchema(propSchema);
      }
      result[key] = sanitizedProps;
      continue;
    }

    if (
      key === '$schema' ||
      key === '$id' ||
      key === '$ref' ||
      key === '$defs' ||
      key === 'definitions' ||
      key === 'title' ||
      key === 'examples' ||
      key === 'default' ||
      key === 'format' ||
      key === 'pattern'
    ) {
      continue;
    }

    result[key] = sanitizeJsonSchema(val);
  }

  return result;
}

export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function mergeStringRecord(
  base?: Record<string, string>,
  override?: Record<string, string>,
): Record<string, string> | undefined {
  if (override !== undefined) {
    if (Object.keys(override).length === 0) return {};
    return { ...(base ?? {}), ...override };
  }
  if (base) return { ...base };
  return undefined;
}

export function mergeSingleMcpServer(
  existing: McpServerConfig | undefined,
  incoming: McpServerConfig,
): McpServerConfig {
  if (!existing || existing.transport !== incoming.transport) {
    return { ...incoming };
  }

  if (incoming.transport === 'stdio') {
    const baseStdio = existing as McpServerStdio;
    const result: McpServerConfig = {
      transport: 'stdio',
      command: incoming.command,
      args: incoming.args ?? baseStdio.args,
      env: mergeStringRecord(baseStdio.env, incoming.env),
      cwd: incoming.cwd ?? baseStdio.cwd,
      enabled: incoming.enabled ?? existing.enabled,
      startupTimeoutSec: incoming.startupTimeoutSec ?? existing.startupTimeoutSec,
      toolTimeoutSec: incoming.toolTimeoutSec ?? existing.toolTimeoutSec,
      enabledTools: incoming.enabledTools ?? existing.enabledTools,
      disabledTools: incoming.disabledTools ?? existing.disabledTools,
    };
    return result;
  }

  const baseHttp = existing as McpServerHttp;
  const hasIncomingAuth =
    incoming.bearerToken !== undefined || incoming.bearerTokenEnvVar !== undefined;
  const bearerToken = hasIncomingAuth ? incoming.bearerToken : baseHttp.bearerToken;
  const bearerTokenEnvVar = hasIncomingAuth
    ? incoming.bearerTokenEnvVar
    : baseHttp.bearerTokenEnvVar;

  const result: McpServerConfig = {
    transport: 'http',
    url: incoming.url,
    bearerToken,
    bearerTokenEnvVar,
    httpHeaders: mergeStringRecord(baseHttp.httpHeaders, incoming.httpHeaders),
    envHttpHeaders: mergeStringRecord(baseHttp.envHttpHeaders, incoming.envHttpHeaders),
    enabled: incoming.enabled ?? existing.enabled,
    startupTimeoutSec: incoming.startupTimeoutSec ?? existing.startupTimeoutSec,
    toolTimeoutSec: incoming.toolTimeoutSec ?? existing.toolTimeoutSec,
    enabledTools: incoming.enabledTools ?? existing.enabledTools,
    disabledTools: incoming.disabledTools ?? existing.disabledTools,
  };

  return result;
}

export function mergeMcpServers(
  base?: Record<string, McpServerConfig>,
  override?: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> | undefined {
  if (!base && !override) return undefined;

  const normalizedBase: Record<string, McpServerConfig> = {};
  for (const [rawName, server] of Object.entries(base ?? {})) {
    const name = assertValidMcpServerName(rawName);
    normalizedBase[name] = server;
  }

  if (!override) return normalizedBase;

  const merged: Record<string, McpServerConfig> = { ...normalizedBase };
  for (const [rawName, incoming] of Object.entries(override)) {
    const name = assertValidMcpServerName(rawName);
    const existing = merged[name];
    merged[name] = mergeSingleMcpServer(existing, incoming);
  }
  return merged;
}

export function mapUnsupportedSettingsWarnings(options: {
  temperature?: unknown;
  topP?: unknown;
  topK?: unknown;
  maxOutputTokens?: unknown;
  presencePenalty?: unknown;
  frequencyPenalty?: unknown;
  stopSequences?: unknown[];
  seed?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
}): SharedV3Warning[] {
  const unsupported: SharedV3Warning[] = [];
  const add = (setting: unknown, name: string) => {
    if (setting !== undefined) {
      unsupported.push({
        type: 'unsupported',
        feature: name,
        details: `Codex CLI does not support ${name}; it will be ignored.`,
      });
    }
  };

  add(options.temperature, 'temperature');
  add(options.topP, 'topP');
  add(options.topK, 'topK');
  add(options.maxOutputTokens, 'maxOutputTokens');
  add(options.presencePenalty, 'presencePenalty');
  add(options.frequencyPenalty, 'frequencyPenalty');
  add(options.stopSequences?.length ? options.stopSequences : undefined, 'stopSequences');
  add(options.seed, 'seed');
  add(options.tools, 'tools');
  add(options.toolChoice, 'toolChoice');

  return unsupported;
}

export function mcpServersToConfigOverrides(
  mcpServers?: Record<string, McpServerConfig>,
  rmcpClient?: boolean,
): Record<string, CodexConfigOverrideValue> {
  const overrides: Record<string, CodexConfigOverrideValue> = {};
  const setOverride = (key: string, value: CodexConfigOverrideValue) => {
    assertValidConfigOverrideKey(key);
    overrides[key] = value;
  };

  if (rmcpClient !== undefined) {
    setOverride('features.rmcp_client', rmcpClient);
  }

  if (!mcpServers) {
    return overrides;
  }

  for (const [rawName, server] of Object.entries(mcpServers)) {
    const name = assertValidMcpServerName(rawName);
    const prefix = `mcp_servers.${name}`;

    if (server.enabled !== undefined) {
      setOverride(`${prefix}.enabled`, server.enabled);
    }
    if (server.startupTimeoutSec !== undefined) {
      setOverride(`${prefix}.startup_timeout_sec`, server.startupTimeoutSec);
    }
    if (server.toolTimeoutSec !== undefined) {
      setOverride(`${prefix}.tool_timeout_sec`, server.toolTimeoutSec);
    }
    if (server.enabledTools !== undefined) {
      setOverride(`${prefix}.enabled_tools`, server.enabledTools);
    }
    if (server.disabledTools !== undefined) {
      setOverride(`${prefix}.disabled_tools`, server.disabledTools);
    }

    if (server.transport === 'stdio') {
      setOverride(`${prefix}.command`, server.command);
      if (server.args !== undefined) setOverride(`${prefix}.args`, server.args);
      if (server.env !== undefined) setOverride(`${prefix}.env`, server.env);
      if (server.cwd) setOverride(`${prefix}.cwd`, server.cwd);
    } else {
      setOverride(`${prefix}.url`, server.url);
      if (server.bearerToken !== undefined)
        setOverride(`${prefix}.bearer_token`, server.bearerToken);
      if (server.bearerTokenEnvVar !== undefined) {
        setOverride(`${prefix}.bearer_token_env_var`, server.bearerTokenEnvVar);
      }
      if (server.httpHeaders !== undefined)
        setOverride(`${prefix}.http_headers`, server.httpHeaders);
      if (server.envHttpHeaders !== undefined) {
        setOverride(`${prefix}.env_http_headers`, server.envHttpHeaders);
      }
    }
  }

  return overrides;
}
