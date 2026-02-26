import { createLocalMcpServer, type LocalMcpServer } from './local-mcp-server.js';
import type { LocalTool } from './tool-builder.js';

export const SDK_MCP_SERVER_MARKER = Symbol.for('ai-sdk-provider-codex-cli.sdkMcpServer');

export interface SdkMcpServer {
  readonly [SDK_MCP_SERVER_MARKER]: true;
  readonly name: string;
  readonly tools: LocalTool[];
  _server?: LocalMcpServer;
  _start(): Promise<LocalMcpServer['config']>;
  _stop(): Promise<void>;
}

export interface SdkMcpServerOptions {
  name: string;
  tools: LocalTool[];
}

export function createSdkMcpServer(options: SdkMcpServerOptions): SdkMcpServer {
  const { name, tools } = options;

  let server: LocalMcpServer | undefined;
  let startPromise: Promise<LocalMcpServer['config']> | undefined;

  return {
    [SDK_MCP_SERVER_MARKER]: true,
    name,
    tools,
    get _server() {
      return server;
    },
    set _server(nextServer: LocalMcpServer | undefined) {
      server = nextServer;
    },
    async _start() {
      if (startPromise) {
        return await startPromise;
      }

      startPromise = (async () => {
        if (server) {
          await server.stop();
        }

        server = await createLocalMcpServer({ name, tools });
        return server.config;
      })();

      try {
        return await startPromise;
      } catch (error) {
        startPromise = undefined;
        throw error;
      }
    },
    async _stop() {
      if (server) {
        await server.stop();
        server = undefined;
      }
      startPromise = undefined;
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
