import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const { textStream } = await streamText({
    model,
    prompt: 'In exactly 3 short sentences, summarize the history of the internet.',
  });

  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
} finally {
  await appServer.close();
}
