#!/usr/bin/env node

import { generateText } from 'ai';
import { codexCli } from '../dist/index.js';

const model = codexCli('gpt-5.1', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const messages = [
  { role: 'system', content: 'You are a terse assistant. Always reply in exactly 3 words.' },
  { role: 'user', content: 'Describe TypeScript in a nutshell.' },
];

const { text } = await generateText({ model, messages });
console.log('System-influenced reply:', text);
