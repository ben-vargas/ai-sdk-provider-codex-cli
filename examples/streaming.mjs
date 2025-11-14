import { streamText } from 'ai';
import { codexCli } from '../dist/index.js';

const model = codexCli('gpt-5.1', {
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
