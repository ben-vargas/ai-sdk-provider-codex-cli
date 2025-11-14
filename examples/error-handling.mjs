#!/usr/bin/env node

import { generateText } from 'ai';
import { codexCli, isAuthenticationError } from '../dist/index.js';

const model = codexCli('gpt-5.1', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
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
