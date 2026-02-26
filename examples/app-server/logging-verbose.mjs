/**
 * Verbose Logging Example
 *
 * Run: node examples/app-server/logging-verbose.mjs
 *
 * This example demonstrates verbose logging mode.
 * When verbose: true is set, you'll see detailed debug and info logs
 * that help you understand what's happening under the hood.
 *
 * Expected output:
 * - Debug logs showing detailed execution trace
 * - Info logs about request/response flow
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
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    console.log('=== Verbose Logging Mode ===\n');
    console.log('Expected behavior:');
    console.log('- Debug logs showing internal details');
    console.log('- Info logs about execution flow');
    console.log('- Full visibility into what the provider is doing\n');

    try {
      // Enable verbose logging to see debug and info messages
      const result = streamText({
        model: appServer('gpt-5.3-codex', {
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

      console.log('\n Notice: Debug and info logs appeared above');
      console.log('  Verbose mode provides detailed execution information');
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
