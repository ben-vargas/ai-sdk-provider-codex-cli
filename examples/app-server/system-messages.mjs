#!/usr/bin/env node

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.130.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.5', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const { text } = await generateText({
    model,
    system: 'You are a terse assistant. Always reply in exactly 3 words.',
    prompt: 'Describe TypeScript in a nutshell.',
  });
  console.log('System-influenced reply:', text);
} finally {
  await appServer.close();
}
