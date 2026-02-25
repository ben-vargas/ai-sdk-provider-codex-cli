// Run: node examples/app-server/local-mcp-tool.mjs

import { generateText } from 'ai';
import { z } from 'zod';
import { createCodexAppServer, createSdkMcpServer, tool } from 'ai-sdk-provider-codex-cli';

const addNumbers = tool({
  name: 'add_numbers',
  description: 'Adds two numbers and returns the sum.',
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => ({ sum: a + b }),
});

const mathServer = createSdkMcpServer({
  name: 'math-tools',
  tools: [addNumbers],
});

const provider = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.105.0-alpha.0',
    idleTimeoutMs: 30000,
    mcpServers: {
      math: mathServer,
    },
    approvalPolicy: 'on-request',
    effort: 'low',
  },
});

try {
  const result = await generateText({
    model: provider('gpt-5.3-codex'),
    prompt:
      'Use the math MCP tool to compute 41 + 1 and answer with the numeric result and one sentence.',
  });

  console.log(result.text);
} finally {
  await provider.close();
}
