import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const defaultSettings = {
  minCodexVersion: '0.144.0',
  idleTimeoutMs: 30000,
};

const appServer = createCodexAppServer({ defaultSettings });

try {
  // Demonstrates custom CWD plus approval/sandbox policy options.
  const modelSettings = {
    cwd: process.cwd(),
    // Optional app-server style policy overrides:
    // approvalPolicy: 'on-request',
    // personality: 'pragmatic',
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  };

  console.log('Default app-server settings:', JSON.stringify(defaultSettings));
  console.log('Per-model settings:', JSON.stringify(modelSettings));

  const model = appServer('gpt-5.5', modelSettings);

  const { text } = await generateText({
    model,
    prompt: 'In <= 10 words, say: custom config ok.',
  });

  console.log('Result:', text);
} finally {
  await appServer.close();
}
