import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    includeRawChunks: true,
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const result = streamText({
    model,
    prompt: 'Give a short two-sentence summary of why tests matter.',
  });

  let text = '';
  let rawChunkCount = 0;

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.textDelta;
    }

    if (part.type === 'raw') {
      rawChunkCount += 1;
    }
  }

  console.log('Text:', text.trim());
  console.log('Raw chunk count:', rawChunkCount);
  console.log('Raw chunks example complete.');
} finally {
  await appServer.close();
}
