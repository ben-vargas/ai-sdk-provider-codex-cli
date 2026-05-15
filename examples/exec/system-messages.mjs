#!/usr/bin/env node

import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.5', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const { text } = await generateText({
  model,
  system: 'You are a terse assistant. Always reply in exactly 3 words.',
  prompt: 'Describe TypeScript in a nutshell.',
});
console.log('System-influenced reply:', text);
