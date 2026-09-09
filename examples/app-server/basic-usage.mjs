import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.153.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-6-astra', {
    approvalPolicy: 'on-request',
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
