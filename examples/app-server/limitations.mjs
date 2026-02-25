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

  const { text, warnings } = await generateText({
    model,
    prompt: 'Briefly explain what a stream is.',
    temperature: 0.9,
    topP: 0.5,
    topK: 20,
    presencePenalty: 0.7,
    frequencyPenalty: 0.3,
    stopSequences: ['.'],
  });

  console.log('Text:', text);
  if (warnings?.length) {
    console.log('\nProvider warnings (unsupported settings were ignored):');
    for (const w of warnings)
      console.log('-', w.type, w.setting || '', w.details || w.message || '');
  }
} finally {
  await appServer.close();
}
