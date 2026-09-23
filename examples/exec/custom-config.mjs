import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

// Demonstrates custom CWD and sandbox/approval options

const model = codexExec('gpt-6-sol', {
  reasoningEffort: 'medium',
  allowNpx: true,
  cwd: process.cwd(),
  skipGitRepoCheck: true,
  // try fully autonomous mode (be careful):
  // fullAuto: true, // deprecated since Codex CLI 0.147: defaults to workspace-write + approvalMode 'never'; explicit settings win
  approvalMode: 'on-request',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const { text } = await generateText({
  model,
  prompt: 'In <= 10 words, say: custom config ok.',
});

console.log('Result:', text);
