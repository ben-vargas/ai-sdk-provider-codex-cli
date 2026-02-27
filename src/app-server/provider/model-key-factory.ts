import type { CodexModelId } from '../../types-shared.js';
import type { CodexAppServerSettings } from '../types.js';
import { isSdkMcpServer } from '../../tools/sdk-mcp-server.js';
import type { ValueIdentityRegistry } from './value-identity-registry.js';

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export interface ModelKeyFactory {
  createPersistentModelKey(modelId: CodexModelId, settings: CodexAppServerSettings): string;
}

export function createModelKeyFactory(identityRegistry: ValueIdentityRegistry): ModelKeyFactory {
  const normalizeForModelKey = (value: unknown, seen = new WeakSet<object>()): unknown => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (typeof value === 'bigint') {
      return { __bigint: value.toString() };
    }

    if (typeof value === 'symbol') {
      return { __symbol: String(value) };
    }

    if (typeof value === 'function') {
      return {
        __functionIdentity: identityRegistry.functionIdentity(
          value as (...args: unknown[]) => unknown,
        ),
      };
    }

    if (Array.isArray(value)) {
      return value.map((item) => normalizeForModelKey(item, seen));
    }

    if (typeof value === 'object') {
      if (seen.has(value)) {
        return { __objectRef: identityRegistry.objectIdentity(value) };
      }
      seen.add(value);

      if (isSdkMcpServer(value)) {
        if (value.cacheKey) {
          return {
            __sdkMcpServerCacheKey: value.cacheKey,
          };
        }

        const tools = value.tools
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: normalizeForModelKey(tool.inputSchema, seen),
            // Function identity avoids conflating recreated tools whose source text is identical
            // but runtime closure state differs.
            execute: normalizeForModelKey(tool.execute, seen),
          }))
          .sort((left, right) => left.name.localeCompare(right.name));

        return {
          __sdkMcpServer: {
            name: value.name,
            tools,
          },
        };
      }

      if (!isPlainObject(value)) {
        return { __objectIdentity: identityRegistry.objectIdentity(value) };
      }

      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
        normalized[key] = normalizeForModelKey(value[key], seen);
      }
      return normalized;
    }

    return String(value);
  };

  return {
    createPersistentModelKey(modelId, settings) {
      const settingsForKey: Record<string, unknown> = {
        ...settings,
        logger:
          settings.logger === false
            ? false
            : settings.logger
              ? { __loggerIdentity: identityRegistry.loggerIdentity(settings.logger) }
              : undefined,
      };

      return JSON.stringify({
        modelId,
        settings: normalizeForModelKey(settingsForKey),
      });
    },
  };
}
