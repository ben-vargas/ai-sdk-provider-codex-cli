#!/usr/bin/env node

/**
 * Conversation History (Codex CLI)
 *
 * Demonstrates how to maintain context using a message array.
 */

import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-6-astra', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-request',
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
