#!/usr/bin/env node

import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-6-astra', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-request',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const { text } = await generateText({
  model,
  instructions: 'You are a terse assistant. Always reply in exactly 3 words.',
  prompt: 'Describe TypeScript in a nutshell.',
});
console.log('System-influenced reply:', text);
