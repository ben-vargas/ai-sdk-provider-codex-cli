import { createLocalMcpServer, type LocalMcpServer } from './local-mcp-server.js';
import type { LocalTool } from './tool-builder.js';

export const SDK_MCP_SERVER_MARKER = '__sdkMcpServer' as const;

export interface SdkMcpServer {
  readonly __sdkMcpServer: true;
  readonly name: string;
  readonly tools: LocalTool[];
  _server?: LocalMcpServer;
  _start(): Promise<{ transport: 'http'; url: string }>;
  _stop(): Promise<void>;
}

export interface SdkMcpServerOptions {
  name: string;
  tools: LocalTool[];
}

export function createSdkMcpServer(options: SdkMcpServerOptions): SdkMcpServer {
  const { name, tools } = options;

  let server: LocalMcpServer | undefined;
  let startPromise: Promise<{ transport: 'http'; url: string }> | undefined;

  return {
    __sdkMcpServer: true,
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
        return { transport: 'http' as const, url: server.url };
      })();

      return await startPromise;
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
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __sdkMcpServer?: unknown }).__sdkMcpServer === true &&
    typeof (value as { _start?: unknown })._start === 'function' &&
    typeof (value as { _stop?: unknown })._stop === 'function'
  );
}
