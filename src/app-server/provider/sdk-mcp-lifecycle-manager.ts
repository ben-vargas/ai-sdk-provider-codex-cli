import type { SdkMcpServer } from '../../tools/sdk-mcp-server.js';
import type { Logger } from '../../types-shared.js';

export interface SdkMcpLifecycleManager {
  markUsed(server: SdkMcpServer, lifecycle: 'provider' | 'request'): void;
  releaseRequestScoped(server: SdkMcpServer): void;
  closeAll(): Promise<void>;
}

export function createSdkMcpLifecycleManager(logger: Logger): SdkMcpLifecycleManager {
  const managedSdkServers = new Set<SdkMcpServer>();
  const providerScopedSdkServers = new Set<SdkMcpServer>();
  const requestScopedSdkServerRefCounts = new Map<SdkMcpServer, number>();

  return {
    markUsed(server, lifecycle) {
      managedSdkServers.add(server);
      if (lifecycle === 'provider') {
        providerScopedSdkServers.add(server);
        return;
      }

      const current = requestScopedSdkServerRefCounts.get(server) ?? 0;
      requestScopedSdkServerRefCounts.set(server, current + 1);
    },

    releaseRequestScoped(server) {
      const current = requestScopedSdkServerRefCounts.get(server);
      if (current === undefined) {
        return;
      }
      if (current > 1) {
        requestScopedSdkServerRefCounts.set(server, current - 1);
        return;
      }

      requestScopedSdkServerRefCounts.delete(server);
      if (providerScopedSdkServers.has(server)) {
        return;
      }

      void server
        ._stop()
        .then(() => {
          if (
            !providerScopedSdkServers.has(server) &&
            !requestScopedSdkServerRefCounts.has(server)
          ) {
            managedSdkServers.delete(server);
          }
        })
        .catch((error) => {
          logger.warn(
            `[codex-app-server] Failed to stop request-scoped SDK MCP server: ${String(error)}`,
          );
        });
    },

    async closeAll() {
      await Promise.allSettled(
        Array.from(managedSdkServers).map(async (server) => {
          await server._stop();
        }),
      );
      managedSdkServers.clear();
      providerScopedSdkServers.clear();
      requestScopedSdkServerRefCounts.clear();
    },
  };
}
