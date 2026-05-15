import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.130.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.5', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const { text } = await generateText({
    model,
    prompt: 'Reply with a single word: hello.',
  });

  console.log('Result:', text);
} finally {
  await appServer.close();
}
