import { streamText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const { textStream } = await streamText({
  model,
  prompt: 'Write a 1,000 word essay on the history of the internet.',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
process.stdout.write('\n');
