import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.156.0', idleTimeoutMs: 30000 },
});

try {
  // Demonstrates custom CWD plus approval/sandbox policy options

  const model = appServer('gpt-6-sol', {
    cwd: process.cwd(),
    effort: 'medium',
    // Optional app-server style policy overrides:
    // approvalPolicy: 'on-request',
    // personality: 'pragmatic',
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const { text } = await generateText({
    model,
    prompt: 'In <= 10 words, say: custom config ok.',
  });

  console.log('Result:', text);
} finally {
  await appServer.close();
}
