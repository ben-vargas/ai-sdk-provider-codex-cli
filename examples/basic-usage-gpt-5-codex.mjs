import { generateText } from 'ai';
import { codexCli } from '../dist/index.js';

const model = codexCli('gpt-5.1-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const { text } = await generateText({
  model,
  prompt: 'Reply with a single word: hello.',
});

console.log('Result:', text);
