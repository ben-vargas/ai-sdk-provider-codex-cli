import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.3-codex', {
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
