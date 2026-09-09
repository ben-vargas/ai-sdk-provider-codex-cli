// Run: node examples/app-server/session-injection.mjs

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.153.0',
    idleTimeoutMs: 30000,
    threadMode: 'persistent',
    effort: 'medium',
    sandboxPolicy: { type: 'readOnly' },
  },
});

try {
  const result = streamText({
    model: provider('gpt-6-astra'),
    prompt:
      'Write a tiny Node.js function named parseCsvLine that parses one CSV line with no dependencies. Start with one markdown code block. If you receive follow-up guidance while writing, append a second revised markdown code block rather than trying to erase earlier streamed text.',
    providerOptions: {
      'codex-app-server': {
        onSessionCreated: (session) => {
          // Demonstrates mid-execution guidance while the turn is in-flight.
          setTimeout(() => {
            void session.injectMessage(
              'Append a second revised markdown code block that includes basic input validation. Prefix it with "Revised version:" and do not erase the original streamed block.',
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
