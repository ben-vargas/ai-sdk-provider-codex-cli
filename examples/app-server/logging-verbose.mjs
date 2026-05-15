/**
 * Verbose Logging Example
 *
 * Run: node examples/app-server/logging-verbose.mjs
 *
 * This example demonstrates verbose logging mode for the app-server provider.
 * The app-server path keeps most protocol traffic structured rather than
 * logging every request, so verbose mode is most visible through provider
 * lifecycle and diagnostic messages.
 *
 * Expected output:
 * - Provider/app-server diagnostic logs when available
 * - Lifecycle info about the app-server process
 * - Warn/error logs if issues occur
 * - Much more detailed output for troubleshooting
 *
 * Use verbose mode when:
 * - Debugging issues
 * - Understanding the provider's behavior
 * - Developing and testing
 */

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.130.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    console.log('=== Verbose Logging Mode ===\n');
    console.log('Expected behavior:');
    console.log('- Provider/app-server diagnostic logs when available');
    console.log('- Lifecycle info about the app-server process');
    console.log('- More visibility than the disabled logger mode\n');

    try {
      // Enable verbose logging to surface provider diagnostics when available.
      const result = streamText({
        model: appServer('gpt-5.5', {
          approvalPolicy: 'on-failure',
          sandboxPolicy: { type: 'workspaceWrite' },
          verbose: true, // Enable verbose logging
        }),
        prompt: 'Say hello in 5 words',
      });

      // Stream the response
      console.log('\nResponse:');
      for await (const textPart of result.textStream) {
        process.stdout.write(textPart);
      }
      console.log('\n');

      // Get usage info
      const usage = await result.usage;
      console.log('Token usage:', usage);

      console.log('\n Notice: Provider diagnostics may appear above');
      console.log('  Verbose mode keeps app-server lifecycle messages visible');
      console.log('  This is helpful for development and troubleshooting');
    } catch (error) {
      console.error('Error:', error);
      console.log('\n Troubleshooting:');
      console.log('1. Install Codex CLI: npm install -g @openai/codex');
      console.log('2. Authenticate: codex login (or set OPENAI_API_KEY)');
      console.log('3. Run check-cli.mjs to verify setup');
    }
  }

  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} finally {
  await appServer.close();
}
