// Run: node examples/app-server/session-injection.mjs

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.105.0-alpha.0',
    idleTimeoutMs: 30000,
    threadMode: 'persistent',
    effort: 'medium',
    sandboxPolicy: { type: 'readOnly' },
  },
});

try {
  const result = streamText({
    model: provider('gpt-5.3-codex'),
    prompt:
      'Write a tiny Node.js utility that parses CSV with no dependencies. Return code in a single markdown code block only. Do not run commands or write files.',
    providerOptions: {
      'codex-app-server': {
        onSessionCreated: (session) => {
          // Demonstrates mid-execution guidance while the turn is in-flight.
          setTimeout(() => {
            void session.injectMessage(
              'Also include basic input validation and one usage example. Keep this as response text only (no command execution, no file writes).',
            );
          }, 500);
        },
      },
    },
  });

  for await (const textChunk of result.textStream) {
    process.stdout.write(textChunk);
  }
  process.stdout.write('\n');
} finally {
  await provider.close();
}
