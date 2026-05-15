// Run: node examples/app-server/session-injection.mjs

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.130.0',
    idleTimeoutMs: 30000,
    threadMode: 'persistent',
    effort: 'medium',
    sandboxPolicy: { type: 'readOnly' },
  },
});

try {
  const result = streamText({
    model: provider('gpt-5.5'),
    prompt:
      'Write a tiny Node.js function named parseCsvLine that parses one CSV line with no dependencies. Return one markdown code block only. Do not include explanations, usage examples, commands, or file writes.',
    providerOptions: {
      'codex-app-server': {
        onSessionCreated: (session) => {
          // Demonstrates mid-execution guidance while the turn is in-flight.
          setTimeout(() => {
            void session.injectMessage(
              'Update the code block to include basic input validation only. Keep exactly one markdown code block and no explanatory text.',
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
