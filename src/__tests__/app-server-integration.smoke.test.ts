import { describe, expect, it } from 'vitest';
import { generateText } from 'ai';
import { createCodexAppServer } from '../app-server/provider.js';

const runIntegration = process.env.CODEX_APP_SERVER_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('app-server integration smoke', () => {
  it(
    'runs a real initialize + turn + stateful follow-up against codex app-server',
    { timeout: 180_000 },
    async () => {
      const codexPath = process.env.CODEX_APP_SERVER_INTEGRATION_CODEX_PATH;
      const modelId = process.env.CODEX_APP_SERVER_INTEGRATION_MODEL ?? 'gpt-5.3-codex';
      const provider = createCodexAppServer({
        defaultSettings: {
          minCodexVersion: '0.105.0',
          connectionTimeoutMs: 60_000,
          codexPath,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
        },
      });

      try {
        const first = await generateText({
          model: provider(modelId),
          prompt: 'Reply with one short word.',
        });
        expect(first.text.trim().length).toBeGreaterThan(0);

        const threadId = first.providerMetadata?.['codex-app-server']?.threadId;
        expect(typeof threadId).toBe('string');

        const second = await generateText({
          model: provider(modelId),
          prompt: 'Reply with another short word.',
          providerOptions: { 'codex-app-server': { threadId } },
        });
        expect(second.text.trim().length).toBeGreaterThan(0);
      } finally {
        await provider.close();
      }
    },
  );
});
