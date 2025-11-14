#!/usr/bin/env node

/**
 * Conversation History (Codex CLI)
 *
 * Demonstrates how to maintain context using a message array.
 */

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
  { role: 'user', content: 'My name is Dana.' },
  { role: 'assistant', content: 'Hi Dana! How can I help you today?' },
  { role: 'user', content: 'What did I just tell you my name was?' },
];

const { text } = await generateText({ model, messages });
console.log('Assistant:', text);
