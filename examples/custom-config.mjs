import { generateText } from 'ai';
import { codexCli } from '../dist/index.js';

// Demonstrates custom CWD and sandbox/approval options

const model = codexCli('gpt-5.1', {
  allowNpx: true,
  cwd: process.cwd(),
  skipGitRepoCheck: true,
  // try fully autonomous mode (be careful):
  // fullAuto: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const { text } = await generateText({
  model,
  prompt: 'In <= 10 words, say: custom config ok.',
});

console.log('Result:', text);
