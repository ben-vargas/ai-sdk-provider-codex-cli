import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const result = await generateText({
    model,
    prompt: 'Reply with one short sentence about automated testing.',
  });

  console.log('Text:', result.text.trim());
  console.log('Usage:', {
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    totalTokens: result.usage?.totalTokens ?? 0,
  });

  const metadata = result.providerMetadata?.['codex-app-server'] ?? {};
  console.log('Provider metadata keys:', Object.keys(metadata));
  console.log('Usage metadata example complete.');
} finally {
  await appServer.close();
}
