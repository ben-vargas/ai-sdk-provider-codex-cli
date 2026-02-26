import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { McpServerHttp } from '../types-shared.js';
import type { LocalTool } from './tool-builder.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface LocalMcpServerOptions {
  name: string;
  tools: LocalTool[];
  port?: number;
  // Defaults to 127.0.0.1 and is validated as loopback unless explicitly opted out.
  host?: string;
  // When true, allows binding to non-loopback hosts (for advanced use only).
  allowNonLoopbackHost?: boolean;
}

export interface LocalMcpServer {
  // MCP HTTP transport config, including the per-instance bearer token.
  config: McpServerHttp;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

function normalizeHost(host: string): string {
  const trimmed = host.trim();
  const unwrapped =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return unwrapped.toLowerCase();
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('127.')
  );
}

function formatHttpUrlHost(host: string): string {
  const normalized = normalizeHost(host);
  return normalized.includes(':') ? `[${normalized}]` : normalized;
}

function serializeToolResultToText(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  const json = JSON.stringify(result);
  if (json !== undefined) {
    return json;
  }

  return String(result);
}

export async function createLocalMcpServer(
  options: LocalMcpServerOptions,
): Promise<LocalMcpServer> {
  const { name, tools, port = 0, host = '127.0.0.1', allowNonLoopbackHost = false } = options;
  if (!isLoopbackHost(host) && !allowNonLoopbackHost) {
    throw new Error(
      `Refusing to bind local MCP server to non-loopback host '${host}'. ` +
        'Set allowNonLoopbackHost: true to override.',
    );
  }
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const bearerToken = randomBytes(32).toString('hex');
  const expectedAuthorizationHeader = `Bearer ${bearerToken}`;

  const handleRpcRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const id = request.id;

    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name, version: '1.0.0' },
        },
      };
    }

    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };
    }

    if (request.method === 'tools/call') {
      const toolName = typeof request.params?.name === 'string' ? request.params.name : undefined;
      const toolArgs = request.params?.arguments;

      if (!toolName || !toolMap.has(toolName)) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown tool: ${String(toolName)}` },
        };
      }

      const tool = toolMap.get(toolName)!;
      try {
        const result = await tool.execute(toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: serializeToolResultToText(result) }],
          },
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    if (request.method === 'notifications/initialized') {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${request.method}`,
      },
    };
  };

  const httpHandler = (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const contentType = req.headers['content-type'];
      if (typeof contentType !== 'string' || !contentType.includes('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unsupported media type' }));
        return;
      }

      const authorization = req.headers.authorization;
      if (authorization !== expectedAuthorizationHeader) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const chunks: Buffer[] = [];
      let bodyBytes = 0;
      for await (const chunk of req) {
        const buffer = chunk as Buffer;
        bodyBytes += buffer.length;
        if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
        chunks.push(buffer);
      }

      let payload: JsonRpcRequest;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcRequest;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }),
        );
        return;
      }

      if (payload.id === undefined) {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end();
        return;
      }

      const rpcResponse = await handleRpcRequest(payload);
      res.writeHead(200, {
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify(rpcResponse));
    })();
  };

  const server: Server = createServer(httpHandler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve local MCP server address');
  }

  const actualPort = address.port;
  const url = `http://${formatHttpUrlHost(host)}:${actualPort}`;

  return {
    config: { transport: 'http', url, bearerToken },
    url,
    port: actualPort,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
