#!/usr/bin/env node

/**
 * Conversation History (Codex App Server)
 *
 * Demonstrates stateful multi-turn chat by reusing threadId.
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
    threadMode: 'persistent',
  });

  const first = await generateText({
    model,
    prompt: 'My name is Dana. Say hi and remember it.',
  });
  console.log('Turn 1:', first.text);

  const threadId = first.providerMetadata?.['codex-app-server']?.threadId;
  if (!threadId) {
    throw new Error('No threadId returned from app-server provider.');
  }
  console.log('threadId:', threadId);

  const second = await generateText({
    model,
    prompt: 'What name did I tell you in the previous turn?',
    providerOptions: {
      'codex-app-server': { threadId },
    },
  });

  console.log('Turn 2:', second.text);
} finally {
  await appServer.close();
}
