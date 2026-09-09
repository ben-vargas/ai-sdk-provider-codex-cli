#!/usr/bin/env node

/**
 * Permissions & Sandbox Modes (Codex App Server)
 *
 * Shows how to switch approval and sandbox policies. This example avoids
 * running any real commands; it just demonstrates configuration toggles.
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.153.0', idleTimeoutMs: 30000 },
});

try {
  async function run(label, settings) {
    const model = appServer('gpt-6-astra', {
      ...settings,
    });
    const { text } = await generateText({ model, prompt: `Say the mode label: ${label}.` });
    console.log(`[${label}]`, text);
  }

  await run('on-request + workspace-write', {
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite' },
  });
  await run('on-request + read-only', {
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'readOnly' },
  });
  await run('never + danger-full-access', {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
  });
  // Fine-grained control (codex app-server `granular` policy): flags set to
  // `true` are routed to your `serverRequests` handlers, `false` auto-rejects.
  await run('granular + read-only', {
    approvalPolicy: {
      granular: { sandbox_approval: true, rules: true, mcp_elicitations: false },
    },
    sandboxPolicy: { type: 'readOnly' },
  });

  console.log('Note: These modes affect how Codex would execute tools/commands if needed.');
} finally {
  await appServer.close();
}
