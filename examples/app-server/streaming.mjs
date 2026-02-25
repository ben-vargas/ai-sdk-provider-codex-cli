import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0', idleTimeoutMs: 100 },
});

try {
  const model = appServer('gpt-5.1', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const { textStream } = await streamText({
    model,
    prompt: 'Write a 1,000 word essay on the history of the internet.',
  });

  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
} finally {
  await appServer.close();
}
