#!/usr/bin/env node

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const messages = [
    { role: 'system', content: 'You are a terse assistant. Always reply in exactly 3 words.' },
    { role: 'user', content: 'Describe TypeScript in a nutshell.' },
  ];

  const { text } = await generateText({ model, messages });
  console.log('System-influenced reply:', text);
} finally {
  await appServer.close();
}
