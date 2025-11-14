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
  for (const w of warnings) console.log('-', w.type, w.setting || '', w.details || w.message || '');
}
