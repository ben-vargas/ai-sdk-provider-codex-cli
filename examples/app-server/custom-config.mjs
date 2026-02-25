import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0', idleTimeoutMs: 100 },
});

try {
  // Demonstrates custom CWD plus approval/sandbox policy options

  const model = appServer('gpt-5.1', {
    cwd: process.cwd(),
    // Optional app-server style policy overrides:
    // approvalPolicy: 'on-request',
    // personality: 'pragmatic',
    approvalMode: 'on-failure',
    sandboxMode: 'workspace-write',
  });

  const { text } = await generateText({
    model,
    prompt: 'In <= 10 words, say: custom config ok.',
  });

  console.log('Result:', text);
} finally {
  await appServer.close();
}
