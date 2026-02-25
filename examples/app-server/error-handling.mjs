#!/usr/bin/env node

import { generateText } from 'ai';
import { createCodexAppServer, isAuthenticationError } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  try {
    const { text, warnings } = await generateText({
      model,
      prompt: 'Say hello in one short sentence.',
    });
    if (warnings?.length) {
      console.log('Warnings:');
      for (const w of warnings)
        console.log('-', w.type, w.setting || '', w.details || w.message || '');
    }
    console.log('Text:', text);
  } catch (err) {
    if (isAuthenticationError(err)) {
      console.error('Auth error. Try: codex login');
    } else {
      console.error('Unexpected error:', err);
    }
  }
} finally {
  await appServer.close();
}
