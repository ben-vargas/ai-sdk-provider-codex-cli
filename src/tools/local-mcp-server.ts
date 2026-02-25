import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
  host?: string;
}

export interface LocalMcpServer {
  config: McpServerHttp;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export async function createLocalMcpServer(
  options: LocalMcpServerOptions,
): Promise<LocalMcpServer> {
  const { name, tools, port = 0, host = '127.0.0.1' } = options;
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

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
            content: [
              { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
            ],
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
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
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
        res.writeHead(202, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }

      const rpcResponse = await handleRpcRequest(payload);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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
  const url = `http://${host}:${actualPort}`;

  return {
    config: { transport: 'http', url },
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
