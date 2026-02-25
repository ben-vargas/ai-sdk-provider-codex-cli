#!/usr/bin/env node

/**
 * Long Running Tasks with Abort (Codex CLI)
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
  });

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error('Timeout after 10s')), 10_000);

  try {
    const { text } = await generateText({
      model,
      prompt: 'Write a detailed 5-paragraph essay on scalable monorepo design.',
      abortSignal: ac.signal,
    });
    console.log('Result:', text.slice(0, 300) + '...');
  } catch (err) {
    console.error('Aborted:', err?.message || String(err));
  } finally {
    clearTimeout(timeout);
  }
} finally {
  await appServer.close();
}
