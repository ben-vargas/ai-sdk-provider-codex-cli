import { AppServerRpcClient } from '../rpc/client.js';
import type { CodexAppServerSettings } from '../types.js';
import type { ValueIdentityRegistry } from './value-identity-registry.js';

type ClientScopedSettings = Pick<
  CodexAppServerSettings,
  | 'codexPath'
  | 'cwd'
  | 'env'
  | 'logger'
  | 'connectionTimeoutMs'
  | 'requestTimeoutMs'
  | 'idleTimeoutMs'
  | 'minCodexVersion'
>;

function pickClientScopedSettings(settings: CodexAppServerSettings): ClientScopedSettings {
  return {
    codexPath: settings.codexPath,
    cwd: settings.cwd,
    env: settings.env,
    logger: settings.logger,
    connectionTimeoutMs: settings.connectionTimeoutMs,
    requestTimeoutMs: settings.requestTimeoutMs,
    idleTimeoutMs: settings.idleTimeoutMs,
    minCodexVersion: settings.minCodexVersion,
  };
}

function createClientKey(
  settings: ClientScopedSettings,
  identityRegistry: ValueIdentityRegistry,
): string {
  const envEntries =
    settings.env && Object.keys(settings.env).length > 0
      ? Object.entries(settings.env).sort(([a], [b]) => a.localeCompare(b))
      : undefined;

  return JSON.stringify({
    codexPath: settings.codexPath ?? null,
    cwd: settings.cwd ?? null,
    connectionTimeoutMs: settings.connectionTimeoutMs ?? null,
    requestTimeoutMs: settings.requestTimeoutMs ?? null,
    idleTimeoutMs: settings.idleTimeoutMs ?? null,
    minCodexVersion: settings.minCodexVersion ?? null,
    env: envEntries ?? null,
    logger: identityRegistry.loggerIdentity(settings.logger),
  });
}

export interface AppServerClientPool {
  getOrCreate(settings: CodexAppServerSettings): AppServerRpcClient;
  closeAll(): Promise<void>;
}

export function createAppServerClientPool(
  identityRegistry: ValueIdentityRegistry,
): AppServerClientPool {
  const sharedClients = new Map<string, AppServerRpcClient>();

  return {
    getOrCreate(settings) {
      const clientSettings = pickClientScopedSettings(settings);
      const key = createClientKey(clientSettings, identityRegistry);
      const existing = sharedClients.get(key);
      if (existing) {
        return existing;
      }

      const created = new AppServerRpcClient({
        settings: clientSettings,
        logger: clientSettings.logger,
      });
      sharedClients.set(key, created);
      return created;
    },
    async closeAll() {
      await Promise.allSettled(
        Array.from(sharedClients.values()).map(async (client) => {
          await client.close();
        }),
      );
      sharedClients.clear();
    },
  };
}
