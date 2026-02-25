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
  defaultSettings: { minCodexVersion: '0.105.0', idleTimeoutMs: 100 },
});

try {
  async function run(label, settings) {
    const model = appServer('gpt-5.1', {
      ...settings,
    });
    const { text } = await generateText({ model, prompt: `Say the mode label: ${label}.` });
    console.log(`[${label}]`, text);
  }

  await run('on-failure + workspace-write', {
    approvalMode: 'on-failure',
    sandboxMode: 'workspace-write',
  });
  await run('on-request + read-only', {
    approvalMode: 'on-request',
    sandboxMode: 'read-only',
  });
  await run('never + danger-full-access', {
    approvalMode: 'never',
    sandboxMode: 'danger-full-access',
  });

  console.log('Note: These modes affect how Codex would execute tools/commands if needed.');
} finally {
  await appServer.close();
}
