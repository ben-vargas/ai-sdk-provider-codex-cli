import { createLocalMcpServer, type LocalMcpServer } from './local-mcp-server.js';
import type { LocalTool } from './tool-builder.js';

export const SDK_MCP_SERVER_MARKER = Symbol.for('ai-sdk-provider-codex-cli.sdkMcpServer');

export interface SdkMcpServer {
  readonly [SDK_MCP_SERVER_MARKER]: true;
  readonly name: string;
  readonly cacheKey?: string;
  readonly tools: LocalTool[];
  _server?: LocalMcpServer;
  _start(): Promise<LocalMcpServer['config']>;
  _stop(): Promise<void>;
}

export interface SdkMcpServerOptions {
  name: string;
  cacheKey?: string;
  tools: LocalTool[];
}

export function createSdkMcpServer(options: SdkMcpServerOptions): SdkMcpServer {
  const { name, cacheKey, tools } = options;

  let server: LocalMcpServer | undefined;
  let startPromise: Promise<LocalMcpServer> | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    [SDK_MCP_SERVER_MARKER]: true,
    name,
    cacheKey: cacheKey?.trim() || undefined,
    tools,
    get _server() {
      return server;
    },
    set _server(nextServer: LocalMcpServer | undefined) {
      server = nextServer;
    },
    async _start() {
      while (true) {
        if (server) {
          return server.config;
        }

        if (startPromise) {
          const started = await startPromise;
          return started.config;
        }

        if (stopPromise) {
          await stopPromise;
          continue;
        }

        const startup = (async () => {
          const created = await createLocalMcpServer({ name, tools });
          server = created;
          return created;
        })();
        startPromise = startup;

        try {
          const started = await startup;
          return started.config;
        } finally {
          if (startPromise === startup) {
            startPromise = undefined;
          }
        }
      }
    },
    async _stop() {
      if (stopPromise) {
        await stopPromise;
        return;
      }

      const stopping = (async () => {
        if (startPromise) {
          await startPromise.catch(() => undefined);
        }

        const serverToStop = server;
        server = undefined;
        if (serverToStop) {
          await serverToStop.stop();
        }
      })();
      stopPromise = stopping;

      try {
        await stopping;
      } finally {
        if (stopPromise === stopping) {
          stopPromise = undefined;
        }
        startPromise = undefined;
      }
    },
  };
}

export function isSdkMcpServer(value: unknown): value is SdkMcpServer {
  const marker =
    typeof value === 'object' && value !== null
      ? (value as Record<PropertyKey, unknown>)[SDK_MCP_SERVER_MARKER]
      : undefined;
  return (
    typeof value === 'object' &&
    value !== null &&
    marker === true &&
    typeof (value as { _start?: unknown })._start === 'function' &&
    typeof (value as { _stop?: unknown })._stop === 'function'
  );
}
