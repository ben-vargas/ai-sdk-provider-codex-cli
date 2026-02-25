import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0', idleTimeoutMs: 100 },
});

try {
  const model = appServer('gpt-5.1-codex', {
    approvalMode: 'on-failure',
    sandboxMode: 'workspace-write',
  });

  const { text } = await generateText({
    model,
    prompt: 'Reply with a single word: hello.',
  });

  console.log('Result:', text);
} finally {
  await appServer.close();
}
