import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

// Demonstrates custom CWD and sandbox/approval options

const model = codexExec('gpt-5.3-codex', {
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
